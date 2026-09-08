import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('tool language diagnostics expose canonical normalization and production routing at debug level', () => {
  assert.match(userscript, /logDiagnostic\('debug', 'canonical-tool-normalization'/);
  assert.match(userscript, /input_format: block\?\.input_format \?\? null/);
  assert.match(userscript, /language: block\?\.language \?\? null/);
  assert.match(userscript, /source_language: block\?\.source_language \?\? null/);
  assert.match(userscript, /source_input_prefix: boundedDiagnosticText/);
  assert.match(userscript, /logDiagnostic\('debug', 'canonical-tool-segment-routing'/);
  assert.match(userscript, /complete: canonicalSegmentComplete/);
  assert.match(userscript, /eligible: canonicalSegmentEligible/);
});


test('issue 114 traces an accepted assistant segment through Markdown assembly and download boundaries', () => {
  assert.match(userscript, /logDiagnostic\('debug', 'canonical-assistant-segment-rendered'/);
  assert.match(userscript, /logDiagnostic\('debug', 'conversation-markdown-segment-render-request'/);
  assert.match(userscript, /logDiagnostic\('debug', 'conversation-markdown-block-appended'/);
  assert.match(userscript, /logDiagnostic\('debug', 'conversation-markdown-assembled'/);
  assert.match(userscript, /logDiagnostic\('debug', 'conversation-export-markdown-ready'/);
  assert.match(userscript, /logDiagnostic\('debug', 'conversation-export-blob-created'/);
  assert.match(userscript, /logDiagnostic\('debug', 'conversation-download-triggered'/);
  assert.match(userscript, /rejection_reason: canonicalSegmentEligible/);
  assert.match(userscript, /reason: 'no-canonical-or-fallback-renderer-produced-output'/);
  assert.match(userscript, /function diagnosticTextHash\(text\)/);
  assert.match(userscript, /function diagnosticMarkdownTurnInventory\(markdown, tailCount = 12\)/);
});
