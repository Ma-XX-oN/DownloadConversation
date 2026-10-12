
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
      if (index === lines.length - 1 && !text.endsWith('\n')) break;
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
      if (index === 0 && Object.keys(event).length === 1
          && Object.hasOwn(event, 'version') && !Object.hasOwn(event, 'timestamp')) {
        continue;
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
        groups.push({ bytes: plain, records: mergedLogParseJsonl(plain) });
      }
    }
    return groups;
  }

  /**
   * Freezes and reads existing disk archives without altering their storage.
   *
   * @returns {Promise<Object[]>} Captured communication events in file order.
   */
  async function mergedLogReadCommunication(includeVersions = false) {
    if (!communicationLogReady || !communicationLogSegmentDirectoryHandle) {
      throw new Error('Communication recording directory is not ready.');
    }
    const queued = communicationLogEnqueue('merged-log-extract-snapshot',
      async () => communicationLogCaptureSnapshotPlan());
    const plan = await queued.operation;
    const blocks = [];
    for (const segment of plan.segments) {
      const bytes = await communicationLogReadHistoricalSegment(segment);
      blocks.push({ bytes, records: mergedLogParseJsonl(bytes) });
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
    blocks.push({ bytes, records: mergedLogParseJsonl(bytes) });
    const group = recordingGroupState();
    if (group.ready && group.uuid) {
      blocks.push(...await mergedLogPreviousConversationBlocks());
      // A group starts at explicit enablement. Historical entries from
      // before enablement and other tabs must never leak into the output.
      for (let i = 0; i < blocks.length; i += 1) {
        blocks[i].records = blocks[i].records.filter(event =>
          event.recording_group_uuid === group.uuid
        );
      }
    }
    // The older segment naming scheme sorts by timestamps, not source order.
    // New records carry capture_order; sort whole archived blocks by their
    // capture position when every block has comparable evidence.
    const positioned = group.ready && group.uuid
      && blocks.every(block => block.records.every(event =>
      mergedLogValidPosition(event?.capture_order)));
    if (positioned) {
      blocks.sort((left, right) => {
        if (!left.records.length || !right.records.length) return 0;
        return mergedLogComparePosition(
          left.records[0].capture_order, right.records[0].capture_order
        );
      });
    }
    const records = blocks.flatMap(block => block.records);
    const seen = new Set();
    const unique = records.filter(event => {
      if (!mergedLogValidPosition(event?.capture_order)) return true;
      const key = String(event.recording_group_uuid) + ':'
        + event.capture_order.epoch + ':' + event.capture_order.ordinal;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!includeVersions) return unique;
    const encoder = new TextEncoder();
    const fragments = blocks.filter(block => block.records.length > 0)
      .map(block => {
        const original = new TextDecoder().decode(block.bytes);
        const headerLine = original.split('\n', 1)[0];
        let header = null;
        try {
          const candidate = JSON.parse(headerLine);
          if (candidate && typeof candidate === 'object'
              && !Array.isArray(candidate)
              && Object.keys(candidate).length === 1
              && Object.hasOwn(candidate, 'version')) {
            header = candidate;
          }
        } catch {}
        const physical = header ? [header, ...block.records] : block.records;
        return encoder.encode(physical.map(JSON.stringify).join('\n') + '\n');
      });
    return { records: unique, fragments };
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
