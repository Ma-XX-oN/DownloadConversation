from pathlib import Path

USERSCRIPT = Path('chatgpt-conversation-markdown-export.user.js')
TESTS = Path('tests/tool-language-diagnostics.test.mjs')
DESIGN = Path('DESIGN.md')


def replace_once(text, old, new, description):
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{description}: expected one match, found {count}')
  return text.replace(old, new, 1)


text = USERSCRIPT.read_text(encoding='utf-8')
text = replace_once(
  text,
  '  const PAGE_TURNS = 100;\n',
  '  const PAGE_TURNS = 20;\n',
  'Conversation API page size'
)
text = replace_once(
  text,
  """    if (diagnosticEnabled('debug')) {\n      logDiagnostic('debug', 'canonical-assistant-segment-rendered', {\n        source_record_ids: records.map(record => record?.id ?? null),\n        final_source_record_id: messageRecord?.id ?? null,\n        event_kinds: events.map(event => event?.kind ?? null),\n        rendered_length: rendered.length,\n        rendered_hash: diagnosticTextHash(rendered),\n        rendered_turn_ids: diagnosticMarkdownTurnInventory(rendered)\n      });\n    }\n""",
  """    if (diagnosticEnabled('debug')) {\n      logDiagnostic('debug', 'canonical-assistant-segment-rendered', {\n        source_record_ids: records.map(record => record?.id ?? null),\n        final_source_record_id: messageRecord?.id ?? null,\n        event_kinds: events.map(event => event?.kind ?? null),\n        rendered_length: rendered.length\n      });\n    }\n""",
  'canonical rendered-segment duplicate scans'
)
text = replace_once(
  text,
  """            logDiagnostic('debug', 'conversation-markdown-block-appended', {\n              route: 'canonical-assistant-segment',\n              output_index: output.length - 1,\n              source_record_ids: segmentRecords.map(item => item?.id ?? null),\n              final_source_record_id: record?.id ?? null,\n              block_length: renderedSegment.length,\n              block_hash: diagnosticTextHash(renderedSegment),\n              block_turn_ids: diagnosticMarkdownTurnInventory(renderedSegment)\n            });\n""",
  """            if (diagnosticEnabled('debug')) {\n              logDiagnostic('debug', 'conversation-markdown-block-appended', {\n                route: 'canonical-assistant-segment',\n                output_index: output.length - 1,\n                source_record_ids: segmentRecords.map(item => item?.id ?? null),\n                final_source_record_id: record?.id ?? null,\n                block_length: renderedSegment.length\n              });\n            }\n""",
  'block-appended duplicate scans and disabled-debug argument work'
)
text = replace_once(
  text,
  """        markdown_hash: diagnosticTextHash(markdown),\n        markdown_turn_ids: diagnosticMarkdownTurnInventory(markdown, 32),\n""",
  '',
  'assembled-Markdown duplicate full-document scans'
)
USERSCRIPT.write_text(text, encoding='utf-8')


test_text = TESTS.read_text(encoding='utf-8')
marker = 'issue 119 live evidence removes redundant Markdown scans and uses 20-record pages'
if marker in test_text:
  raise SystemExit('Live-evidence regression test already exists unexpectedly.')
test_text += r'''

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
'''
TESTS.write_text(test_text, encoding='utf-8')


design_text = DESIGN.read_text(encoding='utf-8')
section = r'''

## Issue #119 live-evidence performance correction

A real Debug export established that image recovery itself was not the observed stall: the supplied run completed image recovery in 24 ms, while repeated diagnostic scans over large rendered Markdown consumed tens of seconds after image recovery.  The instrumentation is therefore retained, but the diagnostic work is constrained so observability does not dominate export time.

- Canonical rendered segments are no longer hashed or regex-inventoried merely to populate per-segment/per-block Debug events.  Those events retain structural IDs, route information, and lengths without rescanning the full rendered segment.
- The `conversation-markdown-block-appended` Debug event is guarded before its argument object is built, so disabled Debug logging cannot evaluate expensive or high-volume diagnostic arguments.
- `conversation-markdown-assembled` no longer performs a full-document hash or turn-ID regex inventory.  The final export-tail Debug boundary remains the single deliberate full-Markdown fingerprint/inventory point used for correlation.
- Conversation API pagination requests 20 records per page instead of 100.  This does not change record ordering or completeness; it creates more fetch boundaries so the existing progress UI can report progress more frequently during long history retrieval.
- No image timeout, concurrency, retry, or fallback policy is changed by this correction.
'''
if '## Issue #119 live-evidence performance correction' in design_text:
  raise SystemExit('Design correction section already exists unexpectedly.')
DESIGN.write_text(design_text.rstrip() + section.rstrip() + '\n', encoding='utf-8')
