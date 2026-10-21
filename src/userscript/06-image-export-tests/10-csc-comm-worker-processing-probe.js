
  /**
   * Checks deterministic synthetic bytes inside an isolated Worker sink.
   * Never sees ChatGPT's real network data or writes a file.
   * @returns {void} Installs in-Worker synthetic verification callbacks.
   */
  function cscCommProcessingProbeWorkerSink() {
    let verified = 0;
    let started = 0;
    let finished = 0;
    let damaged = false;
    let cycles = 0;
    self.cscCommWriteChunk = async bytes => {
      const jsonl = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      for (const line of jsonl.split('\n').filter(Boolean)) {
        const frame = JSON.parse(line);
        if (frame.kind === 'csc-comm-start') {
          if (frame.binary_encoding !== 'base64') damaged = true;
          started += 1;
        } else if (frame.kind === 'csc-comm-body') {
          if (frame.encoding !== 'base64') damaged = true;
          const binary = atob(frame.data);
          for (let i = 0; i < binary.length; i += 1) {
            if (binary.charCodeAt(i) !==
                ((Math.imul(verified + i, 29) + 7) & 255)) damaged = true;
          }
          verified += binary.length;
        } else if (frame.kind === 'hmac-key-cycle') {
          cycles += 1;
          if (frame.type !== 'hmac-key-cycle' ||
              frame.id !== 'hmac-key-cycle:1:00112233445566778899aabbccddeeff' ||
              frame.epoch !== 1 || frame.reason !== 'initial' ||
              frame.occurred_at_ms !== 10000) damaged = true;
        } else if (frame.kind === 'csc-comm-end') {
          if (frame.status !== 'completed' ||
              frame.source_bytes !== verified) damaged = true;
          finished += 1;
        }
      }
    };
    self.addEventListener('message', event => {
      if (event.data?.type === 'csc-comm-probe-report') {
        self.postMessage({
          type: 'csc-comm-probe-report', bytes: verified,
          starts: started, ends: finished, cycles, damaged
        });
      }
    });
  }

  /**
   * Generates source for the isolated synthetic COMM Worker capability probe.
   * @returns {string} Synthetic sink plus production Worker processor source.
   */
  function cscCommProcessingProbeSource() {
    return '(' + cscCommProcessingProbeWorkerSink.toString() + ')();\n' +
      cscCommProcessingWorkerSource();
  }

  /**
   * Runs native page Worker capture with only deterministic synthetic bytes.
   * Keeps the stock synthetic Response intact; transfers only its COMM clone.
   * @returns {Promise<string>} Exact browser capability test result.
   */
  async function testCscCommWorkerProcessing() {
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const failures = [];
    const successes = [];
    for (const [name, realm] of [['page', page], ['userscript', window]]) {
      if (name === 'userscript' && realm === page) continue;
      if (typeof realm.Worker !== 'function') {
        failures.push(name + ': Worker unavailable');
        continue;
      }
      let worker = null;
      let url = null;
      try {
        url = realm.URL.createObjectURL(new realm.Blob(
          [cscCommProcessingProbeSource()], { type: 'text/javascript' }
        ));
        worker = new realm.Worker(url);
        const messages = [];
        let crash = null;
        worker.addEventListener('message', event => messages.push(event.data));
        worker.addEventListener('error', event => {
          crash = event.message || 'Worker error';
        });
        /**
         * Waits for one synthetic Worker message or explicitly fails.
         * @param {Function} condition - Expected nonsecret response predicate.
         * @returns {Promise<Object>} Matching synthetic Worker message.
         */
        async function waitFor(condition) {
          for (let tries = 0; tries < 400; tries += 1) {
            if (crash) throw new Error('CSC Worker probe: ' + crash);
            const found = messages.find(condition);
            if (found) return found;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('CSC Worker probe timeout');
        }
        worker.postMessage({
          type: 'csc-comm-configure',
          options: {
            mode: 'replay-essentials', origin: 'https://chatgpt.com',
            binary: true, cross_origin: false, auth_headers: false,
            all: false
          }
        });
        await waitFor(message => message.type === 'csc-comm-configured');
        const token = 'synthetic-csc-comm-token-311';
        const keyBytes = Uint8Array.from({ length: 32 }, (_, i) => i);
        worker.postMessage({
          type: 'dc-hmac-key-v2', token, key_bytes: keyBytes
        }, [keyBytes.buffer]);
        await waitFor(message => message.type === 'csc-comm-key-ready' &&
          message.token === token);
        const count = 512 * 1024 + 11;
        const bytes = Uint8Array.from({ length: count },
          (_, i) => (Math.imul(i, 29) + 7) & 255);
        const original = new Response(bytes, {
          headers: { 'content-type': 'application/octet-stream' }
        });
        const comm = cloneSafely(original);
        assert(comm && comm.body, 'Synthetic COMM clone missing');
        const body = comm.body;
        worker.postMessage({
          type: 'csc-comm-capture',
          envelope: {
            capture_id: 'synthetic-csc311-test', network_sequence: 1,
            capture_order: 1, captured_at_epoch_ms: 10000,
            captured_at_mono_ms: 42, page_instance_id: 'synthetic-page',
            clock_domain: 'synthetic-page',
            connection_id: 'synthetic-request',
            transport: 'fetch', direction: 'response',
            url: 'https://chatgpt.com/backend-api/synthetic-test',
            headers: [['content-type', 'application/octet-stream']],
            body_type: 'application/octet-stream', body_available: true,
            body_state: 'stream-transferred', body, complete: true,
            hmac_token: token, redaction_format: 'dc-secret-marker/2',
            redaction_scope: '00112233445566778899aabbccddeeff',
            redaction_key_generation: '00112233445566778899aabbccddeeff',
            redaction_key_epoch: 1,
            redaction_key_storage: 'tampermonkey-script-installation'
          }
        }, [body]);
        assert(body.locked,
          'Transferred COMM stream was not locked immediately after transfer');
        const outcome = await waitFor(message =>
          message.type === 'csc-comm-status' &&
          message.capture_id === 'synthetic-csc311-test');
        assert(outcome.status === 'completed' && outcome.source_bytes === count &&
          outcome.durable === false, 'Worker COMM completion mismatch');
        const cycleId = 'hmac-key-cycle:1:00112233445566778899aabbccddeeff';
        worker.postMessage({ type: 'csc-comm-key-cycle', event: {
          type: 'hmac-key-cycle', id: cycleId,
          generation: '00112233445566778899aabbccddeeff',
          epoch: 1, occurred_at_ms: 10000, reason: 'initial'
        } });
        const cycleAck = await waitFor(message =>
          message.type === 'csc-comm-cycle-status' && message.id === cycleId);
        assert(cycleAck.status === 'completed' && cycleAck.durable === false,
          'Committed cycle event did not reach the Worker sink');
        worker.postMessage({ type: 'csc-comm-probe-report' });
        const report = await waitFor(message =>
          message.type === 'csc-comm-probe-report');
        assert(!report.damaged && report.bytes === count &&
          report.starts === 1 && report.ends === 1 && report.cycles === 1,
          'Sanitizing serializer changed synthetic binary data');
        const untouched = new Uint8Array(await original.arrayBuffer());
        assert(untouched.length === count,
          'Original stock Response length changed');
        for (let i = 0; i < count; i += 1) {
          assert(untouched[i] === ((Math.imul(i, 29) + 7) & 255),
            'Original stock body changed at byte ' + i);
        }
        successes.push(name + ' Worker; binary ' + count + ' bytes exact; ' +
          'start/body/end verified; V2 key token; cycle event; stock intact');
      } catch (error) {
        failures.push(name + ': ' + errorMessage(error));
      } finally {
        worker?.terminate();
        if (url) realm.URL.revokeObjectURL(url);
      }
    }
    if (failures.length) {
      throw new Error('CSC COMM Worker test failed: ' + failures.join(' | '));
    }
    return successes.join(' | ');
  }
