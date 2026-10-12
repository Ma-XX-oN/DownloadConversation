import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/userscript/07-panel-launcher/01-extract-logs-dialog.js', import.meta.url),
  'utf8'
);

test('extract logs uses the already implemented second-precision date control', () => {
  assert.match(source, /injectSingleDateTimeControlStyles\(\)/);
  assert.match(source, /createSingleDateTimeControl\(\{/g);
  assert.match(source, /installModalContract\(overlay/);
  assert.match(source, /\.setMilliseconds\(999\)/);
  assert.match(source, /\.setMilliseconds\(0\)/);
});

test('main panel source switches are only defaults for modal choices', () => {
  assert.match(source, /querySelector\('\[data-role="record-general"\]'\)/);
  assert.match(source, /querySelector\('\[data-role="record-communication"\]'\)/);
  assert.match(source, /gen\.checked = selectedGen/);
  assert.match(source, /comm\.checked = selectedComm/);
  assert.doesNotMatch(source, /localStorage\.setItem/);
});

test('save requires chronological bounds and at least one selected log', () => {
  assert.match(source, /const selected = gen\.checked \|\| comm\.checked/);
  assert.match(source, /save\.disabled = !chronological \|\| !selected/);
  assert.match(source, /start_timestamp: from\.toISOString\(\)/);
  assert.match(source, /end_timestamp: to\.toISOString\(\)/);
});

test('cancel, escape and modal dismissal preserve original extraction settings', () => {
  assert.match(source, /cancel\.addEventListener\('click', \(\) => finish\(null\)\)/);
  assert.match(source, /onClose: \(\) => finish\(null, false\)/);
  assert.match(source, /previousFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /if \(settled\) return/);
});
