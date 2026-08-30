from pathlib import Path
import re

SOURCE = Path('chatgpt-conversation-markdown-export.user.js')

GLOBAL_DOCS = {
  'VERSION': 'Installed userscript version reported in diagnostics and runtime metadata.',
  'PANEL_ID': 'DOM id of the recorder panel so UI lookups share one stable selector.',
  'LAUNCHER_ID': 'DOM id of the floating launcher button that opens the recorder panel.',
  'DIAGNOSTIC_LEVELS': 'Numeric severity ordering used to decide which diagnostic entries are emitted.',
  'DEFAULT_DIAGNOSTICS': 'Default diagnostic threshold when the user has not stored a preference.',
  'PAGE_TURNS': 'Conversation API page size requested while walking backward through history.',
  'MAX_PAGES': 'Safety cap that prevents malformed pagination from running without bound.',
  'SCREEN_ON_STORAGE_KEY': 'Local-storage key for the keep-screen-on capture preference.',
  'DIAGNOSTIC_LOG_STORAGE_KEY': 'Session-storage key for the retained recorder diagnostic log.',
  'MAX_DIAGNOSTIC_LOG_ITEMS': 'Maximum number of diagnostic entries retained in memory and session storage.',
  'originalPageFetch': 'Unwrapped page-realm fetch implementation captured before installing interception.',
  'apiRequestContext': 'Latest captured Conversation API authorization/header context for direct requests.',
  'captureInstalled': 'Guards network interception so page hooks are installed only once.',
  'diagnosticsLevel': 'Currently selected diagnostic threshold, restored from local storage at startup.',
  'screenOnWhenCapturing': 'Whether active exports should request a screen wake lock.',
  'wakeLockSentinel': 'Active screen wake-lock handle, or null when no lock is held.',
  'exportInProgress': 'Serializes export work so overlapping extraction runs cannot start.',
  'exportKind': 'Format of the active export, used by shared status/progress rendering.',
  'statusText': 'Persistent status message shown when no structured progress state is active.',
  'statusTimer': 'Interval handle used to refresh elapsed time and ETA while work is active.',
  'progressState': 'Structured state for the active fetch/render progress display.',
  'testInProgress': 'Guards the built-in test runner against overlapping operations.',
  'jumpInProgress': 'Guards turn-jump navigation against overlapping operations.',
  'clickDiagnosticSequence': 'Monotonic identifier assigned to click-correlation diagnostic observations.',
  'activeClickDiagnostic': 'Click observation currently collecting correlated network/resource evidence.',
  'diagnosticLog': 'In-memory diagnostic history mirrored to session storage for the panel.',
  'diagnosticLogExpanded': 'Whether the recorder panel currently shows the expanded diagnostic history.',
  'lastModalOpener': 'Element to refocus after the active recorder modal closes.',
  'CG_INLINE_TOKEN_START': 'Private-use marker that begins a fallback inline-reference token.',
  'CG_INLINE_TOKEN_END': 'Private-use marker that terminates a fallback inline-reference token.',
  'CG_INLINE_TOKEN_SEP': 'Private-use separator between fields inside a fallback inline-reference token.',
  'CG_INLINE_TOKEN_RX': 'Matcher for complete fallback inline-reference tokens embedded in source text.',
  'TEST_MATRIX_ID': 'DOM id of the built-in test matrix overlay.',
  'TEST_RESULT_HISTORY_KEY': 'Local-storage key for the previous built-in test outcomes.',
  'testMatrixPreviousResults': 'Last persisted PASS/FAIL result for each built-in test.',
  'testMatrixCurrentResults': 'Results produced during the current built-in test session.',
  'launcher': 'Floating button that remains available to open the recorder panel.',
}

LOCAL_COMMENTS = {
  '    let imageOrdinal = null;':
    'One-based image ordinal used to correlate a click with the matching source image.',
  '    const active = activeClickDiagnostic;':
    'Snapshot the observation so this request is attributed to one click consistently.',
  "    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;":
    'Use the page realm rather than the userscript sandbox when intercepting page networking.',
  '    const XHR = pageWindow.XMLHttpRequest;':
    'Retain the page-realm XHR constructor whose prototype is patched for capture.',
  '    const context = apiRequestContext;':
    'Snapshot the captured request context used to authorize this direct API request.',
  '    const fetchFn = originalPageFetch || pageWindow.fetch;':
    'Prefer the pre-interception fetch implementation to avoid recursively capturing ourselves.',
  '    const pages = [];':
    'Pages are accumulated newest-to-oldest as the API previous-page cursor is followed.',
  '    const seenCursors = new Set();':
    'Tracks pagination cursors already consumed so a server loop is detected immediately.',
  '    let rawRecordCount = 0;':
    'Running count of source records fetched across all Conversation API pages.',
  '    let cursor = null;':
    'Null requests the newest page; later values request progressively older pages.',
  '    const messageIndexById = new Map();':
    'Maps each stable message id to its slot so duplicate page overlap can be replaced in place.',
  '    const messages = [];':
    'De-duplicated Conversation API messages in chronological source order.',
  '    let duplicateMessageIds = 0;':
    'Counts page-overlap records whose stable message id was already present.',
  '    const uapAnchors = [];':
    'User records become chronological UAP anchors for associating following activity.',
  '    const freeformKeys = new Set([':
    'Content-bearing fields are excluded from identifier linkage scanning to avoid false matches.',
  '    const exchangeToAnchors = new Map();':
    'Maps each exact turn-exchange id to the UAP anchor ordinals that carry it.',
  '    const workingToAnchors = new Map();':
    'Maps each exact working-turn id to the UAP anchor ordinals that carry it.',
  '    const groups = anchors.map(anchor => ({':
    'Allocate one grouping bucket per User anchor without changing chronological order.',
  '    const classifications = [];':
    'Stores one association classification for every source record in spine order.',
  "    const counts = { exact: 0, fallback: 0, ungrouped: 0, conflict: 0 };":
    'Summarizes association evidence without affecting the grouping decisions themselves.',
  '    const exactMessageToUap = new Map();':
    'Reverse lookup from exactly-associated message ids to their proven UAP ordinal.',
  '    const exactIdentifierToUaps = new Map();':
    'Reverse lookup from identifier-like source values to UAPs established by exact records.',
  '    const linkageByOrdinal = new Map(':
    'Indexes unresolved-linkage analysis by source ordinal for the refinement pass.',
  '    const groups = (spine?.uap_anchors ?? []).map(anchor => ({':
    'Build refined UAP buckets aligned one-for-one with the existing anchor ordinals.',
  '    let rendered = \'\';':
    'Accumulates rewritten Markdown while cursor tracks the next unread source character.',
  '    let cursor = 0;':
    'Offset of the next source character not yet copied into the rewritten Markdown.',
  '      let nestedParentheses = 0;':
    'Tracks parentheses nested inside the Markdown link destination being scanned.',
  '      let sourceEnd = -1;':
    'Index of the closing parenthesis for the current sandbox link destination.',
  '    let imageIndex = 0;':
    'Advances only across canonical conversation-image resources to preserve source ordinals.',
  '    const bySourceRecord = new Map();':
    'Maps stable source record ids back to their adapted canonical events.',
  '    const fileRefIndex = cgBuildFileReferenceIndex(records);':
    'Fallback citation lookup keyed by ChatGPT retrieval turn/file coordinates.',
  '    const canonicalEventBySourceRecord = canonicalEventsBySourceRecord(records, recoveredImageMap);':
    'Canonical-event lookup kept in source-record identity space for order-preserving rendering.',
  '    let pendingThoughts = [];':
    'Buffers Assistant reasoning/tool activity until its complete output segment can be rendered.',
  '    let messageIndex = -1;':
    'Tracks the single final Assistant message position allowed in a canonical activity segment.',
  '    const sentinel = wakeLockSentinel;':
    'Detach the current wake-lock handle before awaiting release to avoid stale global state.',
  '    let uapIndex = -1;':
    'Tracks the latest User anchor at or before the requested source record.',
  '    const exactUrls = new Set([':
    'DOM-derived URLs are exact evidence candidates before broader resource heuristics are tried.',
  '    const recovered = new Map();':
    'Recovered image Markdown is keyed by source message id for later canonical enrichment.',
  '    const originalScrollTop = scrollRoot.scrollTop;':
    'Preserve the caller scroll position so image recovery can restore the page exactly.',
}


def previous_nonblank(lines, index):
  pos = index - 1
  while pos >= 0 and not lines[pos].strip():
    pos -= 1
  return pos


def has_immediate_comment(lines, index):
  pos = previous_nonblank(lines, index)
  if pos < 0:
    return False
  stripped = lines[pos].lstrip()
  return stripped.startswith('//') or stripped.endswith('*/')


def add_global_docs(lines):
  declaration = re.compile(r'^  (?:const|let|var)\s+([A-Za-z_$][\w$]*)\b')
  result = []
  seen = set()
  for line in lines:
    match = declaration.match(line)
    if match:
      name = match.group(1)
      seen.add(name)
      if not has_immediate_comment(result, len(result)):
        doc = GLOBAL_DOCS.get(name)
        if not doc:
          raise SystemExit(f'Missing semantic documentation for top-level declaration: {name}')
        result.append(f'  /** {doc} */')
    result.append(line)
  missing = sorted(set(GLOBAL_DOCS) - seen)
  if missing:
    raise SystemExit('Configured global declarations were not found: ' + ', '.join(missing))
  return result


def add_local_comments(lines):
  matched = {key: 0 for key in LOCAL_COMMENTS}
  result = []
  for line in lines:
    if line in LOCAL_COMMENTS:
      matched[line] += 1
      if not has_immediate_comment(result, len(result)):
        indent = line[:len(line) - len(line.lstrip())]
        result.append(f'{indent}// {LOCAL_COMMENTS[line]}')
    result.append(line)
  missing = [key for key, count in matched.items() if count == 0]
  if missing:
    raise SystemExit('Configured local declarations were not found:\n' + '\n'.join(missing))
  return result


original = SOURCE.read_text(encoding='utf-8')
lines = original.splitlines()
lines = add_global_docs(lines)
lines = add_local_comments(lines)
updated = '\n'.join(lines) + ('\n' if original.endswith('\n') else '')
SOURCE.write_text(updated, encoding='utf-8')
print(f'Added semantic variable documentation; source bytes {len(original)} -> {len(updated)}.')
