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
