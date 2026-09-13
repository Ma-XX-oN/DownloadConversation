import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('tool routing diagnostics retain production segment decisions without per-record normalization dumps', () => {
  assert.doesNotMatch(userscript, /canonical-tool-normalization/,
    'Closed #103 instrumentation must not emit one normalization payload per tool record.');
  assert.doesNotMatch(userscript, /source_input_prefix: boundedDiagnosticText/,
    'Closed #103 instrumentation must not retain source tool-input prefixes.');
  assert.match(userscript, /logDiagnostic\('debug', 'canonical-tool-segment-routing'/);
  assert.match(userscript, /complete: canonicalSegmentComplete/);
  assert.match(userscript, /eligible: canonicalSegmentEligible/);
});

test('diagnostic logging redacts signed URL tokens before retention and console output', () => {
  assert.match(userscript, /function redactDiagnosticSignedTokens\(value\)/);
  assert.ok(userscript.includes("return value.replace(/([?&](?:sig|signature)=)[^&#\\s]*/gi, '$1[redacted]');"));
  assert.match(userscript, /const safeData = redactDiagnosticSignedTokens\(data\)/);
  assert.match(userscript, /data: safeData/);
  assert.match(userscript, /args\.push\(redactDiagnosticSignedTokens\(data\)\)/);
  assert.doesNotMatch(userscript, /args\.push\(data\)/);
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
  assert.match(userscript, /phase: 'blob-create'/);
  assert.match(userscript, /phase: 'download-trigger'/);
  assert.doesNotMatch(userscript, /conversation-image-recovery-item-(?:start|complete|failure)[\s\S]{0,500}(?:data_url|source):/,
    'Image timing diagnostics must not include image payload/source fields.');
});

test('issue 119 keeps Markdown-ready diagnostics compact after removing full-document scans', () => {
  const readyIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-export-markdown-ready'");
  const blobIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-export-blob-created'");
  assert.ok(readyIndex > 0 && blobIndex > readyIndex);
  const readyGuard = userscript.lastIndexOf("if (diagnosticEnabled('debug'))", readyIndex);
  assert.ok(readyGuard > 0 && readyIndex - readyGuard < 1000,
    'Markdown-ready diagnostics must still be guarded before their compact arguments are built.');
  const readyEnd = userscript.indexOf('});', readyIndex);
  const readyBlock = userscript.slice(readyIndex, readyEnd + 3);
  assert.match(readyBlock, /markdown_length: markdown.length/);
  assert.match(readyBlock, /source_tail: sourceTail/);
  assert.doesNotMatch(readyBlock, /markdown_hash|markdown_turn_ids|diagnosticTextHash|diagnosticMarkdownTurnInventory/,
    'Markdown-ready diagnostics must not rescan the complete rendered document.');
});

test('issue 119 keeps high-volume diagnostics cheap while the log UI is collapsed', () => {
  assert.match(userscript, /function schedulePersistDiagnosticLog\(\)/);
  assert.match(userscript, /schedulePersistDiagnosticLog\(\);\n    refreshDiagnosticLog\(\);/);
  assert.match(userscript, /diagnosticLog\.slice\(-MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS\)/);
  assert.match(userscript, /if \(output && diagnosticLogExpanded\) \{/);
});



test('issue 119 live evidence restores 100-turn pages, keeps fetch heartbeat, and removes full-document debug scans', () => {
  assert.match(userscript, /const PAGE_TURNS = 100;/,
    'Measured same-conversation evidence requires the faster 100-turn request size.');
  assert.match(userscript, /phase: 'request-start'/,
    'Pagination must publish an in-flight request boundary before awaiting the page.');
  assert.match(userscript, /page_started_at: pageStartedAt/,
    'Pagination must expose the active page start time for the one-second UI heartbeat.');
  assert.doesNotMatch(userscript, /function diagnosticTextHash\(/,
    'The 24 MB Markdown export must not retain a whole-document diagnostic hash pass.');
  assert.doesNotMatch(userscript, /function diagnosticMarkdownTurnInventory\(/,
    'The 24 MB Markdown export must not retain a whole-document regex inventory pass.');
  assert.doesNotMatch(userscript, /diagnosticTextHash\(markdown\)/,
    'The complete Markdown document must not be fingerprinted during export.');
  assert.doesNotMatch(userscript, /diagnosticMarkdownTurnInventory\(markdown/,
    'The complete Markdown document must not be regex-inventoried during export.');
  assert.doesNotMatch(userscript, /phase: 'markdown-diagnostics'/,
    'The removed full-document scan must not leave a misleading diagnostics phase.');
  assert.doesNotMatch(userscript, /markdown_hash:/,
    'Downstream diagnostics must not claim a removed full-document hash.');
  assert.doesNotMatch(userscript, /rendered_hash: diagnosticTextHash\(rendered\)/,
    'Canonical segment diagnostics must not rescan the rendered segment for a duplicate hash.');
  assert.doesNotMatch(userscript, /block_hash: diagnosticTextHash\(renderedSegment\)/,
    'Block-appended diagnostics must not hash the same rendered segment again.');
});
