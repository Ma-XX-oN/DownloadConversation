import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controlSource = await readFile(
  new URL('../src/userscript/07-panel-launcher/01-date-time-control.js', import.meta.url),
  'utf8'
);
const dialogSource = await readFile(
  new URL('../src/userscript/07-panel-launcher/01-duplicate-range-dialog.js', import.meta.url),
  'utf8'
);

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

test('reusable single local date/time control exposes six editable fields with up/down controls', () => {
  assert.match(controlSource, /year.*month.*day.*hour.*minute.*second/s);
  assert.match(controlSource, /data-date-time-step="up"/);
  assert.match(controlSource, /data-date-time-step="down"/);
  assert.match(controlSource, /data-date-time-field="year"/);
  assert.match(controlSource, /createSingleDateTimeControl/);
});

test('date/time stepping carries and borrows through surrounding local-time fields', () => {
  const daysSource = functionSource(controlSource, 'dateTimeControlDaysInMonth');
  const adjustSource = functionSource(controlSource, 'dateTimeControlAdjustDate');
  const adjust = new Function(
    `${daysSource}\n${adjustSource}; return dateTimeControlAdjustDate;`
  )();

  const endOfYear = new Date(2026, 11, 31, 23, 59, 59, 0);
  const nextSecond = adjust(endOfYear, 'second', 1);
  assert.equal(nextSecond.getFullYear(), 2027);
  assert.equal(nextSecond.getMonth(), 0);
  assert.equal(nextSecond.getDate(), 1);
  assert.equal(nextSecond.getHours(), 0);
  assert.equal(nextSecond.getMinutes(), 0);
  assert.equal(nextSecond.getSeconds(), 0);

  const startOfDay = new Date(2026, 0, 1, 0, 0, 0, 0);
  const previousSecond = adjust(startOfDay, 'second', -1);
  assert.equal(previousSecond.getFullYear(), 2025);
  assert.equal(previousSecond.getMonth(), 11);
  assert.equal(previousSecond.getDate(), 31);
  assert.equal(previousSecond.getHours(), 23);
  assert.equal(previousSecond.getMinutes(), 59);
  assert.equal(previousSecond.getSeconds(), 59);
});

test('month and year stepping clamps the local calendar day instead of skipping months', () => {
  const daysSource = functionSource(controlSource, 'dateTimeControlDaysInMonth');
  const adjustSource = functionSource(controlSource, 'dateTimeControlAdjustDate');
  const adjust = new Function(
    `${daysSource}\n${adjustSource}; return dateTimeControlAdjustDate;`
  )();

  const january31 = new Date(2026, 0, 31, 12, 0, 0, 0);
  const february = adjust(january31, 'month', 1);
  assert.equal(february.getFullYear(), 2026);
  assert.equal(february.getMonth(), 1);
  assert.equal(february.getDate(), 28);

  const leapDay = new Date(2028, 1, 29, 12, 0, 0, 0);
  const nextYear = adjust(leapDay, 'year', 1);
  assert.equal(nextYear.getFullYear(), 2029);
  assert.equal(nextYear.getMonth(), 1);
  assert.equal(nextYear.getDate(), 28);
});

test('Duplicate range defaults start from earliest segment filename and end from manifest only', () => {
  assert.match(dialogSource, /communicationLogHistoricalSegmentsFromDirectory/);
  assert.match(dialogSource, /segments\[0\]\.start_timestamp/);
  assert.match(dialogSource, /communicationLogReadSegmentManifest/);
  assert.match(dialogSource, /manifest\.active_last_timestamp/);
  assert.doesNotMatch(dialogSource, /communicationLogFirstTimestampFromJsonl/);
  assert.doesNotMatch(dialogSource, /communicationLogCaptureSnapshotPlan/);
});

test('Duplicate range dialog composes two reusable controls and passes selected inclusive bounds', () => {
  assert.match(dialogSource, /createSingleDateTimeControl/);
  assert.match(dialogSource, /start\.setMilliseconds\(0\)/);
  assert.match(dialogSource, /end\.setMilliseconds\(999\)/);
  assert.match(dialogSource, /start_timestamp: start\.toISOString\(\)/);
  assert.match(dialogSource, /end_timestamp: end\.toISOString\(\)/);
  assert.match(dialogSource, /communicationLogShowDuplicateRangeDialog/);
  assert.match(dialogSource, /communicationLogArchiveDuplicate/);
});
