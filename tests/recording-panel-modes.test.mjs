import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../src/userscript/', import.meta.url);
const panel = readFileSync(new URL('07-panel-launcher/04-launcher-removal.js', root), 'utf8');
const diagnostics = readFileSync(new URL('07-panel-launcher/01-panel-diagnostics.js', root), 'utf8');
const communication = readFileSync(new URL('02-network-communication/06-communication-files.js', root), 'utf8');

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
