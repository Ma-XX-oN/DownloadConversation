  function communicationLogResolveCommVersionAtBoundary(fragments, boundary) {
    const bound = typeof boundary === 'number' ? boundary : Date.parse(boundary);
    if (!Number.isFinite(bound)) throw new Error('Invalid COMM export start boundary.');
    let version = null;
    const decoder = new TextDecoder();
    for (const bytes of fragments) {
      let first = true;
      let start = 0;
      for (let i = 0; i < bytes.length; i += 1) {
        if (bytes[i] !== 10) continue;
        const line = decoder.decode(bytes.subarray(start, i));
        start = i + 1;
        if (!line) { first = false; continue; }
        let record;
        try { record = JSON.parse(line); }
        catch { first = false; continue; }
        const header = first && record && typeof record === 'object'
          && !Array.isArray(record) && Object.keys(record).length === 1
          && Object.hasOwn(record, 'version');
        first = false;
        if (header) {
          const value = record.version?.comm;
          version = typeof value === 'string' && value ? value : null;
          continue;
        }
        const time = typeof record?.timestamp === 'string'
          ? Date.parse(record.timestamp) : NaN;
        if (!Number.isFinite(time) || time > bound) continue;
        if (record.version && Object.hasOwn(record.version, 'comm')) {
          const value = record.version.comm;
          if (value === null) version = null;
          else if (typeof value === 'string' && value) version = value;
        }
      }
    }
    return version;
  }
