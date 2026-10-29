  /**
   * #359 physical GEN boundary port, separate from legacy diagnostic segments.
   * One active owner and a serialized filesystem queue; never marks memory-only
   * writes durable. The caller supplies the approved GEN directory handle.
   */
  function cscGenDurablePort(directory, version) {
    if (!directory || typeof directory.getFileHandle !== 'function' ||
        typeof version !== 'string' || !version) {
      throw Error('csc-gen-directory-or-version-invalid');
    }
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let tail = Promise.resolve();
    let activeName = null;
    let activeRestart = null;
    let poisoned = false;
    let recovered = false;
    const cycles = new Map();
    const knownRestarts = new Set();
    function check(condition, code) { if (!condition) throw Error(code); }
    function validRestart(value) {
      return typeof value === 'string' &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value;
    }
    function header(restart) {
      return Object.freeze({
        version: { gen: version, comm: version }, key_restart: restart
      });
    }
    function cycleValid(event) {
      const keys = ['type','id','key_restart','epoch','occurred_at_ms','reason'];
      return event && typeof event === 'object' && !Array.isArray(event) &&
        Object.keys(event).length === keys.length &&
        keys.every(key => Object.hasOwn(event,key)) &&
        event.type === 'hmac-key-cycle' &&
        validRestart(event.key_restart) &&
        event.id === 'hmac-key-cycle:' + event.key_restart &&
        Number.isSafeInteger(event.epoch) && event.epoch > 0 &&
        event.occurred_at_ms === Date.parse(event.key_restart) &&
        ['initial','scheduled','overdue','manual'].includes(event.reason);
    }
    function withQueue(fn) {
      const result = tail.then(() => {
        check(!poisoned, 'csc-gen-poisoned');
        return fn();
      });
      tail = result.catch(() => {});
      return result;
    }
    async function exactFile(name) {
      const handle = await directory.getFileHandle(name, { create: false });
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
    async function scan() {
      cycles.clear();
      knownRestarts.clear();
      const names = [];
      for await (const [name, handle] of directory.entries()) {
        if (handle?.kind === 'file' && /^gen-key-[0-9]{8}\.jsonl$/.test(name)) {
          names.push(name);
        }
      }
      names.sort();
      let latest = null;
      for (const name of names) {
        const bytes = await exactFile(name);
        const data = decoder.decode(bytes);
        check(data.endsWith('\n'), 'csc-gen-truncated-file');
        const lines = data.trimEnd().split('\n');
        check(lines.length >= 1, 'csc-gen-empty-file');
        let first;
        try { first = JSON.parse(lines[0]); }
        catch { throw Error('csc-gen-header-json-invalid'); }
        check(validRestart(first?.key_restart) &&
          first?.version?.gen === version &&
          first?.version?.comm === version &&
          Object.keys(first).length === 2,
        'csc-gen-recovered-header-invalid');
        for (const line of lines.slice(1)) {
          let record;
          try { record = JSON.parse(line); }
          catch { throw Error('csc-gen-journal-json-invalid'); }
          check(cycleValid(record) && record.key_restart === first.key_restart,
            'csc-gen-recovered-cycle-invalid');
          const prev = cycles.get(record.id);
          check(!prev || JSON.stringify(prev) === JSON.stringify(record),
            'csc-gen-conflicting-cycle');
          cycles.set(record.id, record);
        }
        check(!latest || first.key_restart >= latest.restart,
          'csc-gen-disk-key-restart-regression');
        check(!knownRestarts.has(first.key_restart) ||
          latest?.restart === first.key_restart,
          'csc-gen-noncontiguous-key-restart');
        knownRestarts.add(first.key_restart);
        latest = { name, restart: first.key_restart };
      }
      activeName = latest?.name ?? null;
      activeRestart = latest?.restart ?? null;
      recovered = true;
      return { files: names.length, key_restart: activeRestart };
    }
    async function beginSegment(boundary) {
      return withQueue(async () => {
        if (!recovered) await scan();
        check(boundary && typeof boundary === 'object' &&
          !Array.isArray(boundary) && boundary.version === version &&
          validRestart(boundary.key_restart),
        'csc-gen-boundary-invalid');
        const restart = boundary.key_restart;
        if (activeRestart === restart) {
          check(activeName, 'csc-gen-header-missing');
          const bytes = await exactFile(activeName);
          const expected = encoder.encode(JSON.stringify(header(restart)) + '\n');
          check(bytes.length >= expected.length &&
            expected.every((byte,i) => bytes[i] === byte),
          'csc-gen-header-readback-mismatch');
          return Object.freeze({ durable: true, key_restart: restart });
        }
        check((activeRestart === null || restart > activeRestart) &&
          !knownRestarts.has(restart), 'csc-gen-stale-key-restart');
        // Never attach a new key to a nonempty old-key GEN file.
        const existingNames = [];
        for await (const [name,handle] of directory.entries()) {
          if (handle?.kind === 'file' && /^gen-key-[0-9]{8}\.jsonl$/.test(name)) {
            existingNames.push(name);
          }
        }
        check(existingNames.length < 99999999, 'csc-gen-segment-limit');
        existingNames.sort();
        const last = existingNames.length ?
          Number(existingNames.at(-1).slice(8,16)) : 0;
        const name = 'gen-key-' + String(last + 1).padStart(8,'0') + '.jsonl';
        const handle = await directory.getFileHandle(name, { create: true });
        const before = await handle.getFile();
        check(before.size === 0, 'csc-gen-new-segment-nonempty');
        const bytes = encoder.encode(JSON.stringify(header(restart)) + '\n');
        const writable = await handle.createWritable();
        try { await writable.write(bytes); await writable.close(); }
        catch (error) { await writable.abort?.().catch(() => {}); throw error; }
        const observed = await exactFile(name);
        check(observed.length === bytes.length &&
          bytes.every((byte,i) => observed[i] === byte),
        'csc-gen-header-readback-mismatch');
        activeName = name;
        activeRestart = restart;
        knownRestarts.add(restart);
        return Object.freeze({ durable: true, key_restart: restart });
      }).catch(error => { poisoned = true; throw error; });
    }
    async function writeCycle(event) {
      return withQueue(async () => {
        if (!recovered) await scan();
        check(cycleValid(event), 'csc-gen-invalid-cycle');
        check(activeName && activeRestart === event.key_restart,
          'csc-gen-key-boundary-not-committed');
        if (cycles.has(event.id)) {
          check(JSON.stringify(cycles.get(event.id)) === JSON.stringify(event),
            'csc-gen-cycle-conflict');
          return Object.freeze({ durable: true, id: event.id });
        }
        const before = await exactFile(activeName);
        const expected = encoder.encode(JSON.stringify(event) + '\n');
        const handle = await directory.getFileHandle(activeName, { create: false });
        const writable = await handle.createWritable({ keepExistingData: true });
        try {
          await writable.seek(before.length);
          await writable.write(expected);
          await writable.close();
        } catch (error) { await writable.abort?.().catch(() => {}); throw error; }
        const after = await exactFile(activeName);
        check(after.length === before.length + expected.length &&
          before.every((byte,i) => byte === after[i]) &&
          expected.every((byte,i) => byte === after[before.length+i]),
        'csc-gen-cycle-readback-mismatch');
        cycles.set(event.id, event);
        return Object.freeze({ durable: true, id: event.id });
      }).catch(error => { poisoned = true; throw error; });
    }
    async function hasCycle(id) {
      if (!recovered) await withQueue(scan);
      await tail;
      check(!poisoned, 'csc-gen-poisoned');
      return typeof id === 'string' && cycles.has(id);
    }
    return Object.freeze({ beginSegment, writeCycle, hasCycle, recover: () =>
      withQueue(scan).catch(error => { poisoned = true; throw error; }) });
  }
