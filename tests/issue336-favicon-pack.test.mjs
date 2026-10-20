import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

// Frozen #332 interface, SHA verified via GitHub blob metadata.
const CONTRACT_SHA = 'e2460ba2bf1c1852579782ecbb05139de32e505e';
const MAGIC = Buffer.from('DCFC0001', 'ascii');
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const FRAMES_PER_VARIANT = 4 * 7 * 21;
// Safety envelope for genuine packs; not an asserted V1 size requirement.
const MAX_ASSET_BYTES = 512 * 1024 * 1024;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, canonical(value[key])]));
  }
  return value;
}

function versionTriplet(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[a-z0-9.-]+)?$/i.exec(value);
  if (!match) return null;
  const components = match.slice(1, 4).map(Number);
  if (components.some(value => !Number.isSafeInteger(value))) return null;
  return components;
}

function chooseDataset(catalogue, running) {
  const target = versionTriplet(running);
  if (!target || catalogue.schema !== 'dc-favicon-catalogue-v1'
    || !Array.isArray(catalogue.datasets)) return null;
  const seen = new Set();
  const available = catalogue.datasets.map(dataset => {
    const parts = versionTriplet(dataset.version);
    assert.ok(parts, 'invalid boundary: ' + dataset.version);
    const key = parts.join('.');
    assert.ok(!seen.has(key), 'duplicate normalized boundary: ' + key);
    seen.add(key);
    assert.ok(Number.isSafeInteger(dataset.update_every_ms)
      && dataset.update_every_ms > 0);
    return { dataset, parts };
  });
  const eligible = available.filter(item => item.parts.every((n, i) => {
    const prior = item.parts.slice(0, i);
    const precedingEqual = prior.every((v, j) => v === target[j]);
    return !precedingEqual || n <= target[i];
  }));
  eligible.sort((a, b) => {
    for (let index = 0; index < 3; index++) {
      if (a.parts[index] !== b.parts[index]) {
        return b.parts[index] - a.parts[index];
      }
    }
    return 0;
  });
  return eligible[0]?.dataset ?? null;
}

function pulseIndex(offset) {
  assert.ok(Number.isFinite(offset));
  const phase = ((offset % 10000) + 10000) % 10000;
  const slot = Math.floor(phase / 250);
  return Math.min(slot, 40 - slot);
}

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

function chunk(type, payload) {
  const kind = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([kind, payload])));
  return Buffer.concat([length, kind, payload, checksum]);
}

// Synthetic, deterministic PNG source; never treated as a genuine #333 pack.
function fixturePng(red, green, blue) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue, 255]))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function fixturePack() {
  const payload = [];
  const images = [];
  let offset = 0;
  for (let base = 0; base < 4; base++) {
    const steps = [];
    for (let step = 0; step < 7; step++) {
      const frames = [];
      for (let pulse = 0; pulse < 21; pulse++) {
        const png = fixturePng(50 + base, 80 + step, 120 + pulse);
        frames.push({ offset, bytes: png.length });
        payload.push(png);
        offset += png.length;
      }
      steps.push(frames);
    }
    images.push(steps);
  }
  const manifest = {
    schema: 'dc-favicon-pack-v1',
    variants: [{ id: '0', source_sha256: 'a'.repeat(64),
      width: 1, height: 1, images }]
  };
  const header = Buffer.from(JSON.stringify(canonical(manifest)));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return Buffer.concat([MAGIC, length, header, ...payload]);
}

function validatePack(pack, declared) {
  assert.ok(Buffer.isBuffer(pack));
  assert.ok(pack.length >= 12 && pack.length <= MAX_ASSET_BYTES);
  assert.equal(pack.subarray(0, 8).compare(MAGIC), 0);
  const headerLength = pack.readUInt32LE(8);
  assert.ok(headerLength > 0 && headerLength <= 64 * 1024 * 1024);
  assert.ok(12 + headerLength <= pack.length);
  const bytes = pack.subarray(12, 12 + headerLength);
  const manifest = JSON.parse(bytes.toString('utf8'));
  assert.equal(JSON.stringify(canonical(manifest)), bytes.toString('utf8'));
  assert.equal(manifest.schema, 'dc-favicon-pack-v1');
  assert.ok(Array.isArray(manifest.variants) && manifest.variants.length > 0);
  const payload = pack.subarray(12 + headerLength);
  const spans = [];
  const ids = new Set();
  for (const variant of manifest.variants) {
    assert.ok(!ids.has(variant.id));
    ids.add(variant.id);
    assert.match(variant.source_sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(variant.width) && variant.width > 0);
    assert.ok(Number.isSafeInteger(variant.height) && variant.height > 0);
    assert.equal(variant.images.length, 4);
    for (const steps of variant.images) {
      assert.equal(steps.length, 7);
      for (const frames of steps) {
        assert.equal(frames.length, 21);
        for (const frame of frames) {
          assert.ok(Number.isSafeInteger(frame.offset) && frame.offset >= 0);
          assert.ok(Number.isSafeInteger(frame.bytes) && frame.bytes >= 24);
          assert.ok(frame.offset + frame.bytes <= payload.length);
          const png = payload.subarray(frame.offset, frame.offset + frame.bytes);
          assert.equal(png.subarray(0, 8).compare(PNG_SIGNATURE), 0);
          assert.equal(png.toString('ascii', 12, 16), 'IHDR');
          assert.equal(png.readUInt32BE(16), variant.width);
          assert.equal(png.readUInt32BE(20), variant.height);
          spans.push(frame);
        }
      }
    }
  }
  spans.sort((a, b) => a.offset - b.offset);
  let end = 0;
  for (const span of spans) {
    assert.equal(span.offset, end, 'overlapping or uncovered PNG payload');
    end += span.bytes;
  }
  assert.equal(end, payload.length);
  if (declared) {
    assert.equal(pack.length, declared.bytes, 'declared pack byte count');
    assert.equal(sha256(pack), declared.sha256, 'immutable pack digest');
    assert.match(declared.commit, /^[0-9a-f]{40}$/);
    assert.ok(declared.path.startsWith('assets/favicons/'));
  }
  return { variants: manifest.variants.length,
    images: manifest.variants.length * FRAMES_PER_VARIANT,
    payloadBytes: payload.length, sha256: sha256(pack) };
}

test('V1 contract reference ' + CONTRACT_SHA + ' and 40-slot pulse', () => {
  assert.equal(pulseIndex(0), 0);
  assert.equal(pulseIndex(250), 1);
  assert.equal(pulseIndex(5000), 20);
  assert.equal(pulseIndex(9750), 1);
  assert.equal(pulseIndex(10000), 0);
  assert.equal(pulseIndex(-250), 1);
  assert.deepEqual(new Set(Array.from({length: 40}, (_, i) =>
    pulseIndex(i * 250))).size, 21);
  assert.throws(() => pulseIndex(Infinity));
});

test('V1 version ranges ignore issue suffix and choose numeric maximum', () => {
  const datasets = ['1.11.7', '1.12.0', '2.0.0'].map(version => ({
    version, update_every_ms: 250
  }));
  const catalogue = { schema: 'dc-favicon-catalogue-v1', datasets };
  assert.equal(chooseDataset(catalogue, '1.11.6'), null);
  assert.equal(chooseDataset(catalogue, '1.11.7-issue.999.1').version, '1.11.7');
  assert.equal(chooseDataset(catalogue, '1.11.7-issue.1.999').version, '1.11.7');
  assert.equal(chooseDataset(catalogue, '1.99.0').version, '1.12.0');
  assert.equal(chooseDataset(catalogue, '2.0.0').version, '2.0.0');
  assert.equal(chooseDataset(catalogue, 'invalid'), null);
  assert.throws(() => chooseDataset({ ...catalogue,
    datasets: [...datasets, {version: '1.11.7-issue.2.3', update_every_ms: 500}]
  }, '1.11.8'), /duplicate/);
});

test('synthetic pack covers every base/pie/pulse address exactly once', () => {
  const pack = fixturePack();
  const meta = { bytes: pack.length, sha256: sha256(pack),
    commit: 'b'.repeat(40), path: 'assets/favicons/v1/fixture.dcfav' };
  assert.deepEqual(validatePack(pack, meta), {
    variants: 1, images: 588, payloadBytes: validatePack(pack).payloadBytes,
    sha256: sha256(pack)
  });
});

test('synthetic pack corruption, digest, truncation and unsafe bounds reject', () => {
  const pack = fixturePack();
  const declared = { bytes: pack.length, sha256: sha256(pack),
    commit: 'b'.repeat(40), path: 'assets/favicons/v1/fixture.dcfav' };
  const corrupt = Buffer.from(pack);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => validatePack(corrupt, declared), /digest/);
  assert.throws(() => validatePack(pack.subarray(0, pack.length - 1)),
    /payload|bounds|byte count/);
  const badMagic = Buffer.from(pack);
  badMagic[0] = 0;
  assert.throws(() => validatePack(badMagic));
  const hugeHeader = Buffer.from(pack);
  hugeHeader.writeUInt32LE(0xffffffff, 8);
  assert.throws(() => validatePack(hugeHeader));
});

// Explicit external mode for genuine #333 bytes once upstream exists.
if (process.argv[2] === '--real-pack') {
  assert.equal(process.argv.length, 6,
    'Usage: node <this file> --real-pack <catalogue.json> <pack.dcfav> <DC version>');
  const catalogue = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const dataset = chooseDataset(catalogue, process.argv[5]);
  assert.ok(dataset, 'no compatible genuine dataset');
  const summary = validatePack(readFileSync(process.argv[4]), dataset.favicons);
  console.log(JSON.stringify({kind:'real-asset-static-integrity-only',
    contract: CONTRACT_SHA, selected: dataset.version, ...summary}));
}
