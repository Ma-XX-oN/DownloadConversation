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
  assert.match(panelHtml, /<button data-role="test" type="button">Test<\/button>/);
});
