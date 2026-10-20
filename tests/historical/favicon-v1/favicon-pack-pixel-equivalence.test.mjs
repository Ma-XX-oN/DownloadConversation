import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderOriginal } from '../../../scripts/generate-favicon-packs.mjs';
import { crc32 } from '../../../scripts/favicon-pack-format.mjs';
import { productionFunctionSource } from '../../helpers/userscript-source.mjs';

/** Frame one PNG chunk for an independent synthetic source fixture.
 * @param {string} type - PNG chunk identifier.
 * @param {Buffer} bytes - Uncompressed chunk body.
 * @returns {Buffer} Complete CRC-checked chunk.
 */
function chunk(type, bytes) {
  const header = Buffer.alloc(8), checksum = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  header.write(type, 4, 4, 'ascii');
  checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), bytes])));
  return Buffer.concat([header, bytes, checksum]);
}

/** Make pixels including white, nonwhite, fully and partly transparent areas.
 * @returns {Buffer} Pinned 16x16 synthetic PNG source.
 */
function originalPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(16, 0);
  header.writeUInt32BE(16, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(16 * (1 + 16 * 4));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = y * 65 + 1 + x * 4;
      const white = x > 3 && x < 12 && y > 3 && y < 12;
      raw[i] = white ? 250 : 46;
      raw[i + 1] = white ? 252 : 70;
      raw[i + 2] = white ? 255 : 110;
      raw[i + 3] = (x + y) % 7 === 0 ? 0 : (x + y) % 3 === 0 ? 128 : 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Build reference pixels using the actual legacy DC production helpers.
 * @param {object[]} samples - Captured PNGs from the external producer.
 * @param {string} original - Original PNG source as a data URL.
 * @returns {string} Standalone browser HTML containing an independent parity check.
 */
function referenceHtml(samples, original) {
  const functions = [
    'agentFaviconRecolorPixels', 'agentFaviconRingColor',
    'agentFaviconDrawPieSlice', 'agentFaviconDrawRing',
    'agentFaviconApplyOpacity', 'agentFaviconPulseOpacity'
  ].map(productionFunctionSource).join('\n');
  const config = JSON.stringify({ samples, original }).replaceAll('<', '\\u003c');
  const browser = `
    'use strict';
    const AGENT_FAVICON_PULSE_INTERVAL_MS = 10000;
    function assert(condition, reason) {
      if (!condition) throw new Error(reason);
    }
    const config = __CONFIG__;
    __LEGACY__
    function load(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    }
    async function compare() {
      const original = await load(config.original);
      const colors = [[255,255,0], [144,238,144], [255,0,0], [255,255,255]];
      for (const sample of config.samples) {
        const actual = await load(sample.url);
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const context = canvas.getContext('2d');
        context.drawImage(original, 0, 0, 16, 16);
        const originalPixels = context.getImageData(0, 0, 16, 16);
        agentFaviconRecolorPixels(originalPixels.data, colors[sample.base]);
        context.putImageData(originalPixels, 0, 0);
        if (sample.step > 0 && sample.base !== 2) {
          context.globalCompositeOperation = 'destination-over';
          try {
            agentFaviconDrawPieSlice(context, 16, 16, sample.step);
          } finally {
            context.globalCompositeOperation = 'source-over';
          }
          agentFaviconDrawRing(context, 16, 16, sample.step);
        }
        const composite = context.getImageData(0, 0, 16, 16);
        agentFaviconApplyOpacity(composite.data,
          agentFaviconPulseOpacity(sample.pulse * 250));
        context.putImageData(composite, 0, 0);
        const expected = context.getImageData(0, 0, 16, 16).data;
        const actualCanvas = document.createElement('canvas');
        actualCanvas.width = 16;
        actualCanvas.height = 16;
        const actualContext = actualCanvas.getContext('2d');
        actualContext.drawImage(actual, 0, 0, 16, 16);
        const actualPixels = actualContext.getImageData(0, 0, 16, 16).data;
        for (let index = 0; index < expected.length; index++) {
          if (expected[index] !== actualPixels[index]) {
            throw new Error('Pixel mismatch base=' + sample.base +
              ' step=' + sample.step + ' pulse=' + sample.pulse +
              ' byte=' + index + ' expected=' + expected[index] +
              ' actual=' + actualPixels[index]);
          }
        }
      }
      document.getElementById('result').textContent =
        'PASS:' + config.samples.length;
    }
    compare().catch(error => {
      document.getElementById('result').textContent = 'FAIL:' + error.message;
    });
  `.replace('__CONFIG__', config).replace('__LEGACY__', functions);
  return '<!doctype html><html><body><pre id="result">PENDING</pre>' +
    '<script>' + browser + '</script></body></html>';
}

test('generated PNG pixels match legacy production functions at all critical states', () => {
  const chrome = process.env.DC_FAVICON_CHROME ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' :
      '/usr/bin/google-chrome');
  assert(existsSync(chrome), 'Real Chromium/Chrome is mandatory for pixel parity');
  const original = originalPng();
  const frames = renderOriginal(original, { mime:'image/png',width:16,height:16 });
  const keys = [
    [0,0,0], [0,1,1], [0,6,20],
    [1,0,20], [1,3,7], [1,6,0],
    [2,0,4], [2,1,4], [2,6,4],
    [3,0,0], [3,1,20], [3,6,20]
  ];
  const samples = keys.map(([base,step,pulse]) => ({
    base, step, pulse,
    url:'data:image/png;base64,' +
      frames[(base * 7 + step) * 21 + pulse].toString('base64')
  }));
  const originalUrl = 'data:image/png;base64,' + original.toString('base64');
  const dir = mkdtempSync(join(tmpdir(), 'dc-favicon-parity-'));
  try {
    const path = join(dir, 'verify.html');
    writeFileSync(path, referenceHtml(samples, originalUrl));
    const output = execFileSync(chrome, [
      '--headless','--no-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--disable-background-networking',
      '--virtual-time-budget=30000','--dump-dom','file://' + path
    ], { encoding:'utf8',maxBuffer:1024 * 1024,timeout:120000,
      stdio:['ignore','pipe','ignore'] });
    const match = /<pre id="result">([^<]*)<\/pre>/.exec(output);
    assert.equal(match?.[1], 'PASS:' + samples.length,
      'Browser source-pixel parity failed: ' + match?.[1]);
  } finally {
    rmSync(dir, { recursive:true,force:true });
  }
});
