// Focused metadata-safe timestamp tests for issue #250.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,
  '../src/userscript/02-network-communication/06-segment-snapshot.js'), 'utf8');
const context = vm.createContext({
  TextDecoder, Uint8Array, Blob, File, Date,
  COMMUNICATION_LOG_COMPARE_CHUNK_BYTES: 7
});
vm.runInContext(source, context);
const invoke = (name, ...args) => vm.runInContext(name, context)(...args);
const header = '{"version":"1.11.4-issue.238.1"}\n';
const a = '{"timestamp":"2026-10-12T12:00:00.000Z","event":"a"}\n';
const b = '{"timestamp":"2026-10-12T13:00:00.000Z","event":"b"}\n';
const file = text => new File([text], 'segment.jsonl');
const bytes = text => new TextEncoder().encode(text);

(async () => {
  assert.equal(invoke('communicationLogTimestampRangeFromJsonl', bytes(header)), null);
  assert.equal(await invoke('communicationLogFirstTimestampFromJsonlFile', file(header)), null);
  assert.equal(await invoke('communicationLogLastTimestampFromJsonlFile', file(header)), null);
  for (const text of [a + b, header + a + b]) {
    const range = invoke('communicationLogTimestampRangeFromJsonl', bytes(text));
    assert.equal(range.start_timestamp, '2026-10-12T12:00:00.000Z');
    assert.equal(range.end_timestamp, '2026-10-12T13:00:00.000Z');
    assert.equal(await invoke('communicationLogFirstTimestampFromJsonlFile', file(text)),
      '2026-10-12T12:00:00.000Z');
    assert.equal(await invoke('communicationLogLastTimestampFromJsonlFile', file(text)),
      '2026-10-12T13:00:00.000Z');
  }
  assert.equal(invoke('communicationLogTimestampRangeFromJsonl',
    bytes(header + a + b.slice(0, -1))).end_timestamp,
    '2026-10-12T12:00:00.000Z');
  assert.equal(invoke('communicationLogTimestampRangeFromJsonl', bytes(a.slice(0, -1))), null);
  const incomplete = file(header + a + b.slice(0, -1));
  assert.equal(await invoke('communicationLogLastTimestampFromJsonlFile', incomplete),
    '2026-10-12T12:00:00.000Z');
  assert.equal(await invoke('communicationLogFirstTimestampFromJsonlFile',
    file(header + a), (header + a).length - 1), null);
  console.log('PASS: metadata-only, legacy, mixed, chunk boundaries, frozen EOF');
})().catch(error => { console.error(error); process.exitCode = 1; });
