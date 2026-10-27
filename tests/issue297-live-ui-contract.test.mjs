import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../src/userscript/' + path,
  import.meta.url), 'utf8');
const menu = read('06-image-export-tests/04-tests-modal-transition.js');
const witness = read('06-image-export-tests/07-issue127-queued-witness.js');
const observer = read('06-image-export-tests/07a-issue127-queued-witness.js');
const modal = read('06-image-export-tests/05-modal-contract.js');

test('live witness requires current registered plugin, not legacy catalogue', () => {
  assert.match(observer, /core\.getVersion\(\) === '1\.1\.1'/);
  assert.match(observer, /core\.getAgentPlugin\('chatgpt-web'\)/);
  assert.match(observer, /identity\.version === '0\.1\.2-issue\.11\.6'/);
  assert.match(observer, /chatGPTSubjectHost\[key\]/);
  assert.doesNotMatch(observer, /getAgentPluginArtifact\(/);
  assert.doesNotMatch(observer, /1\.1\.0-issue\.127|0\.1\.0-issue\.1\.29/);
  assert.match(witness, /629c86284b7db5fb412bb083178eaee8c06f796c/);
  assert.match(witness, /fad4a74c4bbe410f7f71aa06f69b9ed8ec8ffcb8/);
  assert.match(witness, /3d0203dacc02764e3d560993908d4d5c372a630b/);
  assert.match(observer, /provider_identity_attestation: 'runtime-version-only'/);
  assert.match(observer, /source_sha: AICC127_SOURCE_SHA, source_version: VERSION/);
  assert.match(witness, /AICC127_SOURCE_SHA = null/);
});
test('Test button has all eight opt-in witness operations exactly once', () => {
  for (const label of [
    'staged registered host', 'verified project identity',
    'standalone gizmo null', 'zero-network A-B-A',
    'stale response safety', 'reload and rebind',
    'recording group 1', 'export evidence'
  ]) {
    assert.equal(menu.split("['AICC #127 " + label + "'").length - 1, 1, label);
  }
  assert.match(menu, /aicc127ExportEvidence, 'Action'/);
  assert.match(menu, /type !== 'Visual' && type !== 'Action'/);
});
test('actual Test runner treats INCOMPLETE as INCOMPLETE, not PASS', async () => {
  assert.match(menu, /value === 'INCOMPLETE'/);
  assert.match(menu, /result\.status === 'INCOMPLETE'/);
  const block = menu.match(/async function executeBuiltInTest\(name, fn\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(block, 'real runner extracted');
  const states = new Map();
  const realm = vm.createContext({
    testMatrixCurrentResults: states,
    saveTestResultHistory() {}, refreshTestMatrix() {},
    errorMessage: e => String(e?.message || e)
  });
  vm.runInContext(block + '\nglobalThis.run = executeBuiltInTest;', realm);
  const pending = await realm.run('pending', async () => ({
    status: 'INCOMPLETE', detail: 'needs real backend'
  }));
  const failed = await realm.run('failed', async () => {
    throw Error('backend identity mismatched');
  });
  const passed = await realm.run('passed', async () => {});
  assert.equal(states.get('pending').status, 'INCOMPLETE');
  assert.match(pending, /INCOMPLETE|pending/);
  assert.equal(states.get('failed').status, 'FAIL');
  assert.match(failed, /failed/);
  assert.equal(states.get('passed').status, 'PASS');
  assert.match(passed, /passed/);
});
test('evidence cannot be exported without a real armed witness', () => {
  assert.match(observer, /if \(!s\) throw new Error\('Arm AICC #127 before exporting evidence/);
});

test('evidence action appears as Export, never as an automatic Run All item', () => {
  assert.match(modal, /type === 'Action' \? 'Action' : 'Automatic'/);
  assert.match(modal, /type === 'Action' \? 'Export' : 'Run'/);
  assert.match(menu, /type !== 'Visual' && type !== 'Action'/);
  assert.match(modal, /else if \(test\) void runOneTest\(test\[0\], test\[1\]\)/);
});
