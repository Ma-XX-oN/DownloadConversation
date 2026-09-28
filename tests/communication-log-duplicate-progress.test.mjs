import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const duplicateSource = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-duplicate.js', import.meta.url),
  'utf8'
);

test('Issue 166 Duplicate reports real file-count progress and measured ETA', () => {
  assert.match(duplicateSource, /const totalFiles = relevantSegments\.length \+ 1;/);
  assert.match(duplicateSource, /completed_files:/);
  assert.match(duplicateSource, /total_files:/);
  assert.match(duplicateSource, /percent:/);
  assert.match(duplicateSource, /eta_ms:/);
  assert.match(
    duplicateSource,
    /\$\{progress\.completed_files\}\/\$\{progress\.total_files\} files /
  );
  assert.match(duplicateSource, /\$\{progress\.percent\.toFixed\(1\)\}% done/);
  assert.match(
    duplicateSource,
    /ETA: \$\{communicationLogFormatDuration\(progress\.eta_ms\)\}/
  );
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
