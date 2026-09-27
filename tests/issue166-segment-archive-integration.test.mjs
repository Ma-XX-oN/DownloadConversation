import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  productionFunctionSource,
  userscript
} from './helpers/userscript-source.mjs';

test('Issue 166 generated artifact keeps archive bridge and diagnostic Save in one runtime IIFE', () => {
  const iifeStart = userscript.indexOf('\n(() => {');
  const iifeEnd = userscript.lastIndexOf('})();');
  const create = userscript.indexOf('async function create7zArchive(', iifeStart);
  const save = userscript.indexOf('async function saveDiagnosticLog(', iifeStart);
  assert.ok(iifeStart >= 0 && iifeEnd > iifeStart);
  assert.ok(create > iifeStart && create < iifeEnd,
    'generated artifact must contain create7zArchive inside the DC runtime IIFE');
  assert.ok(save > create && save < iifeEnd,
    'generated artifact diagnostic Save must share the archive bridge lexical scope');
});

test('Issue 166 storage append crosses the target only after a complete record and seals the active segment', () => {
  const append = productionFunctionSource('communicationLogStorageAppendRecord');
  assert.match(append, /JSON\.stringify\(record\).*\\n/s,
    'one complete JSONL record must be formed before threshold evaluation');
  assert.match(append, /COMMUNICATION_LOG_SEGMENT_TARGET_BYTES/,
    'append must evaluate the repository-owned segment target');
  assert.match(append, /communicationLogSealActiveSegment/,
    'threshold crossing must seal the active segment');
});

test('Issue 166 sealing swaps to a new active segment before compression', () => {
  const seal = productionFunctionSource('communicationLogSealActiveSegment');
  const swap = seal.search(/communicationLogFileName\s*=|communicationLogOpenWriter|active/i);
  const compress = seal.indexOf('communicationLogCompressSealedSegment');
  assert.ok(swap >= 0 && compress > swap,
    'the next active segment must be established before background compression begins');
});

test('Issue 166 verified compression deletes raw sealed bytes only after exact verification', () => {
  const compress = productionFunctionSource('communicationLogCompressSealedSegment');
  const archive = compress.indexOf('create7zArchive');
  const verify = compress.search(/extract|decompress|sha256|hash|exact/i);
  const remove = compress.indexOf('removeEntry');
  assert.ok(archive >= 0, 'sealed bytes must be archived');
  assert.ok(verify > archive, 'archive/member bytes must be independently verified');
  assert.ok(remove > verify, 'raw sealed bytes may be deleted only after verification');
});

test('Issue 166 compression failure retains the sealed raw source', () => {
  const compress = productionFunctionSource('communicationLogCompressSealedSegment');
  assert.match(compress, /catch\s*\(/);
  assert.match(compress, /failed|failure|retain|retry/i);
  const catchStart = compress.search(/catch\s*\(/);
  assert.doesNotMatch(compress.slice(catchStart), /removeEntry\(/,
    'failure path must not delete the only sealed raw copy');
});
