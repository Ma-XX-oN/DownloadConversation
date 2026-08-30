from pathlib import Path
import re

SCRIPT = Path('chatgpt-conversation-markdown-export.user.js')
text = SCRIPT.read_text(encoding='utf-8')

TYPE_BY_NAME = {
  'record': 'Object', 'sourceRecord': 'Object', 'canonicalEvent': 'Object', 'event': 'Event|Object',
  'block': 'Object', 'segment': 'Array<Object>', 'segmentRecords': 'Array<Object>', 'records': 'Array<Object>',
  'events': 'Array<Object>', 'blocks': 'Array<Object>', 'items': 'Array<Object>', 'parts': 'Array<unknown>',
  'options': 'Object', 'state': 'Object', 'metadata': 'Object', 'payload': 'Object|string', 'detail': 'Object',
  'map': 'Map<unknown, unknown>', 'lookup': 'Map<unknown, unknown>', 'set': 'Set<unknown>',
  'element': 'Element', 'node': 'Node', 'section': 'HTMLElement', 'panel': 'HTMLElement', 'dialog': 'HTMLElement',
  'button': 'HTMLButtonElement', 'input': 'HTMLInputElement', 'select': 'HTMLSelectElement',
  'anchor': 'HTMLAnchorElement', 'container': 'HTMLElement', 'target': 'EventTarget|null',
  'directoryHandle': 'FileSystemDirectoryHandle', 'fileHandle': 'FileSystemFileHandle', 'handle': 'FileSystemHandle',
  'file': 'File', 'blob': 'Blob', 'response': 'Response', 'request': 'Request',
  'error': 'Error|unknown', 'reason': 'string', 'message': 'string', 'text': 'string', 'markdown': 'string',
  'html': 'string', 'value': 'string', 'name': 'string', 'label': 'string', 'title': 'string', 'url': 'string',
  'path': 'string', 'key': 'string', 'id': 'string', 'turnId': 'string', 'messageId': 'string',
  'sourceRecordId': 'string', 'conversationId': 'string', 'contentType': 'string', 'language': 'string',
  'index': 'number', 'recordIndex': 'number', 'sourceIndex': 'number', 'partIndex': 'number', 'ordinal': 'number',
  'count': 'number', 'total': 'number', 'attempt': 'number', 'delayMs': 'number', 'timeoutMs': 'number',
  'start': 'number', 'end': 'number', 'offset': 'number', 'length': 'number',
  'callback': 'Function', 'predicate': 'Function', 'fn': 'Function'
}

RETURN_BY_NAME = {
  'canonicalCore': ('Object', 'The loaded AIConversationCore browser API after required entry points are validated.'),
  'canonicalEventsBySourceRecord': ('Map<string, Array<Object>>', 'Canonical events indexed by their preserved source record identifiers.'),
  'canonicalMessageRecordEligible': ('boolean', 'Whether the source message record can be rendered by the canonical renderer without losing required semantics.'),
  'canonicalThoughtRecordEligible': ('boolean', 'Whether the canonical Assistant activity event is supported by the shared canonical renderer.'),
  'canonicalAssistantSegmentEligible': ('boolean', 'Whether the complete Assistant activity segment can be rendered canonically as-is.'),
  'canonicalRecordBlock': ('string|null', 'The rendered canonical Markdown block with DownloadConversation source identity, or `null` when canonical rendering is unavailable.'),
  'canonicalAssistantSegmentBlock': ('string|null', 'The rendered canonical Assistant segment with DownloadConversation source identity, or `null` when canonical rendering is unavailable.'),
  'canonicalRecoveredImageState': ('Object', 'The canonical availability state derived from one recovered image representation.'),
  'canonicalEnrichRecoveredImages': ('Array<Object>', 'The canonical events with matching image resources enriched by recovered image state.'),
  'renderConversationMarkdown': ('string', 'The complete DownloadConversation Markdown transcript in established source-record order.'),
  'apiRecordsJsonl': ('string', 'The complete JSONL export containing metadata followed by source API records in established order.'),
  'conversationMetadataJsonlRecord': ('Object', 'The DownloadConversation metadata object prepended to a JSONL export.'),
  'transcriptHeading': ('string', 'The Markdown heading containing the provider/source turn identity.'),
  'quoteMarkdown': ('string', 'The input text represented as Markdown blockquote lines.'),
  'cgCodeFence': ('string', 'A collision-safe Markdown code fence containing the literal payload.'),
  'cgInferCodeLanguage': ('string', 'The inferred fallback Markdown fence language, or an empty string when no language is justified.'),
  'cgRenderDetail': ('string', 'The fallback HTML details block containing the supplied summary and body.'),
  'cgRenderThoughtItem': ('string', 'The fallback Markdown representation of one Assistant reasoning/tool source record.'),
  'cgRenderThoughtBlock': ('string', 'The fallback Thoughts details block for the ordered reasoning/tool records.'),
  'runExport': ('Promise<void>', 'A promise that resolves after the requested export completes or its failure has been reported.'),
}

DESC_BY_NAME = {
  'record': 'The provider/source record to process.',
  'sourceRecord': 'The provider/source record whose identity and content are being processed.',
  'records': 'The ordered provider/source records to process.',
  'recordIndex': 'The zero-based index of the provider/source record.',
  'sourceIndex': 'The zero-based index of the provider/source record.',
  'sourceRecordId': 'The stable provider/source record identifier.',
  'turnId': 'The provider/source turn identifier.',
  'messageId': 'The provider/source message identifier.',
  'markdown': 'The Markdown text to process.',
  'text': 'The text to process.',
  'element': 'The DOM element to inspect or update.',
  'button': 'The button element to configure or inspect.',
  'event': 'The event or event-like object being handled.',
  'directoryHandle': 'The File System Access API directory handle used for persistent recorder files.',
  'fileHandle': 'The File System Access API file handle being read or written.',
  'segmentRecords': 'The ordered provider/source records belonging to one Assistant activity segment.',
  'canonicalEvent': 'The canonical event corresponding to the source record.',
  'options': 'Configuration options controlling this operation.',
}


def split_top_level(value):
  parts = []
  start = 0
  stack = []
  quote = None
  escape = False
  pairs = {')': '(', ']': '[', '}': '{'}
  for i, ch in enumerate(value):
    if quote:
      if escape:
        escape = False
      elif ch == '\\':
        escape = True
      elif ch == quote:
        quote = None
      continue
    if ch in "'\"`":
      quote = ch
      continue
    if ch in '([{':
      stack.append(ch)
    elif ch in pairs and stack:
      stack.pop()
    elif ch == ',' and not stack:
      parts.append(value[start:i].strip())
      start = i + 1
  tail = value[start:].strip()
  if tail:
    parts.append(tail)
  return parts


def strip_default(param):
  stack = []
  quote = None
  escape = False
  pairs = {')': '(', ']': '[', '}': '{'}
  for i, ch in enumerate(param):
    if quote:
      if escape: escape = False
      elif ch == '\\': escape = True
      elif ch == quote: quote = None
      continue
    if ch in "'\"`": quote = ch; continue
    if ch in '([{': stack.append(ch)
    elif ch in pairs and stack: stack.pop()
    elif ch == '=' and not stack:
      return param[:i].strip(), param[i + 1:].strip()
  return param.strip(), None


def infer_type(name, default=None, rest=False):
  typ = TYPE_BY_NAME.get(name)
  if typ is None:
    if re.search(r'(?:Index|Offset|Count|Length|Ordinal|Number|Size|Depth|Start|End|Ms)$', name): typ = 'number'
    elif re.match(r'^(?:is|has|can|should|include|allow|enabled|visible|hidden|force|exact)', name): typ = 'boolean'
    elif re.search(r'(?:Records|Events|Blocks|Parts|Items|Sources|Citations|References|Entries|Groups|Values|Warnings|Files|Images)$', name): typ = 'Array<Object>'
    elif re.search(r'(?:Map|Lookup|Index)$', name): typ = 'Map<unknown, unknown>'
    elif re.search(r'(?:Set)$', name): typ = 'Set<unknown>'
    elif re.search(r'(?:Element|Node|Panel|Dialog|Container)$', name): typ = 'HTMLElement'
    elif re.search(r'(?:Callback|Handler|Predicate|Fn)$', name): typ = 'Function'
    elif re.search(r'(?:Text|Markdown|Html|HTML|Label|Name|Url|URL|Id|ID|Key|Language|Kind|Role|Path|Pattern|Token|Summary|Body|Title|Level|Phase)$', name): typ = 'string'
    else: typ = 'Object'
  if default:
    d = default.strip()
    if d == 'null' and 'null' not in typ: typ += '|null'
    elif d == 'undefined' and 'undefined' not in typ: typ += '|undefined'
    elif d in {'true', 'false'}: typ = 'boolean'
    elif re.fullmatch(r'-?\d+(?:\.\d+)?', d): typ = 'number'
    elif d.startswith(('"', "'", '`')): typ = 'string'
    elif d.startswith('[]'): typ = 'Array<unknown>'
    elif d.startswith('{}'): typ = 'Object'
    elif d.startswith('new Map'): typ = 'Map<unknown, unknown>'
    elif d.startswith('new Set'): typ = 'Set<unknown>'
  return f'Array<{typ}>' if rest else typ


def param_desc(name):
  if name in DESC_BY_NAME: return DESC_BY_NAME[name]
  human = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', name).replace('_', ' ').lower()
  if name.endswith('Index'): return f'The zero-based {human[:-6].strip()} index.'
  if name.endswith('Ms'): return f'The {human[:-3].strip()} duration in milliseconds.'
  return f'The {human} value used by this operation.'


def return_contract(name, async_fn, body):
  if name in RETURN_BY_NAME:
    typ, desc = RETURN_BY_NAME[name]
  elif re.match(r'^(?:is|has|can|should)', name):
    typ, desc = 'boolean', f'Whether the condition checked by `{name}` is satisfied.'
  elif not re.search(r'\breturn\b', body):
    typ, desc = 'void', 'No value is returned.'
  elif re.search(r'\breturn\s+(?:true|false)\b', body):
    typ, desc = 'boolean', f'The Boolean result produced by `{name}`.'
  elif re.search(r'\breturn\s+(?:`|["\'])', body):
    typ, desc = 'string', f'The text representation produced by `{name}`.'
  elif re.search(r'\breturn\s+\[', body):
    typ, desc = 'Array<unknown>', f'The ordered values produced by `{name}`.'
  elif re.search(r'\breturn\s+new\s+Map\b', body):
    typ, desc = 'Map<unknown, unknown>', f'The lookup map produced by `{name}`.'
  elif re.search(r'\breturn\s+new\s+Set\b', body):
    typ, desc = 'Set<unknown>', f'The set produced by `{name}`.'
  elif name.startswith(('render', 'format', 'quote', 'escape', 'serialize')) or name.endswith(('Markdown', 'Heading', 'Label', 'Text', 'Html', 'HTML')):
    typ, desc = 'string', f'The text representation produced by `{name}`.'
  elif name.startswith(('find', 'get', 'resolve', 'parse', 'extract', 'canonical')):
    typ, desc = 'Object|null', f'The value resolved by `{name}`, or `null` when no matching value is available.'
  elif name.startswith(('collect', 'build', 'create', 'make')):
    typ, desc = 'Object', f'The structured value produced by `{name}`.'
  else:
    typ, desc = 'Object|boolean|string|number|null', f'The result produced by `{name}` according to the operation outcome.'
  if async_fn and not typ.startswith('Promise<'):
    typ = f'Promise<{typ}>'
    desc = 'A promise resolving to ' + desc[0].lower() + desc[1:]
  return typ, desc


def find_close(text, open_pos, open_ch='(', close_ch=')'):
  depth = 0
  quote = None
  escape = False
  for i in range(open_pos, len(text)):
    ch = text[i]
    if quote:
      if escape: escape = False
      elif ch == '\\': escape = True
      elif ch == quote: quote = None
      continue
    if ch in "'\"`": quote = ch; continue
    if ch == open_ch: depth += 1
    elif ch == close_ch:
      depth -= 1
      if depth == 0: return i
  return -1


def function_body(text, signature_end):
  brace = text.find('{', signature_end)
  if brace < 0: return ''
  close = find_close(text, brace, '{', '}')
  return text[brace + 1:close] if close >= 0 else text[brace + 1:]


def declarations(text):
  out = []
  patterns = [
    re.compile(r'(?m)^(?P<indent>[ \t]*)(?P<async>async\s+)?function\*?\s+(?P<name>[A-Za-z_$][\w$]*)\s*\('),
    re.compile(r'(?m)^(?P<indent>[ \t]*)(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?P<async>async\s+)?function\*?\s*\('),
    re.compile(r'(?m)^(?P<indent>[ \t]*)(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?P<async>async\s*)?\('),
    re.compile(r'(?m)^(?P<indent>[ \t]*)(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?P<async>async\s+)?(?P<single>[A-Za-z_$][\w$]*)\s*=>')
  ]
  for pidx, pattern in enumerate(patterns):
    for m in pattern.finditer(text):
      if pidx < 3:
        open_pos = text.find('(', m.start(), m.end() + 1)
        close_pos = find_close(text, open_pos)
        if close_pos < 0: continue
        if pidx == 2 and not re.match(r'\s*=>', text[close_pos + 1:]): continue
        params = text[open_pos + 1:close_pos]
        sig_end = close_pos + 1
      else:
        params = m.group('single')
        sig_end = m.end()
      out.append((m.start(), m.group('indent'), m.group('name'), params, bool(m.groupdict().get('async')), sig_end))
  return sorted({item[0]: item for item in out}.values())


def jsdoc_bounds(text, start):
  prefix = text[:start]
  stripped = prefix.rstrip()
  if not stripped.endswith('*/'): return None
  end = len(stripped)
  begin = stripped.rfind('/**')
  if begin < 0: return None
  return begin, end


def enrich(doc, params_text, name, async_fn, body):
  lines = doc.splitlines()
  indent = re.match(r'^(\s*)', lines[0]).group(1)
  body_lines = [line for line in lines[:-1] if not re.match(r'\s*\*\s+@(param|returns?)\b', line)]
  if body_lines and body_lines[-1].strip() != '*': body_lines.append(indent + ' *')
  for ordinal, raw in enumerate(split_top_level(params_text), 1):
    lhs, default = strip_default(raw)
    rest = lhs.startswith('...')
    lhs = lhs[3:].strip() if rest else lhs
    if lhs.startswith('{'):
      pname = f'options{ordinal}'
      body_lines.append(f'{indent} * @param {{Object}} {pname} - The destructured options object used by this operation.')
      for prop in re.findall(r'([A-Za-z_$][\w$]*)\s*(?:=|,|}|$)', lhs):
        body_lines.append(f'{indent} * @param {{{infer_type(prop)}}} {pname}.{prop} - {param_desc(prop)}')
    elif lhs.startswith('['):
      pname = f'values{ordinal}'
      body_lines.append(f'{indent} * @param {{Array<unknown>}} {pname} - The destructured array argument used by this operation.')
    else:
      pname = lhs
      body_lines.append(f'{indent} * @param {{{infer_type(pname, default, rest)}}} {pname} - {param_desc(pname)}')
  rtype, rdesc = return_contract(name, async_fn, body)
  body_lines.append(f'{indent} * @returns {{{rtype}}} {rdesc}')
  body_lines.append(indent + ' */')
  return '\n'.join(body_lines)

edits = []
for start, indent, name, params, async_fn, sig_end in declarations(text):
  bounds = jsdoc_bounds(text, start)
  if not bounds:
    raise AssertionError(f'Missing existing JSDoc for {name} at offset {start}')
  begin, end = bounds
  doc = text[begin:end]
  new_doc = enrich(doc, params, name, async_fn, function_body(text, sig_end))
  edits.append((begin, end, new_doc))

for begin, end, replacement in sorted(edits, reverse=True):
  text = text[:begin] + replacement + text[end:]

SCRIPT.write_text(text, encoding='utf-8')

rules = Path('AI_AGENT_RULES.md')
rules_text = rules.read_text(encoding='utf-8')
old = 'Every named production JavaScript function and named function-valued constant must have an immediately preceding JSDoc block using `/** ... */`. The comment must state the function\'s purpose. When a function normalizes, transforms, projects, or otherwise changes the representation of source/provider data, its documentation must also state the actual source representation and the canonical/output representation when they differ.'
new = 'Every named production JavaScript function and named function-valued constant must have an immediately preceding JSDoc block using `/** ... */`. The comment must state the function\'s purpose. Every declared parameter must have an `@param` tag with the expected JSDoc type and a description of what the parameter represents. Every function must have a typed `@returns` tag whose description states what the return value represents; functions with no meaningful return value use `@returns {void}`. When a function normalizes, transforms, projects, or otherwise changes the representation of source/provider data, its documentation must also state the actual source representation and the canonical/output representation when they differ.'
assert old in rules_text
rules.write_text(rules_text.replace(old, new, 1), encoding='utf-8')
