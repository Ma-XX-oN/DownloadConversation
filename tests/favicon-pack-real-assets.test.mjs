import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { generatePack } from '../scripts/generate-favicon-packs.mjs';
import { sha256, validatePack } from '../scripts/favicon-pack-format.mjs';

const EXPECTED_SHA256 = '26512d41c8d181ac53dcedf91d59739b1dfd79c5372f9e96ba6b2993bcafc100';
const EXPECTED_BYTES = 10620388;
const PACK_PATH = new URL('../assets/favicons/v1/chatgpt-v1.dcfav', import.meta.url);

test('pinned real ICO/SVG/WebP produce all 1764 pixel-distinct pulses', () => {
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
  if (existsSync(PACK_PATH)) {
    assert(readFileSync(PACK_PATH).equals(pack),
      'Committed binary pack differs from canonical deterministic regeneration');
  }
  console.log('DC333_CANONICAL_PACK_SHA256=' + EXPECTED_SHA256);
  console.log('DC333_CANONICAL_PACK_BYTES=' + EXPECTED_BYTES);
  console.log('DC333_REAL_VARIANTS=' + manifest.variants.length);
});
