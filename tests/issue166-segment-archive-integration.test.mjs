import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/userscript/02-network-communication/06-segment-duplicate.js', import.meta.url),
  'utf8'
);

function productionFunctionSource(name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing production function ${name}`);
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
  throw new Error(`unterminated production function ${name}`);
}

// This focused file intentionally covers only the Duplicate invariants that depend
// on the assembled production function text.  The broader Issue 166 integration
// suite remains in the generated artifact and archive runtime tests.

test('Issue 166 streaming Duplicate orders historical segments before frozen active prefix', () => {
  const stream = productionFunctionSource('communicationLogStreamDuplicateArchive');
  assert.match(stream, /start_timestamp/);
  const historical = stream.indexOf('for (const segment of relevantSegments)');
  const active = stream.indexOf('const activeHandle =');
  assert.ok(historical >= 0 && active > historical,
    'historical segments must feed the open writer before the frozen active prefix');
  assert.match(stream, /streamingArchiveWriterAppendArchive/);
  assert.match(stream, /streamingArchiveWriterFinish/);
});

test('Issue 166 bounded Duplicate filtering stops after the upper bound', () => {
  const filter = productionFunctionSource('communicationLogFilterJsonlBytes');
  assert.match(filter, /if \(upperMs !== null && time > upperMs\) break;/);
});
