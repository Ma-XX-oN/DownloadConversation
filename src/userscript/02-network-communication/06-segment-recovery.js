  /**
   * Derives the append target from the two alternating physical files.
   *
   * @returns {Promise<void>} Resolves after an active file is selected/created.
   */
  async function communicationLogRecoverAlternatingActiveFiles() {
    const states = [];
    for (const name of COMMUNICATION_LOG_ACTIVE_FILE_NAMES) {
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
  }

  /**
   * Recovers the non-active alternating file as an interrupted sealed source.
   *
   * @returns {Promise<void>} Resolves after recovery compression is scheduled.
   */
  async function communicationLogRecoverSegmentState() {
    const closedName = COMMUNICATION_LOG_ACTIVE_FILE_NAMES.find(
      name => name !== communicationLogActiveFileName
    );
    if (!closedName) return;
    let rawHandle;
    try {
      rawHandle = await communicationLogSegmentDirectoryHandle.getFileHandle(
        closedName,
        { create: false }
      );
    } catch (error) {
      if (error?.name === 'NotFoundError') return;
      throw error;
    }
    const rawFile = await rawHandle.getFile();
    if (rawFile.size === 0) {
      await communicationLogSegmentDirectoryHandle.removeEntry(closedName);
      return;
    }
    const rawBytes = new Uint8Array(await rawFile.arrayBuffer());
    const range = communicationLogTimestampRangeFromJsonl(rawBytes);
    if (!range) throw new Error(`Closed communication source has no timestamp range: ${closedName}`);
    const start = communicationLogArchiveTimestamp(range.start_timestamp);
    const end = communicationLogArchiveTimestamp(range.end_timestamp);
    const segment = {
      raw_name: closedName,
      archive_name: communicationLogRoleArchiveName('segment', range, 'seg'),
      member_name: `segment_${start}-${end}.jsonl`,
      raw_bytes: rawBytes.byteLength,
      source_sha256: await communicationLogSha256(rawBytes),
      start_timestamp: range.start_timestamp,
      end_timestamp: range.end_timestamp
    };

    try {
      const archiveHandle = await communicationLogSegmentDirectoryHandle.getFileHandle(
        segment.archive_name,
        { create: false }
      );
      const archive = new Uint8Array(await (await archiveHandle.getFile()).arrayBuffer());
      const extracted = await extractArchive(archive);
      if (await communicationLogBytesEqual(extracted, rawBytes)) {
        await communicationLogSegmentDirectoryHandle.removeEntry(closedName);
        return;
      }
      await communicationLogSegmentDirectoryHandle.removeEntry(segment.archive_name);
    } catch (error) {
      if (error?.name !== 'NotFoundError') {
        try {
          await communicationLogSegmentDirectoryHandle.removeEntry(segment.archive_name);
        } catch (removeError) {
          if (removeError?.name !== 'NotFoundError') throw removeError;
        }
      }
    }
    void communicationLogQueueSegmentCompression(segment).catch(() => {});
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
    const output = communicationLogSegmentManifest.duplicate_output;
    if (typeof output === 'string' && output) {
      try {
        await communicationLogDirectoryHandle.removeEntry(output);
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
        segment_directory: directoryName
      });

      phase = 'duplicate-recovery';
      await communicationLogRecoverDuplicateRequest();

      phase = 'active-file-recovery';
      await communicationLogRecoverAlternatingActiveFiles();

      phase = 'recovery';
      logDiagnostic('debug', 'communication-log-segment-recovery-started', {
        segment_directory: directoryName
      });
      await communicationLogRecoverSegmentState();
      logDiagnostic('debug', 'communication-log-segment-recovery-completed', {
        segment_directory: directoryName
      });

      phase = 'active-snapshot';
      const activeSnapshot = await communicationLogRefreshedFileSnapshot();
      communicationLogActiveSegmentBytes = activeSnapshot.file.size;
      const activeRange = communicationLogActiveSegmentBytes > 0
        ? communicationLogTimestampRangeFromJsonl(
          new Uint8Array(await activeSnapshot.file.arrayBuffer())
        )
        : null;
      communicationLogActiveLastTimestamp = activeRange?.end_timestamp ?? null;
      communicationLogSegmentManifest.active_committed_eof =
        communicationLogActiveSegmentBytes;
      communicationLogSegmentManifest.active_last_timestamp =
        communicationLogActiveLastTimestamp;
      await communicationLogWriteSegmentManifest();
      if (communicationLogActiveSegmentBytes >= COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
        communicationLogRotationPending = true;
        await communicationLogSealActiveSegment();
      }
      logDiagnostic('debug', 'communication-log-segment-initialize-completed', {
        segment_directory: directoryName,
        active_segment_bytes: communicationLogActiveSegmentBytes
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
