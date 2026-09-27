  /** Issue #166 segmented communication-log state. */
  let communicationLogSegmentDirectoryHandle = null;
  let communicationLogSegmentManifest = null;
  let communicationLogCompressionChain = Promise.resolve();

  function communicationLogSegmentDirectoryName() {
    const identity = sanitizeFileName(currentConversationId() || communicationLogConversationName() || 'conversation');
    return `.DownloadConversation-${identity}-segments`;
  }

  async function communicationLogReadSegmentManifest() {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory) throw new Error('Communication segment directory is not ready.');
    try {
      const handle = await directory.getFileHandle('manifest.json', { create: false });
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text());
      if (parsed?.schema !== 1 || !Array.isArray(parsed.segments)) {
        throw new Error('Invalid communication segment manifest.');
      }
      return parsed;
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
      return {
        schema: 1,
        logical_log_id: currentConversationId() || crypto.randomUUID(),
        next_ordinal: 1,
        segments: []
      };
    }
  }

  async function communicationLogWriteSegmentManifest() {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory || !communicationLogSegmentManifest) {
      throw new Error('Communication segment manifest is not ready.');
    }
    const handle = await directory.getFileHandle('manifest.json', { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(JSON.stringify(communicationLogSegmentManifest, null, 2) + '\n');
      await writable.close();
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  async function communicationLogSha256(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function communicationLogWriteExactFile(directory, name, bytes) {
    const handle = await directory.getFileHandle(name, { create: true });
    let writable = null;
    try {
      writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      writable = null;
      const file = await handle.getFile();
      const committed = new Uint8Array(await file.arrayBuffer());
      if (committed.byteLength !== bytes.byteLength
          || !(await communicationLogBytesEqual(committed, bytes))) {
        throw new Error(`Exact file verification failed: ${name}`);
      }
      return handle;
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  async function communicationLogBytesEqual(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  async function communicationLogCompressSealedSegment(segment) {
    const directory = communicationLogSegmentDirectoryHandle;
    if (!directory) throw new Error('Communication segment directory is not ready.');
    const rawHandle = await directory.getFileHandle(segment.raw_name, { create: false });
    const rawFile = await rawHandle.getFile();
    const rawBytes = new Uint8Array(await rawFile.arrayBuffer());
    const sourceHash = await communicationLogSha256(rawBytes);
    if (rawBytes.byteLength !== segment.raw_bytes || sourceHash !== segment.source_sha256) {
      throw new Error(`Sealed segment ${segment.ordinal} changed before compression.`);
    }

    try {
      segment.compression_state = 'compressing';
      await communicationLogWriteSegmentManifest();
      const archiveBytes = await create7zArchive(rawBytes, segment.member_name);
      const archiveHandle = await communicationLogWriteExactFile(
        directory,
        segment.archive_name,
        archiveBytes
      );
      const committedArchive = new Uint8Array(await (await archiveHandle.getFile()).arrayBuffer());
      const extracted = await extract7zArchive(committedArchive);
      const extractedHash = await communicationLogSha256(extracted);
      if (!(await communicationLogBytesEqual(extracted, rawBytes))
          || extractedHash !== segment.source_sha256) {
        throw new Error(`Archive round-trip verification failed for segment ${segment.ordinal}.`);
      }
      segment.archive_bytes = committedArchive.byteLength;
      segment.compression_state = 'compressed';
      segment.verified_sha256 = extractedHash;
      await communicationLogWriteSegmentManifest();
      await directory.removeEntry(segment.raw_name);
      logDiagnostic('debug', 'communication-log-segment-compressed', {
        ordinal: segment.ordinal,
        raw_bytes: segment.raw_bytes,
        archive_bytes: segment.archive_bytes
      });
    } catch (error) {
      segment.compression_state = 'failed';
      segment.failure = boundedDiagnosticText(errorMessage(error), 2000);
      await communicationLogWriteSegmentManifest().catch(() => {});
      logDiagnostic('warnings', 'communication-log-segment-compression-failed', {
        ordinal: segment.ordinal,
        raw_name: segment.raw_name,
        message: segment.failure
      });
      throw error;
    }
  }

  function communicationLogQueueSegmentCompression(segment) {
    const operation = communicationLogCompressionChain.then(
      () => communicationLogCompressSealedSegment(segment)
    );
    communicationLogCompressionChain = operation.catch(() => undefined);
    return operation;
  }

  async function communicationLogTruncateActiveAfterSeal(expectedBytes, expectedHash) {
    const snapshot = await communicationLogRefreshedFileSnapshot();
    const bytes = new Uint8Array(await snapshot.file.arrayBuffer());
    if (bytes.byteLength !== expectedBytes || await communicationLogSha256(bytes) !== expectedHash) {
      throw new Error('Active communication segment changed during seal transaction.');
    }
    let writable = null;
    try {
      writable = await snapshot.handle.createWritable({ keepExistingData: true });
      await writable.truncate(0);
      await writable.close();
      writable = null;
      communicationLogWriterDirty = false;
    } catch (error) {
      await abortWritableQuietly(writable);
      throw error;
    }
  }

  async function communicationLogSealActiveSegment() {
    await communicationLogCloseActiveWriter();
    const snapshot = await communicationLogRefreshedFileSnapshot();
    if (snapshot.file.size === 0) return null;
    const rawBytes = new Uint8Array(await snapshot.file.arrayBuffer());
    const ordinal = communicationLogSegmentManifest.next_ordinal++;
    const suffix = String(ordinal).padStart(6, '0');
    const rawName = `segment-${suffix}.jsonl`;
    const archiveName = `segment-${suffix}.7z`;
    const sourceHash = await communicationLogSha256(rawBytes);
    await communicationLogWriteExactFile(
      communicationLogSegmentDirectoryHandle,
      rawName,
      rawBytes
    );
    const segment = {
      ordinal,
      raw_name: rawName,
      archive_name: archiveName,
      member_name: rawName,
      raw_bytes: rawBytes.byteLength,
      source_sha256: sourceHash,
      compression_state: 'sealed'
    };
    communicationLogSegmentManifest.segments.push(segment);
    await communicationLogWriteSegmentManifest();
    await communicationLogTruncateActiveAfterSeal(rawBytes.byteLength, sourceHash);
    await communicationLogOpenWriter();
    void communicationLogQueueSegmentCompression(segment).catch(() => {});
    return segment;
  }

  async function communicationLogRecoverSegmentState() {
    for (const segment of communicationLogSegmentManifest.segments) {
      if (segment.compression_state === 'compressed') continue;
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
      const active = await communicationLogRefreshedFileSnapshot();
      if (active.file.size === segment.raw_bytes) {
        const activeBytes = new Uint8Array(await active.file.arrayBuffer());
        if (await communicationLogSha256(activeBytes) === segment.source_sha256) {
          await communicationLogTruncateActiveAfterSeal(segment.raw_bytes, segment.source_sha256);
        }
      }
      segment.compression_state = 'sealed';
      void communicationLogQueueSegmentCompression(segment).catch(() => {});
    }
  }

  async function communicationLogInitializeSegmentStorage() {
    communicationLogSegmentDirectoryHandle =
      await communicationLogDirectoryHandle.getDirectoryHandle(
        communicationLogSegmentDirectoryName(),
        { create: true }
      );
    communicationLogSegmentManifest = await communicationLogReadSegmentManifest();
    await communicationLogRecoverSegmentState();
  }

  async function communicationLogStorageAppendRecord(record) {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = new TextEncoder().encode(line).byteLength;
    const queued = communicationLogEnqueue('storage-append', async () => {
      await communicationLogOpenWriter();
      await communicationLogWritable.write(line);
      communicationLogWriterDirty = true;
      const snapshot = await communicationLogRefreshedFileSnapshot();
      const pendingBytes = communicationLogWriterDirty ? lineBytes : 0;
      if (snapshot.file.size + pendingBytes >= COMMUNICATION_LOG_SEGMENT_TARGET_BYTES) {
        await communicationLogSealActiveSegment();
      }
    });
    return queued.operation;
  }
