  /**
   * Derives the append target from the two alternating files and recoverable
   * sealed-source ownership.  No persisted active-name flag is trusted.
   *
   * @returns {Promise<void>} Resolves after an active file is selected/created.
   */
  async function communicationLogRecoverAlternatingActiveFiles() {
    const names = ['active-a.jsonl', 'active-b.jsonl'];
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

    const existing = states.filter(state => state.exists);
    let active;
    if (existing.length === 0) {
      active = states[0];
    } else if (existing.length === 1) {
      active = existing[0];
    } else {
      const empty = existing.filter(state => state.size === 0);
      if (empty.length === 1) {
        active = empty[0];
      } else {
        active = [...existing].sort((left, right) =>
          right.modified - left.modified || left.name.localeCompare(right.name)
        )[0];
      }
    }
    communicationLogActiveFileName = active.name;
    await communicationLogSegmentDirectoryHandle.getFileHandle(
      communicationLogActiveFileName,
      { create: true }
    );

    const closed = states.find(state =>
      state.name !== communicationLogActiveFileName && state.exists && state.size > 0
    );
    if (!closed) return;
    const alreadyTracked = communicationLogSegmentManifest.segments.some(segment =>
      segment.raw_name === closed.name && segment.compression_state !== 'compressed'
    );
    if (alreadyTracked) return;

    const handle = await communicationLogSegmentDirectoryHandle.getFileHandle(
      closed.name,
      { create: false }
    );
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const range = communicationLogTimestampRangeFromJsonl(bytes);
    if (!range) throw new Error(`Closed communication source has no timestamp range: ${closed.name}`);
    const ordinal = communicationLogSegmentManifest.next_ordinal++;
    const suffix = String(ordinal).padStart(6, '0');
    const start = communicationLogArchiveTimestamp(range.start_timestamp);
    const end = communicationLogArchiveTimestamp(range.end_timestamp);
    const segment = {
      ordinal,
      raw_name: closed.name,
      raw_parent: 'segment',
      archive_name: await communicationLogUnusedRoleArchiveName(
        communicationLogSegmentDirectoryHandle,
        'segment',
        range,
        'seg'
      ),
      member_name: `segment-${suffix}_${start}-${end}.jsonl`,
      raw_bytes: bytes.byteLength,
      source_sha256: await communicationLogSha256(bytes),
      start_timestamp: range.start_timestamp,
      end_timestamp: range.end_timestamp,
      compression_state: 'sealed'
    };
    communicationLogSegmentManifest.segments.push(segment);
    await communicationLogWriteSegmentManifest();
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
            const staleRaw = await communicationLogSegmentDirectoryHandle.getFileHandle(
              segment.raw_name,
              { create: false }
            );
            const staleBytes = new Uint8Array(await (await staleRaw.getFile()).arrayBuffer());
            if (staleBytes.byteLength === segment.raw_bytes
                && await communicationLogSha256(staleBytes) === segment.source_sha256) {
              await communicationLogSegmentDirectoryHandle.removeEntry(segment.raw_name);
            }
          } catch (error) {
            if (error?.name !== 'NotFoundError') throw error;
          }
          continue;
        } catch (archiveError) {
          try {
            await communicationLogSegmentDirectoryHandle.getFileHandle(
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
        rawHandle = await communicationLogSegmentDirectoryHandle.getFileHandle(
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
   * Removes an interrupted Duplicate output while retaining its request for a
   * fresh post-startup snapshot boundary.
   *
   * @returns {Promise<void>} Resolves after transient Duplicate output is cleared.
   */
  async function communicationLogRecoverDuplicateRequest() {
    const request = communicationLogSegmentManifest?.duplicate_request;
    if (!request) return;
    const outputName = communicationLogSegmentManifest.duplicate_output;
    if (typeof outputName === 'string' && outputName) {
      try {
        await communicationLogDirectoryHandle.removeEntry(outputName);
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
    }
    delete communicationLogSegmentManifest.duplicate_output;
    communicationLogRotationHold = 0;
    communicationLogRotationPending = false;
    await communicationLogWriteSegmentManifest();
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

      phase = 'duplicate-recovery';
      await communicationLogRecoverDuplicateRequest();

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
      if (communicationLogActiveSegmentBytes >= COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
        communicationLogRotationPending = true;
        await communicationLogSealActiveSegment();
      }
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
