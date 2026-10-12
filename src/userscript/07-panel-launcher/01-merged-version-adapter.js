  /**
   * Resolve both versions at the selected inclusive export boundary.
   * Inputs are source-order GEN diagnostics and exact physical COMM fragments.
   * No source event or immutable fragment header is changed.
   *
   * @param {Object[]} general - Unfiltered, source-order GEN diagnostics.
   * @param {string|null} genBaseline - Effective GEN version before general[0].
   * @param {Uint8Array[]} fragments - Ordered physical COMM JSONL fragments.
   * @param {Object} selection - Inclusive selected start/end and source flags.
   * @returns {Object} Version record with gen and comm fields, each nullable.
   */
  function mergedLogBoundaryVersionRecord(general, genBaseline, fragments, selection) {
    const lower = Date.parse(selection.start_timestamp);
    const upper = Date.parse(selection.end_timestamp);
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
      throw new Error('Invalid combined log version range.');
    }
    let gen = null;
    if (selection.general === true) {
      const preceding = general.filter(entry => {
        const ms = typeof entry?.timestamp === 'string'
          ? Date.parse(entry.timestamp) : NaN;
        return Number.isFinite(ms) && ms <= lower;
      });
      gen = preceding.length
        ? resolveGenVersionAtBoundary(
          preceding, preceding.length - 1, genBaseline
        ) : genBaseline;
    }
    const comm = selection.communication === true
      ? communicationLogResolveCommVersionAtBoundary(fragments, lower)
      : null;
    return { version: { gen, comm } };
  }

  /**
   * Prefix exactly one timestamp-free provenance record before #220's grouped
   * source-order export. Fragment metadata must never appear as an event.
   *
   * @param {Object} merge - #220's tagged, ordered GEN/COMM event stream.
   * @param {Object} selection - Original export selection.
   * @param {Object} provenance - Resolver-produced version record.
   * @returns {string} Newline-terminated JSONL, unchanged event order/count.
   */
  function mergedLogJsonlWithVersions(merge, selection, provenance) {
    const fields = provenance?.version;
    if (!fields || !(fields.gen === null || typeof fields.gen === 'string')
        || !(fields.comm === null || typeof fields.comm === 'string')) {
      throw new TypeError('Invalid combined version provenance.');
    }
    const entries = merge.entries.filter(item => {
      const value = item?.record;
      return !(item?.source === 'comm' && value
        && typeof value === 'object' && !Array.isArray(value)
        && !Object.hasOwn(value, 'timestamp')
        && Object.keys(value).length === 1
        && Object.hasOwn(value, 'version'));
    });
    return JSON.stringify({ version: { gen: fields.gen, comm: fields.comm } })
      + '\n' + mergedLogJsonl({ ...merge, entries }, selection);
  }
