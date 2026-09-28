  /**
   * Retires the pre-segmentation top-level active log directly into an archive.
   * This upgrade path creates no second uncompressed copy.
   *
   * @returns {Promise<void>} Resolves after any legacy active bytes are secured.
   */
  async function communicationLogRetireLegacyTopLevelActive() {
    let handle;
    try {
      handle = await communicationLogDirectoryHandle.getFileHandle(
        communicationLogFileName,
        { create: false }
      );
    } catch (error) {
      if (error?.name === 'NotFoundError') return;
      throw error;
    }
    const file = await handle.getFile();
    if (file.size === 0) {
      await communicationLogDirectoryHandle.removeEntry(communicationLogFileName);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const range = communicationLogTimestampRangeFromJsonl(bytes);
    if (!range) throw new Error('Legacy communication log has no trustworthy timestamp range.');
    const hash = await communicationLogSha256(bytes);
    const ordinal = communicationLogSegmentManifest.next_ordinal++;
    const suffix = String(ordinal).padStart(6, '0');
    const start = communicationLogArchiveTimestamp(range.start_timestamp);
    const end = communicationLogArchiveTimestamp(range.end_timestamp);
    const segment = {
      ordinal,
      raw_name: communicationLogFileName,
      raw_parent: 'root',
      archive_name: await communicationLogUnusedRoleArchiveName(
        communicationLogSegmentDirectoryHandle,
        'segment',
        range,
        'seg'
      ),
      member_name: `segment-${suffix}_${start}-${end}.jsonl`,
      raw_bytes: bytes.byteLength,
      source_sha256: hash,
      start_timestamp: range.start_timestamp,
      end_timestamp: range.end_timestamp,
      compression_state: 'sealed'
    };
    communicationLogSegmentManifest.segments.push(segment);
    await communicationLogWriteSegmentManifest();
    await communicationLogCompressSealedSegment(segment);
  }

  /**
   * Derives the append target from the two alternating files and recoverable
   * sealed-source ownership.  No persisted active-name flag is trusted.
   *
   * @returns {Promise<void>} Resolves after an active file is selected/created.
   */
  async function communicationLogRecoverAlternatingActiveFiles() {
    const names = ['active-a.jsonl', 'active-b.jsonl'];
    const sealed = new Set(
      communicationLogSegmentManifest.segments
        .filter(segment => segment.compression_state !== 'compressed')
        .map(segment => segment.raw_name)
    );
    const states = [];
    for (const name of names) {
      try {
        const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
          name,
          { create: false }
        );
        const file = await handle.getFile();
        states.push({ name, exists: true, size: file.size, modified: file.lastModified });
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
        states.push({ name, exists: false, size: 0, modified: 0 });
      }
    }

    const candidates = states.filter(state => !sealed.has(state.name));
    if (candidates.length === 0) {
      throw new Error('Both alternating communication files are sealed recovery sources.');
    }
    candidates.sort((left, right) => {
      if (left.exists !== right.exists) return left.exists ? -1 : 1;
      if (left.size !== right.size) return right.size - left.size;
      return right.modified - left.modified;
    });
    communicationLogActiveFileName = candidates[0].name;
    await communicationLogSegmentDirectoryHandle.getFileHandle(
      communicationLogActiveFileName,
      { create: true }
    );
  }

  /**
   * Recovers sealed pending/failed segments after reload.
   *
   * @returns {Promise<void>} Resolves after recovery work is scheduled.
   */
  async function communicationLogRecoverSegmentState() {
    for (const segment of communicationLogSegmentManifest.segments) {
      if (segment.compression_state === 'compressed') {
        try {
          const archiveHandle = await communicationLogSegmentDirectoryHandle.getFileHandle(
            segment.archive_name,
            { create: false }
          );
          const archive = new Uint8Array(await (await archiveHandle.getFile()).arrayBuffer());
          const extracted = await extract7zArchive(archive);
          const hash = await communicationLogSha256(extracted);
          if (extracted.byteLength !== segment.raw_bytes || hash !== segment.source_sha256) {
            throw new Error('compressed segment verification mismatch');
          }
          try {
            const staleRaw = await (segment.raw_parent === 'root'
              ? communicationLogDirectoryHandle
              : communicationLogSegmentDirectoryHandle).getFileHandle(
              segment.raw_name,
              { create: false }
            );
            const staleBytes = new Uint8Array(await (await staleRaw.getFile()).arrayBuffer());
            if (staleBytes.byteLength === segment.raw_bytes
                && await communicationLogSha256(staleBytes) === segment.source_sha256) {
              await (segment.raw_parent === 'root'
                ? communicationLogDirectoryHandle
                : communicationLogSegmentDirectoryHandle).removeEntry(segment.raw_name);
            }
          } catch (error) {
            if (error?.name !== 'NotFoundError') throw error;
          }
          continue;
        } catch (archiveError) {
          try {
            await (segment.raw_parent === 'root'
              ? communicationLogDirectoryHandle
              : communicationLogSegmentDirectoryHandle).getFileHandle(
              segment.raw_name,
              { create: false }
            );
            segment.compression_state = 'sealed';
            segment.failure = `Recovery replaced invalid compressed state: ${errorMessage(archiveError)}`;
            await communicationLogWriteSegmentManifest();
          } catch (rawError) {
            if (rawError?.name === 'NotFoundError') {
              throw new Error(
                `Compressed segment ${segment.ordinal} is invalid and has no recoverable raw source.`
              );
            }
            throw rawError;
          }
        }
      }

      let rawHandle;
      try {
        rawHandle = await (segment.raw_parent === 'root'
          ? communicationLogDirectoryHandle
          : communicationLogSegmentDirectoryHandle).getFileHandle(
          segment.raw_name,
          { create: false }
        );
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          throw new Error(`Missing recoverable raw segment: ${segment.raw_name}`);
        }
        throw error;
      }
      const rawBytes = new Uint8Array(await (await rawHandle.getFile()).arrayBuffer());
      const hash = await communicationLogSha256(rawBytes);
      if (rawBytes.byteLength !== segment.raw_bytes || hash !== segment.source_sha256) {
        throw new Error(`Recoverable raw segment verification failed: ${segment.raw_name}`);
      }
      segment.compression_state = 'sealed';
      void communicationLogQueueSegmentCompression(segment).catch(() => {});
    }
  }

  /**
   * Initializes durable segmented storage before recorder readiness.
   *
   * @returns {Promise<void>} Resolves when active and historical state is ready.
   */
  async function communicationLogInitializeSegmentStorage() {
    logDiagnostic('debug', 'communication-log-segment-initialize-entered', {});
    let phase = 'directory-name';
    let directoryName = null;
    try {
      directoryName = communicationLogSegmentDirectoryName();
      logDiagnostic('debug', 'communication-log-segment-directory-name-resolved', {
        segment_directory: directoryName
      });
      phase = 'directory-create-open';
      logDiagnostic('debug', 'communication-log-segment-initialize-started', {
        segment_directory: directoryName
      });
      communicationLogSegmentDirectoryHandle =
        await communicationLogDirectoryHandle.getDirectoryHandle(
          directoryName,
          { create: true }
        );
      logDiagnostic('debug', 'communication-log-segment-directory-ready', {
        segment_directory: directoryName
      });

      phase = 'manifest-read';
      communicationLogSegmentManifest = await communicationLogReadSegmentManifest();
      logDiagnostic('debug', 'communication-log-segment-manifest-ready', {
        segment_directory: directoryName,
        next_ordinal: communicationLogSegmentManifest.next_ordinal,
        historical_segments: communicationLogSegmentManifest.segments.length
      });

      phase = 'legacy-active-retirement';
      await communicationLogRetireLegacyTopLevelActive();

      phase = 'active-file-recovery';
      await communicationLogRecoverAlternatingActiveFiles();

      phase = 'recovery';
      logDiagnostic('debug', 'communication-log-segment-recovery-started', {
        segment_directory: directoryName,
        historical_segments: communicationLogSegmentManifest.segments.length
      });
      await communicationLogRecoverSegmentState();
      logDiagnostic('debug', 'communication-log-segment-recovery-completed', {
        segment_directory: directoryName,
        historical_segments: communicationLogSegmentManifest.segments.length
      });

      phase = 'active-snapshot';
      communicationLogActiveSegmentBytes =
        (await communicationLogRefreshedFileSnapshot()).file.size;
      logDiagnostic('debug', 'communication-log-segment-initialize-completed', {
        segment_directory: directoryName,
        active_segment_bytes: communicationLogActiveSegmentBytes,
        historical_segments: communicationLogSegmentManifest.segments.length
      });
    } catch (error) {
      logDiagnostic('warnings', 'communication-log-segment-initialize-failed', {
        phase,
        segment_directory: directoryName,
        message: boundedDiagnosticText(errorMessage(error), 2000)
      });
      throw error;
    }
  }
