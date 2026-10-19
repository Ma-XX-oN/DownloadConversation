import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

// EXPERIMENTAL NONSECRET witness. This is not the #313 key service.
// The authoritative anchor is assumed to be a coherent origin-local
// IndexedDB transaction; GM replicas deliberately have stale reads.
// No credential, private key, or payload enters this anchor.
function fixture() {
  const anchor = { value: null };
  const replicas = [null, null];
  let tail = Promise.resolve();
  const exclusive = async fn => {
    const prior = tail;
    let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await prior;
    try { return await fn(); } finally { unlock(); }
  };
  async function admit(tab, crashBeforeAnchor = false) {
    return exclusive(async () => {
      const fromGM = replicas[tab];
      const fromAnchor = anchor.value;
      if (!fromAnchor && fromGM) throw Error('orphan-gm-record');
      if (fromAnchor && (!fromGM ||
          fromAnchor.revision !== fromGM.revision ||
          fromAnchor.generation !== fromGM.generation)) {
        throw Error('stale-gm-record');
      }
      const next = {
        generation: fromGM ? fromGM.generation : randomUUID(),
        revision: randomUUID(), epoch: fromGM ? fromGM.epoch : 1,
        // This marker represents GM-only secret material in the fixture.
        gmPrivate: fromGM ? fromGM.gmPrivate : randomUUID()
      };
      // Production design would persist GM first and anchor second.
      // A crash between the two MUST refuse admission, not reset K.
      replicas[tab] = structuredClone(next);
      if (crashBeforeAnchor) throw Error('injected-crash');
      anchor.value = { generation: next.generation,
        revision: next.revision, epoch: next.epoch };
      return { generation: next.generation, epoch: next.epoch };
    });
  }
  function propagate(from, to) {
    replicas[to] = structuredClone(replicas[from]);
  }
  return { admit, propagate, anchor, replicas };
}

test('nonsecret coherent revision fence refuses stale GM under one lock', async () => {
  const f = fixture();
  const first = await f.admit(0);
  const exposed = JSON.stringify(f.anchor);
  assert.ok(!exposed.includes(f.replicas[0].gmPrivate));
  await assert.rejects(f.admit(1), /stale-gm-record/);
  assert.equal(f.replicas[1], null);
  f.propagate(0, 1);
  const second = await f.admit(1);
  assert.equal(second.generation, first.generation);
  await assert.rejects(f.admit(0), /stale-gm-record/);
  f.propagate(1, 0);
  const third = await f.admit(0);
  assert.equal(third.generation, first.generation);
  assert.equal(third.epoch, 1);
});

test('crash before committing nonsecret anchor refuses orphaned GM', async () => {
  const f = fixture();
  await assert.rejects(f.admit(0, true), /injected-crash/);
  assert.equal(f.anchor.value, null);
  await assert.rejects(f.admit(0), /orphan-gm-record/);
  assert.equal(f.anchor.value, null);
});

test('lost GM state never reinitializes over a persistent anchor', async () => {
  const f = fixture();
  await f.admit(0);
  f.replicas[0] = null;
  await assert.rejects(f.admit(0), /stale-gm-record/);
  assert.ok(f.anchor.value);
});
