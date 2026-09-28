  /**
   * Filters exact JSONL record bytes by inclusive timestamp bounds.
   *
   * @param {Uint8Array} bytes - Complete JSONL bytes.
   * @param {number|null} lowerMs - Inclusive lower bound.
   * @param {number|null} upperMs - Inclusive upper bound.
   * @returns {Object} Exact accepted bytes and accepted timestamp range.
   */
  function communicationLogFilterJsonlBytes(bytes, lowerMs, upperMs) {
    const parts = [];
    let total = 0;
    let startTimestamp = null;
    let endTimestamp = null;
    let lineStart = 0;
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] !== 10) continue;
      const line = bytes.subarray(lineStart, index);
      const complete = bytes.subarray(lineStart, index + 1);
      lineStart = index + 1;
      if (!line.byteLength) continue;
      let record;
      try {
        record = JSON.parse(new TextDecoder().decode(line));
      } catch {
        continue;
      }
      const timestamp = typeof record?.timestamp === 'string'
        ? record.timestamp
        : null;
      const time = timestamp ? Date.parse(timestamp) : NaN;
      if (!Number.isFinite(time)) continue;
      if (lowerMs !== null && time < lowerMs) continue;
      if (upperMs !== null && time > upperMs) continue;
      parts.push(complete);
      total += complete.byteLength;
      startTimestamp ??= timestamp;
      endTimestamp = timestamp;
    }
    const accepted = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      accepted.set(part, offset);
      offset += part.byteLength;
    }
    return {
      bytes: accepted,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp
    };
  }

  /**
   * Streams one frozen Duplicate plan through one continuously open 7z writer.
   *
   * @param {Object} plan - Frozen historical membership and active EOF.
   * @param {Object} options - Optional ISO lower/upper timestamp bounds.
   * @returns {Promise<Object>} Compressed archive and accepted timestamp range.
   */
  async function communicationLogStreamDuplicateArchive(plan, options = {}) {
    /**
     * Parses one optional inclusive Duplicate timestamp bound.
     *
     * @param {unknown} value - User-supplied timestamp bound.
     * @param {string} label - Diagnostic bound name.
     * @returns {number|null} Parsed epoch milliseconds, or null when omitted.
     */
    const parseBound = (value, label) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Date.parse(String(value));
      if (!Number.isFinite(parsed)) throw new Error(`Invalid Duplicate ${label} bound.`);
      return parsed;
    };
    const lowerMs = parseBound(options.start_timestamp, 'start');
    const upperMs = parseBound(options.end_timestamp, 'end');
    if (lowerMs !== null && upperMs !== null && lowerMs > upperMs) {
      throw new Error('Duplicate start bound is after its end bound.');
    }

    const ordered = [...plan.segments].sort((left, right) =>
      String(left.start_timestamp).localeCompare(String(right.start_timestamp))
      || String(left.end_timestamp).localeCompare(String(right.end_timestamp))
    );
    const prepared = [];
    let expectedBytes = 0;
    let startTimestamp = null;
    let endTimestamp = null;

    for (const segment of ordered) {
      const segmentStart = Date.parse(segment.start_timestamp);
      const segmentEnd = Date.parse(segment.end_timestamp);
      if ((lowerMs !== null && segmentEnd < lowerMs)
          || (upperMs !== null && segmentStart > upperMs)) continue;
      const whole = (lowerMs === null || segmentStart >= lowerMs)
        && (upperMs === null || segmentEnd <= upperMs);
      if (whole) {
        prepared.push({ segment, whole: true });
        expectedBytes += segment.raw_bytes;
        startTimestamp ??= segment.start_timestamp;
        endTimestamp = segment.end_timestamp;
        continue;
      }
      const raw = await communicationLogReadHistoricalSegment(segment);
      const filtered = communicationLogFilterJsonlBytes(raw, lowerMs, upperMs);
      if (!filtered.bytes.byteLength) continue;
      prepared.push({ segment, whole: false });
      expectedBytes += filtered.bytes.byteLength;
      startTimestamp ??= filtered.start_timestamp;
      endTimestamp = filtered.end_timestamp;
    }

    const activeHandle = await communicationLogSegmentDirectoryHandle.getFileHandle(
      plan.active_name,
      { create: false }
    );
    const activeFile = await activeHandle.getFile();
    if (activeFile.size < plan.active_eof) {
      throw new Error('Frozen active communication prefix became shorter during Duplicate.');
    }
    const activeRaw = new Uint8Array(
      await activeFile.slice(0, plan.active_eof).arrayBuffer()
    );
    const activeFiltered = communicationLogFilterJsonlBytes(
      activeRaw,
      lowerMs,
      upperMs
    );
    expectedBytes += activeFiltered.bytes.byteLength;
    startTimestamp ??= activeFiltered.start_timestamp;
    endTimestamp = activeFiltered.end_timestamp ?? endTimestamp;

    if (!startTimestamp || !endTimestamp || expectedBytes === 0) {
      throw new Error('Duplicate bounds contain no trustworthy communication records.');
    }
    const range = {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp
    };
    const base = communicationLogFileName.replace(/\.jsonl$/i, '');
    const archiveName = await communicationLogUnusedRoleArchiveName(
      communicationLogDirectoryHandle,
      base,
      range,
      'comm'
    );
    const memberName = communicationLogAsciiArchiveMemberName(
      archiveName.replace(/\.comm\.7z$/i, '.jsonl')
    );
    const writer = await streaming7zWriterBegin(memberName, expectedBytes);
    try {
      for (const item of prepared) {
        if (!item.whole) {
          const raw = await communicationLogReadHistoricalSegment(item.segment);
          const filtered = communicationLogFilterJsonlBytes(raw, lowerMs, upperMs);
          streaming7zWriterAppendBytes(writer, filtered.bytes);
          continue;
        }
        if (item.segment.compression_state === 'compressed') {
          const archiveHandle =
            await communicationLogSegmentDirectoryHandle.getFileHandle(
              item.segment.archive_name,
              { create: false }
            );
          const archiveBytes = new Uint8Array(
            await (await archiveHandle.getFile()).arrayBuffer()
          );
          streaming7zWriterAppendArchive(writer, archiveBytes);
        } else {
          const rawHandle = await communicationLogSegmentDirectoryHandle.getFileHandle(
            item.segment.raw_name,
            { create: false }
          );
          streaming7zWriterAppendBytes(
            writer,
            new Uint8Array(await (await rawHandle.getFile()).arrayBuffer())
          );
        }
      }
      streaming7zWriterAppendBytes(writer, activeFiltered.bytes);
      return {
        archive: streaming7zWriterFinish(writer),
        archive_name: archiveName,
        member_name: memberName,
        expected_bytes: expectedBytes,
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp
      };
    } catch (error) {
      if (!writer.finished) {
        try { streaming7zWriterFinish(writer); } catch {}
      }
      throw error;
    }
  }


