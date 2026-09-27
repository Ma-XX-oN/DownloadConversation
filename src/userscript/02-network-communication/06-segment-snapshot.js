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
    return date.toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', 'Z');
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
    return `${base}_${start}_${end}${suffix}.${role}.7z`;
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
    const active = await communicationLogRefreshedFileSnapshot();
    const activeBytes = new Uint8Array(await active.file.arrayBuffer());
    return {
      segments: communicationLogSegmentManifest.segments.map(segment => ({ ...segment })),
      active_bytes: activeBytes,
      active_range: communicationLogTimestampRangeFromJsonl(activeBytes)
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
    parts.push(frozen.active_bytes);
    total += frozen.active_bytes.byteLength;
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
