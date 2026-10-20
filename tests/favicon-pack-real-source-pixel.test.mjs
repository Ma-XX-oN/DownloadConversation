import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePack } from '../scripts/generate-favicon-packs.mjs';
import { validatePack } from '../scripts/favicon-pack-format.mjs';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

/** Browser-side pixel comparison against the actual legacy DC implementation.
 * @param {object} config - Original data URI and exact indexed PNG data URIs.
 * @returns {Promise<void>} Writes a diagnostic result to the page.
 */
async function verifyInBrowser(config) {
  const load = url => new Promise((resolve, reject) => {
    const icon = new Image();
    icon.onload = () => resolve(icon);
    icon.onerror = () => reject(new Error('Source or pack PNG decode failed'));
    icon.src = url;
  });
  const palette = [[255, 255, 0], [144, 238, 144],
    [255, 0, 0], [255, 255, 255]];
  try {
    const source = await load(config.source);
    if (source.naturalWidth !== config.width ||
      source.naturalHeight !== config.height) {
      throw new Error('Decoded original intrinsic dimensions differ');
    }
    for (const sample of config.samples) {
      const output = await load(sample.data);
      const expectedCanvas = document.createElement('canvas');
      expectedCanvas.width = config.width;
      expectedCanvas.height = config.height;
      const ctx = expectedCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0, config.width, config.height);
      const pixels = ctx.getImageData(0, 0, config.width, config.height);
      agentFaviconRecolorPixels(pixels.data, palette[sample.base]);
      ctx.putImageData(pixels, 0, 0);
      if (sample.step > 0 && sample.base !== 2) {
        ctx.globalCompositeOperation = 'destination-over';
        try {
          agentFaviconDrawPieSlice(ctx, config.width, config.height,
            sample.step);
        } finally {
          ctx.globalCompositeOperation = 'source-over';
        }
        agentFaviconDrawRing(ctx, config.width, config.height, sample.step);
      }
      const composite = ctx.getImageData(0, 0, config.width, config.height);
      agentFaviconApplyOpacity(composite.data,
        agentFaviconPulseOpacity(sample.frame * 250));
      ctx.putImageData(composite, 0, 0);
      const expected = ctx.getImageData(0, 0, config.width, config.height).data;
      const actualCanvas = document.createElement('canvas');
      actualCanvas.width = config.width;
      actualCanvas.height = config.height;
      const actualContext = actualCanvas.getContext('2d',
        { willReadFrequently: true });
      actualContext.drawImage(output, 0, 0, config.width, config.height);
      const actual = actualContext.getImageData(0, 0,
        config.width, config.height).data;
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] !== actual[i]) {
          throw new Error('Pixel ' + i + ' differs for base ' + sample.base +
            ', step ' + sample.step + ', frame ' + sample.frame +
            ' expected=' + expected[i] + ' actual=' + actual[i]);
        }
      }
    }
    document.getElementById('result').textContent =
      'PASS:' + config.samples.length;
  } catch (error) {
    document.getElementById('result').textContent = 'FAIL:' + error.message;
  }
}

/** Build a standalone file whose reference functions are read from production.
 * @param {object} config - One independently pinned source and sample images.
 * @returns {string} Offline browser fixture, no external network requests.
 */
function browserHtml(config) {
  const production = [
    'agentFaviconRecolorPixels', 'agentFaviconRingColor',
    'agentFaviconDrawPieSlice', 'agentFaviconDrawRing',
    'agentFaviconApplyOpacity', 'agentFaviconPulseOpacity'
  ].map(productionFunctionSource).join('\n');
  return '<!doctype html><html><body><pre id="result">PENDING</pre><script>' +
    'const AGENT_FAVICON_PULSE_INTERVAL_MS=10000;\n' +
    'function assert(condition,reason){if(!condition)throw new Error(reason)};\n' +
    production + '\n(' +
    verifyInBrowser.toString() + ')(' +
    JSON.stringify(config).replaceAll('<', '\\u003c') +
    ');</script></body></html>';
}

test('three pinned ChatGPT originals are pixel-equivalent to real legacy helpers', () => {
  const chrome = process.env.DC_FAVICON_CHROME ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' :
      '/usr/bin/google-chrome');
  assert(existsSync(chrome), 'Real Chromium browser required for pixel parity');
  const sources = JSON.parse(readFileSync(new URL(
    '../assets/favicons/v1/sources.json', import.meta.url), 'utf8')).sources;
  const pack = generatePack();
  const headerBytes = pack.readUInt32LE(8);
  const manifest = validatePack(pack);
  const samples = [[0,0,0],[0,0,20],[0,6,20],
    [1,0,0],[1,3,7],[1,6,20],
    [2,0,4],[2,1,20],[2,6,0],
    [3,0,0],[3,3,10],[3,6,20]];
  const directory = mkdtempSync(join(tmpdir(), 'dc333-real-pixel-'));
  try {
    for (const variant of manifest.variants) {
      const source = sources.find(item => item.sha256 === variant.source_sha256);
      assert(source, 'Pack variant without pinned original');
      const original = readFileSync(new URL('../' + source.path,
        import.meta.url));
      const frames = samples.map(([base, step, frame]) => {
        const entry = variant.images[base][step][frame];
        const begin = 12 + headerBytes + entry.offset;
        return {
          base, step, frame,
          data: 'data:image/png;base64,' +
            pack.subarray(begin, begin + entry.bytes).toString('base64')
        };
      });
      const config = {
        source:'data:' + source.mime + ';base64,' + original.toString('base64'),
        width: variant.width, height: variant.height, samples:frames
      };
      const file = join(directory, 'source-' + variant.id + '.html');
      writeFileSync(file, browserHtml(config));
      const html = execFileSync(chrome, [
        '--headless', '--no-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-background-networking',
        '--virtual-time-budget=30000', '--dump-dom', 'file://' + file
      ], { encoding:'utf8', maxBuffer:3 * 1024 * 1024, timeout:120000,
        stdio:['ignore','pipe','ignore'] });
      const match = /<pre id="result">([^<]*)<\/pre>/.exec(html);
      assert.equal(match?.[1], 'PASS:' + samples.length,
        'Pinned source ' + variant.id + ' light-mode comparison: ' + match?.[1]);
    }
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});
