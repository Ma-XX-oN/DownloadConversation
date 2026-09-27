  /**
   * Returns exact verified raw bytes for one historical segment.
   *
   * @param {Object} segment - Historical segment metadata.
   * @returns {Promise<Uint8Array>} Verified raw JSONL segment bytes.
   */
  async function communicationLogReadHistoricalSegment(segment) {
    if (segment.compression_state === 'compressed') {
      const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
        segment.archive_name,
        { create: false }
      );
      const archive = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      const bytes = await extract7zArchive(archive);
      if (bytes.byteLength !== segment.raw_bytes
          || await communicationLogSha256(bytes) !== segment.source_sha256) {
        throw new Error(`Historical archive verification failed: segment ${segment.ordinal}`);
      }
      return bytes;
    }
    const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
      segment.raw_name,
      { create: false }
    );
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (bytes.byteLength !== segment.raw_bytes
        || await communicationLogSha256(bytes) !== segment.source_sha256) {
      throw new Error(`Historical raw verification failed: segment ${segment.ordinal}`);
    }
    return bytes;
  }

  /**
   * Reconstructs the logical JSONL stream in canonical ordinal order.
   *
   * @returns {Promise<Uint8Array>} Exact logical-log snapshot bytes.
   */
  async function communicationLogLogicalSnapshotBytes() {
    await communicationLogCloseActiveWriter();
    const ordered = [...communicationLogSegmentManifest.segments]
      .sort((left, right) => left.ordinal - right.ordinal);
    const parts = [];
    let total = 0;
    for (const segment of ordered) {
      const bytes = await communicationLogReadHistoricalSegment(segment);
      parts.push(bytes);
      total += bytes.byteLength;
    }
    const active = await communicationLogRefreshedFileSnapshot();
    const activeBytes = new Uint8Array(await active.file.arrayBuffer());
    parts.push(activeBytes);
    total += activeBytes.byteLength;
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      combined.set(part, offset);
      offset += part.byteLength;
    }
    return combined;
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
