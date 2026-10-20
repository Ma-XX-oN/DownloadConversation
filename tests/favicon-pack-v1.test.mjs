import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { encodePack, validatePack, validatePng, canonicalJson, crc32,
  sha256, versionTriplet, selectDataset } from '../scripts/favicon-pack-format.mjs';
import { rendererHtml, renderOriginal, validateOriginalSource } from '../scripts/generate-favicon-packs.mjs';

/** Construct a signed PNG chunk for controlled byte-corruption fixtures.
 * @param {string} type - Four-character PNG chunk type.
 * @param {Buffer} content - Chunk payload bytes.
 * @returns {Buffer} Framed chunk with valid CRC-32.
 */
function chunk(type, content) {
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32BE(content.length);
  prefix.write(type, 4, 4, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), content])));
  return Buffer.concat([prefix, content, checksum]);
}

/** Make an in-memory 8-bit RGBA PNG with white foreground and black detail.
 * @param {number} width - Expected width.
 * @param {number} height - Expected height.
 * @param {number} alpha - Uniform alpha channel value.
 * @returns {Buffer} Valid PNG fixture bytes.
 */
function fixturePng(width, height, alpha = 255) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * (width * 4 + 1) + 1 + x * 4;
      const white = x >= 2 && x < width - 2 && y >= 2 && y < height - 2;
      raw[i] = white ? 255 : 0;
      raw[i+1] = white ? 255 : 0;
      raw[i+2] = white ? 255 : 0;
      raw[i+3] = white ? alpha : 0;
    }
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header), chunk('IDAT',deflateSync(raw)),
    chunk('IEND',Buffer.alloc(0))
  ]);
}

/** Build a complete producer fixture with 588 physically indexed PNG spans.
 * @param {number} width - Synthetic icon width.
 * @returns {Buffer} Valid pack with exact V1 indexing.
 */
function fixturePack(width = 8) {
  const png = fixturePng(width,width);
  return encodePack([{
    id: '0', source_sha256: sha256(png), width, height: width,
    pngs: Array.from({ length: 588 }, () => png)
  }]);
}

/** Return a valid catalogue entry using a verified synthetic pack.
 * @param {string} version - Catalogue minimum version boundary.
 * @returns {object} V1 catalogue entry.
 */
function entry(version) {
  const pack = fixturePack();
  return {
    version, update_every_ms: 250,
    favicons: {
      commit: '1'.repeat(40),
      path: 'assets/favicons/v1/chatgpt-v1.dcfav',
      bytes: pack.length, sha256: sha256(pack)
    }
  };
}

test('numeric three-part version order completely ignores all issue suffixes', () => {
  const c = { schema: 'dc-favicon-catalogue-v1', datasets: [
    entry('1.9.19'), entry('1.10.0'), entry('2.0.0')
  ] };
  assert.equal(selectDataset(c, '1.9.18'), null);
  assert.equal(selectDataset(c, '1.9.19-issue.99.999').version, '1.9.19');
  assert.equal(selectDataset(c, '1.10.0-issue.1.1').version, '1.10.0');
  assert.equal(selectDataset(c, '1.10.0-issue.999999.999999').version, '1.10.0');
  assert.equal(selectDataset(c, '1.99.0-issue.999.0').version, '1.10.0');
  assert.equal(selectDataset(c, '2.0.0-issue.0.0').version, '2.0.0');
  assert.deepEqual(versionTriplet('1.11.8-issue.3.93'), [1,11,8]);
  for (const bad of ['1.2', '1.2.3.4', '1.2.x', 'a.2.3',
    '1.2.3garbage', '99999999999999999999.2.3']) {
    assert.throws(() => versionTriplet(bad), bad);
  }
});

test('duplicate normalized boundaries and unsound catalogue metadata fail closed', () => {
  const duplicate = { schema: 'dc-favicon-catalogue-v1',
    datasets: [entry('1.11.7'), entry('1.11.7')] };
  assert.throws(() => selectDataset(duplicate,'1.11.8'), /Duplicate/);
  const invalid = entry('1.11.7');
  invalid.update_every_ms = 0;
  assert.throws(() => selectDataset({
    schema: 'dc-favicon-catalogue-v1', datasets: [invalid]
  }, '1.11.9'), /interval/);
  assert.throws(() => selectDataset({
    schema: 'dc-favicon-catalogue-v1', datasets: [entry('1.11.7-issue.9.1')]
  }, '1.11.9'), /normalized/);
});

test('canonical manifest has 588 unique nonoverlapping indexed PNG spans', () => {
  const pack = fixturePack();
  const manifest = validatePack(pack);
  assert.equal(manifest.schema,'dc-favicon-pack-v1');
  assert.equal(manifest.variants.length, 1);
  const variant = manifest.variants[0];
  assert.deepEqual([variant.width,variant.height],[8,8]);
  assert.deepEqual(variant.images.map(x => x.length),[7,7,7,7]);
  const ranges = variant.images.flat(2).map(f => [f.offset,f.offset+f.bytes]);
  assert.equal(ranges.length,588);
  assert.equal(new Set(ranges.map(x => x[0])).size,588);
  assert.equal(ranges[0][0],0);
  assert.equal(pack.toString('ascii',0,8),'DCFC0001');
  const length = pack.readUInt32LE(8);
  const header = pack.toString('utf8',12,12+length);
  assert.equal(header,canonicalJson(manifest));
  assert.equal(ranges.at(-1)[1],pack.length-12-length);
  assert.deepEqual(pack,fixturePack(), 'Repeat builds must be byte-for-byte identical');
});

test('pack validator rejects missing bytes, bad magic, bad CRC and unindexed tails', () => {
  const p = fixturePack();
  assert.throws(() => validatePack(p.subarray(0,p.length-1)));
  const magic = Buffer.from(p);
  magic[0] ^= 1;
  assert.throws(() => validatePack(magic), /magic/);
  const tail = Buffer.concat([p, Buffer.from('junk')]);
  assert.throws(() => validatePack(tail), /tail/);
  const headerBytes = p.readUInt32LE(8);
  const crc = Buffer.from(p);
  crc[12+headerBytes+20] ^= 1;
  assert.throws(() => validatePack(crc), /CRC/);
  assert.throws(() => validatePng(Buffer.from('not a PNG')), /PNG/);
  const oversized = Buffer.from(p);
  oversized.writeUInt32LE(0xffffffff,8);
  assert.throws(() => validatePack(oversized), /bounds/);
});

test('pinned PNG, ICO and SVG candidate formats accept actual resource framing', () => {
  const png = fixturePng(16, 16);
  assert.doesNotThrow(() => validateOriginalSource(png, {
    mime: 'image/png', width: 16, height: 16
  }));
  const ico = Buffer.alloc(22 + png.length);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico[6] = 16;
  ico[7] = 16;
  ico.writeUInt32LE(png.length, 14);
  ico.writeUInt32LE(22, 18);
  png.copy(ico, 22);
  assert.doesNotThrow(() => validateOriginalSource(ico, {
    mime: 'image/x-icon', width: 16, height: 16
  }));
  assert.throws(() => validateOriginalSource(ico, {
    mime: 'image/x-icon', width: 32, height: 32
  }), /no matching source dimensions/);
  const corrupt = Buffer.from(ico);
  corrupt.writeUInt32LE(0xffffffff, 18);
  assert.throws(() => validateOriginalSource(corrupt, {
    mime: 'image/x-icon', width: 16, height: 16
  }), /offset invalid/);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" ' +
    'viewBox="0 0 16 16"><path fill="#fff" d="M0 0H16V16H0Z"/></svg>');
  assert.doesNotThrow(() => validateOriginalSource(svg, {
    mime: 'image/svg+xml', width: 16, height: 16
  }));
  for (const unsafe of [
    '<svg><script>alert(1)</script></svg>',
    '<svg><image href="https://example.com/a.png"/></svg>',
    '<svg onload="alert(1)"></svg>',
    '<!DOCTYPE svg><svg></svg>'
  ]) {
    assert.throws(() => validateOriginalSource(Buffer.from(unsafe), {
      mime: 'image/svg+xml', width: 16, height: 16
    }));
  }
});

test('generator source is an offline Canvas pipeline, not runtime userscript bytes', () => {
  const html = rendererHtml({
    data_url: 'data:image/png;base64,AAAA', width: 8, height: 8
  });
  assert.match(html,/globalCompositeOperation = 'destination-over'/);
  assert.match(html,/globalCompositeOperation = 'source-over'/);
  assert.match(html,/Math.cos/);
  assert.match(html,/pulse < 21/);
  assert.match(html,/step < 7/);
  assert.match(html,/state < 4/);
  assert.doesNotMatch(html,/<script src=/);
});

test('headless browser creates 588 full-composite frames with repeatable PNG bytes', () => {
  assert(process.env.DC_FAVICON_CHROME ||
    existsSync('/usr/bin/chromium') || existsSync('/usr/bin/google-chrome'),
    'A real Chrome/Chromium executable is required for rendering acceptance');
  if (existsSync('/usr/bin/google-chrome') && !existsSync('/usr/bin/chromium')) {
    process.env.DC_FAVICON_CHROME = '/usr/bin/google-chrome';
  }
  const original = fixturePng(16,16);
  const input = { mime: 'image/png',width:16,height:16 };
  const first = renderOriginal(original,input);
  const second = renderOriginal(original,input);
  assert.equal(first.length,588);
  assert.equal(second.length,588);
  assert.equal(first[0].equals(second[0]),true);
  assert.equal(first[20].equals(second[20]),true);
  assert.equal(first[587].equals(second[587]),true);
  assert.equal(sha256(first[0]) === sha256(first[20]),false,
    'Pulse minimum must differ from maximum');
  for (const image of [first[0],first[20],first[21],first[146],first[587]]) {
    assert.deepEqual(validatePng(image),{width:16,height:16});
  }
});
