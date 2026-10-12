import assert from 'node:assert/strict';
import test from 'node:test';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

const source = productionFunctionSource('communicationLogEnsureFragmentHeader');
const append = productionFunctionSource('communicationLogStorageAppendRecord');
const rotate = productionFunctionSource('communicationLogSealActiveSegment');

async function runHeader({ version, storedBytes = 0, fileSize = 0, failWrite = false }) {
  const run = new Function('source', `
    return async function (version, storedBytes, fileSize, failWrite) {
      const writes = [];
      let opens = 0;
      const VERSION = version;
      let communicationLogActiveSegmentBytes = storedBytes;
      let communicationLogWriterDirty = false;
      const communicationLogActiveFileSnapshot = async () => ({ file: { size: fileSize } });
      const communicationLogOpenWriter = async () => { opens += 1; };
      const communicationLogWritable = {
        write: async line => {
          if (failWrite) throw new Error('write rejected');
          writes.push(line);
        }
      };
      ${source}
      let failure = null;
      try { await communicationLogEnsureFragmentHeader(); }
      catch (error) { failure = error.message; }
      return { writes, opens, dirty: communicationLogWriterDirty,
        bytes: communicationLogActiveSegmentBytes, failure };
    };
  `)(source);
  return run(version, storedBytes, fileSize, failWrite);
}

test('new physical fragment gets one timestamp-free GEN/COMM version header', async () => {
  const result = await runHeader({ version: '1.11.4' });
  assert.deepEqual(result.writes, ['{"version":{"gen":"1.11.4","comm":"1.11.4"}}\n']);
  assert.equal(result.bytes, Buffer.byteLength(result.writes[0]));
  assert.equal(result.dirty, true);
});

test('unknown installed version is not misrepresented as historical provenance', async () => {
  const result = await runHeader({ version: 'unknown' });
  assert.deepEqual(result.writes, ['{"version":{"gen":null,"comm":null}}\n']);
});

test('nonempty original fragment is immutable after upgrade', async () => {
  const result = await runHeader({ version: '2.0.0', storedBytes: 42, fileSize: 42 });
  assert.deepEqual(result.writes, []);
  assert.equal(result.bytes, 42);
});

test('nonempty recovered fragment is not overwritten', async () => {
  const result = await runHeader({ version: '2.0.0', fileSize: 75 });
  assert.deepEqual(result.writes, []);
  assert.equal(result.bytes, 75);
});

test('header write failure propagates without marking bytes or dirty', async () => {
  const result = await runHeader({ version: '1.11.4', failWrite: true });
  assert.match(result.failure, /write rejected/);
  assert.equal(result.bytes, 0);
  assert.equal(result.dirty, false);
});

test('header runs before an appended event and upon rotation before compression', () => {
  assert.match(append, /await communicationLogEnsureFragmentHeader\(\);\s*await communicationLogWritable\.write\(line\)/);
  assert.match(rotate, /await communicationLogEnsureFragmentHeader\(\);\s*void communicationLogQueueSegmentCompression/);
  assert.doesNotMatch(source.slice(source.indexOf('const line =')), /timestamp:/);
});

test('production append places header before the only timestamped event', async () => {
  const execute = new Function(`
    const VERSION = '1.11.4';
    let communicationLogActiveSegmentBytes = 0;
    let communicationLogActiveLastTimestamp = null;
    let communicationLogWriterDirty = false;
    let communicationLogRotationHold = 0;
    let communicationLogRotationPending = false;
    const COMMUNICATION_LOG_SEGMENT_TARGET_BYTES = 10000;
    const writes = [];
    let seals = 0;
    const communicationLogActiveFileSnapshot = async () => ({ file: { size: 0 } });
    const communicationLogOpenWriter = async () => {};
    const communicationLogWritable = { write: async line => writes.push(line) };
    const communicationLogEnqueue = (_stage, task) => ({ operation: task() });
    const communicationLogSealActiveSegment = async () => { seals += 1; };
    ${source}
    ${append}
    return async () => {
      await communicationLogStorageAppendRecord({
        timestamp: '2026-10-12T18:00:00Z', type: 'fixture'
      });
      return { writes, bytes: communicationLogActiveSegmentBytes,
        lastTimestamp: communicationLogActiveLastTimestamp, seals };
    };
  `)();
  const result = await execute();
  assert.equal(result.writes.length, 2);
  assert.deepEqual(JSON.parse(result.writes[0]), {
    version: { gen: '1.11.4', comm: '1.11.4' }
  });
  assert.deepEqual(JSON.parse(result.writes[1]), {
    timestamp: '2026-10-12T18:00:00Z', type: 'fixture'
  });
  assert.equal(result.lastTimestamp, '2026-10-12T18:00:00Z');
  assert.equal(result.seals, 0);
  assert.equal(result.bytes, Buffer.byteLength(result.writes.join('')));
});
