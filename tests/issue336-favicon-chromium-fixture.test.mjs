import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const header = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([header, type, data, checksum]);
}

// Pixel bytes are deliberately produced outside the Chromium runtime.
function syntheticPng(variant, colour, step, pulse) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixel = Buffer.from([0, 10 + variant, 40 + colour * 10 + step,
    80 + pulse, 255]);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixel)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function packFixture() {
  const variants = [];
  const data = [];
  let offset = 0;
  for (let v = 0; v < 2; v++) {
    const images = [];
    for (let c = 0; c < 4; c++) {
      const steps = [];
      for (let p = 0; p < 7; p++) {
        const frames = [];
        for (let i = 0; i < 21; i++) {
          const png = syntheticPng(v, c, p, i);
          frames.push({ offset, bytes: png.length });
          data.push(png);
          offset += png.length;
        }
        steps.push(frames);
      }
      images.push(steps);
    }
    variants.push({ id: String(v), source_sha256: String(v + 1).repeat(64),
      width: 1, height: 1, images });
  }
  const manifest = { schema: 'dc-favicon-pack-v1', variants };
  const sort = value => Array.isArray(value) ? value.map(sort)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]))
      : value;
  const header = Buffer.from(JSON.stringify(sort(manifest)));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return Buffer.concat([Buffer.from('DCFC0001'), length, header, ...data]);
}

function chromium() {
  for (const name of ['chromium', 'google-chrome', 'chromium-browser']) {
    const result = spawnSync('which', [name], { encoding: 'utf8' });
    if (result.status === 0) return result.stdout.trim();
  }
  throw new Error('Chromium unavailable; browser fixture INCOMPLETE');
}

// This synthetic adapter deliberately is NOT the production #335 get_favicon.
const browserScript = String.raw`
  async function run() {
    const links = Array.from(document.querySelectorAll('link[rel~="icon"]'));
    const originals = links.map(link => link.href);
    const bytes = Uint8Array.from(atob(globalThis.__syntheticPackBase64),
      value => value.charCodeAt(0));
    const buffer = bytes.buffer;
    const view = new DataView(buffer);
    const headerLength = view.getUint32(8, true);
    const manifest = JSON.parse(new TextDecoder().decode(
      bytes.subarray(12, 12 + headerLength)));
    const payloadStart = 12 + headerLength;
    const urls = new Map();
    let coldReads = 0;
    let hrefWrites = 0;
    let decodeCount = 0;
    let verifiedPixels = 0;
    const sampleCanvas = new OffscreenCanvas(1, 1);
    const sample = sampleCanvas.getContext('2d', {willReadFrequently:true});
    const slots = new Set();
    async function syntheticGetFavicon(base, step, offset) {
      const phase = ((offset % 10000) + 10000) % 10000;
      const slot = Math.floor(phase / 250);
      const index = Math.min(slot, 40 - slot);
      slots.add(index);
      for (let variant = 0; variant < 2; variant++) {
        const image = manifest.variants[variant].images[base][step][index];
        const key = [variant, base, step, index].join(':');
        if (!urls.has(key)) {
          const blob = new Blob([bytes.slice(payloadStart + image.offset,
            payloadStart + image.offset + image.bytes)], {type:'image/png'});
          const decoded = await createImageBitmap(blob);
          if (decoded.width !== 1 || decoded.height !== 1) {
            throw new Error('browser PNG decode dimension mismatch');
          }
          sample.clearRect(0, 0, 1, 1);
          sample.drawImage(decoded, 0, 0);
          const actual = Array.from(sample.getImageData(0, 0, 1, 1).data);
          const expected = [10 + variant, 40 + base * 10 + step,
            80 + index, 255];
          if (actual.some((value, j) => value !== expected[j])) {
            throw new Error('pixel mismatch ' + key + ': ' + actual);
          }
          verifiedPixels++;
          decoded.close();
          decodeCount++;
          urls.set(key, URL.createObjectURL(blob));
          coldReads++;
        }
        if (links[variant].href !== urls.get(key)) {
          links[variant].href = urls.get(key);
          hrefWrites++;
        }
      }
    }
    for (let base = 0; base < 4; base++) {
      for (let step = 0; step < 7; step++) {
        for (let slot = 0; slot < 40; slot++) {
          await syntheticGetFavicon(base, step, slot * 250);
        }
      }
    }
    const writesBeforeRepeat = hrefWrites;
    await syntheticGetFavicon(3, 6, 9750);
    const redundantHrefWrites = hrefWrites - writesBeforeRepeat;
    if (redundantHrefWrites !== 0) {
      throw new Error('identical href was assigned twice');
    }
    const warmReadsBefore = coldReads;
    for (let slot = 0; slot < 40; slot++) {
      await syntheticGetFavicon(0, 0, slot * 250);
    }
    if (links[2].href !== originals[2]) {
      throw new Error('unknown source candidate overwritten');
    }
    if (links.length !== 3 || links[0].media !== 'screen'
      || links[1].sizes.value !== '48x48'
      || links[0].type !== 'image/png' || links[1].type !== 'image/png') {
      throw new Error('favicon link attributes changed');
    }
    for (let variant = 0; variant < 2; variant++) {
      links[variant].href = originals[variant];
    }
    for (const url of urls.values()) URL.revokeObjectURL(url);
    return {fixtureOnly:true, sourceVariants:2, addressesPerVariant:588,
      uniquePhaseFrames:slots.size, objectUrls:urls.size, decoded:decodeCount,
      coldFrames:coldReads, warmExtraFrames:coldReads - warmReadsBefore,
      hrefWrites, verifiedPixels, redundantHrefWrites, unknownRestored:links[2].href === originals[2],
      originalRestored:links[0].href === originals[0]
        && links[1].href === originals[1]};
  }
`;

/**
 * Connects to a local headless Chromium page without navigating to a URL.
 * @param {number} port Browser debugging port.
 * @returns {Promise<{evaluate: Function, close: Function}>} Evaluation client.
 */
async function connectPage(port) {
  const tabs = await fetch('http://127.0.0.1:' + port + '/json/list')
    .then(response => response.json());
  const page = tabs.find(item => item.type === 'page');
  assert.ok(page, 'no Chromium page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let serial = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const {resolve, reject} = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  };
  function send(method, params) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject});
      socket.send(JSON.stringify({id, method, params}));
    });
  }
  return {
    async evaluate(expression) {
      const result = await send('Runtime.evaluate',
        {expression, awaitPromise: true, returnByValue: true});
      if (result.exceptionDetails) {
        throw new Error(JSON.stringify(result.exceptionDetails));
      }
      return result.result.value;
    },
    close() { socket.close(); }
  };
}

/**
 * Runs the actual Chromium PNG decoder against two synthetic source variants.
 * @returns {Promise<void>} Browser fixture outcome.
 */
test('Chromium decodes the 2x588 synthetic pack frames and preserves candidates',
  { timeout: 50000 }, async () => {
    const pack = packFixture();
    const directory = mkdtempSync(path.join(os.tmpdir(), 'dc336-browser-'));
    const args = ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--no-first-run', '--disable-background-networking',
      '--remote-debugging-port=0', '--user-data-dir=' + directory,
      'about:blank'];
    const chrome = spawn(chromium(), args, { stdio: 'ignore' });
    let client = null;
    try {
      const endpoint = path.join(directory, 'DevToolsActivePort');
      let port = null;
      for (let retry = 0; retry < 100; retry++) {
        if (existsSync(endpoint)) {
          port = Number(readFileSync(endpoint, 'utf8').split('\n')[0]);
          break;
        }
        if (chrome.exitCode !== null) {
          throw new Error('Chromium process exited before debug endpoint');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(port > 0, 'Chromium debug endpoint unavailable');
      client = await connectPage(port);
      const html = '<link rel="icon" media="screen" type="image/png" sizes="32x32" href="/one.png">'
        + '<link rel="icon" media="(prefers-color-scheme: dark)"'
        + ' type="image/png" sizes="48x48" href="/two.png">'
        + '<link rel="icon" sizes="16x16" href="/unknown.png">';
      const expression = '(() => {document.head.innerHTML = '
        + JSON.stringify(html) + '; globalThis.__syntheticPackBase64 = '
        + JSON.stringify(pack.toString('base64'))
        + '; return (async () => {' + browserScript
        + '; return await run(); })();})()';
      const result = await client.evaluate(expression);
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.fixtureOnly, true);
      assert.equal(result.sourceVariants, 2);
      assert.equal(result.addressesPerVariant, 588);
      assert.equal(result.uniquePhaseFrames, 21);
      assert.equal(result.decoded, 1176);
      assert.equal(result.verifiedPixels, 1176);
      assert.equal(result.redundantHrefWrites, 0);
      assert.equal(result.warmExtraFrames, 0);
      assert.equal(result.unknownRestored, true);
      assert.equal(result.originalRestored, true);
      console.log('FIXTURE ONLY ' + JSON.stringify(result));
    } finally {
      client?.close();
      chrome.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => chrome.once('close', resolve)),
        new Promise(resolve => setTimeout(() => {
          chrome.kill('SIGKILL');
          resolve();
        }, 2000))
      ]);
      rmSync(directory, { recursive:true, force:true, maxRetries: 5,
        retryDelay: 100 });
    }
  });
