import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const duplicateSource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-duplicate.js', import.meta.url),
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
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
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
  assert.match(
    duplicateSource,
    /\$\{progress\.completed_files\}\/\$\{progress\.total_files\} files /
  );
  assert.match(duplicateSource, /\$\{progress\.percent\.toFixed\(1\)\}% done/);
  assert.match(duplicateSource, /communicationLogFormatDuration\(progress\.eta_ms\)/);
  assert.match(duplicateSource, /ETA: \$\{etaText\}/);
});

test('Issue 166 Duplicate filters records only when a requested bound cuts through a file', () => {
  assert.match(duplicateSource, /const cutsLowerBoundary = lowerMs !== null && lowerMs > segmentStart;/);
  assert.match(duplicateSource, /const cutsUpperBoundary = upperMs !== null && upperMs < segmentEnd;/);
  assert.match(duplicateSource, /if \(!cutsLowerBoundary && !cutsUpperBoundary\) \{/);
  assert.match(duplicateSource, /streamingArchiveWriterAppendArchive\(writer, archiveBytes\)/);
  assert.match(duplicateSource, /const raw = await extractArchive\(archiveBytes\);/);
  assert.match(duplicateSource, /communicationLogFilterJsonlBytes\(raw, lowerMs, upperMs\)/);
});

test('Issue 166 upper-bound filtering stops after the first record beyond the bound', () => {
  assert.match(duplicateSource, /if \(upperMs !== null && time > upperMs\) break;/);
});

test('Issue 166 reusable single date/time control exposes six local fields with steppers', () => {
  assert.match(dateTimeSource, /function createSingleDateTimeControl\(/);
  for (const field of ['year', 'month', 'day', 'hour', 'minute', 'second']) {
    assert.match(dateTimeSource, new RegExp(`data-date-time-field=\\"${field}\\"`));
  }
  assert.match(dateTimeSource, /data-date-time-step="up"/);
  assert.match(dateTimeSource, /data-date-time-step="down"/);
});

test('Issue 166 date/time spinner carries surrounding local fields correctly', () => {
  const days = functionSource(dateTimeSource, 'dateTimeControlDaysInMonth');
  const adjust = functionSource(dateTimeSource, 'dateTimeControlAdjustDate');
  const run = new Function(`
    ${days}
    ${adjust}
    const secondCarry = dateTimeControlAdjustDate(
      new Date(2026, 11, 31, 23, 59, 59), 'second', 1
    );
    const leapMonth = dateTimeControlAdjustDate(
      new Date(2024, 0, 31, 12, 0, 0), 'month', 1
    );
    const dayBorrow = dateTimeControlAdjustDate(
      new Date(2024, 2, 1, 0, 0, 0), 'day', -1
    );
    return {
      secondCarry: [
        secondCarry.getFullYear(), secondCarry.getMonth(), secondCarry.getDate(),
        secondCarry.getHours(), secondCarry.getMinutes(), secondCarry.getSeconds()
      ],
      leapMonth: [leapMonth.getMonth(), leapMonth.getDate()],
      dayBorrow: [dayBorrow.getMonth(), dayBorrow.getDate()]
    };
  `);
  assert.deepEqual(run(), {
    secondCarry: [2027, 0, 1, 0, 0, 0],
    leapMonth: [1, 29],
    dayBorrow: [1, 29]
  });
});

test('Issue 166 Duplicate range dialog defaults to filename start and manifest end', () => {
  assert.match(rangeDialogSource, /communicationLogHistoricalSegmentsFromDirectory/);
  assert.match(rangeDialogSource, /segments\[0\]\.start_timestamp/);
  assert.match(rangeDialogSource, /communicationLogReadSegmentManifest/);
  assert.match(rangeDialogSource, /manifest\.active_last_timestamp/);
  assert.doesNotMatch(rangeDialogSource, /communicationLogFirstTimestampFromJsonl/);
  assert.match(rangeDialogSource, /createSingleDateTimeControl/);
  assert.match(rangeDialogSource, /communicationLogArchiveDuplicate\(\{/);
  assert.match(rangeDialogSource, /start_timestamp: start\.toISOString\(\)/);
  assert.match(rangeDialogSource, /end_timestamp: end\.toISOString\(\)/);
  assert.match(rangeDialogSource, /button\.disabled = false;/,
    'the range preflight disable must be cleared before the shared action runner');
});

test('Issue 166 Duplicate range dialog uses the shared modal contract', () => {
  assert.match(rangeDialogSource, /installModalContract\(overlay,/);
  assert.match(rangeDialogSource, /defaultButton:\s*okButton/);
  assert.match(rangeDialogSource, /onClose:\s*\(\) => finish\(null, false\)/);
  assert.match(rangeDialogSource, /opener:\s*previousFocus/);
  assert.match(rangeDialogSource, /communicationLogShowDuplicateRangeDialog\(button\)/);
  assert.doesNotMatch(
    rangeDialogSource,
    /overlay\.addEventListener\('keydown',[\s\S]*event\.key === 'Escape'/,
    'Duplicate must not maintain a second private Escape modal-control path'
  );
});
