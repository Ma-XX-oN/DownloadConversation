import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cssModule = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/01-panel-diagnostics-part2.js',
  import.meta.url), 'utf8');
const markupModule = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/04-launcher-removal.js',
  import.meta.url), 'utf8');
const start = cssModule.indexOf('style.textContent = `');
const end = cssModule.indexOf('`;\n    (document.head', start);
assert.ok(start >= 0 && end > start, 'Could not locate production CSS template');
const css = new Function('PANEL_ID', 'LAUNCHER_ID', 'TEST_MATRIX_ID',
  'return `' + cssModule.slice(start + 'style.textContent = `'.length, end) + '`;')(
  'dc-panel', 'dc-launcher', 'dc-tests');
const mark = markupModule.indexOf('panel.innerHTML = `');
const markEnd = markupModule.indexOf('`;', mark);
assert.ok(mark >= 0 && markEnd > mark);
const html = markupModule.slice(mark + 'panel.innerHTML = `'.length, markEnd);

function run(width, height) {
  const doc = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<div id="dc-panel" style="display:block">${html}</div>
<pre id="layout-result">PENDING</pre>
<script>
const panel = document.getElementById('dc-panel');
panel.querySelector('[data-role="title"]').textContent =
  'ChatGPT Recorder v1.11.4-issue.220.16';
panel.querySelector('[data-role="log-count"]').textContent = 'Log: 5199 items';
panel.querySelector('[data-role="last-log-problem"]').hidden = false;
panel.querySelector('[data-role="last-log-problem"]').textContent =
  'warnings: communication-log-response-body-incomplete after repeated requests and retries';
panel.querySelector('[data-role="status"]').textContent =
  'segment_2026,10,11;22,31,25-2026,10,11;22,31,26.seg.zst verified; recording continues';
panel.querySelector('[data-role="communication-log-name"]').textContent =
  'DownloadConversation_' + 'LongConversationName_'.repeat(14) + '.comm.zst';
const box = element => element.getBoundingClientRect();
const result = { width: innerWidth, height: innerHeight,
  panel: {left:box(panel).left,right:box(panel).right,top:box(panel).top,
    bottom:box(panel).bottom,height:box(panel).height},
  overflow: panel.scrollHeight > panel.clientHeight,
  issues: [] };
const background = getComputedStyle(panel).backgroundColor;
if (background !== 'rgb(24, 24, 24)') {
  result.issues.push('popup background is translucent: ' + background);
}
const bounds = box(panel);
if (bounds.left < -1 || bounds.right > innerWidth + 1 ||
    bounds.top < -1 || bounds.bottom > innerHeight + 1) {
  result.issues.push('panel outside viewport');
}
const title = panel.querySelector('[data-role="title"]');
if (box(title).height > 30) result.issues.push('title wraps');
for (const role of ['last-log-problem', 'status']) {
  const el = panel.querySelector('[data-role="' + role + '"]');
  if (box(el).height > 24) result.issues.push(role + ' uses multiple rows');
}
for (const role of ['record-general','record-communication','console-diagnostics',
  'record-one-group','diagnostics','rename-communication-log',
  'duplicate-communication-log','reset-communication-log',
  'jump','test','extract']) {
  if (!panel.querySelector('[data-role="' + role + '"]')) {
    result.issues.push('missing ' + role);
  }
}
const filename = box(panel.querySelector('[data-role="communication-log-name-viewport"]'));
const rename = box(panel.querySelector('[data-role="rename-communication-log"]'));
if (filename.right > rename.left + 1 || filename.width < 24) {
  result.issues.push('filename overlaps action buttons');
}
const rows = [...panel.querySelectorAll('.tm-row')];
const warning = box(panel.querySelector('[data-role="last-log-problem"]'));
const status = box(panel.querySelector('[data-role="status"]'));
if (status.top < warning.bottom - 1) result.issues.push('warning/status overlap');
for (let i = 1; i < rows.length; i++) {
  if (box(rows[i]).top < box(rows[i - 1]).bottom - 1) {
    result.issues.push('vertically overlapping rows ' + i);
  }
}
const output = document.getElementById('layout-result');
output.textContent = JSON.stringify(result);
<\/script>`;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dc-popup-layout-'));
  try {
    const file = path.join(dir, 'index.html');
    writeFileSync(file, doc, 'utf8');
    const candidates = process.platform === 'win32'
      ? ['chrome.exe'] : ['google-chrome', 'chromium', 'chromium-browser'];
    const binary = candidates.find(name => {
      const check = spawnSync(process.platform === 'win32' ? 'where' : 'which',
        [name], { encoding: 'utf8' });
      return check.status === 0;
    });
    assert.ok(binary, 'Headless Chromium required for UI acceptance test');
    const chrome = spawnSync(binary,
      ['--headless=new','--no-sandbox','--disable-gpu',
        '--disable-dev-shm-usage','--no-first-run',
        '--window-size=' + width + ',' + height,
        '--user-data-dir=' + path.join(dir, 'profile'),
        '--dump-dom', 'file://' + file],
      { encoding:'utf8', timeout:25000, maxBuffer:4*1024*1024 });
    assert.equal(chrome.status, 0, String(chrome.stderr).slice(-2000));
    const match = chrome.stdout.match(/<pre id="layout-result">([^<]+)<\/pre>/);
    assert.ok(match && match[1] !== 'PENDING', 'Browser layout did not execute');
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const [width, height] of [[430, 800], [800, 600], [900, 450]]) {
  test('real Chromium popup layout is contained at ' + width + 'x' + height,
    { timeout: 35000 }, () => {
      const result = run(width, height);
      assert.deepEqual(result.issues, [], JSON.stringify(result));
      assert.ok(result.panel.height > 100);
    });
}
