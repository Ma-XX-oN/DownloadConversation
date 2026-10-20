import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ORIGINAL = new URL(
  '../assets/favicons/v1/originals/chatgpt-favicon-l4nq08hd.svg', import.meta.url);
const EXPECTED_SHA = '8f2de046d22cfecfe3917cf87ff1ce49a48d79956f6b18be3b37db29148a0aeb';

/** Render the source SVG under Chrome's active browser theme.
 * @param {string} svg - Byte-identical source encoded as a data URI.
 * @returns {string} Browser HTML fixture with transparent-pixel-safe metrics.
 */
function html(svg) {
  const js = `
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 180; canvas.height = 180;
      const context = canvas.getContext('2d', {willReadFrequently:true});
      context.drawImage(image, 0, 0, 180, 180);
      const pixels = context.getImageData(0, 0, 180, 180).data;
      let opaque = 0, light = 0, dark = 0, sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) continue;
        opaque++;
        const rgb = pixels[i] + pixels[i + 1] + pixels[i + 2];
        sum += rgb;
        if (rgb > 600) light++;
        if (rgb < 150) dark++;
      }
      document.getElementById('result').textContent = JSON.stringify({
        theme:matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light',
        opaque,light,dark,mean:Math.round(sum / Math.max(opaque,1) / 3)
      });
    };
    image.onerror = () => {
      document.getElementById('result').textContent = 'LOAD_ERROR';
    };
    image.src = '__SVG__';
  `.replace('__SVG__', svg);
  return '<!doctype html><html><body><pre id="result">PENDING</pre>' +
    '<script>' + js + '</script></body></html>';
}

/** Execute one independent theme-specific render in real Chromium.
 * @param {string} chrome - Browser executable.
 * @param {string} path - Offline HTML fixture.
 * @param {string} theme - Browser theme selection.
 * @returns {object} Source raster pixel statistics.
 */
function render(chrome, path, theme) {
  const flags = theme === 'dark' ?
    ['--force-dark-mode', '--force-prefers-color-scheme=dark'] :
    ['--force-prefers-color-scheme=light'];
  const output = execFileSync(chrome, [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--disable-background-networking',
    ...flags, '--virtual-time-budget=30000', '--dump-dom', 'file://' + path
  ], {encoding:'utf8',timeout:120000,maxBuffer:1024*1024,
    stdio:['ignore','pipe','ignore']});
  const match = /<pre id="result">([^<]*)<\/pre>/.exec(output);
  assert(match && match[1] !== 'PENDING' && match[1] !== 'LOAD_ERROR',
    theme + ' SVG render unavailable: ' + match?.[1]);
  return JSON.parse(match[1]);
}

test('same pinned original SVG digest renders different light/dark raster pixels', () => {
  const chrome = process.env.DC_FAVICON_CHROME ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' :
      '/usr/bin/google-chrome');
  assert(existsSync(chrome), 'Chromium is mandatory for light/dark source proof');
  const bytes = readFileSync(ORIGINAL);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), EXPECTED_SHA);
  const svg = 'data:image/svg+xml;base64,' + bytes.toString('base64');
  const temp = mkdtempSync(join(tmpdir(), 'dc333-svg-themes-'));
  try {
    const path = join(temp, 'fixture.html');
    writeFileSync(path, html(svg));
    const light = render(chrome,path,'light');
    const dark = render(chrome,path,'dark');
    assert.equal(light.theme,'light');
    assert.equal(dark.theme,'dark');
    assert(light.opaque > 1000 && dark.opaque > 1000);
    assert(light.dark > light.light * 3,
      'Original SVG expected predominantly black in light browser theme');
    assert(dark.light > dark.dark * 3,
      'Original SVG expected predominantly white in dark browser theme');
    console.log('DC333_THEME_SOURCE_DIGEST=' + EXPECTED_SHA);
    console.log('DC333_LIGHT_RASTER=' + JSON.stringify(light));
    console.log('DC333_DARK_RASTER=' + JSON.stringify(dark));
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});
