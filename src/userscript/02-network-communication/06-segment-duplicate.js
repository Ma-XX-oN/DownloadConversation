  /**
   * Filters exact JSONL record bytes by inclusive timestamp bounds.
   *
   * Records are chronological.  Once a trustworthy record is later than the
   * requested upper bound, no following record can be accepted and scanning
   * stops immediately.
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
      if (upperMs !== null && time > upperMs) break;
      if (lowerMs !== null && time < lowerMs) continue;
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
   * Returns the first trustworthy JSONL record timestamp without scanning the
   * remainder of the file.
   *
   * @param {Uint8Array} bytes - Complete JSONL bytes.
   * @returns {string|null} First trustworthy ISO timestamp, or null.
   */
  function communicationLogFirstTimestampFromJsonl(bytes) {
    let lineStart = 0;
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] !== 10) continue;
      const line = bytes.subarray(lineStart, index);
      lineStart = index + 1;
      if (!line.byteLength) continue;
      try {
        const record = JSON.parse(new TextDecoder().decode(line));
        const timestamp = typeof record?.timestamp === 'string'
          ? record.timestamp
          : null;
        if (timestamp && Number.isFinite(Date.parse(timestamp))) return timestamp;
      } catch {}
    }
    return null;
  }

  /**
   * Formats a measured Duplicate ETA as whole minutes/seconds.
   *
   * @param {number} milliseconds - Remaining wall time estimate.
   * @returns {string} Human-readable duration such as `1 m 23 s`.
   */
  function communicationLogFormatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes} m ${seconds} s` : `${seconds} s`;
  }

  /**
   * Updates visible Duplicate file-count progress from measured current-operation work.
   *
   * @param {number} completedFiles - Number of source files fully processed.
   * @param {number} totalFiles - Total source files in this Duplicate plan.
   * @param {number} startedMs - performance.now() when source processing began.
   * @returns {void} No value is returned.
   */
  function communicationLogReportDuplicateProgress(completedFiles, totalFiles, startedMs) {
    const elapsedMs = Math.max(0, performance.now() - startedMs);
    const percent = totalFiles > 0 ? (completedFiles / totalFiles) * 100 : 100;
    const etaMs = completedFiles > 0
      ? (elapsedMs / completedFiles) * (totalFiles - completedFiles)
      : null;
    const progress = {
      completed_files: completedFiles,
      total_files: totalFiles,
      percent,
      eta_ms: etaMs
    };
    const etaText = progress.eta_ms === null
      ? 'calculating...'
      : communicationLogFormatDuration(progress.eta_ms);
    setStatus(
      `Duplicate: ${progress.completed_files}/${progress.total_files} files `
      + `${progress.percent.toFixed(1)}% done ETA: ${etaText}; recording continues.`
    );
  }

  /**
   * Streams one frozen Duplicate plan through one continuously open archive writer.
   *
   * Historical file selection is made entirely from the timestamp ranges encoded
   * in filenames.  A whole selected segment is decompressed once by the archive
   * layer and fed directly to the open output encoder without parsing JSONL
   * records.  Only a first/last boundary segment actually cut by a requested
   * timestamp is decompressed to raw bytes and filtered record by record.
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
    const relevantSegments = ordered.filter(segment => {
      const segmentStart = Date.parse(segment.start_timestamp);
      const segmentEnd = Date.parse(segment.end_timestamp);
      return !((lowerMs !== null && segmentEnd < lowerMs)
        || (upperMs !== null && segmentStart > upperMs));
    });
    const totalFiles = relevantSegments.length + 1;
    const progressStarted = performance.now();
    let completedFiles = 0;
    let expectedBytes = 0;
    let startTimestamp = null;
    let endTimestamp = null;
    const writer = await streamingArchiveWriterBegin();
    communicationLogReportDuplicateProgress(completedFiles, totalFiles, progressStarted);

    try {
      for (const segment of relevantSegments) {
        const segmentStart = Date.parse(segment.start_timestamp);
        const segmentEnd = Date.parse(segment.end_timestamp);
        const cutsLowerBoundary = lowerMs !== null && lowerMs > segmentStart;
        const cutsUpperBoundary = upperMs !== null && upperMs < segmentEnd;
        const archiveHandle =
          await communicationLogSegmentDirectoryHandle.getFileHandle(
            segment.archive_name,
            { create: false }
          );
        const archiveBytes = new Uint8Array(
          await (await archiveHandle.getFile()).arrayBuffer()
        );

        if (!cutsLowerBoundary && !cutsUpperBoundary) {
          expectedBytes += streamingArchiveWriterAppendArchive(writer, archiveBytes);
          startTimestamp ??= segment.start_timestamp;
          endTimestamp = segment.end_timestamp;
        } else {
          const raw = await extractArchive(archiveBytes);
          const filtered = communicationLogFilterJsonlBytes(raw, lowerMs, upperMs);
          if (filtered.bytes.byteLength) {
            streamingArchiveWriterAppendBytes(writer, filtered.bytes);
            expectedBytes += filtered.bytes.byteLength;
            startTimestamp ??= filtered.start_timestamp;
            endTimestamp = filtered.end_timestamp ?? endTimestamp;
          }
        }

        completedFiles += 1;
        communicationLogReportDuplicateProgress(
          completedFiles,
          totalFiles,
          progressStarted
        );
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
      const activeFirstTimestamp = communicationLogFirstTimestampFromJsonl(activeRaw);
      const activeStartMs = activeFirstTimestamp
        ? Date.parse(activeFirstTimestamp)
        : NaN;
      const activeEndMs = plan.active_last_timestamp
        ? Date.parse(plan.active_last_timestamp)
        : NaN;
      const activeOutsideBounds = Number.isFinite(activeStartMs)
        && Number.isFinite(activeEndMs)
        && ((lowerMs !== null && activeEndMs < lowerMs)
          || (upperMs !== null && activeStartMs > upperMs));
      const activeCutsLowerBoundary = Number.isFinite(activeStartMs)
        && lowerMs !== null
        && lowerMs > activeStartMs;
      const activeCutsUpperBoundary = Number.isFinite(activeEndMs)
        && upperMs !== null
        && upperMs < activeEndMs;

      if (!activeOutsideBounds && activeRaw.byteLength) {
        if (!activeCutsLowerBoundary && !activeCutsUpperBoundary) {
          streamingArchiveWriterAppendBytes(writer, activeRaw);
          expectedBytes += activeRaw.byteLength;
          startTimestamp ??= activeFirstTimestamp;
          endTimestamp = plan.active_last_timestamp ?? endTimestamp;
        } else {
          const activeFiltered = communicationLogFilterJsonlBytes(
            activeRaw,
            lowerMs,
            upperMs
          );
          if (activeFiltered.bytes.byteLength) {
            streamingArchiveWriterAppendBytes(writer, activeFiltered.bytes);
            expectedBytes += activeFiltered.bytes.byteLength;
            startTimestamp ??= activeFiltered.start_timestamp;
            endTimestamp = activeFiltered.end_timestamp ?? endTimestamp;
          }
        }
      }
      completedFiles += 1;
      communicationLogReportDuplicateProgress(
        completedFiles,
        totalFiles,
        progressStarted
      );

      if (!startTimestamp || !endTimestamp || expectedBytes === 0) {
        throw new Error('Duplicate bounds contain no trustworthy communication records.');
      }
      const range = {
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp
      };
      const filenamePrefix = canonicalFilename(
        conversationProjectName(),
        conversationTitle(),
        range
      );
      const archiveName = await unusedFilename(
        communicationLogDirectoryHandle,
        filenamePrefix,
        `.comm${compressorExtension()}`
      );
      return {
        archive: streamingArchiveWriterFinish(writer),
        archive_name: archiveName,
        expected_bytes: expectedBytes,
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp
      };
    } catch (error) {
      if (!writer.finished) {
        try { streamingArchiveWriterFinish(writer); } catch {}
      }
      throw error;
    }
  }

