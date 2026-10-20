import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

const colours = ['white', 'yellow', 'green', 'red'];
const updateEveryMs = 250;
const pulsePeriodMs = 10000;
const pulseFrames = 21;

function triplet(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(version);
  assert.ok(parts, `invalid version: ${version}`);
  return parts.slice(1, 4).map(Number);
}

function compareVersions(a, b) {
  const left = triplet(a);
  const right = triplet(b);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return Math.sign(left[index] - right[index]);
  }
  return 0;
}

function selectDataset(collections, version) {
  const supported = collections.filter(item => compareVersions(item.version, version) <= 0);
  return supported.sort((a, b) => compareVersions(a.version, b.version)).at(-1) ?? null;
}

function pulseIndex(timeOffset) {
  assert.ok(Number.isFinite(timeOffset));
  const phase = ((timeOffset % pulsePeriodMs) + pulsePeriodMs) % pulsePeriodMs;
  const step = Math.floor(phase / updateEveryMs);
  return Math.min(step, pulsePeriodMs / updateEveryMs - step);
}

function checkContract() {
  assert.equal(compareVersions('1.11.7-issue.309.11', '1.11.7-issue.99.1'), 0);
  assert.equal(compareVersions('1.12.0', '1.11.99'), 1);
  assert.equal(compareVersions('1.11.9-issue.1.999', '1.11.9'), 0);
  assert.equal(selectDataset([{version:'1.12.0'}, {version:'1.11.7'}],
    '1.11.8-issue.500.1').version, '1.11.7');
  assert.equal(selectDataset([{version:'1.12.0'}, {version:'1.11.7'}],
    '1.12.0-issue.1.1').version, '1.12.0');
  assert.equal(selectDataset([{version:'1.12.0'}], '1.11.9'), null);
  const indices = Array.from({length: 40}, (_, i) => pulseIndex(i * updateEveryMs));
  assert.deepEqual(indices.slice(0, 21), Array.from({length:21}, (_, i) => i));
  assert.deepEqual(indices.slice(21), Array.from({length:19}, (_, i) => 19 - i));
  assert.equal(new Set(indices).size, 21);
  assert.equal(pulseIndex(-250), pulseIndex(9750));
  assert.equal(pulseIndex(10000), 0);
  assert.equal(colours.length * 7 * pulseFrames, 588);
  for (const v of ['1.11', '1.11.7.9', '1.11.bad']) {
    assert.throws(() => triplet(v));
  }
  console.log('CONTRACT PASS: version ranges, suffix ignorance, 21 pulse frames, 588 combinations');
}

function chromeBinary() {
  for (const binary of [
    process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome'
  ]) {
    if (binary && existsSync(binary)) return binary;
  }
  throw new Error('Chromium/Google Chrome binary is unavailable on this runner');
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ChromeClient {
  constructor(socket) {
    this.ws = new WebSocket(socket);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, {once:true});
      this.ws.addEventListener('error', reject, {once:true});
    });
    this.ws.addEventListener('message', message => {
      const result = JSON.parse(message.data);
      const entry = this.pending.get(result.id);
      if (!entry) return;
      this.pending.delete(result.id);
      if (result.error) entry.reject(new Error(JSON.stringify(result.error)));
      else entry.resolve(result.result);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.ws.send(JSON.stringify({id, method, params}));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate',
      {expression, awaitPromise:true, returnByValue:true});
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }
  close() {
    this.ws.close();
  }
}

async function runBrowserCase() {
  const server = createServer((_request, response) => {
    response.writeHead(200, {'content-type':'text/html'});
    response.end('<html><head><link rel="icon" href="data:," /></head><body>Favicon cache benchmark</body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const userDir = mkdtempSync(path.join(os.tmpdir(), 'dc-favicon-chrome-'));
  const chrome = spawn(chromeBinary(), [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank'
  ], {stdio:'ignore'});
  const pages = [];
  try {
    let debugPort = 0;
    for (let attempt = 0; attempt < 160; attempt++) {
      const target = path.join(userDir, 'DevToolsActivePort');
      if (existsSync(target)) {
        debugPort = Number(readFileSync(target, 'utf8').split('\n')[0]);
        break;
      }
      if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}`);
      await delay(100);
    }
    assert.ok(debugPort > 0, 'Chrome DevTools port did not appear');
    async function openPage() {
      const address = `http://127.0.0.1:${port}/`;
      const newTab = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(address)}`,
        {method:'PUT'}).then(response => response.json());
      const client = new ChromeClient(newTab.webSocketDebuggerUrl);
      await client.send('Runtime.enable');
      for (let i = 0; i < 100; i++) {
        const ready = await client.evaluate('document.readyState');
        if (ready === 'complete') break;
        await delay(50);
      }
      pages.push(client);
      return client;
    }
    const first = await openPage();
    await first.send('Performance.enable');
    const result = await first.evaluate(`(${browserCase.toString()})()`);
    assert.equal(result.storedFrames, 21);
    assert.equal(result.coldLoadedFrames, 21);
    assert.equal(result.warmDbReads, 0);
    assert.ok(result.legacyMs > result.warmMs,
      `Cached warm switching not faster: legacy=${result.legacyMs}, warm=${result.warmMs}`);
    const getCpu = async () => Object.fromEntries(
      (await first.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value])
    );
    const m0 = await getCpu();
    const pacedLegacy = await first.evaluate(`(${pacedFaviconTest.toString()})('legacy')`);
    const m1 = await getCpu();
    const pacedWarm = await first.evaluate(`(${pacedFaviconTest.toString()})('cached')`);
    const m2 = await getCpu();
    const paced = {
      legacy: pacedLegacy,
      cached: pacedWarm,
      legacyTaskCpuMs: (m1.TaskDuration - m0.TaskDuration) * 1000,
      cachedTaskCpuMs: (m2.TaskDuration - m1.TaskDuration) * 1000,
      legacyScriptCpuMs: (m1.ScriptDuration - m0.ScriptDuration) * 1000,
      cachedScriptCpuMs: (m2.ScriptDuration - m1.ScriptDuration) * 1000
    };
    assert.ok(pacedLegacy.jsWorkMs > pacedWarm.jsWorkMs);
    const second = await openPage();
    const sharedCount = await second.evaluate(`(${countSharedImages.toString()})()`);
    assert.equal(sharedCount, 21, 'Tabs must share the same origin IndexedDB entries');
    console.log(JSON.stringify({test:'Chromium IndexedDB binary PNG/favicon switching',
      resolution:'256x256', frames:40, ...result, paced250ms:paced,
      secondTabStoredFrames:sharedCount}, null, 2));
  } finally {
    for (const page of pages) page.close();
    chrome.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    rmSync(userDir, {recursive:true, force:true});
  }
}

async function browserCase() {
  const source = document.createElement('canvas');
  source.width = source.height = 256;
  const srcCtx = source.getContext('2d');
  srcCtx.fillStyle = 'white';
  srcCtx.fillRect(0, 0, 256, 256);
  const icon = document.querySelector('link[rel~="icon"]');
  const draw = slot => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d', {willReadFrequently:true});
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, 256, 256);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const r = pixels.data[offset];
      const g = pixels.data[offset + 1];
      const b = pixels.data[offset + 2];
      if (Math.min(r, g, b) < 240 || Math.max(r, g, b) - Math.min(r,g,b) > 16) continue;
      pixels.data[offset] = Math.round(255 * ((r + g + b) / 765));
      pixels.data[offset + 1] = Math.round(180 * ((r + g + b) / 765));
      pixels.data[offset + 2] = 0;
    }
    context.putImageData(pixels, 0, 0);
    context.fillStyle = '#55cc00';
    context.beginPath();
    context.moveTo(128,128);
    context.arc(128,128,122,-Math.PI/2,0);
    context.closePath();
    context.fill();
    const rgba = context.getImageData(0, 0, 256, 256);
    const opacity = 0.75 + 0.25 * Math.cos(2*Math.PI*slot/40);
    for (let offset = 3; offset < rgba.data.length; offset += 4) {
      rgba.data[offset] = Math.round(rgba.data[offset] * opacity);
    }
    context.putImageData(rgba, 0, 0);
    return canvas;
  };

  const t0 = performance.now();
  for (let slot=0; slot<40; slot++) icon.href = draw(slot).toDataURL('image/png');
  const legacyMs = performance.now() - t0;

  const frames = [];
  for (let index=0; index<21; index++) {
    const canvas = draw(index);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    frames.push(blob);
  }
  const db = await new Promise((resolve,reject) => {
    const open = indexedDB.open('dc-favicon-benchmark',1);
    open.onupgradeneeded = () => open.result.createObjectStore('images');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  await new Promise((resolve,reject) => {
    const tx = db.transaction('images','readwrite');
    const store = tx.objectStore('images');
    for (let index=0; index<21; index++) store.put(frames[index], String(index));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  let reads = 0;
  const urls = new Map();
  const t1 = performance.now();
  for (let slot=0; slot<40; slot++) {
    const index = Math.min(slot,40-slot);
    if (!urls.has(index)) {
      const image = await new Promise((resolve,reject) => {
        const request = db.transaction('images','readonly').objectStore('images').get(String(index));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      reads++;
      urls.set(index,URL.createObjectURL(image));
    }
    icon.href = urls.get(index);
  }
  const coldMs = performance.now() - t1;
  const t2 = performance.now();
  let warmDbReads = 0;
  for (let slot=0; slot<40; slot++) {
    icon.href = urls.get(Math.min(slot,40-slot));
  }
  const warmMs = performance.now() - t2;
  const storedFrames = await new Promise((resolve,reject) => {
    const request = db.transaction('images','readonly').objectStore('images').count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const storedPngBytes = frames.reduce((sum, frame) => sum + frame.size, 0);
  db.close();
  globalThis.__faviconBenchmark = {draw, urls, icon};
  return {legacyMs, coldMs, warmMs, coldLoadedFrames:reads,
    warmDbReads, storedPngBytes, storedFrames};
}

async function pacedFaviconTest(mode) {
  const state = globalThis.__faviconBenchmark;
  if (!state) throw new Error('Favicon benchmark setup missing');
  const start = performance.now();
  let jsWorkMs = 0;
  for (let slot = 0; slot < 40; slot++) {
    const t0 = performance.now();
    if (mode === 'legacy') {
      state.icon.href = state.draw(slot).toDataURL('image/png');
    } else {
      state.icon.href = state.urls.get(Math.min(slot, 40 - slot));
    }
    jsWorkMs += performance.now() - t0;
    if (slot < 39) await new Promise(resolve => setTimeout(resolve, 250));
  }
  return {mode, frames:40, intervalMs:250, jsWorkMs, wallMs:performance.now() - start};
}

async function countSharedImages() {
  const db = await new Promise((resolve,reject) => {
    const req = indexedDB.open('dc-favicon-benchmark',1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const total = await new Promise((resolve,reject) => {
    const req = db.transaction('images','readonly').objectStore('images').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return total;
}

checkContract();
await runBrowserCase();
