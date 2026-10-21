import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prefix = 'src/userscript/02-network-communication/04-csc-comm-worker-processing';
const read = name => readFileSync(path.join(root, name), 'utf8');
const code = read(prefix + '.js') + read(prefix + '-part2.js') +
  read(prefix + '-part3.js');
const generation = '00112233445566778899aabbccddeeff';
const makeEvent = (extra = {}) => ({
  type: 'hmac-key-cycle', id: 'hmac-key-cycle:1:' + generation,
  generation, epoch: 1, occurred_at_ms: 10000, reason: 'initial', ...extra
});
function harness(initialFailure = false) {
  const reports = [], frames = [], listeners = [];
  let writingFails = initialFailure;
  const context = vm.createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    DataView, URL, Map, Set, crypto: webcrypto, atob, btoa
  });
  vm.runInContext(code + '\nglobalThis.factory = cscCommWorkerProcessing;',
    context);
  context.factory({
    postMessage(x) { reports.push(x); },
    addEventListener(_type, cb) { listeners.push(cb); }
  }, { async write(bytes) {
    if (writingFails) throw new Error('PRIVATE-ERROR');
    frames.push(JSON.parse(new TextDecoder().decode(bytes)));
  } });
  const send = item => listeners[0]({data: {
    type: 'csc-comm-key-cycle', event: item
  }});
  const statuses = id => reports.filter(x =>
    x.type === 'csc-comm-cycle-status' && x.id === id);
  async function waitFor(predicate) {
    for (let i = 0; i < 400 && !predicate(); i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(predicate(), 'Cycle sink did not acknowledge');
  }
  return { send, statuses, reports, frames, waitFor,
    failWrites(value) { writingFails = value; } };
}
test('committed cycle serializer and Test-row witness exist in source', () => {
  assert.match(code, /function enqueueCycle/);
  assert.match(code, /return processCycle\(event.event\)/);
  assert.match(code, /csc-comm-key-cycle/);
  assert.match(read('src/userscript/06-image-export-tests/' +
    '10-csc-comm-worker-processing-probe.js'), /report.cycles === 1/);
});
test('four committed reasons preserve exact same producer fields', async () => {
  const h = harness();
  for (const [i, reason] of ['initial', 'scheduled', 'overdue', 'manual'].entries()) {
    const item = makeEvent({
      id: 'hmac-key-cycle:' + (i + 1) + ':' + generation,
      epoch: i + 1, occurred_at_ms: 10000 + i, reason
    });
    h.send(item);
    await h.waitFor(() => h.statuses(item.id).length === 1);
    assert.equal(h.statuses(item.id)[0].status, 'completed');
    assert.equal(h.statuses(item.id)[0].durable, false);
    assert.deepEqual(JSON.parse(JSON.stringify(h.frames.at(-1))),
      { kind: 'hmac-key-cycle', ...item });
  }
  assert.equal(h.frames.length, 4);
});
test('duplicate cycle is suppressed within Worker without claiming durability', async () => {
  const h = harness();
  h.send(makeEvent());
  await h.waitFor(() => h.statuses(makeEvent().id).length === 1);
  h.send(makeEvent());
  assert.equal(h.statuses(makeEvent().id).at(-1).status, 'duplicate');
  assert.equal(h.statuses(makeEvent().id).at(-1).durable, false);
  assert.equal(h.frames.length, 1);
});
test('malformed/pending/private cycle payload fails closed', () => {
  const h = harness();
  const invalid = [makeEvent({reason: 'pending'}),makeEvent({epoch: 0}),
    makeEvent({id: 'bad'}),makeEvent({occurred_at_ms: null}),
    makeEvent({key_hex: 'PRIVATE-KEY'}),makeEvent({secret: 'PRIVATE-TOKEN'})];
  for (const item of invalid) h.send(item);
  assert.equal(h.frames.length, 0);
  assert.equal(h.statuses('').length, invalid.length);
  assert.ok(h.statuses('').every(x => x.status === 'rejected'));
  assert.doesNotMatch(JSON.stringify(h.reports), /PRIVATE-KEY|PRIVATE-TOKEN/);
});
test('writer failure does not mark cycle complete and allows retry', async () => {
  const h = harness(true);
  h.send(makeEvent());
  await h.waitFor(() => h.statuses(makeEvent().id).length === 1);
  assert.equal(h.statuses(makeEvent().id)[0].status, 'failed');
  assert.equal(h.frames.length, 0);
  assert.doesNotMatch(JSON.stringify(h.reports), /PRIVATE-ERROR/);
  h.failWrites(false);
  h.send(makeEvent());
  await h.waitFor(() => h.statuses(makeEvent().id).length === 2);
  assert.equal(h.statuses(makeEvent().id)[1].status, 'completed');
  assert.equal(h.frames.length, 1);
});
