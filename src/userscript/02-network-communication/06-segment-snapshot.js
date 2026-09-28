  /**
   * Extracts the trustworthy earliest/latest record timestamps from exact JSONL bytes.
   *
   * @param {Uint8Array} bytes - Exact JSONL bytes.
   * @returns {Object|null} ISO start/end timestamps, or null when none are trustworthy.
   */
  function communicationLogTimestampRangeFromJsonl(bytes) {
    const text = new TextDecoder().decode(bytes);
    let start = null;
    let end = null;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const timestamp = typeof record?.timestamp === 'string' ? record.timestamp : null;
      if (!timestamp || !Number.isFinite(Date.parse(timestamp))) continue;
      if (start === null || timestamp < start) start = timestamp;
      if (end === null || timestamp > end) end = timestamp;
    }
    return start === null ? null : { start_timestamp: start, end_timestamp: end };
  }

  /**
   * Formats one ISO timestamp deterministically for cross-platform filenames.
   *
   * @param {string} timestamp - Trustworthy ISO timestamp.
   * @returns {string} Filesystem-safe UTC timestamp.
   */
  function communicationLogArchiveTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) throw new Error('Archive timestamp is not trustworthy.');
    /**
     * Pads one local date/time field to two digits.
     *
     * @param {number} value - Local calendar/time field.
     * @returns {string} Two-digit field.
     */
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()},${pad(date.getMonth() + 1)},${pad(date.getDate())};`
      + `${pad(date.getHours())},${pad(date.getMinutes())},${pad(date.getSeconds())}`;
  }

  /**
   * Returns the final communication content time at whole-second precision.
   *
   * @param {Object} range - Trustworthy communication timestamp range.
   * @returns {number} Unix modification time in milliseconds.
   */
  function communicationLogArchiveMTime(range) {
    const endMs = Date.parse(range?.end_timestamp);
    if (!Number.isFinite(endMs)) {
      throw new Error('Communication archive end timestamp is not trustworthy.');
    }
    return Math.floor(endMs / 1000) * 1000;
  }

  /**
   * Builds a role-explicit archive filename; collision suffix is inserted before the role.
   *
   * @param {string} base - Logical archive base name.
   * @param {Object} range - Trustworthy start/end timestamps.
   * @param {'seg'|'comm'|'log'} role - Archive role.
   * @param {number} collision - Zero for normal name, positive for actual collision.
   * @returns {string} Timestamped role-explicit archive filename.
   */
  function communicationLogRoleArchiveName(base, range, role, collision = 0) {
    if (!range?.start_timestamp || !range?.end_timestamp) {
      throw new Error('Archive content has no trustworthy timestamp range.');
    }
    const start = communicationLogArchiveTimestamp(range.start_timestamp);
    const end = communicationLogArchiveTimestamp(range.end_timestamp);
    const suffix = collision > 0 ? `(${collision})` : '';
    return `${base}_${start}-${end}${suffix}.${role}.7z`;
  }

  /**
   * Converts a user-facing archive-derived member name to the bridge's ASCII contract.
   *
   * @param {string} name - Desired member name.
   * @returns {string} Deterministic printable-ASCII member name.
   */
  function communicationLogAsciiArchiveMemberName(name) {
    return String(name).replace(/[^\\x20-\\x7e]/g, '_');
  }

  /**
   * Returns the first unused role archive name without adding (N) unnecessarily.
   *
   * @param {Object} directory - Directory where the archive will be written.
   * @param {string} base - Logical archive base.
   * @param {Object} range - Trustworthy timestamp range.
   * @param {'seg'|'comm'|'log'} role - Archive role.
   * @returns {Promise<string>} Lowest-collision archive name.
   */
  async function communicationLogUnusedRoleArchiveName(directory, base, range, role) {
    for (let collision = 0; ; collision += 1) {
      const name = communicationLogRoleArchiveName(base, range, role, collision);
      try {
        await directory.getFileHandle(name, { create: false });
      } catch (error) {
        if (error?.name === 'NotFoundError') return name;
        throw error;
      }
    }
  }

  /**
   * Returns exact verified raw bytes for one historical segment.
   *
   * @param {Object} segment - Historical segment metadata.
   * @returns {Promise<Uint8Array>} Verified raw JSONL segment bytes.
   */
  async function communicationLogReadHistoricalSegment(segment) {
    /** Reads and extracts the committed archive representation for this segment. */
    /**
     * Reads and extracts the verified archive member for this segment.
     *
     * @returns {Promise<Uint8Array>} Exact extracted segment bytes.
     */
    const readArchive = async () => {
      const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
        segment.archive_name,
        { create: false }
      );
      const archive = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      return extract7zArchive(archive);
    };
    let bytes;
    if (segment.compression_state === 'compressed') {
      bytes = await readArchive();
    } else {
      try {
        const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
          segment.raw_name,
          { create: false }
        );
        bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
        bytes = await readArchive();
      }
    }
    if (bytes.byteLength !== segment.raw_bytes
        || await communicationLogSha256(bytes) !== segment.source_sha256) {
      throw new Error(`Historical segment verification failed: segment ${segment.ordinal}`);
    }
    return bytes;
  }

  /**
   * Reconstructs the logical JSONL stream in canonical ordinal order.
   *
   * @returns {Promise<Uint8Array>} Exact logical-log snapshot bytes.
   */
  async function communicationLogCaptureSnapshotPlan() {
    await communicationLogCloseActiveWriter();
    const active = await communicationLogActiveFileSnapshot();
    const activeEof = active.file.size;
    const activePrefix = active.file.slice(0, activeEof);
    const activeRange = communicationLogTimestampRangeFromJsonl(
      new Uint8Array(await activePrefix.arrayBuffer())
    );
    communicationLogSegmentManifest.active_committed_eof = activeEof;
    communicationLogSegmentManifest.active_last_timestamp =
      activeRange?.end_timestamp ?? null;
    await communicationLogWriteSegmentManifest();
    return {
      segments: communicationLogSegmentManifest.segments.map(segment => ({ ...segment })),
      active_name: communicationLogActiveFileName,
      active_eof: activeEof,
      active_range: activeRange
    };
  }

  /**
   * Reconstructs one previously frozen snapshot plan without holding the append queue.
   *
   * @param {Object|null} plan - Frozen segment membership and active prefix.
   * @returns {Promise<Object>} Exact bytes and trustworthy content timestamp range.
   */
  async function communicationLogLogicalSnapshot(plan = null) {
    const frozen = plan ?? await communicationLogCaptureSnapshotPlan();
    const ordered = [...frozen.segments]
      .sort((left, right) => left.ordinal - right.ordinal);
    const parts = [];
    let total = 0;
    let startTimestamp = null;
    let endTimestamp = null;
    for (let index = 0; index < ordered.length; index += 1) {
      const segment = ordered[index];
      setStatus(`Duplicate: reading historical segments ${index + 1} of ${ordered.length}; recording continues.`);
      const bytes = await communicationLogReadHistoricalSegment(segment);
      parts.push(bytes);
      total += bytes.byteLength;
      if (total > COMMUNICATION_LOG_DUPLICATE_MAX_BYTES) {
        throw new Error(
          `Duplicate snapshot exceeds the ${COMMUNICATION_LOG_DUPLICATE_MAX_BYTES}-byte in-memory safety limit.`
        );
      }
      startTimestamp ??= segment.start_timestamp ?? null;
      endTimestamp = segment.end_timestamp ?? endTimestamp;
    }
    const activeHandle = await communicationLogSegmentDirectoryHandle.getFileHandle(
      frozen.active_name,
      { create: false }
    );
    const activeFile = await activeHandle.getFile();
    if (activeFile.size < frozen.active_eof) {
      throw new Error('Frozen communication active prefix is no longer available.');
    }
    const activeBytes = new Uint8Array(
      await activeFile.slice(0, frozen.active_eof).arrayBuffer()
    );
    parts.push(activeBytes);
    total += activeBytes.byteLength;
    if (total > COMMUNICATION_LOG_DUPLICATE_MAX_BYTES) {
      throw new Error(
        `Duplicate snapshot exceeds the ${COMMUNICATION_LOG_DUPLICATE_MAX_BYTES}-byte in-memory safety limit.`
      );
    }
    startTimestamp ??= frozen.active_range?.start_timestamp ?? null;
    endTimestamp = frozen.active_range?.end_timestamp ?? endTimestamp;
    if (!startTimestamp || !endTimestamp) {
      throw new Error('Communication log snapshot has no trustworthy content timestamp range.');
    }
    setStatus('Duplicate: reconstructing exact logical JSONL; recording continues.');
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      combined.set(part, offset);
      offset += part.byteLength;
    }
    return {
      bytes: combined,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp
    };
  }

  /**
   * Compatibility helper returning only exact snapshot bytes.
   *
   * @returns {Promise<Uint8Array>} Exact logical snapshot bytes.
   */
  async function communicationLogLogicalSnapshotBytes() {
    return (await communicationLogLogicalSnapshot()).bytes;
  }

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
        prepared.push({ segment, whole: true, bytes: null });
        expectedBytes += segment.raw_bytes;
        startTimestamp ??= segment.start_timestamp;
        endTimestamp = segment.end_timestamp;
        continue;
      }
      const raw = await communicationLogReadHistoricalSegment(segment);
      const filtered = communicationLogFilterJsonlBytes(raw, lowerMs, upperMs);
      if (!filtered.bytes.byteLength) continue;
      prepared.push({ segment, whole: false, bytes: filtered.bytes });
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
          streaming7zWriterAppendBytes(writer, item.bytes);
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
          const rawDirectory = item.segment.raw_parent === 'root'
            ? communicationLogDirectoryHandle
            : communicationLogSegmentDirectoryHandle;
          const rawHandle = await rawDirectory.getFileHandle(
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
        // The Wasm writer owns no filesystem state; abandoning it cannot expose
        // a partial user archive.  The output file is created only after finish.
        streaming7zOutputs.delete(writer.outputId);
      }
      throw error;
    }
  }


  /**
   * Clears historical segment membership for an explicit log reset.
   *
   * @returns {Promise<void>} Resolves after historical segment state is reset.
   */
  async function communicationLogResetSegmentHistory() {
    if (!communicationLogSegmentDirectoryHandle) return;
    await communicationLogCompressionChain;
    const name = communicationLogSegmentDirectoryName();
    await communicationLogDirectoryHandle.removeEntry(name, { recursive: true });
    communicationLogSegmentDirectoryHandle =
      await communicationLogDirectoryHandle.getDirectoryHandle(name, { create: true });
    communicationLogSegmentManifest = await communicationLogReadSegmentManifest();
    await communicationLogWriteSegmentManifest();
    communicationLogActiveSegmentBytes = 0;
  }
