import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
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
    const response = await fetch('/pack');
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const headerLength = view.getUint32(8, true);
    const manifest = JSON.parse(new TextDecoder().decode(
      bytes.subarray(12, 12 + headerLength)));
    const payloadStart = 12 + headerLength;
    const urls = new Map();
    let coldReads = 0;
    let hrefWrites = 0;
    let decodeCount = 0;
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
    const warmReadsBefore = coldReads;
    for (let slot = 0; slot < 40; slot++) {
      await syntheticGetFavicon(0, 0, slot * 250);
    }
    if (links[2].href !== originals[2]) {
      throw new Error('unknown source candidate overwritten');
    }
    if (links[0].media !== 'screen' || links[1].sizes.value !== '48x48') {
      throw new Error('favicon link attributes changed');
    }
    for (let variant = 0; variant < 2; variant++) {
      links[variant].href = originals[variant];
    }
    for (const url of urls.values()) URL.revokeObjectURL(url);
    return {fixtureOnly:true, sourceVariants:2, addressesPerVariant:588,
      uniquePhaseFrames:slots.size, objectUrls:urls.size, decoded:decodeCount,
      coldFrames:coldReads, warmExtraFrames:coldReads - warmReadsBefore,
      hrefWrites, unknownRestored:links[2].href === originals[2],
      originalRestored:links[0].href === originals[0]
        && links[1].href === originals[1]};
  }
  run().then(result => {
    document.getElementById('result').textContent = JSON.stringify(result);
  }).catch(error => {
    document.getElementById('result').textContent =
      JSON.stringify({error:String(error)});
  });
`;

test('Chromium decodes the 2x588 synthetic pack frames and preserves candidates',
  { timeout: 50000 }, async () => {
    const pack = packFixture();
    const html = '<!doctype html><head>'
      + '<link rel="icon" media="screen" sizes="32x32" href="/one.png">'
      + '<link rel="icon" media="(prefers-color-scheme: dark)" sizes="48x48" href="/two.png">'
      + '<link rel="icon" sizes="16x16" href="/unknown.png">'
      + '</head><body><pre id="result">RUNNING</pre>'
      + '<script>' + browserScript + '</script><img src="/hold" hidden></body>';
    const server = createServer((request, response) => {
      if (request.url === '/hold') {
        setTimeout(() => { response.writeHead(204); response.end(); }, 16000);
        return;
      }
      response.writeHead(200, { 'Content-Type': request.url === '/pack'
        ? 'application/octet-stream' : 'text/html; charset=utf-8' });
      response.end(request.url === '/pack' ? pack : html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const directory = mkdtempSync(path.join(os.tmpdir(), 'dc336-browser-'));
    try {
      const args = ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
        '--no-first-run', '--disable-background-networking', '--dump-dom',
        '--user-data-dir=' + directory,
        'http://127.0.0.1:' + server.address().port + '/'];
      const run = await new Promise((resolve, reject) => {
        const child = spawn(chromium(), args);
        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Chromium fixture timed out: ' + stderr.slice(-500)));
        }, 42000);
        child.stdout.on('data', data => { stdout += data.toString(); });
        child.stderr.on('data', data => { stderr += data.toString(); });
        child.on('error', reject);
        child.on('close', code => {
          clearTimeout(timeout);
          resolve({ code, stdout, stderr });
        });
      });
      assert.equal(run.code, 0, run.stderr.slice(-1000));
      const match = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
      assert.ok(match, 'Chromium result node missing');
      assert.notEqual(match[1], 'RUNNING', 'fixture did not complete');
      const result = JSON.parse(match[1].replaceAll('&quot;', '"'));
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.fixtureOnly, true);
      assert.equal(result.sourceVariants, 2);
      assert.equal(result.addressesPerVariant, 588);
      assert.equal(result.uniquePhaseFrames, 21);
      assert.equal(result.decoded, 1176);
      assert.equal(result.warmExtraFrames, 0);
      assert.equal(result.unknownRestored, true);
      assert.equal(result.originalRestored, true);
      console.log('FIXTURE ONLY ' + JSON.stringify(result));
    } finally {
      rmSync(directory, { recursive:true, force:true });
      await new Promise(resolve => server.close(resolve));
    }
  });
