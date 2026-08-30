from pathlib import Path
import re

SCRIPT = Path('chatgpt-conversation-markdown-export.user.js')
text = SCRIPT.read_text(encoding='utf-8')

SPECIAL = {
  'cgCodeFence': [
    'Wraps opaque source/tool payload text in a collision-safe Markdown code fence.',
    '',
    'Source -> output transformation: scans the literal payload for its longest run of backtick characters, then emits an outer fence one character longer (minimum three). The payload itself is not rewritten.'
  ],
  'cgInferCodeLanguage': [
    'Infers a Markdown fence language only for the legacy/fallback renderer when no stronger canonical language is available.',
    '',
    'Source -> output transformation: explicit source language wins; otherwise provider metadata/recipient and limited code-prefix evidence may map to a fence language such as `python` or `bash`. This fallback does not alter payload text.'
  ],
  'canonicalRecoveredImageState': [
    'Converts DownloadConversation recovery Markdown for one image into canonical image-resource state.',
    '',
    'Source -> canonical transformation: recovered data-image Markdown becomes `status: available` plus `data_url`; missing/unavailable placeholders become the corresponding canonical status and optional source pointer.'
  ],
  'canonicalEnrichRecoveredImages': [
    'Enriches canonical conversation-image resources with host-recovered image state without changing canonical event order.',
    '',
    'Source -> canonical transformation: the already-normalized image resource remains the identity-bearing object; recovery Markdown contributes only availability/data/source-pointer fields at the matching source image ordinal.'
  ],
  'canonicalEventsBySourceRecord': [
    'Adapts the actual ordered ChatGPT Conversation API records through AIConversationCore and indexes the resulting canonical events by their preserved source record IDs.',
    '',
    'Source -> canonical transformation: raw ChatGPT records are passed unchanged to `adaptChatGPTRecords` (apart from synthetic conversation metadata when required by the adapter contract); canonical events must preserve source ID/index/timestamps before they are accepted into the source-record map.'
  ],
  'canonicalMessageRecordEligible': [
    'Determines whether one source User/Assistant record and its canonical event can be rendered by the shared canonical Markdown renderer.',
    '',
    'Source/canonical -> routing transformation: returns only an eligibility decision. It never rewrites the source record or canonical event; unsupported shapes remain on the legacy fallback path.'
  ],
  'canonicalThoughtRecordEligible': [
    'Determines whether one non-message canonical Assistant activity event is supported by the shared canonical Markdown renderer.',
    '',
    'Canonical -> routing transformation: reasoning summaries, tool calls, and tool results are eligible; the event payload is not modified.'
  ],
  'canonicalAssistantSegmentEligible': [
    'Determines whether an ordered Assistant activity segment can be rendered wholly by AIConversationCore without changing its source association.',
    '',
    'Source/canonical -> routing transformation: validates semantic event combinations and returns a Boolean; it does not regroup, reorder, or rewrite records.'
  ],
  'canonicalRecordBlock': [
    'Renders one eligible canonical message event while preserving DownloadConversation source-turn identity in the transcript heading.',
    '',
    'Canonical -> output transformation: AIConversationCore supplies the plain canonical heading/body; DownloadConversation replaces only that heading with its existing source-record `turn_id` comment and preserves the rendered body.'
  ],
  'canonicalAssistantSegmentBlock': [
    'Renders one eligible canonical Assistant activity segment while preserving DownloadConversation source-turn identity in the transcript heading.',
    '',
    'Canonical -> output transformation: AIConversationCore renders the ordered segment; DownloadConversation substitutes only its established source-record heading/comment for the plain canonical heading. Tool payloads and rendered body remain opaque.'
  ],
  'renderConversationMarkdown': [
    'Projects the oldest-to-newest Conversation API spine into DownloadConversation Markdown.',
    '',
    'Source -> output transformation: each source record keeps its established order and identity; supported records/segments use AIConversationCore canonical Markdown, while unsupported source shapes retain the legacy renderer. This function does not re-associate or reorder records.'
  ],
  'apiRecordsJsonl': [
    'Serializes the Conversation API spine as DownloadConversation JSONL.',
    '',
    'Source -> output transformation: prepends one DownloadConversation conversation-metadata record, then serializes the source API message records in existing spine order without altering their provider fields.'
  ],
  'transcriptHeading': [
    'Builds the DownloadConversation transcript heading from the actual provider/source record.',
    '',
    'Source -> output transformation: the source record ID is emitted as the `turn_id` comment; it is intentionally not replaced by AIConversationCore derived turn identity.'
  ],
  'quoteMarkdown': ['Quotes literal message text as the transcript blockquote representation while preserving line order.'],
  'cgRenderDetail': ['Wraps a summary and opaque body in the HTML `details` structure used by fallback Markdown output.'],
  'cgRenderThoughtItem': ['Renders one legacy/fallback Assistant reasoning/tool source record without changing its source order.'],
  'cgRenderThoughtBlock': ['Renders the accumulated legacy/fallback Assistant reasoning/tool records as one Thoughts details block.'],
  'canonicalCore': ['Returns the loaded AIConversationCore browser API after asserting the required adapter and renderer entry points are available.'],
  'conversationMetadataJsonlRecord': ['Builds the DownloadConversation metadata record prepended to a JSONL export.'],
  'runExport': ['Runs one requested Conversation API export from acquisition through optional image recovery, rendering/serialization, download, status, and failure diagnostics.']
}

PREFIXES = [
  ('render', 'Renders'), ('canonical', 'Handles canonical'), ('conversation', 'Handles conversation'),
  ('recover', 'Recovers'), ('recovery', 'Handles recovery'), ('resolve', 'Resolves'),
  ('extract', 'Extracts'), ('fetch', 'Fetches'), ('collect', 'Collects'),
  ('build', 'Builds'), ('create', 'Creates'), ('update', 'Updates'),
  ('refresh', 'Refreshes'), ('set', 'Sets'), ('get', 'Gets'), ('load', 'Loads'),
  ('save', 'Saves'), ('open', 'Opens'), ('close', 'Closes'), ('clear', 'Clears'),
  ('show', 'Shows'), ('hide', 'Hides'), ('toggle', 'Toggles'), ('format', 'Formats'),
  ('parse', 'Parses'), ('sanitize', 'Sanitizes'), ('normalize', 'Normalizes'),
  ('diagnostic', 'Handles diagnostic'), ('log', 'Logs'), ('test', 'Tests'),
  ('assert', 'Validates'), ('is', 'Checks whether'), ('has', 'Checks whether'),
  ('can', 'Checks whether'), ('find', 'Finds'), ('wait', 'Waits for'),
  ('jump', 'Handles conversation jump'), ('mounted', 'Returns mounted'),
  ('image', 'Handles image'), ('cg', 'Handles fallback')
]

def humanize(name):
  value = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', name)
  value = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', value)
  value = value.replace('_', ' ').replace('$', '').strip().lower()
  for old, new in {
    'api': 'API', 'jsonl': 'JSONL', 'json': 'JSON', 'url': 'URL', 'id': 'ID',
    'ui': 'UI', 'dom': 'DOM', 'html': 'HTML', 'markdown': 'Markdown',
    'uap': 'UAP', 'toc': 'TOC', 'sha': 'SHA'
  }.items():
    value = re.sub(rf'\b{old}\b', new, value)
  return value

def summary(name):
  for prefix, verb in PREFIXES:
    if name.startswith(prefix) and len(name) > len(prefix):
      return f'{verb} {humanize(name[len(prefix):])}.'
  return f'Handles {humanize(name)}.'

def jsdoc(indent, name):
  lines = SPECIAL.get(name, [summary(name)])
  out = [f'{indent}/**']
  for line in lines:
    out.append(f'{indent} *{(" " + line) if line else ""}')
  out.append(f'{indent} */\n')
  return '\n'.join(out)

def has_jsdoc_before(source, start):
  return bool(re.search(r'/\*\*[\s\S]*?\*/\s*$', source[:start]))

patterns = [
  re.compile(r'(?m)^(?P<indent>[ \t]*)(?:(?:async\s+)?function\*?\s+(?P<name>[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{)'),
  re.compile(r'(?m)^(?P<indent>[ \t]*)(?:(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)'),
  re.compile(r'(?m)^(?P<indent>[ \t]*)(?:(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\*?\s*\([^)]*\)\s*\{)')
]

matches = []
seen = set()
for pattern in patterns:
  for match in pattern.finditer(text):
    if match.start() in seen or has_jsdoc_before(text, match.start()):
      continue
    seen.add(match.start())
    matches.append((match.start(), match.group('indent'), match.group('name')))

for start, indent, name in sorted(matches, reverse=True):
  text = text[:start] + jsdoc(indent, name) + text[start:]

SCRIPT.write_text(text, encoding='utf-8')

rules = Path('AI_AGENT_RULES.md')
rules_text = rules.read_text(encoding='utf-8')
marker = '## Verification\n'
assert marker in rules_text
addition = '''## Code documentation standard\n\nEvery named production JavaScript function and named function-valued constant must have an immediately preceding JSDoc block using `/** ... */`. The comment must state the function's purpose. When a function normalizes, transforms, projects, or otherwise changes the representation of source/provider data, its documentation must also state the actual source representation and the canonical/output representation when they differ.\n\nDo not use ordinary `//` comments as the function-level documentation marker. Inline comments remain appropriate for local algorithm details and rationale. Anonymous inline callbacks do not require separate JSDoc unless they are promoted to named reusable functions.\n\n'''
if '## Code documentation standard' not in rules_text:
  rules_text = rules_text.replace(marker, addition + marker, 1)
rules.write_text(rules_text, encoding='utf-8')
