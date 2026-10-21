import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL(
  './manual/dc313-exact-hmac-indexeddb-lifecycle.user.js',
  import.meta.url), 'utf8');
const start = script.indexOf('  channel.onmessage = async event => {');
const end = script.indexOf(
  '  /**\n   * @returns {Promise<void>} Initial', start);
assert.ok(start > 0 && end > start,
  'cohort tests must execute the shipped probe functions, not a rewrite');
const cohortSource = script.slice(start, end);
const observation = Object.freeze({
  generation: 'GEN-1', epoch: 1, fingerprint: 'HMAC-1',
  events: [{ id: 'cycle-1', reason: 'initial' }]
});

/**
 * Create a synthetic BroadcastChannel with independently specified responses.
 * @param {string[]} ids - Ready responder IDs (may contain duplicates).
 * @param {Object} options - Misbehaving or unavailable peer conditions.
 * @returns {Object} The actual shipped probe cohort functions and transport.
 */
function fixture(ids, options = {}) {
  const seen = { starts: [], selected: [], readiness: [] };
  let current = 0;
  const channel = {
    onmessage: null,
    postMessage(msg) {
      if (msg.type === 'prepare') {
        for (const from of ids) {
          seen.readiness.push(from);
          this.onmessage({ data: { type: 'ready', run: msg.run, from } });
        }
      }
      if (msg.type === 'start') {
        seen.starts.push(msg);
        seen.selected = [...msg.peers];
        // This late, unselected peer must never be admitted to the cohort.
        this.onmessage({ data: {
          type: 'ready', run: msg.run, from: 'late-unselected'
        } });
        for (const from of msg.peers) {
          if (options.absent === from) continue;
          const signal = options.failure === from ? {
            type: 'error', run: msg.run, from, error: 'injected-error'
          } : {
            type: 'done', run: msg.run, from,
            outcome: options.mismatch === from ?
              { ...observation, fingerprint: 'WRONG' } :
              options.journalMismatch === from ?
                { ...observation, events: [{ id: 'cycle-DIFFERENT' }] } :
                observation
          };
          this.onmessage({ data: signal });
          // Repeated peer messages should not count as separate participants.
          this.onmessage({ data: signal });
        }
        this.onmessage({ data: {
          type: 'done', run: msg.run, from: 'stray-not-selected',
          outcome: observation
        } });
      }
    }
  };
  const context = {
    channel, tabId: 'leader', busy: false, sessions: new Map(),
    crypto: { randomUUID: () => 'run-1' },
    delay: async () => {},
    inspect: async () => observation,
    Date: { now: () => (current++ * 30000) },
    Set, Map, Array, JSON, Promise, Error, String
  };
  const functions = vm.runInNewContext(
    cohortSource + '\n({ participatingInstances, equalIdentity, journalsAgree });',
    context);
  return { ...functions, seen };
}

test('zero peers fails explicitly and does not claim complete coverage', async () => {
  const f = fixture([]);
  await assert.rejects(
    f.participatingInstances('test', 'measure', 123),
    /at-least-one-peer-required/
  );
  assert.equal(f.seen.starts.length, 0);
});

test('one responding instance is valid but not mandatory', async () => {
  const f = fixture(['A']);
  const result = await f.participatingInstances('test', 'measure', 123);
  assert.equal(result.participants, 2);
  assert.equal(result.peers.length, 1);
  assert.equal(f.equalIdentity(result), true);
  assert.equal(f.journalsAgree(result), true);
});

test('four unique responding instances all participate, not just first', async () => {
  const f = fixture(['A', 'B', 'C', 'D']);
  const result = await f.participatingInstances('test', 'measure', 123);
  assert.equal(result.participants, 5);
  assert.equal(result.peers.length, 4);
  assert.equal(f.seen.selected.length, 4);
  assert.equal(f.equalIdentity(result), true);
  assert.equal(f.journalsAgree(result), true);
});

test('duplicate notifications never inflate participant count', async () => {
  const f = fixture(['A', 'B', 'B', 'C', 'A']);
  const result = await f.participatingInstances('test', 'measure', 123);
  assert.equal(result.participants, 4);
  assert.deepEqual(f.seen.selected, ['A', 'B', 'C']);
});

test('one mismatched HMAC fails whole-cohort identity', async () => {
  const f = fixture(['A', 'B', 'C', 'D'], { mismatch: 'C' });
  const result = await f.participatingInstances('test', 'measure', 123);
  assert.equal(result.participants, 5);
  assert.equal(f.equalIdentity(result), false);
  assert.equal(f.journalsAgree(result), true);
});

test('one selected peer error rejects the entire cohort', async () => {
  const f = fixture(['A', 'B', 'C'], { failure: 'B' });
  await assert.rejects(
    f.participatingInstances('test', 'measure', 123),
    /participant-errors:.*injected-error/
  );
});

test('one missing selected peer is a failure, never a partial PASS', async () => {
  const f = fixture(['A', 'B', 'C'], { absent: 'B' });
  await assert.rejects(
    f.participatingInstances('test', 'measure', 123),
    /participant-timeout:1 missing out of 3/
  );
});

test('sixteen participating peers are checked without a fixed upper count', async () => {
  const names = Array.from({ length: 16 }, (_, i) => 'peer-' + i);
  const f = fixture(names);
  const result = await f.participatingInstances('test', 'measure', 123);
  assert.equal(result.participants, 17);
  assert.equal(f.equalIdentity(result), true);
  assert.equal(f.journalsAgree(result), true);
});

test('one mismatched cycle journal fails whole-cohort parity', async () => {
  const f = fixture(['A', 'B', 'C', 'D'], { journalMismatch: 'D' });
  const result = await f.participatingInstances('test', 'measure', 123);
  assert.equal(f.equalIdentity(result), true);
  assert.equal(f.journalsAgree(result), false);
});
