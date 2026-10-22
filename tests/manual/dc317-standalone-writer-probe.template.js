// ==UserScript==
// @name         DownloadConversation DC317 Standalone Disk Probe
// @namespace    https://github.com/Ma-XX-oN/DownloadConversation/tests/dc317
// @version      __DC317_TEST_VERSION__
// @description  Isolated synthetic Worker filesystem + actual Zstd test; does not run the recorder.
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  // Deterministically compiled from the same source files as DC #317.
  const expectedVersion = __DC317_VERSION_JSON__;
  const workerSource = __DC317_WORKER_SOURCE_JSON__;
  const compressedWasmBase64 = __DC317_WASM_GZIP_BASE64_JSON__;
  const panelId = 'dc317-standalone-disk-probe';
  if (document.getElementById(panelId)) return;

  const panel = document.createElement('section');
  panel.id = panelId;
  panel.setAttribute('aria-label', 'DC317 isolated disk probe');
  panel.style.cssText = [
    'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
    'max-width:330px', 'padding:12px', 'border-radius:7px',
    'background:#1e293b', 'color:white', 'font:13px/1.4 system-ui,sans-serif',
    'border:1px solid #64748b', 'box-shadow:0 3px 12px #0005'
  ].join(';');
  const title = document.createElement('div');
  title.textContent = 'DC #317 isolated Worker disk test';
  title.style.cssText = 'font-weight:700;margin-bottom:5px';
  const detail = document.createElement('div');
  detail.textContent = 'Production recorder is not modified. Source ' +
    expectedVersion + '. Synthetic 11 MiB only.';
  detail.style.cssText = 'margin-bottom:8px;overflow-wrap:anywhere';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Run disk test';
  button.style.cssText = [
    'padding:6px 11px','background:#e2e8f0','color:#0f172a',
    'border:1px solid #94a3b8','border-radius:4px','cursor:pointer'
  ].join(';');
  const result = document.createElement('div');
  result.setAttribute('aria-live', 'polite');
  result.style.cssText = 'margin-top:8px;overflow-wrap:anywhere';
  panel.append(title, detail, button, result);
  (document.body || document.documentElement).append(panel);

  async function run() {
    // This MUST be the very first privileged action in the click handler.
    // Calling the native picker after an await loses the user gesture.
    const selection = window.showDirectoryPicker({ mode: 'readwrite' });
    const directory = await selection;
    const namespace = 'probe-' + crypto.randomUUID().replace(/-/g, '');
    const childName = 'dc-comm-' + namespace;
    try {
      await directory.getDirectoryHandle(childName, { create: false });
      throw new Error('Unexpected private test-directory collision');
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }

    const blob = new Blob([workerSource], { type: 'text/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    let worker = null;
    let timeout = null;
    try {
      worker = new Worker(workerUrl);
      const response = await new Promise((resolve, reject) => {
        let started = false;
        worker.addEventListener('error', event => reject(new Error(
          event.message || 'Worker failed to start')));
        worker.addEventListener('message', event => {
          const item = event.data;
          if (item?.type === 'csc-writer-error') {
            reject(new Error('Worker writer error: ' + item.reason));
          } else if (item?.type === 'csc-writer-ready' && !started) {
            started = true;
            worker.postMessage({ type: 'csc-writer-probe-run',
              handle: directory, namespace,
              version: expectedVersion,
              key_restart: '2026-10-22T00:00:00.000Z' });
          } else if (item?.type === 'csc-writer-probe-result') {
            if (item.ok) resolve(item);
            else reject(new Error(item.reason || 'Unspecified probe failure'));
          }
        });
        timeout = setTimeout(() =>
          reject(new Error('Native Worker disk probe exceeded 90 seconds')),
        90000);
        worker.postMessage({ type: 'csc-writer-open',
          handle: directory, namespace, version: expectedVersion,
          key_restart: '2026-10-22T00:00:00.000Z',
          wasm_gzip_base64: compressedWasmBase64 });
      });
      if (response.fragments < 2 ||
          response.bodyBytes !== 11 * 1024 * 1024) {
        throw new Error('Incomplete native synthetic disk witness');
      }
      return 'PASS — native Worker + actual Zstd; ' +
        response.fragments + ' fragments, ' +
        response.bodyBytes + ' exact synthetic bytes, SHA-256 manifest';
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      worker?.terminate();
      URL.revokeObjectURL(workerUrl);
      // Only the unique generated namespace may be removed.
      try { await directory.removeEntry(childName, { recursive: true }); }
      catch (error) {
        if (error?.name !== 'NotFoundError') {
          throw new Error('Test cleanup failed; remove ' + childName +
            ' manually. Underlying error: ' + error.message);
        }
      }
    }
  }

  button.addEventListener('click', () => {
    if (typeof window.showDirectoryPicker !== 'function') {
      result.textContent = 'FAIL — native directory picker unavailable';
      return;
    }
    button.disabled = true;
    result.textContent = 'Select a temporary folder to begin.';
    // run() invokes showDirectoryPicker synchronously from this click.
    void run().then(message => {
      result.textContent = message;
    }).catch(error => {
      result.textContent = 'FAIL — ' + String(error?.message || error);
    }).finally(() => {
      button.disabled = false;
    });
  });
})();
