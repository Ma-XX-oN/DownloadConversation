import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { generatePack } from '../scripts/generate-favicon-packs.mjs';
import { sha256, validatePack, selectDataset, canonicalJson } from '../scripts/favicon-pack-format.mjs';

const EXPECTED_SHA256 = '26512d41c8d181ac53dcedf91d59739b1dfd79c5372f9e96ba6b2993bcafc100';
const EXPECTED_BYTES = 10620388;
const PACK_PATH = new URL('../assets/favicons/v1/chatgpt-v1.dcfav', import.meta.url);
const CATALOGUE_PATH = new URL('../assets/favicons/catalogue.json', import.meta.url);
const PINNED_COMMIT = 'b9c123d1f178fe57bb3515ed1244b0d5e3fb9c83';
const PINNED_BLOB = 'e365d482e10b9e5cb3b29673b4ff5f1c399e3741';

test('pinned real ICO/SVG/WebP produce all 1764 indexed PNGs with byte-distinct pulses', () => {
  const pack = generatePack();
  assert.equal(pack.length, EXPECTED_BYTES, 'Unexpected canonical pack size');
  assert.equal(sha256(pack), EXPECTED_SHA256,
    'Canonical PNG producer changed from exact hosted baseline');
  const manifest = validatePack(pack);
  assert.equal(manifest.variants.length, 3);
  for (const variant of manifest.variants) {
    assert.equal(variant.images.length, 4);
    for (const state of variant.images) {
      assert.equal(state.length, 7);
      for (const pulses of state) {
        assert.equal(pulses.length, 21);
        const distinct = new Set(pulses.map(frame =>
          sha256(pack.subarray(12 + pack.readUInt32LE(8) + frame.offset,
            12 + pack.readUInt32LE(8) + frame.offset + frame.bytes))));
        assert.equal(distinct.size, 21, 'Pulse frames must have distinct pixels');
      }
    }
  }
  assert(readFileSync(PACK_PATH).equals(pack),
    'Committed binary pack differs from canonical deterministic regeneration');
  console.log('DC333_CANONICAL_PACK_SHA256=' + EXPECTED_SHA256);
  console.log('DC333_CANONICAL_PACK_BYTES=' + EXPECTED_BYTES);
  console.log('DC333_REAL_VARIANTS=' + manifest.variants.length);
});

test('published catalogue pins immutable original Git commit containing exact pack bytes', () => {
  const pack = readFileSync(PACK_PATH);
  const catalogueRaw = readFileSync(CATALOGUE_PATH, 'utf8');
  const catalogue = JSON.parse(catalogueRaw);
  assert.equal(catalogueRaw, canonicalJson(catalogue) + '\n',
    'Catalogue must be canonical JSON followed by a single LF');
  assert.equal(catalogue.schema, 'dc-favicon-catalogue-v1');
  assert.equal(catalogue.datasets.length, 1, 'Initial catalogue must have one boundary');
  const entry = catalogue.datasets[0];
  assert.equal(entry.version, '1.11.8');
  assert.equal(entry.update_every_ms, 250);
  assert.deepEqual(entry.favicons, {
    commit: PINNED_COMMIT,
    path: 'assets/favicons/v1/chatgpt-v1.dcfav',
    bytes: EXPECTED_BYTES,
    sha256: EXPECTED_SHA256
  });
  assert.equal(selectDataset(catalogue, '1.11.7'), null);
  for (const version of [
    '1.11.8',
    '1.11.8-issue.1.999',
    '1.11.8-issue.999.1',
    '1.11.10-issue.333.14',
    '2.0.0'
  ]) assert.equal(selectDataset(catalogue, version)?.version, '1.11.8');
  const localGitBlob = createHash('sha1')
    .update(Buffer.from('blob ' + pack.length + '\0'))
    .update(pack).digest('hex');
  assert.equal(localGitBlob, PINNED_BLOB, 'Local Git blob identity changed');
  const repoRoot = new URL('../', import.meta.url);
  const revision = execFileSync('git', [
    'rev-parse', PINNED_COMMIT + ':assets/favicons/v1/chatgpt-v1.dcfav'
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 15000 }).trim();
  assert.equal(revision, PINNED_BLOB, 'Declared immutable revision lacks matching Git blob');
});
