from pathlib import Path
import argparse
import difflib
import re

USERSCRIPT = Path('chatgpt-conversation-markdown-export.user.js')
HEADING_TEST = Path('tests/heading-metadata-controls.test.mjs')
PANEL_TEST = Path('tests/recorder-panel-ui.test.mjs')
DIAG_TEST = Path('tests/tool-language-diagnostics.test.mjs')
DESIGN = Path('DESIGN.md')


def replace_once(text, old, new, description):
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{description}: expected one match, found {count}')
  return text.replace(old, new, 1)


def regex_replace_once(text, pattern, replacement, description):
  updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
  if count != 1:
    raise SystemExit(f'{description}: expected one match, found {count}')
  return updated


def patch_userscript(text):
  text = replace_once(text, '// @version      0.6.168\n', '// @version      0.6.169\n', 'userscript version')
  text = replace_once(text, '  const PAGE_TURNS = 20;\n', '  const PAGE_TURNS = 100;\n', 'page size')

  text = regex_replace_once(
    text,
    r"\n  /\*\*\n   \* Computes a deterministic FNV-1a fingerprint[\s\S]*?\n  function diagnosticMarkdownTurnInventory\(markdown, tailCount = 12\) \{[\s\S]*?\n  \}\n",
    '\n',
    'obsolete full-markdown diagnostic helpers'
  )

  text = replace_once(
    text,
    "      const previousPageInfo = pages.length ? pages[pages.length - 1].page_info : null;\n      const data = await fetchPage(cursor, pages.length + 1, previousPageInfo);\n",
    "      const previousPageInfo = pages.length ? pages[pages.length - 1].page_info : null;\n      const pageNumber = pages.length + 1;\n      const pageStartedAt = performance.now();\n      onProgress?.({\n        stage: 'fetching',\n        phase: 'request-start',\n        page_count: pages.length,\n        raw_record_count: rawRecordCount,\n        page_number: pageNumber,\n        page_started_at: pageStartedAt\n      });\n      const data = await fetchPage(cursor, pageNumber, previousPageInfo);\n",
    'pagination request-start progress'
  )
  text = replace_once(
    text,
    "      onProgress?.({\n        stage: 'fetching',\n        page_count: pages.length,\n        raw_record_count: rawRecordCount\n      });\n",
    "      onProgress?.({\n        stage: 'fetching',\n        phase: 'request-complete',\n        page_count: pages.length,\n        raw_record_count: rawRecordCount,\n        page_number: pageNumber,\n        page_started_at: 0\n      });\n",
    'pagination request-complete progress'
  )

  text = regex_replace_once(
    text,
    r"    if \(stage === 'fetching'\) \{[\s\S]*?\n    \}\n    if \(stage === 'recovering-images'\) \{",
    "    if (stage === 'fetching') {\n      const pageNumber = Number(progressState.fetch_page_number) || (Number(progressState.page_count) || 0) + 1;\n      const pageElapsed = progressState.fetch_page_started_at > 0\n        ? Math.max(0, now - progressState.fetch_page_started_at)\n        : 0;\n      return `${prefix}: fetching API page ${pageNumber}…\\\nCompleted: ${progressState.page_count} page(s), ${progressState.raw_record_count} raw record(s)\\\nPage elapsed: ${formatDuration(pageElapsed)} — Total elapsed: ${formatDuration(elapsed)}`;\n    }\n    if (stage === 'recovering-images') {",
    'fetching live status'
  )

  text = replace_once(
    text,
    "      const fetched = await fetchConversationPages(conversationId, progress => {\n        progressState.stage = 'fetching';\n        progressState.page_count = progress.page_count;\n        progressState.raw_record_count = progress.raw_record_count;\n        refreshStatus();\n      });\n",
    "      const fetched = await fetchConversationPages(conversationId, progress => {\n        progressState.stage = 'fetching';\n        progressState.page_count = progress.page_count;\n        progressState.raw_record_count = progress.raw_record_count;\n        progressState.fetch_page_number = progress.page_number;\n        progressState.fetch_page_started_at = progress.page_started_at;\n        refreshStatus();\n      });\n",
    'runExport fetch progress fields'
  )

  text = replace_once(
    text,
    "        progressState.stage = 'rendering';\n        progressState.render_started_at = performance.now();\n        progressState.record_count = spine.records.length;\n",
    "        progressState.stage = 'rendering';\n        progressState.render_started_at = performance.now();\n        progressState.record_number = 0;\n        progressState.record_count = spine.records.length;\n        refreshStatus();\n        // Yield once so the completed image state is painted before synchronous rendering begins.\n        await new Promise(resolve => setTimeout(resolve, 0));\n",
    'post-image paint yield'
  )

  text = regex_replace_once(
    text,
    r"        /\*\* Markdown fingerprint reused by downstream debug boundaries when debug logging is enabled\. \*/[\s\S]*?\n        const blobStartedAt = performance\.now\(\);",
    "        if (diagnosticEnabled('debug')) {\n          const sourceTail = spine.records.slice(-32).map(item => ({\n            source_record_id: item?.message_id ?? item?.message?.id ?? null,\n            source_role: item?.role ?? item?.message?.author?.role ?? null,\n            source_channel: item?.channel ?? item?.message?.channel ?? null,\n            source_content_type: item?.content_type ?? item?.message?.content?.content_type ?? null\n          }));\n          logDiagnostic('debug', 'conversation-export-markdown-ready', {\n            filename,\n            source_record_count: spine.records.length,\n            source_tail: sourceTail,\n            markdown_length: markdown.length\n          });\n        }\n        const blobStartedAt = performance.now();",
    'remove full-markdown diagnostic scan'
  )
  text = replace_once(
    text,
    "            markdown_length: markdown.length,\n            markdown_hash: markdownHash,\n            blob_size: markdownBlob.size,\n",
    "            markdown_length: markdown.length,\n            blob_size: markdownBlob.size,\n",
    'remove blob markdown hash'
  )
  return text


def patch_heading_test(text):
  return replace_once(
    text,
    r'assert.match(userscript, /\/\/ @version      0\.6\.168/);',
    r'assert.match(userscript, /\/\/ @version      0\.6\.169/);',
    'heading test version'
  )


def patch_panel_test(text):
  anchor = "  assert.match(userscript, /recoveredImages = Math\\.max\\(recoveredImages, context\\.image_number\\);/,\n    'Image recovery progress must advance as each individual image operation completes.');\n"
  addition = anchor + "  assert.match(userscript, /fetching API page \\${pageNumber}/,\n    'Conversation fetching status must identify the currently awaited API page.');\n  assert.match(userscript, /Page elapsed: \\${formatDuration\\(pageElapsed\\)}/,\n    'Conversation fetching status must keep a live elapsed heartbeat while a page request is pending.');\n  assert.match(userscript, /await new Promise\\(resolve => setTimeout\\(resolve, 0\\)\\);/,\n    'Image completion must yield once so the next phase can paint before synchronous rendering.');\n"
  return replace_once(text, anchor, addition, 'panel live-feedback regressions')


def patch_diag_test(text):
  text = replace_once(
    text,
    "  assert.match(userscript, /function diagnosticTextHash\\(text\\)/);\n  assert.match(userscript, /function diagnosticMarkdownTurnInventory\\(markdown, tailCount = 12\\)/);\n",
    "",
    'issue 114 obsolete helper assertions'
  )
  text = replace_once(
    text,
    "  assert.match(userscript, /phase: 'markdown-diagnostics'/);\n",
    "",
    'obsolete diagnostics phase assertion'
  )
  stale = """test('issue 119 gates expensive export-tail fingerprints behind debug diagnostics and reuses the result', () => {
  const readyIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-export-markdown-ready'");
  const blobIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-export-blob-created'");
  assert.ok(readyIndex > 0 && blobIndex > readyIndex);
  const diagnosticStart = userscript.lastIndexOf('const diagnosticStartedAt = performance.now();', readyIndex);
  const diagnosticEnd = userscript.indexOf('const blobStartedAt = performance.now();', readyIndex);
  assert.ok(diagnosticStart > 0 && diagnosticEnd > diagnosticStart,
    'Markdown-ready diagnostics must have a bounded debug-only phase.');
  const diagnosticBlock = userscript.slice(diagnosticStart, diagnosticEnd);
  assert.match(diagnosticBlock, /markdownHash = diagnosticTextHash\\(markdown\\)/);
  assert.match(diagnosticBlock, /markdown_hash: markdownHash/);
  assert.equal((diagnosticBlock.match(/diagnosticTextHash\\(markdown\\)/g) ?? []).length, 1,
    'The export-tail diagnostic phase should calculate its full Markdown fingerprint only once.');
});
"""
  compact = """test('issue 119 keeps Markdown-ready diagnostics compact after removing full-document scans', () => {
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
"""
  text = replace_once(text, stale, compact, 'stale fingerprint regression')

  start = text.index("test('issue 119 live evidence removes redundant Markdown scans and uses 20-record pages'")
  if start < 0:
    raise SystemExit('issue 119 live-evidence test: start not found')
  end = text.find("\n});", start)
  if end < 0:
    raise SystemExit('issue 119 live-evidence test: end not found')
  end += len("\n});")
  replacement = r"""
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
});"""
  return text[:start] + replacement + text[end:]


def patch_design(text):
  addition = """

## Issue #119 superseding live evidence: page size and UI heartbeat

The later 0.6.168 live run supersedes the earlier decision to request 20 turns per
Conversation API page.  On the same conversation, a single `num_turns=100`
request fetched all 4392 source records in 15.133 seconds, while four
`num_turns=20` cursor-chained requests required 41.016 seconds in total.  The
pagination API exposes the next backward cursor only in the preceding response,
so those requests are structurally sequential; they are not parallelized without
separate evidence for an independent range API.

Production therefore returns to `PAGE_TURNS = 100`.  User feedback no longer
depends on small pages: progress marks a page as in-flight before awaiting it and
the existing one-second status timer displays the current API page, completed
page/record counts, current-page elapsed time, and whole-export elapsed time.

The same run showed why the UI could remain visibly stuck on an old image count.
All seven image-pointer operations completed in 24 ms, but the one remaining
full-document Debug hash/turn-ID inventory then blocked the main thread for
17.768 seconds while scanning roughly 24.2 million Markdown characters.  That
whole-document scan and its hash/inventory helpers are removed.  The
`conversation-export-markdown-ready` boundary retains compact source-tail and
length metadata without rescanning the document, and the Blob boundary no longer
reports a Markdown hash.

After image recovery the export also yields one browser task before synchronous
Markdown rendering.  This does not change image recovery behavior; it gives the
completed image state and rendering transition a chance to paint so a prior
`5/7` display cannot remain on screen while later CPU work is running.

No image concurrency, timeout, retry, or fallback policy is introduced by this
correction.
"""
  if '## Issue #119 superseding live evidence: page size and UI heartbeat' in text:
    raise SystemExit('design addition already present')
  return text.rstrip() + addition.rstrip() + '\n'


def patched_files():
  files = [
    (USERSCRIPT, patch_userscript),
    (HEADING_TEST, patch_heading_test),
    (PANEL_TEST, patch_panel_test),
    (DIAG_TEST, patch_diag_test),
    (DESIGN, patch_design),
  ]
  result = []
  for path, patch in files:
    old = path.read_text(encoding='utf-8')
    new = patch(old)
    result.append((path, old, new))
  return result


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--check', action='store_true')
  args = parser.parse_args()
  changes = patched_files()
  if args.check:
    for path, old, new in changes:
      print(''.join(difflib.unified_diff(
        old.splitlines(keepends=True), new.splitlines(keepends=True),
        fromfile=f'a/{path}', tofile=f'b/{path}'
      )), end='')
    return
  for path, _, new in changes:
    path.write_text(new, encoding='utf-8')


if __name__ == '__main__':
  main()
