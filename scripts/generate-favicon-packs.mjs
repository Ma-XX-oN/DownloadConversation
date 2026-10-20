import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync,
  existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePack, validatePack, validatePng, sha256, canonicalJson,
  CATALOGUE_SCHEMA, MAX_PACK_BYTES, selectDataset, versionTriplet } from './favicon-pack-format.mjs';

/** Root of the checked-out source tree. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Exact original image provenance file. */
const INPUT = join(ROOT, 'assets/favicons/v1/sources.json');
/** Single immutable external binary pack. */
const PACK = join(ROOT, 'assets/favicons/v1/chatgpt-v1.dcfav');
/** Stable and small version-range catalogue path. */
const CATALOGUE = join(ROOT, 'assets/favicons/catalogue.json');
/** Source digest syntax. */
const SHA256 = /^[0-9a-f]{64}$/;

/** Recreate the original DC Canvas pixel pipeline in its own offline browser.
 * @param {object} input - Data URI, width and height of pinned resource.
 * @returns {void} Reports the 588 PNGs through offline page DOM.
 */
function browserCanvasRender(input) {
  const colors = [[255,255,0],[144,238,144],[255,0,0],[255,255,255]];
  const ringColors = ['#00cc00','#55cc00','#aacc00','#ffcc00','#ff7700','#ff0000'];
  const result = document.getElementById('result');
  const image = new Image();
  image.onload = () => {
    try {
      if (image.naturalWidth !== input.width || image.naturalHeight !== input.height) {
        throw new Error('Pinned favicon dimensions changed');
      }
      const frames = [];
      for (let state = 0; state < 4; state++) {
        for (let step = 0; step < 7; step++) {
          for (let pulse = 0; pulse < 21; pulse++) {
            const width = image.naturalWidth, height = image.naturalHeight;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0, width, height);
            const pixels = context.getImageData(0, 0, width, height);
            const data = pixels.data, color = colors[state];
            for (let index = 0; index + 3 < data.length; index += 4) {
              if (data[index + 3] === 0) continue;
              const r = data[index], g = data[index + 1], b = data[index + 2];
              if (Math.min(r,g,b) < 240 || Math.max(r,g,b) - Math.min(r,g,b) > 16) {
                continue;
              }
              const intensity = (r + g + b) / (3 * 255);
              data[index] = Math.round(color[0] * intensity);
              data[index+1] = Math.round(color[1] * intensity);
              data[index+2] = Math.round(color[2] * intensity);
            }
            context.putImageData(pixels, 0, 0);
            if (step > 0) {
              const size = Math.min(width, height), cx = width / 2, cy = height / 2;
              const from = -Math.PI / 2, to = from + 2 * Math.PI * step / 6;
              context.globalCompositeOperation = 'destination-over';
              context.beginPath();
              context.moveTo(cx, cy);
              context.fillStyle = ringColors[step-1];
              context.arc(cx, cy, size * 0.49, from, to);
              context.closePath();
              context.fill();
              context.globalCompositeOperation = 'source-over';
              context.beginPath();
              context.strokeStyle = ringColors[step-1];
              context.lineWidth = Math.max(1, size * 0.12);
              context.arc(cx, cy, size * 0.43, from, to);
              context.stroke();
            }
            const composite = context.getImageData(0, 0, width, height);
            const opacity = 0.75 + 0.25 * Math.cos(2 * Math.PI * pulse * 250 / 10000);
            for (let i = 3; i < composite.data.length; i += 4) {
              composite.data[i] = Math.round(composite.data[i] * opacity);
            }
            context.putImageData(composite, 0, 0);
            frames.push(canvas.toDataURL('image/png').split(',')[1]);
          }
        }
      }
      result.textContent = JSON.stringify(frames);
    } catch (error) {
      result.textContent = 'FAILED:' + error.message;
    }
  };
  image.onerror = () => { result.textContent = 'FAILED: source image decode'; };
  image.src = input.data_url;
}

/** Build a self-contained offline HTML renderer using real legacy Canvas calls.
 * @param {object} source - Source URI and pinned dimensions.
 * @returns {string} HTML to execute in headless Chromium.
 */
export function rendererHtml(source) {
  const json = JSON.stringify(source).replaceAll('<', '\\u003c');
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<pre id="result">NOT_READY</pre><script>(' +
    browserCanvasRender.toString() + ')(' + json + ');</script></body></html>';
}

/** Render one original into the 588 complete PNG composites in real Chrome.
 * @param {Buffer} original - Original untouched source resource bytes.
 * @param {object} descriptor - Resource metadata including dimensions.
 * @returns {Buffer[]} Complete PNG frames in base/step/pulse order.
 */
export function renderOriginal(original, descriptor) {
  const tmp = mkdtempSync(join(tmpdir(), 'dc-favicon-'));
  try {
    const html = rendererHtml({
      data_url: 'data:' + descriptor.mime + ';base64,' + original.toString('base64'),
      width: descriptor.width, height: descriptor.height
    });
    const htmlPath = join(tmp, 'render.html');
    writeFileSync(htmlPath, html);
    const chrome = process.env.DC_FAVICON_CHROME || 'chromium';
    const stdout = execFileSync(chrome, [
      '--headless', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-background-networking',
      '--no-first-run', '--virtual-time-budget=30000',
      '--dump-dom', 'file://' + htmlPath
    ], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120000,
      stdio: ['ignore', 'pipe', 'ignore'] });
    const match = /<pre id="result">([^<]*)<\/pre>/.exec(stdout);
    assert(match && match[1] !== 'NOT_READY', 'Chrome did not finish favicon render');
    assert(!match[1].startsWith('FAILED:'), match?.[1] || 'Render failed');
    const encoded = JSON.parse(match[1]);
    assert(Array.isArray(encoded) && encoded.length === 588, 'Incomplete Canvas grid');
    return encoded.map(value => {
      assert(typeof value === 'string' && /^[A-Za-z0-9+/=]+$/.test(value),
        'Invalid Canvas PNG encoding');
      const png = Buffer.from(value, 'base64');
      const dimensions = validatePng(png);
      assert(dimensions.width === descriptor.width &&
        dimensions.height === descriptor.height, 'PNG dimensions mismatch');
      return png;
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Validate a source resource without treating its filename as proof of format.
 * @param {Buffer} bytes - Exact fetched favicon response bytes.
 * @param {object} source - Immutable source descriptor (MIME and size).
 * @returns {void} Rejects unsupported or malformed source formats.
 */
export function validateOriginalSource(bytes, source) {
  assert(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024,
    'Original favicon binary bound');
  if (source.mime === 'image/png') {
    const size = validatePng(bytes);
    assert(size.width === source.width && size.height === source.height,
      'Pinned original PNG dimensions differ');
    return;
  }
  if (source.mime === 'image/webp') {
    assert(bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP' &&
      bytes.readUInt32LE(4) === bytes.length - 8,
      'Pinned original WebP framing differs');
    return;
  }
  if (source.mime === 'image/x-icon') {
    assert(bytes.length >= 22 && bytes.readUInt16LE(0) === 0 &&
      bytes.readUInt16LE(2) === 1, 'Pinned ICO header invalid');
    const count = bytes.readUInt16LE(4);
    assert(count > 0 && count <= 64 && 6 + count * 16 <= bytes.length,
      'Pinned ICO directory count invalid');
    let foundSize = false;
    for (let i = 0; i < count; i++) {
      const pos = 6 + i * 16;
      const width = bytes[pos] || 256, height = bytes[pos + 1] || 256;
      const length = bytes.readUInt32LE(pos + 8);
      const offset = bytes.readUInt32LE(pos + 12);
      assert(length >= 8 && offset >= 6 + count * 16 &&
        offset + length <= bytes.length, 'Pinned ICO data offset invalid');
      if (width === source.width && height === source.height) foundSize = true;
    }
    assert(foundSize, 'Pinned ICO has no matching source dimensions');
    return;
  }
  if (source.mime === 'image/svg+xml') {
    const text = bytes.toString('utf8');
    assert(!text.includes('\ufffd') &&
      /^\s*(?:<\?xml\b[^>]*\?>\s*)?<svg[\s>]/i.test(text) &&
      /<\/svg\s*>\s*$/i.test(text), 'Pinned SVG root invalid');
    assert(!/<!DOCTYPE|<!ENTITY|<(?:script|foreignObject|iframe|object|image)\b|\bon[a-z]+\s*=|@import\b/i.test(text) &&
      !/\b(?:href|xlink:href)\s*=\s*['"](?!#)/i.test(text) &&
      !/\burl\s*\(\s*['"]?\s*(?!#)/i.test(text),
      'SVG contains executable or external references');
    return;
  }
  throw new Error('Unsupported source favicon MIME type');
}

/** Verify authentic pinned original resource digests and produce exact asset.
 * @returns {Buffer} Complete immutable V1 pack.
 */
export function generatePack() {
  const descriptor = JSON.parse(readFileSync(INPUT, 'utf8'));
  assert(descriptor.schema === 'dc-favicon-originals-v1' &&
    Array.isArray(descriptor.sources) && descriptor.sources.length > 0 &&
    descriptor.sources.length <= 8, 'Pinned source list invalid');
  const sources = descriptor.sources.toSorted((a, b) =>
    a.sha256.localeCompare(b.sha256));
  const seen = new Set();
  const variants = [];
  for (const [index, source] of sources.entries()) {
    assert(typeof source.path === 'string' &&
      /^assets\/favicons\/v1\/originals\/[a-z0-9-]+\.(png|webp|ico|svg)$/.test(source.path) &&
      SHA256.test(source.sha256) && !seen.has(source.sha256) &&
      ['image/png', 'image/webp', 'image/x-icon', 'image/svg+xml'].includes(source.mime) &&
      Number.isInteger(source.width) && source.width > 0 && source.width <= 512 &&
      Number.isInteger(source.height) && source.height > 0 && source.height <= 512,
      'Invalid source descriptor');
    seen.add(source.sha256);
    const bytes = readFileSync(join(ROOT, source.path));
    assert(sha256(bytes) === source.sha256, 'Pinned source SHA mismatch');
    validateOriginalSource(bytes, source);
    variants.push({
      id: String(index), source_sha256: source.sha256,
      width: source.width, height: source.height,
      pngs: renderOriginal(bytes, source)
    });
  }
  const pack = encodePack(variants);
  assert(pack.length <= MAX_PACK_BYTES, 'Pack exceeds binary limit');
  validatePack(pack);
  return pack;
}

/** Generate or independently verify immutable pack bytes.
 * @param {boolean} verify - Do not modify the committed pack when true.
 * @returns {void} Print exact pack digest and variant metadata.
 */
function build(verify) {
  const output = generatePack();
  if (verify) {
    assert(existsSync(PACK), 'Committed pack missing');
    assert(readFileSync(PACK).equals(output), 'Regeneration differs byte-for-byte');
  } else {
    mkdirSync(dirname(PACK), { recursive: true });
    writeFileSync(PACK, output);
  }
  process.stdout.write(JSON.stringify({
    path: 'assets/favicons/v1/chatgpt-v1.dcfav',
    bytes: output.length, sha256: sha256(output),
    variants: validatePack(output).variants.map(v => ({
      id: v.id, source_sha256: v.source_sha256,
      width: v.width, height: v.height, frames: 588
    }))
  }) + '\n');
}

/** Publish a catalogue referencing a prior immutable pack-bearing Git commit.
 * @param {string} commit - Pack-bearing Git commit SHA (not this later commit).
 * @param {string} boundary - Minimum supported normalized DC release triplet.
 * @returns {void} Write the canonical version-range catalogue.
 */
function publish(commit, boundary) {
  assert(/^[0-9a-f]{40}$/.test(commit), 'Asset commit SHA is required');
  assert(boundary === versionTriplet(boundary).join('.'),
    'Minimum boundary must be major.minor.patch');
  const pack = readFileSync(PACK);
  validatePack(pack);
  const existing = existsSync(CATALOGUE)
    ? JSON.parse(readFileSync(CATALOGUE, 'utf8'))
    : { schema: CATALOGUE_SCHEMA, datasets: [] };
  assert(existing.schema === CATALOGUE_SCHEMA && Array.isArray(existing.datasets),
    'Invalid existing catalogue');
  const entry = {
    version: boundary, update_every_ms: 250,
    favicons: {
      commit, path: 'assets/favicons/v1/chatgpt-v1.dcfav',
      bytes: pack.length, sha256: sha256(pack)
    }
  };
  const old = existing.datasets.find(item => item.version === boundary);
  assert(!old || canonicalJson(old) === canonicalJson(entry),
    'Published catalogue boundary must be immutable');
  const datasets = [...existing.datasets.filter(item => item.version !== boundary), entry];
  datasets.sort((a, b) => {
    const x = versionTriplet(a.version), y = versionTriplet(b.version);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
  const next = { schema: CATALOGUE_SCHEMA, datasets };
  for (const item of datasets) selectDataset(next, item.version);
  mkdirSync(dirname(CATALOGUE), { recursive: true });
  writeFileSync(CATALOGUE, canonicalJson(next) + '\n');
}

/** Dispatch the developer-only generator CLI. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2);
  if (action === '--build' && !args.length) build(false);
  else if (action === '--verify' && !args.length) build(true);
  else if (action === '--catalogue' && args.length === 2) publish(args[0], args[1]);
  else if (action === '--verify-catalogue' && !args.length) {
    const parsed = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
    const chosen = selectDataset(parsed, parsed.datasets.at(-1).version);
    const bytes = readFileSync(PACK);
    assert(chosen?.favicons.bytes === bytes.length &&
      chosen?.favicons.sha256 === sha256(bytes), 'Catalogue pack hash mismatch');
    assert(readFileSync(CATALOGUE, 'utf8') === canonicalJson(parsed) + '\n',
      'Catalogue is not canonical');
  } else {
    throw new Error('Use --build, --verify, --catalogue COMMIT VERSION, or --verify-catalogue');
  }
}
