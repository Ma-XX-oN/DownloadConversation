import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../src/userscript/03-agent-lifecycle/03-favicon-cache-v2.js', import.meta.url), 'utf8'
);

function harness() {
  const context = { Blob, AbortController, navigator: { locks: {} }, console };
  vm.runInNewContext(`${source}\nthis.api = {
    configure: faviconCacheV2Configure,
    resolve: get_compatible_version_key,
    key: faviconSequenceKey,
    supported: faviconSequenceSupported,
    open: open_favicon_dataset
  };`, context);
  return context.api;
}

test('V2 sequence provider is present and independent of V1 downloader', () => {
  assert.match(source, /class FaviconDatasetSession/);
  assert.match(source, /faviconSequenceEnsure/);
  assert.doesNotMatch(source, /GM_xmlhttpRequest|dcfav|faviconCacheFetch|dc-favicon-catalogue-v1/);
  assert.match(source, /FAVICON_SEQUENCE_TTL_MS = 600000/);
});

test('numeric version range ignores all issue suffix values completely', async () => {
  const api = harness();
  api.configure([
    { version: '1.11.8', update_every_ms: 250 },
    { version: '1.9.10', update_every_ms: 125 },
    { version: '1.12.0', update_every_ms: 300 }
  ]);
  assert.equal(await api.resolve('1.11.8-issue.9.999'), '1.11.8');
  assert.equal(await api.resolve('1.11.8-issue.334.3'), '1.11.8');
  assert.equal(await api.resolve('1.12.0-issue.0.0'), '1.12.0');
  assert.equal(await api.resolve('1.10.0'), '1.9.10');
  assert.equal(await api.resolve('1.8.99'), null);
  assert.equal(await api.resolve('1.11.8.4'), null);
  assert.equal(await api.resolve('1.11.8-other.test'), '1.11.8');
});

test('duplicates normalized across issue suffix are rejected', () => {
  const api = harness();
  assert.throws(() => api.configure([
    { version: '1.11.8-issue.1.0', update_every_ms: 250 },
    { version: '1.11.8-issue.2.0', update_every_ms: 250 }
  ]), /v2-boundary/);
});

test('configuration replacement clears stale version selection', async () => {
  const api = harness();
  api.configure([{ version: '1.11.8', update_every_ms: 250 }]);
  assert.equal(await api.resolve('1.13.0'), '1.11.8');
  api.configure([{ version: '1.12.0', update_every_ms: 100 }]);
  assert.equal(await api.resolve('1.13.0'), '1.12.0');
});

test('sequence key separates exact URL, theme, version, base and progress', async () => {
  const api = harness();
  api.configure([{ version: '1.11.8', update_every_ms: 250 }]);
  const key = (...values) => api.key(...values);
  const original = key('1.11.8', 'https://chatgpt.com/favicon.svg', 'light', 0, 0);
  assert.equal(JSON.parse(original).length, 5);
  assert.notEqual(original, key('1.11.8', 'https://chatgpt.com/favicon.svg', 'dark', 0, 0));
  assert.notEqual(original, key('1.11.8', 'https://chatgpt.com/favicon2.svg', 'light', 0, 0));
  assert.notEqual(original, key('1.11.8', 'https://chatgpt.com/favicon.svg', 'light', 1, 0));
  assert.notEqual(original, key('1.11.8', 'https://chatgpt.com/favicon.svg', 'light', 0, 1));
  assert.equal(key('1.11.8', '', 'light', 0, 0), null);
  assert.equal(key('1.11.8', 'https://chatgpt.com/favicon.svg', 'unknown', 0, 0), null);
  assert.equal(key('1.11.8', 'https://chatgpt.com/favicon.svg', 'light', 0, 7), null);
  assert.equal(key('1.11.8', 'https://chatgpt.com/favicon.svg', 'light', 4, 0), null);
});

test('pulse frame index cannot influence generation lock identity', () => {
  assert.match(source, /FAVICON_SEQUENCE_LOCK \+ 'seq:' \+ key\.id/);
  assert.doesNotMatch(source, /FAVICON_SEQUENCE_LOCK \+ 'seq:' \+ key\.pulse_index/);
});

test('fails closed when Web Locks or IndexedDB are absent', async () => {
  const api = harness();
  api.configure([{ version: '1.11.8', update_every_ms: 250 }]);
  assert.equal(api.supported(), false);
  assert.equal(await api.open('1.11.8', async () => []), null);
  assert.equal(await api.open('2.0.0', async () => []), null);
});

test('21 Blob frames and ready marker share one atomic transaction', () => {
  assert.match(source, /for \(let pulse_index = 0; pulse_index < 21; pulse_index\+\+\)/);
  assert.match(source, /\['sequences', 'pngs'\], 'readwrite'/);
  assert.match(source, /ready: true, count: 21/);
  assert.match(source, /await faviconSequenceValidate\(frames, signal\)/);
});