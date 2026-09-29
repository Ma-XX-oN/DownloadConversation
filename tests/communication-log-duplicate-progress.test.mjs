import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const duplicateSource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-duplicate.js', import.meta.url),
  'utf8'
);
const snapshotSource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-snapshot.js', import.meta.url),
  'utf8'
);
const manifestSource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-manifest.js', import.meta.url),
  'utf8'
);
const recoverySource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-recovery.js', import.meta.url),
  'utf8'
);
const dateTimeSource = await readFile(
  new URL('../src/userscript/07-panel-launcher/01-date-time-control.js', import.meta.url),
  'utf8'
);
const rangeDialogSource = await readFile(
  new URL('../src/userscript/07-panel-launcher/01-duplicate-range-dialog.js', import.meta.url),
  'utf8'
);

function functionSource(source, name) {
  const marker = `function ${name}`;
  const functionStart = source.indexOf(marker);
  assert.ok(functionStart >= 0, `missing ${name}`);
  const asyncStart = source.lastIndexOf('async ', functionStart);
  const start = asyncStart >= 0 && asyncStart + 'async '.length === functionStart
    ? asyncStart
    : functionStart;
  let depth = 0;
  let seenBrace = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      seenBrace = true;
    } else if (char === '}') {
      depth -= 1;
      if (seenBrace && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

test('Issue 166 Duplicate reports real file-count progress and measured ETA', () => {
  assert.match(duplicateSource, /const totalFiles = relevantSegments\.length \+ 1;/);
  assert.match(duplicateSource, /completed_files:/);
  assert.match(duplicateSource, /total_files:/);
  assert.match(duplicateSource, /percent,/);
  assert.match(duplicateSource, /eta_ms:/);
  assert.match(duplicateSource, /ETA: \$\{etaText\}/);
});

test('Issue 166 Duplicate filters records only when a requested bound cuts through a file', () => {
  assert.match(duplicateSource, /const cutsLowerBoundary = lowerMs !== null && lowerMs > segmentStart;/);
  assert.match(duplicateSource, /const cutsUpperBoundary = upperMs !== null && upperMs < segmentEnd;/);
  assert.match(duplicateSource, /if \(!cutsLowerBoundary && !cutsUpperBoundary\) \{/);
  assert.match(duplicateSource, /streamingArchiveWriterAppendArchive\(writer, archiveBytes\)/);
  assert.match(duplicateSource, /communicationLogFilterJsonlBytes\(raw, lowerMs, upperMs\)/);
});

test('Issue 166 upper-bound filtering stops after the first record beyond the bound', () => {
  assert.match(duplicateSource, /if \(upperMs !== null && time > upperMs\) break;/);
});

test('Issue 166 active last timestamp scans backward from EOF in bounded chunks', async () => {
  const parseLine = functionSource(snapshotSource, 'communicationLogTimestampFromJsonlLine');
  const lastTimestamp = functionSource(
    snapshotSource,
    'communicationLogLastTimestampFromJsonlFile'
  );
  const execute = new Function('Blob', `
    const COMMUNICATION_LOG_COMPARE_CHUNK_BYTES = 17;
    ${parseLine}
    ${lastTimestamp}
    return communicationLogLastTimestampFromJsonlFile;
  `)(Blob);
  const first = '2026-09-28T19:00:00.000Z';
  const last = '2026-09-28T20:05:02.875Z';
  const blob = new Blob([
    `${JSON.stringify({ timestamp: first, payload: 'α'.repeat(20) })}\n`,
    `${JSON.stringify({ timestamp: last, payload: 'β'.repeat(20) })}\n`,
    '{"timestamp":"incomplete"'
  ]);
  assert.equal(await execute(blob, blob.size), last);
  assert.match(lastTimestamp, /cursor - COMMUNICATION_LOG_COMPARE_CHUNK_BYTES/);
  assert.match(lastTimestamp, /file\.slice\(start, cursor\)/);
  assert.match(lastTimestamp, /index -= 1/);
});

test('Issue 166 manifest no longer caches active_last_timestamp', () => {
  assert.match(manifestSource, /delete parsed\.active_last_timestamp/,
    'legacy manifests must be cleaned when read');
  assert.doesNotMatch(
    snapshotSource,
    /communicationLogSegmentManifest\.active_last_timestamp\s*=/
  );
  assert.doesNotMatch(
    recoverySource,
    /communicationLogSegmentManifest\.active_last_timestamp\s*=/
  );
  assert.doesNotMatch(rangeDialogSource, /communicationLogReadSegmentManifest/);
  assert.match(rangeDialogSource, /end_timestamp: plan\.active_last_timestamp/);
});

test('Issue 166 manifest carries a human-readable conversation name and refreshes at durable boundaries', () => {
  assert.match(manifestSource, /conversation_name:/);
  assert.match(manifestSource, /communicationLogConversationName\(\)/);
  assert.match(manifestSource, /communicationLogSyncManifestConversationName/);
  assert.match(snapshotSource, /communicationLogSyncManifestConversationName\(\)/);
});

test('Issue 166 date/time spinner clamps movement beyond available bounds', () => {
  const clamp = functionSource(dateTimeSource, 'dateTimeControlClampDate');
  const resolve = functionSource(dateTimeSource, 'dateTimeControlResolveBoundedAttempt');
  const run = new Function(`
    ${clamp}
    ${resolve}
    const minimum = new Date(2026, 8, 28, 10, 0, 0);
    const maximum = new Date(2026, 8, 28, 11, 0, 0);
    const current = new Date(2026, 8, 28, 10, 30, 0);
    const high = dateTimeControlResolveBoundedAttempt(
      current,
      new Date(2026, 8, 28, 11, 0, 1),
      minimum,
      maximum
    );
    const low = dateTimeControlResolveBoundedAttempt(
      current,
      new Date(2026, 8, 28, 9, 59, 59),
      minimum,
      maximum
    );
    return {
      high: high.value.getTime(),
      highHit: high.boundary_hit,
      low: low.value.getTime(),
      lowHit: low.boundary_hit
    };
  `);
  assert.deepEqual(run(), {
    high: new Date(2026, 8, 28, 11, 0, 0).getTime(),
    highHit: true,
    low: new Date(2026, 8, 28, 10, 0, 0).getTime(),
    lowHit: true
  });
  assert.match(dateTimeSource, /if \(resolved\.boundary_hit\) playAgentSound\('error'\);/);
});

test('Issue 166 Duplicate range uses the oldest raw active file before first segment rotation', async () => {
  const availableRange = functionSource(
    rangeDialogSource,
    'communicationLogDuplicateAvailableRange'
  );
  const olderTimestamp = '2026-09-28T19:00:01.125Z';
  const currentTimestamp = '2026-09-28T20:00:01.125Z';
  const endTimestamp = '2026-09-28T20:05:02.875Z';
  const files = {
    'active-a.jsonl': { size: 100, timestamp: olderTimestamp },
    'active-b.jsonl': { size: 200, timestamp: currentTimestamp }
  };
  const execute = new Function(
    'communicationLogEnqueue',
    'communicationLogCaptureSnapshotPlan',
    'COMMUNICATION_LOG_ACTIVE_FILE_NAMES',
    'communicationLogSegmentDirectoryHandle',
    'communicationLogFirstTimestampFromJsonlFile',
    `return (async () => { ${availableRange}; return communicationLogDuplicateAvailableRange(); })();`
  );
  const result = await execute(
    (_stage, task) => ({ operation: Promise.resolve().then(task) }),
    async () => ({
      segments: [],
      active_name: 'active-b.jsonl',
      active_eof: 200,
      active_last_timestamp: endTimestamp
    }),
    ['active-a.jsonl', 'active-b.jsonl'],
    {
      getFileHandle: async name => ({ getFile: async () => files[name] })
    },
    async file => file.timestamp
  );
  assert.deepEqual(result, {
    start_timestamp: olderTimestamp,
    end_timestamp: endTimestamp
  });
});

test('Issue 166 Duplicate range keeps historical filename fast path', async () => {
  const availableRange = functionSource(
    rangeDialogSource,
    'communicationLogDuplicateAvailableRange'
  );
  const segmentTimestamp = '2026-09-28T19:00:00.000Z';
  const endTimestamp = '2026-09-28T20:05:02.875Z';
  let activeReads = 0;
  const execute = new Function(
    'communicationLogEnqueue',
    'communicationLogCaptureSnapshotPlan',
    'COMMUNICATION_LOG_ACTIVE_FILE_NAMES',
    'communicationLogSegmentDirectoryHandle',
    'communicationLogFirstTimestampFromJsonlFile',
    `return (async () => { ${availableRange}; return communicationLogDuplicateAvailableRange(); })();`
  );
  const result = await execute(
    (_stage, task) => ({ operation: Promise.resolve().then(task) }),
    async () => ({
      segments: [{ start_timestamp: segmentTimestamp }],
      active_name: 'active-b.jsonl',
      active_eof: 123,
      active_last_timestamp: endTimestamp
    }),
    ['active-a.jsonl', 'active-b.jsonl'],
    {
      getFileHandle: async () => {
        activeReads += 1;
        throw new Error('historical fast path must not read raw active files for its start');
      }
    },
    async () => {
      throw new Error('historical fast path must not scan raw active files for its start');
    }
  );
  assert.equal(activeReads, 0);
  assert.deepEqual(result, {
    start_timestamp: segmentTimestamp,
    end_timestamp: endTimestamp
  });
});

test('Issue 166 Duplicate range dialog uses the shared modal contract', () => {
  assert.match(rangeDialogSource, /installModalContract\(overlay,/);
  assert.match(rangeDialogSource, /defaultButton:\s*okButton/);
  assert.match(rangeDialogSource, /onClose:\s*\(\) => finish\(null, false\)/);
  assert.match(rangeDialogSource, /opener:\s*previousFocus/);
  assert.doesNotMatch(
    rangeDialogSource,
    /overlay\.addEventListener\('keydown',[\s\S]*event\.key === 'Escape'/,
    'Duplicate must not maintain a second private Escape modal-control path'
  );
});
