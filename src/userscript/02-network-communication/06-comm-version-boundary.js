  /**
   * Resolve the last known COMM version at or before an inclusive export start.
   * Fragments are committed newline-delimited JSONL bytes in recording order.
   * An immutable fragment header takes effect at its first timestamped event,
   * not earlier; legacy fragments without headers inherit prior knowledge.
   *
   * @param {Uint8Array[]} fragments - Physical fragments in recording order.
   * @param {string|number} boundary - Selected export start time.
   * @returns {string|null} Effective version or null if unknown.
   */
  function communicationLogResolveCommVersionAtBoundary(fragments, boundary) {
    const bound = typeof boundary === 'number' ? boundary : Date.parse(boundary);
    if (!Number.isFinite(bound)) throw new Error('Invalid COMM export start boundary.');
    let version = null;
    const decoder = new TextDecoder();
    for (const bytes of fragments) {
      let firstLine = true;
      let lineStart = 0;
      let pendingHeader;
      let headerSeen = false;
      let fragmentBegan = false;
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== 10) continue;
        const line = decoder.decode(bytes.subarray(lineStart, index));
        lineStart = index + 1;
        if (!line) { firstLine = false; continue; }
        let record;
        try { record = JSON.parse(line); }
        catch { firstLine = false; continue; }
        const header = firstLine && record && typeof record === 'object'
          && !Array.isArray(record) && Object.keys(record).length === 1
          && Object.hasOwn(record, 'version');
        firstLine = false;
        if (header) {
          pendingHeader = record.version?.comm;
          headerSeen = true;
          continue;
        }
        const time = typeof record?.timestamp === 'string'
          ? Date.parse(record.timestamp) : NaN;
        if (!Number.isFinite(time)) continue;
        if (time > bound) continue;
        if (!fragmentBegan) {
          fragmentBegan = true;
          if (headerSeen) {
            version = typeof pendingHeader === 'string' && pendingHeader
              ? pendingHeader : null;
          }
        }
        if (record.type === 'communication_session_start'
            && Object.hasOwn(record, 'script_version')) {
          const next = record.script_version;
          if (next === null || next === 'unknown') version = null;
          else if (typeof next === 'string' && next) version = next;
        }
        if (record.version && Object.hasOwn(record.version, 'comm')) {
          const next = record.version.comm;
          if (next === null) version = null;
          else if (typeof next === 'string' && next) version = next;
        }
      }
    }
    return version;
  }
