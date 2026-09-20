   * @returns {Array<unknown>} The ordered values produced by `apiRecordIdentifierScalars`.
   */
  function apiRecordIdentifierScalars(record) {
    const raw = record?.message && typeof record.message === 'object' ? record.message : {};
    const result = [];
    const seen = new Set();
    // Content-bearing fields are excluded from identifier linkage scanning to avoid false matches.
    const freeformKeys = new Set([
      'text', 'parts', 'thinking', 'summary', 'message', 'prompt', 'output', 'input', 'content'
    ]);
    /**
     * Handles walk.
     *
     * @param {string} value - The value to process.
     * @param {string} path - The property path being traversed.
     * @param {Object} depth - The current traversal depth.
     * @returns {void} No value is returned.
     */
    const walk = (value, path, depth) => {
      if (depth > 8 || value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(value.length, 12); i += 1) {
          walk(value[i], `${path}[${i}]`, depth + 1);
        }
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (child && typeof child === 'object') {
          if (!freeformKeys.has(key)) walk(child, childPath, depth + 1);
          continue;
        }
        if (freeformKeys.has(key)) continue;
        if (apiLinkageKeyIsIdentifierLike(key) && apiLinkageScalarIsSafe(key, child)) {
          result.push({ path: childPath, key, value: child });
        }
      }
    };
    walk(raw, '', 0);
    return result;
  }

  /**
   * Handles API conversation UAP grouping.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @returns {Object} The Object value produced by `apiConversationUapGrouping`.
   */
  function apiConversationUapGrouping(spine) {
    const anchors = spine?.uap_anchors ?? [];
    const records = spine?.records ?? [];
    // Maps each exact turn-exchange id to the UAP anchor ordinals that carry it.
    const exchangeToAnchors = new Map();
    // Maps each exact working-turn id to the UAP anchor ordinals that carry it.
    const workingToAnchors = new Map();
    /**
     * Handles add.
     *
     * @param {Map<unknown, unknown>} map - The map value required by this function.
     * @param {string} key - The lookup key to process.
     * @param {number} ordinal - The ordinal position to process.
     * @returns {void} No value is returned.
     */
    const add = (map, key, ordinal) => {
      if (!key) return;
      const values = map.get(key) ?? [];
      values.push(ordinal);
      map.set(key, values);
    };
    for (const anchor of anchors) {
      add(exchangeToAnchors, anchor.turn_exchange_id, anchor.ordinal);
      add(workingToAnchors, anchor.working_turn_id, anchor.ordinal);
    }

    /**
     * Handles groups.
     */
    const groups = anchors.map(anchor => ({
      ordinal: anchor.ordinal,
      user_message_id: anchor.user_message_id,
      user_record_ordinal: anchor.user_record_ordinal,
      record_ordinals: [],
      exact_record_ordinals: []
    }));
    // Stores one association classification for every source record in spine order.
    const classifications = [];
    // Summarizes association evidence without affecting the grouping decisions themselves.
    const counts = { exact: 0, fallback: 0, ungrouped: 0, conflict: 0 };

    /**
     * Handles chronological anchor.
     *
     * @param {number} recordOrdinal - The zero-based record ordinal.
     * @returns {null} The value produced by `chronologicalAnchor`, or `null` when unavailable.
     */
    const chronologicalAnchor = recordOrdinal => {
      let candidate = null;
      for (const anchor of anchors) {
        if (anchor.user_record_ordinal > recordOrdinal) break;
        candidate = anchor.ordinal;
      }
      return candidate;
    };

    for (const record of records) {
      const exchangeCandidates = record.turn_exchange_id
        ? (exchangeToAnchors.get(record.turn_exchange_id) ?? [])
        : [];
      const workingCandidates = record.working_turn_id
        ? (workingToAnchors.get(record.working_turn_id) ?? [])
        : [];
      const exactCandidates = [...new Set([...exchangeCandidates, ...workingCandidates])];
      const disagreement = exchangeCandidates.length === 1 && workingCandidates.length === 1 &&
        exchangeCandidates[0] !== workingCandidates[0];
      let classification;
      let uapOrdinal = null;
      let basis = null;
      if (disagreement || exactCandidates.length > 1) {
        classification = 'conflict';
      } else if (exactCandidates.length === 1) {
        classification = 'exact';
        uapOrdinal = exactCandidates[0];
        basis = exchangeCandidates.length === 1 && workingCandidates.length === 1
          ? 'turn_exchange_id+working_turn_id'
          : exchangeCandidates.length === 1 ? 'turn_exchange_id' : 'working_turn_id';
        groups[uapOrdinal].exact_record_ordinals.push(record.ordinal);
      } else {
        uapOrdinal = chronologicalAnchor(record.ordinal);
        if (uapOrdinal === null) classification = 'ungrouped';
        else {
          classification = 'fallback';
          basis = 'chronological-window';
        }
      }
      counts[classification] += 1;
      classifications.push({
        record_ordinal: record.ordinal,
        message_id: record.message_id,
        role: record.role,
        classification,
        uap_ordinal: uapOrdinal,
        basis
      });
    }
    return { groups, classifications, counts };
  }

  /**
   * Handles API unresolved UAP linkage analysis.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @param {Object} primary - The primary value required by this function.
   * @returns {Object} The Object value produced by `apiUnresolvedUapLinkageAnalysis`.
   */
  function apiUnresolvedUapLinkageAnalysis(spine, primary) {
    const records = spine?.records ?? [];
    // Reverse lookup from exactly-associated message ids to their proven UAP ordinal.
    const exactMessageToUap = new Map();
    // Reverse lookup from identifier-like source values to UAPs established by exact records.
    const exactIdentifierToUaps = new Map();
    /**
     * Handles key for.
     *
     * @param {string} value - The value to process.
     * @returns {void} No value is returned.
     */
    const keyFor = value => `${typeof value}:${String(value)}`;
    /**
     * Handles add ref.
     *
     * @param {Map<unknown, unknown>} map - The map value required by this function.
     * @param {string} value - The value to process.
     * @param {number} uapOrdinal - The zero-based uap ordinal.
     * @returns {void} No value is returned.
     */
    const addRef = (map, value, uapOrdinal) => {
      const key = keyFor(value);
      const values = map.get(key) ?? new Set();
      values.add(uapOrdinal);
      map.set(key, values);
    };

    for (const item of primary.classifications) {
      if (item.classification !== 'exact') continue;
      const record = records[item.record_ordinal];
      exactMessageToUap.set(record.message_id, item.uap_ordinal);
      for (const scalar of apiRecordIdentifierScalars(record)) {
        addRef(exactIdentifierToUaps, scalar.value, item.uap_ordinal);
      }
    }

    /**
     * Handles exact before after.
     *
     * @param {number} ordinal - The ordinal position to process.
     * @returns {Object} The Object value produced by `exactBeforeAfter`.
     */
    const exactBeforeAfter = ordinal => {
      let before = null;
      let after = null;
      for (let i = ordinal - 1; i >= 0; i -= 1) {
        const item = primary.classifications[i];
        if (item?.classification === 'exact') {
          before = item;
          break;
        }
      }
      for (let i = ordinal + 1; i < primary.classifications.length; i += 1) {
        const item = primary.classifications[i];
        if (item?.classification === 'exact') {
          after = item;
          break;
        }
      }
      return { before, after };
    };

    const unresolved = [];
    for (const item of primary.classifications) {
      if (!['fallback', 'ungrouped'].includes(item.classification)) continue;
      const record = records[item.record_ordinal];
      const refs = new Set();
      for (const scalar of apiRecordIdentifierScalars(record)) {
        const exactUap = exactMessageToUap.get(String(scalar.value));
        if (exactUap !== undefined) refs.add(exactUap);
      }
      for (const uap of exactIdentifierToUaps.get(keyFor(record.message_id)) ?? []) refs.add(uap);
      const { before, after } = exactBeforeAfter(item.record_ordinal);
      const sameUapBounded = before && after && before.uap_ordinal === after.uap_ordinal;
      unresolved.push({
        record_ordinal: item.record_ordinal,
        referenced_uap_ordinals: [...refs].sort((a, b) => a - b),
        same_uap_bounded: Boolean(sameUapBounded),
        bounded_uap_ordinal: sameUapBounded ? before.uap_ordinal : null
      });
    }
    return { unresolved };
  }

  /**
   * Handles API conversation UAP final grouping.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
