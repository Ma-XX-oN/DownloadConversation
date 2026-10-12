import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadConversationSource } from './helpers/userscript-source.mjs';

// Test the production concatenation, not incidental source-file boundaries.
const panel = downloadConversationSource;
const diagnostics = downloadConversationSource;
const communication = downloadConversationSource;

test('panel places Gen, Comm, Con and 1 together with the established console switch', () => {
  assert.match(panel, /tm-recording-modes/);
  for (const name of ['record-general', 'record-communication',
    'console-diagnostics', 'record-one-group']) {
    assert.match(panel, new RegExp('data-role="' + name + '"'));
  }
  assert.match(panel, /oneGroup\.checked = recordingGroupState\(\)\.enabled/);
  assert.match(panel, /recordingGroupEnable\(\)/);
  assert.match(panel, /recordingGroupDisable\(\)/);
});

test('Gen toggle gates retained diagnostics, without changing DevTools console gate', () => {
  const fn = diagnostics.slice(diagnostics.indexOf('  function logDiagnostic(level,'),
    diagnostics.indexOf('  function injectStyles()'));
  assert.match(fn, /logConsoleDiagnostic\(level,/);
  assert.match(fn, /tm-recorder-general-capture/);
  assert.ok(fn.indexOf('logConsoleDiagnostic(level,')
    < fn.indexOf('tm-recorder-general-capture'));
  assert.ok(fn.indexOf('tm-recorder-general-capture')
    < fn.indexOf('diagnosticLog.push(entry)'));
});

test('Comm toggle gates stored communication records before storage append', () => {
  const start = communication.indexOf('  async function communicationLogRecord(type,');
  const end = communication.indexOf('  async function communicationLogAwaitReady()', start);
  assert.ok(start >= 0 && end > start);
  const fn = communication.slice(start, end);
  assert.match(fn, /tm-recorder-communication-capture/);
  assert.ok(fn.indexOf('tm-recorder-communication-capture')
    < fn.indexOf('communicationLogStorage.appendRecord(record)'));
});

test('most recent retained diagnostic warning or error is visible separately', () => {
  assert.match(panel, /data-role="last-log-problem"/);
  assert.match(diagnostics, /diagnosticLog\.findLast\(entry/);
  assert.match(diagnostics, /problem\.level/);
});


test('every directly bound panel control exists in the actual panel markup', () => {
  const start = panel.indexOf('  function makePanel() {');
  const markupStart = panel.indexOf('panel.innerHTML = `', start);
  const markupEnd = panel.indexOf('`;', markupStart);
  const panelHtml = panel.slice(markupStart, markupEnd);
  assert.ok(start >= 0 && markupStart > start && markupEnd > markupStart);
  const bindingSource = panel.slice(markupEnd, panel.indexOf('\n  function ', markupEnd));
  const selectors = [...bindingSource.matchAll(
    /panel\.querySelector\('\[data-role="([^"]+)"\]'\)\.addEventListener\(/g
  )].map(match => match[1]);
  assert.ok(selectors.includes('test'), 'Test handler must be covered');
  for (const role of selectors) {
    assert.match(panelHtml, new RegExp('data-role="' + role + '"'),
      'Missing required panel event target: ' + role);
  }
  assert.match(panelHtml, /data-role="test" type="button" aria-label="Run tests"/);
});

test('recorder panel follows the exact requested control order', () => {
  const start = panel.indexOf('panel.innerHTML = \`', panel.indexOf('  function makePanel() {'));
  const end = panel.indexOf('\`;', start);
  const html = panel.slice(start, end);
  assert.ok(end > start);
  const roles = [
    'title', 'log-count', 'last-log-problem', 'diagnostics',
    'communication-log-name', 'rename-communication-log',
    'record-general', 'record-communication', 'console-diagnostics',
    'record-one-group', 'save-log', 'reset-communication-log',
    'show-timestamps', 'show-record-numbers', 'show-turn-ids',
    'show-debug-provenance', 'format-jsonl', 'format-md',
    'extract', 'export-compression', 'agent-sound-control', 'jump', 'test'
  ];
  let previous = -1;
  for (const role of roles) {
    const index = html.indexOf('data-role="' + role + '"');
    assert.ok(index > previous, role + ' must appear in requested order');
    previous = index;
  }
  for (const obsolete of ['copy-log', 'toggle-log', 'screen-on',
    'duplicate-communication-log']) {
    assert.doesNotMatch(html, new RegExp('data-role="' + obsolete + '"'));
  }
  assert.match(html, /tm-recording-section/);
  assert.match(html, /tm-export-section/);
  assert.match(html, /tm-tool-actions/);
  assert.match(html, /aria-label="Jump to entry"/);
  assert.match(html, /aria-label="Run tests"/);
});

test('the volume markers and user-specified icons are explicitly styled', () => {
  assert.match(panel, /tm-sound-volume-slider::-webkit-slider-runnable-track/);
  assert.match(panel, /tm-sound-volume-slider::-webkit-slider-thumb/);
  assert.match(panel, /background:#b2d8ff/);
  assert.match(panel, /const radius = compressed \? 4 : 8/);
  assert.match(panel, /extract.innerHTML = exportInProgress \? '…' : exportArrowIconMarkup\(\)/);
  assert.match(panel, /\.tm-export-action\{display:grid;place-items:center/);
  assert.match(panel, /function exportArrowIconMarkup\(\)/);
  assert.match(panel, /test.textContent = testInProgress \? '…' : '🧪'/);
  assert.match(panel, /jump.textContent = jumpInProgress \? '…' : '🪂'/);
});

test('export format settings and compression are persistent with independent defaults', () => {
  assert.match(panel, /EXPORT_JSONL_STORAGE_KEY = 'tm-conversation-recorder-export-jsonl'/);
  assert.match(panel, /EXPORT_MD_STORAGE_KEY = 'tm-conversation-recorder-export-md'/);
  assert.match(panel, /EXPORT_COMPRESSION_STORAGE_KEY = 'tm-conversation-recorder-export-compressed'/);
  assert.match(panel, /exportCompressionEnabled = localStorage\.getItem\(EXPORT_COMPRESSION_STORAGE_KEY\) === 'true'/);
  assert.match(panel, /\['format-jsonl', EXPORT_JSONL_STORAGE_KEY, false\]/);
  assert.match(panel, /\['format-md', EXPORT_MD_STORAGE_KEY, true\]/);
  assert.match(panel, /input\.checked = stored === null \? fallback : stored === 'true'/);
  assert.match(panel, /localStorage\.setItem\(key, String\(input\.checked\)\)/);
  assert.match(panel, /localStorage\.setItem\(EXPORT_COMPRESSION_STORAGE_KEY, String\(exportCompressionEnabled\)\)/);
});
