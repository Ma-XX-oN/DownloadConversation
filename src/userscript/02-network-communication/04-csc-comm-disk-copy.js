
  /**
   * Copies a frozen logical COMM snapshot into a new, separately authorized
   * directory. Copies stored fragments and manifest, not a new format.
   * @returns {Object} Physical file-copy service.
   */
  function cscCommDiskCopy() {
    /**
     * Returns a file with explicit create=false semantics.
     * @param {Object} directory - Authorized FileSystemDirectoryHandle.
     * @param {string} name - Validated filename.
     * @returns {Promise<Object>} Existing file handle.
     */
    async function handle(directory, name) {
      return directory.getFileHandle(name, { create: false });
    }
    /**
     * Compares committed source and destination chunk by chunk.
     * @param {Object} source - Source File snapshot.
     * @param {Object} output - Destination File snapshot.
     * @returns {Promise<void>} Exact byte identity proved.
     */
    async function compare(source, output) {
      if (source.size !== output.size) {
        throw new Error('csc-writer-duplicate-size-mismatch');
      }
      const chunkSize = 512 * 1024;
      for (let pos = 0; pos < source.size; pos += chunkSize) {
        const [a, b] = await Promise.all([
          source.slice(pos, pos + chunkSize).arrayBuffer(),
          output.slice(pos, pos + chunkSize).arrayBuffer()
        ]);
        const left = new Uint8Array(a);
        const right = new Uint8Array(b);
        if (left.length !== right.length ||
            left.some((byte, i) => byte !== right[i])) {
          throw new Error('csc-writer-duplicate-readback-mismatch');
        }
      }
    }
    /**
     * Copies source bytes through bounded buffers to a fresh destination.
     * @param {Object} sourceDir - Immutable source directory.
     * @param {Object} outputDir - New empty destination directory.
     * @param {string} fileName - A validated archive or manifest name.
     * @returns {Promise<void>} Source and copy equal on disk.
     */
    async function copyFile(sourceDir, outputDir, fileName) {
      const origin = await (await handle(sourceDir, fileName)).getFile();
      const dest = await outputDir.getFileHandle(fileName, { create: true });
      let writer = null;
      try {
        writer = await dest.createWritable();
        const chunkSize = 512 * 1024;
        for (let pos = 0; pos < origin.size; pos += chunkSize) {
          const bytes = new Uint8Array(await origin.slice(
            pos, pos + chunkSize).arrayBuffer());
          await writer.write(bytes);
        }
        await writer.close();
        writer = null;
        await compare(origin, await dest.getFile());
      } catch (error) {
        if (writer) await writer.abort().catch(() => {});
        throw error;
      }
    }
    /**
     * Copies a verified snapshot into a new private output directory.
     * It never overwrites or deletes an existing target.
     * @param {Object} sourceDir - Current Worker fragment directory.
     * @param {Object} outputRoot - Explicitly authorized destination parent.
     * @param {string} outputId - Unique caller-selected copy identity.
     * @param {Object} inventory - Frozen manifest snapshot.
     * @returns {Promise<Object>} Verified destination and file count.
     */
    async function duplicate(sourceDir, outputRoot, outputId, inventory) {
      if (!outputRoot || typeof outputRoot.getDirectoryHandle !== 'function' ||
          typeof outputRoot.removeEntry !== 'function' ||
          typeof outputId !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(outputId) ||
          !Array.isArray(inventory?.archives)) {
        throw new Error('csc-writer-invalid-duplicate-target');
      }
      if (typeof outputRoot.queryPermission === 'function' &&
          await outputRoot.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('csc-writer-permission-denied');
      }
      const name = 'dc-comm-duplicate-' + outputId;
      try {
        await outputRoot.getDirectoryHandle(name, { create: false });
        throw new Error('csc-writer-duplicate-name-collision');
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      let created = false;
      try {
        const target = await outputRoot.getDirectoryHandle(name, {
          create: true
        });
        created = true;
        const files = ['manifest.json', ...inventory.archives.map(
          fragment => fragment.name)];
        for (const filename of files) {
          if (filename !== 'manifest.json' &&
              !/^fragment-\d{8}\.jsonl\.zst$/.test(filename)) {
            throw new Error('csc-writer-invalid-duplicate-source');
          }
          await copyFile(sourceDir, target, filename);
        }
        return { directory_name: name, files: files.length };
      } catch (error) {
        if (created) {
          await outputRoot.removeEntry(name, { recursive: true })
            .catch(() => {
              throw new Error('csc-writer-duplicate-cleanup-failed');
            });
        }
        throw error;
      }
    }
    return Object.freeze({ duplicate });
  }
