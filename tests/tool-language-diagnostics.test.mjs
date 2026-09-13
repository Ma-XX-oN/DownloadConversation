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


test('issue 119 times image recovery and post-image export phases without logging image payloads', () => {
  assert.match(userscript, /const MAX_DIAGNOSTIC_LOG_ITEMS = 10000/);
  assert.match(userscript, /const MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS = 5000/);
  assert.match(userscript, /const DIAGNOSTIC_PERSIST_DELAY_MS = 1000/);
  assert.match(userscript, /conversation-image-recovery-start/);
  assert.match(userscript, /conversation-image-recovery-item-start/);
  assert.match(userscript, /conversation-image-recovery-item-complete/);
  assert.match(userscript, /conversation-image-recovery-item-failure/);
  assert.match(userscript, /conversation-image-recovery-complete/);
  assert.match(userscript, /fetch_ms: timing\.fetch_ms/);
  assert.match(userscript, /body_ms: timing\.body_ms/);
  assert.match(userscript, /encode_ms: timing\.encode_ms/);
  assert.match(userscript, /blob_bytes: timing\.blob_bytes/);
  assert.match(userscript, /data_url_chars: timing\.data_url_chars/);
  assert.match(userscript, /recovering image \$\{imageNumber\}\/\$\{imageCount\}/);
  assert.match(userscript, /phase: 'markdown-render'/);
  assert.match(userscript, /phase: 'markdown-diagnostics'/);
  assert.match(userscript, /phase: 'blob-create'/);
  assert.match(userscript, /phase: 'download-trigger'/);
  assert.doesNotMatch(userscript, /conversation-image-recovery-item-(?:start|complete|failure)[\s\S]{0,500}(?:data_url|source):/,
    'Image timing diagnostics must not include image payload/source fields.');
});

test('issue 119 gates expensive export-tail fingerprints behind debug diagnostics and reuses the result', () => {
  const readyIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-export-markdown-ready'");
  const blobIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-export-blob-created'");
  assert.ok(readyIndex > 0 && blobIndex > readyIndex);
  const diagnosticStart = userscript.lastIndexOf('const diagnosticStartedAt = performance.now();', readyIndex);
  const diagnosticEnd = userscript.indexOf('const blobStartedAt = performance.now();', readyIndex);
  assert.ok(diagnosticStart > 0 && diagnosticEnd > diagnosticStart,
    'Markdown-ready diagnostics must have a bounded debug-only phase.');
  const diagnosticBlock = userscript.slice(diagnosticStart, diagnosticEnd);
  assert.match(diagnosticBlock, /markdownHash = diagnosticTextHash\(markdown\)/);
  assert.match(diagnosticBlock, /markdown_hash: markdownHash/);
  assert.equal((diagnosticBlock.match(/diagnosticTextHash\(markdown\)/g) ?? []).length, 1,
    'The export-tail diagnostic phase should calculate its full Markdown fingerprint only once.');
});

test('issue 119 keeps high-volume diagnostics cheap while the log UI is collapsed', () => {
  assert.match(userscript, /function schedulePersistDiagnosticLog\(\)/);
  assert.match(userscript, /schedulePersistDiagnosticLog\(\);\n    refreshDiagnosticLog\(\);/);
  assert.match(userscript, /diagnosticLog\.slice\(-MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS\)/);
  assert.match(userscript, /if \(output && diagnosticLogExpanded\) \{/);
});


test('issue 119 live evidence removes redundant Markdown scans and uses 20-record pages', () => {
  assert.match(userscript, /const PAGE_TURNS = 20;/,
    'Conversation API pagination must request 20 records per page for more frequent fetch feedback.');
  assert.doesNotMatch(userscript, /rendered_hash: diagnosticTextHash\(rendered\)/,
    'Canonical segment diagnostics must not rescan the rendered segment for a duplicate hash.');
  assert.doesNotMatch(userscript, /rendered_turn_ids: diagnosticMarkdownTurnInventory\(rendered\)/,
    'Canonical segment diagnostics must not rescan the rendered segment for duplicate turn IDs.');
  assert.doesNotMatch(userscript, /block_hash: diagnosticTextHash\(renderedSegment\)/,
    'Block-appended diagnostics must not hash the same rendered segment again.');
  assert.doesNotMatch(userscript, /block_turn_ids: diagnosticMarkdownTurnInventory\(renderedSegment\)/,
    'Block-appended diagnostics must not inventory the same rendered segment again.');

  const appendedIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-markdown-block-appended'");
  const appendedGuard = userscript.lastIndexOf("if (diagnosticEnabled('debug'))", appendedIndex);
  assert.ok(appendedGuard >= 0 && appendedIndex - appendedGuard < 200,
    'Block-appended debug arguments must be guarded before they are evaluated.');

  const assembledIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-markdown-assembled'");
  const assembledEnd = userscript.indexOf('});', assembledIndex);
  const assembledBlock = userscript.slice(assembledIndex, assembledEnd + 3);
  assert.doesNotMatch(assembledBlock, /diagnosticTextHash\(markdown\)/,
    'Markdown assembly must not hash the complete document before export-tail diagnostics.');
  assert.doesNotMatch(assembledBlock, /diagnosticMarkdownTurnInventory\(markdown/,
    'Markdown assembly must not inventory the complete document before export-tail diagnostics.');

  assert.equal((userscript.match(/diagnosticTextHash\(markdown\)/g) ?? []).length, 1,
    'The complete Markdown document must be fingerprinted at only one deliberate debug boundary.');
  assert.equal((userscript.match(/diagnosticMarkdownTurnInventory\(markdown, 32\)/g) ?? []).length, 1,
    'The complete Markdown turn-ID inventory must be scanned at only one deliberate debug boundary.');
});
