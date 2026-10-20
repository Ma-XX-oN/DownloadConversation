import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

/** Browser HTML witness: prod-0501e92072076c1fc18a4b57ff5e37c15d00546f. */
const URLS = [
  'https://chatgpt.com/favicon.ico',
  'https://chatgpt.com/cdn/assets/favicon-eex17e9e.ico',
  'https://chatgpt.com/cdn/assets/favicon-l4nq08hd.svg',
  'https://chatgpt.com/cdn/assets/favicon-48x48-glnpepm0.webp'
];

test('probe independently observed favicon URLs without asserting equality', async () => {
  let checked = 0;
  for (const url of URLS) {
    try {
      const result = await fetch(url, { signal: AbortSignal.timeout(12000) });
      assert(result.ok, 'HTTP ' + result.status);
      const body = Buffer.from(await result.arrayBuffer());
      assert(body.length > 0 && body.length < 2 * 1024 * 1024,
        'Source byte bounds');
      const sha = createHash('sha256').update(body).digest('hex');
      console.log('DC333_CANDIDATE=' + JSON.stringify({
        url, bytes: body.length, sha256: sha,
        contentType: result.headers.get('content-type'),
        finalUrl: result.url
      }));
      checked++;
    } catch (error) {
      console.log('DC333_CANDIDATE_UNAVAILABLE=' +
        JSON.stringify({url, error:error.message}));
    }
  }
  assert(checked > 0, 'All observed candidate URLs were unavailable');
});
