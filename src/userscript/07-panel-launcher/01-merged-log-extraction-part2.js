
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
    const generalSource = group.ready && group.uuid
      ? diagnosticLog.filter(e => e.recording_group_uuid === group.uuid)
      : diagnosticLog;
    const general = bounds.general
      ? mergedLogRangeFilter(generalSource, bounds.lower, bounds.upper) : [];
    const commSource = bounds.communication
      ? await mergedLogReadCommunication(true) : { records: [], fragments: [] };
    const communication = bounds.communication
      ? mergedLogRangeFilter(commSource.records, bounds.lower, bounds.upper) : [];
    const merge = mergedLogInterleave(general, communication);
    if (!merge.entries.length) {
      throw new Error('No recorded events exist within the selected range.');
    }
    const provenance = mergedLogBoundaryVersionRecord(
      generalSource, diagnosticLogBaselineVersion, commSource.fragments,
      selection
    );
    const text = mergedLogJsonlWithVersions(merge, selection, provenance);
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
