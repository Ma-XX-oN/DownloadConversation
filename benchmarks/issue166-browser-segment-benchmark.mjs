import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const userscript = readFileSync(path.join(root, 'chatgpt-conversation-markdown-export.user.js'), 'utf8');
const begin = userscript.indexOf('// BEGIN bundled direct XZ lzma-rust2=0.16.2');
const endMarker = '// END bundled direct XZ';
const end = userscript.indexOf(endMarker, begin);
const runtimeBegin = userscript.indexOf('  /** True after the embedded direct XZ Wasm codec has been initialized. */', end);
const runtimeEnd = userscript.indexOf(
  '  /**\n   * Installs host-isolation styling for native recorder checkboxes.',
  runtimeBegin
);
if (begin < 0 || end < 0 || runtimeBegin < 0 || runtimeEnd < 0) {
  throw new Error('Could not isolate the exact generated archive bridge.');
}
const prelude = userscript.slice(begin, end + endMarker.length);
const runtime = userscript.slice(runtimeBegin, runtimeEnd);
const candidates = process.platform === 'win32'
  ? ['chrome.exe']
  : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
let chrome = null;
for (const candidate of candidates) {
  try {
    chrome = execFileSync('which', [candidate], { encoding: 'utf8' }).trim();
    if (chrome) break;
  } catch {}
}
if (!chrome) throw new Error('Browser benchmark requires Chrome/Chromium.');

const benchmark = String.raw`
const benchmarkKeepAlive = setInterval(() => {}, 1000);
(async () => {
  const output = document.getElementById('output');
  await directXzModule();
  const mib = Number(location.hash.slice(1));
  const encoder = new TextEncoder();
  const template = encoder.encode(
    '{"timestamp":"2026-09-27T12:00:00.000Z","type":"response_chunk",' +
    '"text":"The quick brown fox jumps over the lazy dog 0123456789 repeated communication payload."}\\n'
  );
  const size = mib * 1024 * 1024;
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += template.length) {
    bytes.set(template.subarray(0, Math.min(template.length, size - offset)), offset);
  }
  const heapBefore = performance.memory?.usedJSHeapSize ?? null;
  const archive = await createXzArchive(bytes);
  const heapAfter = performance.memory?.usedJSHeapSize ?? null;
  const extracted = await extractXzArchive(archive);
  let exact = extracted.byteLength === bytes.byteLength;
  if (exact) {
    for (let index = 0; index < bytes.byteLength; index += 65537) {
      if (bytes[index] !== extracted[index]) { exact = false; break; }
    }
  }
  output.textContent = JSON.stringify({
    user_agent: navigator.userAgent,
    mib,
    input_bytes: bytes.byteLength,
    archive_bytes: archive.byteLength,
    compression_ratio: archive.byteLength / bytes.byteLength,
    js_heap_before: heapBefore,
    js_heap_after: heapAfter,
    exact_round_trip: exact
  });
  clearInterval(benchmarkKeepAlive);
})().catch(error => {
  clearInterval(benchmarkKeepAlive);
  document.getElementById('output').textContent = JSON.stringify({
    error: String(error),
    stack: error?.stack ?? null
  });
});
`;
const directory = mkdtempSync(path.join(tmpdir(), 'dc166-browser-benchmark-'));
const htmlPath = path.join(directory, 'benchmark.html');
const html = '<!doctype html><meta charset="utf-8"><pre id="output">RUNNING</pre><script>\n' +
  prelude + '\n' + runtime + '\n' + benchmark + '\n</script>';
writeFileSync(htmlPath, html);
const results = [];
let userAgent = null;
for (const mib of [10, 20, 40]) {
  let parsed = null;
  let wallMs = null;
  for (let attempt = 1; attempt <= 3 && parsed === null; attempt += 1) {
    const started = process.hrtime.bigint();
    const result = spawnSync(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--enable-precise-memory-info',
      '--virtual-time-budget=180000',
      '--dump-dom',
      new URL('file://' + htmlPath).href + '#' + mib
    ], {
      encoding: 'utf8',
      timeout: 240000,
      maxBuffer: 16 * 1024 * 1024
    });
    wallMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Browser benchmark failed (exit ${result.status}): ${result.stderr.slice(-4000)}`);
    }
    const match = result.stdout.match(new RegExp('<pre id="output">([\\s\\S]*?)</pre>'));
    if (!match) throw new Error('Browser benchmark did not produce a result element.');
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    if (decoded === 'RUNNING') {
      if (attempt === 3) {
        throw new Error(`Browser benchmark remained RUNNING after ${attempt} independent browser processes.`);
      }
      continue;
    }
    parsed = JSON.parse(decoded);
  }
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.exact_round_trip) throw new Error('Browser benchmark archive round-trip verification failed.');
  userAgent ??= parsed.user_agent;
  delete parsed.user_agent;
  parsed.browser_end_to_end_wall_ms = wallMs;
  results.push(parsed);
}
console.log(JSON.stringify({ user_agent: userAgent, results }, null, 2));
