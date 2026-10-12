
  /** Per-tab document-epoch counter, incremented once per page initialization. */
  const LOG_CAPTURE_EPOCH_KEY = 'tm-recorder-capture-epoch';
  /** Document epoch for comparing Gen and Comm events without using clocks. */
  const logCaptureEpoch = (() => {
    const prior = Number(sessionStorage.getItem(LOG_CAPTURE_EPOCH_KEY));
    const next = Number.isSafeInteger(prior) && prior >= 0 ? prior + 1 : 1;
    sessionStorage.setItem(LOG_CAPTURE_EPOCH_KEY, String(next));
    return next;
  })();
  /** Per-document capture position shared by both event sources. */
  let logCaptureSequence = 0;

  /**
   * Assigns a relative capture order without sorting by wall-clock time.
   *
   * @returns {Object} Document epoch and per-document insertion sequence.
   */
  function logCapturePosition() {
    return { epoch: logCaptureEpoch, ordinal: ++logCaptureSequence,
      document: recordingGroupInstanceId };
  }

  /**
   * Validates exact timestamp bounds and one-or-more source selection.
   *
   * @param {Object} selection - UI's inclusive timestamp and source selection.
   * @returns {Object} Numeric boundaries and selected source switches.
   */
  function mergedLogValidateSelection(selection) {
    if (!selection || (!selection.general && !selection.communication)) {
      throw new Error('Select Gen or Comm before extracting logs.');
    }
    const lower = Date.parse(selection.start_timestamp);
    const upper = Date.parse(selection.end_timestamp);
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
      throw new Error('Log extraction requires an ordered, valid date/time range.');
    }
    return { lower, upper, general: selection.general === true,
      communication: selection.communication === true };
  }

  /**
   * Filters one source by time while retaining original insertion order.
   *
   * @param {Object[]} entries - Source events in existing source order.
   * @param {number} lower - Inclusive start epoch milliseconds.
   * @param {number} upper - Inclusive end epoch milliseconds.
   * @returns {Object[]} Filtered events without any reordering.
   */
  function mergedLogRangeFilter(entries, lower, upper) {
    return entries.filter(entry => {
      const timestamp = entry?.timestamp;
      const time = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
      return Number.isFinite(time) && time >= lower && time <= upper;
    });
  }

  /**
   * Parses retained communication JSONL in its original file order.
   *
   * @param {Uint8Array} bytes - Exact recorded bytes.
   * @returns {Object[]} Complete JSONL objects without timestamp ordering.
   */
  function mergedLogParseJsonl(bytes) {
    const results = [];
    const text = new TextDecoder().decode(bytes);
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        if (index === lines.length - 1 && !text.endsWith('\n')) {
          // An incomplete final line is not a committed JSONL record.
          continue;
        }
        throw new Error('Malformed complete communication JSONL record at line '
          + (index + 1));
      }
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new Error('Communication JSONL record is not an object at line '
          + (index + 1));
      }
      results.push(event);
    }
    return results;
  }

  /**
   * Reads earlier conversations visited by this recording tab from the
   * existing per-conversation segment directories without changing storage.
   *
   * @returns {Promise<Object[][]>} Original file-order communication blocks.
   */
  async function mergedLogPreviousConversationBlocks() {
    const current = communicationLogSegmentDirectoryHandle?.name ?? null;
    const groups = [];
    for (const directoryName of recordingGroupDirectoryNames()) {
      if (directoryName === current) continue;
      let directory;
      try {
        directory = await communicationLogDirectoryHandle.getDirectoryHandle(
          directoryName, { create: false }
        );
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          throw new Error('Recorded communication directory is missing: '
            + directoryName);
        }
        throw error;
      }
      for await (const [name, handle] of directory.entries()) {
        if (handle?.kind !== 'file') continue;
        const archived = communicationLogParseSegmentArchiveName(name);
        const isActive = COMMUNICATION_LOG_ACTIVE_FILE_NAMES.includes(name);
        if (!archived && !isActive) continue;
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const plain = archived ? await extractArchive(bytes) : bytes;
        groups.push(mergedLogParseJsonl(plain));
      }
    }
    return groups;
  }

  /**
   * Freezes and reads existing disk archives without altering their storage.
   *
   * @returns {Promise<Object[]>} Captured communication events in file order.
   */
  async function mergedLogReadCommunication() {
    if (!communicationLogReady || !communicationLogSegmentDirectoryHandle) {
      throw new Error('Communication recording directory is not ready.');
    }
    const queued = communicationLogEnqueue('merged-log-extract-snapshot',
      async () => communicationLogCaptureSnapshotPlan());
    const plan = await queued.operation;
    const blocks = [];
    for (const segment of plan.segments) {
      const bytes = await communicationLogReadHistoricalSegment(segment);
      blocks.push(mergedLogParseJsonl(bytes));
    }
    const active = await communicationLogSegmentDirectoryHandle.getFileHandle(
      plan.active_name, { create: false }
    );
    const file = await active.getFile();
    if (file.size < plan.active_eof) {
      throw new Error('Communication active file changed below frozen EOF.');
    }
    const bytes = new Uint8Array(
      await file.slice(0, plan.active_eof).arrayBuffer()
    );
    blocks.push(mergedLogParseJsonl(bytes));
    const group = recordingGroupState();
    if (group.ready && group.uuid) {
      blocks.push(...await mergedLogPreviousConversationBlocks());
      // A group starts at explicit enablement. Historical entries from
      // before enablement and other tabs must never leak into the output.
      for (let i = 0; i < blocks.length; i += 1) {
        blocks[i] = blocks[i].filter(event =>
          event.recording_group_uuid === group.uuid
        );
      }
    }
    // The older segment naming scheme sorts by timestamps, not source order.
    // New records carry capture_order; sort whole archived blocks by their
    // capture position when every block has comparable evidence.
    const positioned = group.ready && group.uuid
      && blocks.every(block => block.every(event =>
      mergedLogValidPosition(event?.capture_order)));
    if (positioned) {
      blocks.sort((left, right) => {
        if (!left.length || !right.length) return 0;
        return mergedLogComparePosition(
          left[0].capture_order, right[0].capture_order
        );
      });
    }
    const records = blocks.flat();
    const seen = new Set();
    return records.filter(event => {
      if (!mergedLogValidPosition(event?.capture_order)) return true;
      const key = String(event.recording_group_uuid) + ':'
        + event.capture_order.epoch + ':' + event.capture_order.ordinal;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Checks a source's explicit capture-order evidence.
   *
   * @param {Object} value - Candidate order marker.
   * @returns {boolean} Whether the marker is structurally valid.
   */
  function mergedLogValidPosition(value) {
    return value && Number.isSafeInteger(value.epoch) && value.epoch > 0
      && Number.isSafeInteger(value.ordinal) && value.ordinal > 0
      && typeof value.document === 'string' && value.document.length > 0;
  }

  /**
   * Compares cross-stream capture markers, never wall-clock timestamps.
   *
   * @param {Object} left - First capture position.
   * @param {Object} right - Second capture position.
   * @returns {number} Negative when first event was captured earlier.
   */
  function mergedLogComparePosition(left, right) {
    return left.epoch - right.epoch || left.ordinal - right.ordinal;
  }

  /**
   * Merges two source streams without changing either stream's event order.
   *
   * For legacy entries without shared order markers, sources stay in separate
   * intact ranges and an explicit uncertainty declaration accompanies export.
   *
   * @param {Object[]} general - Filtered Gen events in insertion order.
   * @param {Object[]} communication - Filtered Comm events in insertion order.
   * @returns {Object} Combined source-tagged events plus order provenance.
   */
  function mergedLogInterleave(general, communication) {
    const tagged = [];
    const all = [...general, ...communication];
    const isPositioned = all.every(event =>
      mergedLogValidPosition(event?.capture_order));
    const documents = new Set(all.map(event =>
      event?.capture_order?.document));
    const groupIds = new Set(all.map(event => event?.recording_group_uuid));
    const sameGroup = groupIds.size === 1
      && !groupIds.has(null) && !groupIds.has(undefined);
    /**
     * Checks whether one source remains monotonic in capture ordinals.
     *
     * @param {Object[]} stream - Original ordered source entries.
     * @returns {boolean} Whether source event order agrees with capture order.
     */
    const ordered = stream => stream.every((event, index) =>
      index === 0 || mergedLogComparePosition(
        stream[index - 1].capture_order, event.capture_order
      ) <= 0);
    const orderConflict = isPositioned
      && (!ordered(general) || !ordered(communication));
    if (!isPositioned || orderConflict
        || (documents.size > 1 && !sameGroup)) {
      for (const event of general) tagged.push({ source: 'gen', record: event });
      for (const event of communication) {
        tagged.push({ source: 'comm', record: event });
      }
      return { entries: tagged, ordering: orderConflict
        ? 'source-order-conflict' : 'legacy-source-ranges' };
    }
    let g = 0;
    let c = 0;
    while (g < general.length || c < communication.length) {
      const takeGeneral = c >= communication.length || (
        g < general.length && mergedLogComparePosition(
          general[g].capture_order, communication[c].capture_order
        ) <= 0
      );
      if (takeGeneral) tagged.push({ source: 'gen', record: general[g++] });
      else tagged.push({ source: 'comm', record: communication[c++] });
    }
    return { entries: tagged, ordering: 'capture-sequence' };
  }

  /**
   * Groups consecutive events by source and diagnostic severity.
   *
   * A change in stream or severity starts another group. The severity is
   * moved out of the individual record only when originally present, so
   * missing severity and an explicit null remain distinguishable. Original
   * record order is never changed.
   *
   * @param {Object[]} entries - Already merged source-tagged records.
   * @returns {Object[]} Consecutive source/severity blocks.
   */
  function mergedLogGroupEntries(entries) {
    const groups = [];
    for (const entry of entries) {
      const original = entry.record;
      const hasLevel = Object.hasOwn(original, 'level');
      const level = hasLevel ? original.level : undefined;
      const previous = groups[groups.length - 1];
      if (!previous || previous.source !== entry.source
          || Object.hasOwn(previous, 'level') !== hasLevel
          || (hasLevel && !Object.is(previous.level, level))) {
        const group = { source: entry.source };
        if (hasLevel) group.level = level;
        group.records = [];
        groups.push(group);
      }
      const record = hasLevel ? { ...original } : original;
      if (hasLevel) delete record.level;
      groups[groups.length - 1].records.push(record);
    }
    return groups;
  }

  /**
   * Renders grouped source/severity JSONL with export provenance.
   *
   * @param {Object} merge - Selected interleaved event stream.
   * @param {Object} selection - Original export bounds.
   * @returns {string} Newline-terminated grouped JSONL.
   */
  function mergedLogJsonl(merge, selection) {
    const header = {
      kind: 'downloadconversation-merged-log',
      schema: 2,
      ordering: merge.ordering,
      start_timestamp: selection.start_timestamp,
      end_timestamp: selection.end_timestamp,
      group_uuid: recordingGroupState().uuid
    };
    return [JSON.stringify(header),
      ...mergedLogGroupEntries(merge.entries).map(JSON.stringify)].join('\n')
      + '\n';
  }

  /**
   * Saves a combined Gen/Comm snapshot using the existing archive primitives.
   *
   * @param {Object} selection - User-selected inclusive bounds and source flags.
   * @returns {Promise<string>} Verified archive filename.
   */
  async function saveMergedLogs(selection) {
    const ownership = recordingGroupState();
    if (ownership.enabled && !ownership.ready) {
      throw new Error('Recording group ownership is not yet verified.');
    }
    const bounds = mergedLogValidateSelection(selection);
    const group = recordingGroupState();
    const general = bounds.general ? mergedLogRangeFilter(
      group.ready && group.uuid
        ? diagnosticLog.filter(e => e.recording_group_uuid === group.uuid)
        : diagnosticLog, bounds.lower, bounds.upper
    ) : [];
    const communication = bounds.communication ? mergedLogRangeFilter(
      await mergedLogReadCommunication(), bounds.lower, bounds.upper
    ) : [];
    const merge = mergedLogInterleave(general, communication);
    if (!merge.entries.length) {
      throw new Error('No recorded events exist within the selected range.');
    }
    const text = mergedLogJsonl(merge, selection);
    const source = new TextEncoder().encode(text);
    const archive = await createArchive(source);
    const restored = await extractArchive(archive);
    if (!diagnosticLogBytesEqual(source, restored)) {
      throw new Error('Merged-log archive round-trip verification failed.');
    }
    const range = {
      start_timestamp: selection.start_timestamp,
      end_timestamp: selection.end_timestamp
    };
    const prefix = canonicalFilename(
      conversationProjectName(), conversationTitle(), range
    );
    const suffix = '.mlog' + compressorExtension();
    const directory = communicationLogReady
      ? communicationLogDirectoryHandle : null;
    let name = prefix + suffix;
    if (directory) {
      name = await unusedFilename(directory, prefix, suffix);
      await diagnosticLogWriteArchive(directory, name, archive);
    } else {
      downloadBlob(new Blob([archive], { type: compressorMimeType() }), name);
    }
    setStatus('Merged logs: ' + merge.entries.length + ' records saved as '
      + name + ' (' + merge.ordering + ').');
    return name;
  }

  /**
   * Opens one extraction dialog and saves exactly the selected sources/range.
   *
   * @param {HTMLButtonElement} button - Disk action origin.
   * @returns {Promise<void>} Resolves after completion or cancellation.
   */
  async function runMergedLogExtraction(button) {
    const selection = await showLogExtractionDialog(button);
    if (!selection) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await saveMergedLogs(selection);
    } catch (error) {
      logDiagnostic('errors', 'merged-log-save-failed', {
        message: errorMessage(error)
      });
      setStatus('Merged log extraction failed: ' + errorMessage(error));
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
