import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const artifact = fs.readFileSync('chatgpt-conversation-markdown-export.user.js', 'utf8');
const restore = fs.readFileSync('src/userscript/01-runtime/01-bootstrap-restore.js', 'utf8');
const startup = fs.readFileSync('src/userscript/07-panel-launcher/05-bootstrap.js', 'utf8');

test('startup transition runs after capture-order declarations', () => {
  const event = "logDiagnostic('lifecycle', 'dc-version-transition', { version: VERSION });";
  assert.equal(artifact.split(event).length - 1, 1, 'exactly one event per startup');
  assert.equal(restore.includes(event), false, 'restore must not log before capture state');
  assert.equal(startup.split(event).length - 1, 1);
  const epoch = artifact.indexOf('const logCaptureEpoch =');
  const seq = artifact.indexOf('let logCaptureSequence = 0;');
  const state = artifact.indexOf('function recordingGroupState(');
  const invocation = artifact.indexOf(event);
  assert.ok(epoch >= 0 && seq > epoch && invocation > seq);
  assert.ok(state >= 0 && invocation > state);
});

test('capture position can execute before lifecycle version event without TDZ', () => {
  const capture = fs.readFileSync(
    'src/userscript/07-panel-launcher/01-merged-log-extraction.js', 'utf8');
  const positionEnd = capture.indexOf('  /**\n   * Validates exact timestamp');
  assert.ok(positionEnd > 0);
  const positionSource = capture.slice(0, positionEnd);
  const context = {
    sessionStorage: {
      value: null,
      getItem() { return this.value; },
      setItem(_key, value) { this.value = value; }
    },
    recordingGroupInstanceId: 'test-tab'
  };
  vm.runInNewContext(positionSource
    + '\nthis.capture = logCapturePosition;', context);
  const one = context.capture();
  const two = context.capture();
  assert.equal(one.epoch, 1);
  assert.equal(one.ordinal, 1);
  assert.equal(two.ordinal, 2);
});
