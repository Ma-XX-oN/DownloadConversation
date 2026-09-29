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
   * Returns a trustworthy timestamp from one exact JSONL line blob.
   *
   * @param {Blob} line - Exact JSONL line bytes without the newline delimiter.
   * @returns {Promise<string|null>} Trustworthy timestamp, or null.
   */
  async function communicationLogTimestampFromJsonlLine(line) {
    if (!line || line.size === 0) return null;
    try {
      const record = JSON.parse(await line.text());
      const timestamp = typeof record?.timestamp === 'string' ? record.timestamp : null;
      return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
    } catch {
      return null;
    }
  }

  /**
   * Finds the first trustworthy complete JSONL record timestamp by scanning only
   * as far forward from the file start as necessary.
   *
   * @param {File} file - JSONL file snapshot.
   * @param {number} [end] - Exclusive frozen EOF.
   * @returns {Promise<string|null>} First trustworthy timestamp, or null.
   */
  async function communicationLogFirstTimestampFromJsonlFile(file, end = file.size) {
    const limit = Math.min(file.size, Math.max(0, end));
    let lineStart = 0;
    for (let cursor = 0; cursor < limit;) {
      const next = Math.min(limit, cursor + COMMUNICATION_LOG_COMPARE_CHUNK_BYTES);
      const bytes = new Uint8Array(await file.slice(cursor, next).arrayBuffer());
      for (let index = 0; index < bytes.byteLength; index += 1) {
        if (bytes[index] !== 10) continue;
        const lineEnd = cursor + index;
        const timestamp = await communicationLogTimestampFromJsonlLine(
          file.slice(lineStart, lineEnd)
        );
        if (timestamp) return timestamp;
        lineStart = lineEnd + 1;
      }
      cursor = next;
    }
    return null;
  }

  /**
   * Finds the last trustworthy complete JSONL record timestamp by scanning
   * backward from the frozen EOF in bounded chunks and stopping at the first
   * timestamped line encountered.
   *
   * @param {File} file - JSONL file snapshot.
   * @param {number} [end] - Exclusive frozen EOF.
   * @returns {Promise<string|null>} Last trustworthy timestamp, or null.
   */
  async function communicationLogLastTimestampFromJsonlFile(file, end = file.size) {
    const limit = Math.min(file.size, Math.max(0, end));
    let lineEnd = limit;
    for (let cursor = limit; cursor > 0;) {
      const start = Math.max(0, cursor - COMMUNICATION_LOG_COMPARE_CHUNK_BYTES);
      const bytes = new Uint8Array(await file.slice(start, cursor).arrayBuffer());
      for (let index = bytes.byteLength - 1; index >= 0; index -= 1) {
        if (bytes[index] !== 10) continue;
        const lineStart = start + index + 1;
        if (lineStart < lineEnd) {
          const timestamp = await communicationLogTimestampFromJsonlLine(
            file.slice(lineStart, lineEnd)
          );
          if (timestamp) return timestamp;
        }
        lineEnd = start + index;
      }
      cursor = start;
    }
    return lineEnd > 0
      ? communicationLogTimestampFromJsonlLine(file.slice(0, lineEnd))
      : null;
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
    return `${base}_${start}-${end}${suffix}.${role}.xz`;
  }

  /**
   * Converts a user-facing archive-derived member name to the bridge's ASCII contract.
   *
   * @param {string} name - Desired member name.
   * @returns {string} Deterministic printable-ASCII member name.
   */
  function communicationLogAsciiArchiveMemberName(name) {
    return String(name).replace(/[^\x20-\x7e]/g, '_');
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
   * Parses one filesystem-authoritative historical segment archive name.
   *
   * @param {string} name - Candidate private segment filename.
   * @returns {Object|null} Parsed range metadata, or null for another file role.
   */
  function communicationLogParseSegmentArchiveName(name) {
    const match = /^segment_(\d{4},\d{2},\d{2};\d{2},\d{2},\d{2})-(\d{4},\d{2},\d{2};\d{2},\d{2},\d{2})\.seg\.xz$/.exec(name);
    if (!match) return null;
    /**
     * Parses one local archive timestamp field.
     *
     * @param {string} value - Local filename timestamp.
     * @returns {number} Epoch milliseconds at the start of that second.
     */
    const parseLocal = value => {
      const fields = value.match(/\d+/g).map(Number);
      return new Date(
        fields[0], fields[1] - 1, fields[2],
        fields[3], fields[4], fields[5], 0
      ).getTime();
    };
    const startMs = parseLocal(match[1]);
    const endMs = parseLocal(match[2]) + 999;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error(`Invalid communication segment timestamp filename: ${name}`);
    }
    return {
      archive_name: name,
      start_timestamp: new Date(startMs).toISOString(),
      end_timestamp: new Date(endMs).toISOString(),
      filename_start: match[1],
      filename_end: match[2]
    };
  }

  /**
   * Enumerates compressed historical segments from the private directory.
   *
   * @returns {Promise<Object[]>} Chronologically ordered archive metadata.
   */
  async function communicationLogHistoricalSegmentsFromDirectory() {
    const segments = [];
    for await (const [name, entry] of communicationLogSegmentDirectoryHandle.entries()) {
      if (entry?.kind !== 'file') continue;
      const parsed = communicationLogParseSegmentArchiveName(name);
      if (parsed) segments.push(parsed);
    }
    segments.sort((left, right) => left.archive_name.localeCompare(right.archive_name));
    return segments;
  }

  /**
   * Returns exact extracted bytes for one filesystem-authoritative historical segment.
   *
   * @param {Object} segment - Historical archive metadata.
   * @returns {Promise<Uint8Array>} Exact raw JSONL segment bytes.
   */
  async function communicationLogReadHistoricalSegment(segment) {
    const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
      segment.archive_name,
      { create: false }
    );
    const archive = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const bytes = await extractArchive(archive);
    const range = communicationLogTimestampRangeFromJsonl(bytes);
    if (!range
        || communicationLogArchiveTimestamp(range.start_timestamp) !== segment.filename_start
        || communicationLogArchiveTimestamp(range.end_timestamp) !== segment.filename_end) {
      throw new Error(`Historical segment range verification failed: ${segment.archive_name}`);
    }
    return bytes;
  }

  /**
   * Freezes filesystem-derived history plus the exact active committed EOF.
   *
   * @returns {Promise<Object>} Frozen logical-log snapshot plan.
   */
  async function communicationLogCaptureSnapshotPlan() {
    await communicationLogCloseActiveWriter();
    const active = await communicationLogActiveFileSnapshot();
    const activeEof = active.file.size;
    communicationLogActiveLastTimestamp = activeEof > 0
      ? await communicationLogLastTimestampFromJsonlFile(active.file, activeEof)
      : null;
    communicationLogSegmentManifest.active_committed_eof = activeEof;
    await communicationLogSyncManifestConversationName();
    await communicationLogWriteSegmentManifest();
    return {
      segments: await communicationLogHistoricalSegmentsFromDirectory(),
      active_name: communicationLogActiveFileName,
      active_eof: activeEof,
      active_last_timestamp: communicationLogActiveLastTimestamp
    };
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
