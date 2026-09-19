import fs from 'node:fs';

const path = 'tests/stream-tail-recovery.test.mjs';
let source = fs.readFileSync(path, 'utf8');
const before = `    logDiagnostic() {},\n    agentSoundObserveTerminal() {},\n    agentStopwatchObserveStreamEvent() {},`;
const after = `    logDiagnostic() {},\n    agentTerminalObserve() {},\n    agentStopwatchObserveStreamEvent() {},`;
const first = source.indexOf(before);
if (first < 0) throw new Error('Expected stream-tail terminal harness stubs are missing.');
if (source.indexOf(before, first + before.length) >= 0) {
  throw new Error('Expected exactly one stream-tail terminal harness stub block.');
}
source = source.slice(0, first) + after + source.slice(first + before.length);
fs.writeFileSync(path, source);
