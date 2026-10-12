import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const html = readFileSync(
  new URL('./gen-browser-storage.bench.html', import.meta.url), 'utf8'
);
const chromeCandidates = [
  process.env.CHROME_BIN, '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const binary = chromeCandidates.find(candidate => {
  try {
    execFileSync(candidate, ['--version'], { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
});
assert.ok(binary, 'Chrome/Chromium binary required for hosted browser acceptance');
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html + '<script>document.getElementById("run").click()</script>');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const { stdout, stderr } = await exec(binary, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--virtual-time-budget=30000', '--dump-dom', url
  ], { timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
  const match = stdout.match(/<pre id="output">([\s\S]*?)<\/pre>/);
  assert.ok(match, 'Browser did not return benchmark output; stderr: ' + stderr.slice(-1000));
  const payload = match[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  assert.ok(!payload.startsWith('FAIL:'), payload);
  const report = JSON.parse(payload);
  assert.equal(report.records, 5000);
  assert.equal(report.trials, 12);
  assert.equal(report.results.length, 2);
  for (const result of report.results) {
    assert.equal(result.writeMs.length, 12);
    assert.equal(result.readParseMs.length, 12);
    assert.ok(result.writeMs.every(value => value >= 0));
    assert.ok(result.readParseMs.every(value => value >= 0));
  }
  console.log('GEN_BROWSER_STORAGE_JSON=' + JSON.stringify(report));
} finally {
  await new Promise(resolve => server.close(resolve));
}
