import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePack } from '../scripts/generate-favicon-packs.mjs';
import { sha256, validatePack } from '../scripts/favicon-pack-format.mjs';

test('actual pinned ICO, SVG and WebP are reproducible as complete V1 pack', () => {
  const pack = generatePack();
  const manifest = validatePack(pack);
  assert.equal(manifest.variants.length, 3, 'Every pinned stock resource must have 588 frames');
  assert(manifest.variants.every(v =>
    v.images.length === 4 && v.images.every(steps =>
      steps.length === 7 && steps.every(frames => frames.length === 21))
  ));
  console.log('DC333_PACK_SHA256=' + sha256(pack));
  console.log('DC333_PACK_BYTES=' + pack.length);
  console.log('DC333_PACK_VARIANTS=' + manifest.variants.length);
  const encoded = pack.toString('base64');
  for (let offset = 0; offset < encoded.length; offset += 8192) {
    console.log('DC333_PACK_CHUNK_' + String(offset / 8192).padStart(5, '0') +
      '=' + encoded.slice(offset, offset + 8192));
  }
  console.log('DC333_PACK_COMPLETE=' + Math.ceil(encoded.length / 8192));
});
