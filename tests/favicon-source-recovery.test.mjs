import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

/** Immutable official 48-pixel favicon name; mirror is a byte-identical backup. */
const URLS = [
  'https://chatgpt.com/cdn/assets/favicon-48x48-glnpepm0.webp',
  'https://raw.githubusercontent.com/lingcang728/ZeppBridge/927c83ee30c3e22823b0810c89d9889d58fdb815/src/assets/ai/chatgpt.webp'
];
/** Independently documented SHA-256 from the publisher's archived asset. */
const SHA256 = '3481f245b6d560f855e49a16fc66ee7fdec2dee4115949179b113839149a9649';

/** Read one pinned, public resource with a bounded response size.
 * @param {string} url - Exact source URL.
 * @returns {Promise<Buffer>} Response bytes.
 */
async function fetchAsset(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  assert(response.ok, 'Source HTTP ' + response.status);
  const data = Buffer.from(await response.arrayBuffer());
  assert(data.length > 0 && data.length <= 2 * 1024 * 1024,
    'Source byte count bound');
  return data;
}

test('recover authentic ChatGPT WebP bytes through independently pinned archive', async () => {
  let verified = null, usedUrl = null, errors = [];
  for (const url of URLS) {
    try {
      const data = await fetchAsset(url);
      const digest = createHash('sha256').update(data).digest('hex');
      assert.equal(digest, SHA256, 'Source integrity digest mismatch');
      assert.equal(data.toString('ascii', 0, 4), 'RIFF');
      assert.equal(data.toString('ascii', 8, 12), 'WEBP');
      verified = data;
      usedUrl = url;
      break;
    } catch (error) {
      errors.push(url + ': ' + error.message);
    }
  }
  assert(verified !== null, 'Both pinned source URLs unavailable: ' +
    errors.join(' | '));
  console.log('DC333_WEBP_SOURCE_URL=' + usedUrl);
  console.log('DC333_WEBP_SHA256=' + SHA256);
  console.log('DC333_WEBP_BYTES=' + verified.length);
  console.log('DC333_WEBP_BASE64=' + verified.toString('base64'));
});
