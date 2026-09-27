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

  /**
   * Initializes durable segmented storage before recorder readiness.
   *
   * @returns {Promise<void>} Resolves when active and historical state is ready.
   */
  async function communicationLogInitializeSegmentStorage() {
    communicationLogSegmentDirectoryHandle =
      await communicationLogDirectoryHandle.getDirectoryHandle(
        communicationLogSegmentDirectoryName(),
        { create: true }
      );
    communicationLogSegmentManifest = await communicationLogReadSegmentManifest();
    await communicationLogRecoverSegmentState();
    communicationLogActiveSegmentBytes =
      (await communicationLogRefreshedFileSnapshot()).file.size;
  }
