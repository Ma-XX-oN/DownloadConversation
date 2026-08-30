from pathlib import Path
import re

PATH = Path('chatgpt-conversation-markdown-export.user.js')
text = PATH.read_text(encoding='utf-8')

DECL = re.compile(
  r'(?m)^(?P<indent>[ \t]*)(?:'
  r'(?:async\s+)?function\*?\s+(?P<name1>[A-Za-z_$][\w$]*)\s*\('
  r'|(?:const|let|var)\s+(?P<name2>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\*?\s*\('
  r'|(?:const|let|var)\s+(?P<name3>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\('
  r')'
)
SINGLE = re.compile(
  r'(?m)^(?P<indent>[ \t]*)(?:const|let|var)\s+'
  r'(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?P<async>async\s+)?'
  r'(?P<param>[A-Za-z_$][\w$]*)\s*=>'
)


def find_closing(source, start, opener, closer):
  depth = 0
  quote = None
  escape = False
  i = start
  while i < len(source):
    ch = source[i]
    if quote:
      if escape:
        escape = False
      elif ch == '\\':
        escape = True
      elif ch == quote:
        quote = None
      i += 1
      continue
    if ch in "'\"`":
      quote = ch
      i += 1
      continue
    if ch == opener:
      depth += 1
    elif ch == closer:
      depth -= 1
      if depth == 0:
        return i
    i += 1
  return -1


def function_body(source, start):
  brace = source.find('{', start)
  if brace < 0:
    return '', False
  end = find_closing(source, brace, '{', '}')
  return (source[brace + 1:end] if end >= 0 else ''), bool(re.search(r'\basync\b', source[start:brace]))


def top_level_returns(body):
  values = []
  depth = 0
  quote = None
  escape = False
  i = 0
  while i < len(body):
    ch = body[i]
    if quote:
      if escape:
        escape = False
      elif ch == '\\':
        escape = True
      elif ch == quote:
        quote = None
      i += 1
      continue
    if ch in "'\"`":
      quote = ch
      i += 1
      continue
    if ch == '{':
      depth += 1
      i += 1
      continue
    if ch == '}':
      depth = max(0, depth - 1)
      i += 1
      continue
    if depth == 0 and body.startswith('return', i) and (i == 0 or not (body[i - 1].isalnum() or body[i - 1] in '_$')):
      after = i + 6
      if after < len(body) and (body[after].isalnum() or body[after] in '_$'):
        i += 1
        continue
      j = after
      q = None
      esc = False
      par = br = cr = 0
      while j < len(body):
        c = body[j]
        if q:
          if esc:
            esc = False
          elif c == '\\':
            esc = True
          elif c == q:
            q = None
        else:
          if c in "'\"`": q = c
          elif c == '(': par += 1
          elif c == ')': par -= 1
          elif c == '[': br += 1
          elif c == ']': br -= 1
          elif c == '{': cr += 1
          elif c == '}': cr -= 1
          elif c == ';' and par == br == cr == 0:
            break
          elif c == '\n' and par == br == cr == 0:
            snippet = body[after:j].strip()
            if snippet:
              break
        j += 1
      values.append(body[after:j].strip())
      i = j + 1
      continue
    i += 1
  return values


def infer_expr_type(expr, name):
  e = expr.strip()
  if not e: return 'void'
  if e == 'null': return 'null'
  if e in ('true', 'false'): return 'boolean'
  if re.match(r'^[-+]?\d+(?:\.\d+)?(?:\s|$)', e): return 'number'
  if e.startswith(('`', "'", '"', 'String(')): return 'string'
  if re.search(r'\.(?:replace|trim|join|toLowerCase|toUpperCase|padStart|padEnd)\s*\(', e): return 'string'
  if re.search(r'\.(?:test|includes|startsWith|endsWith)\s*\(', e): return 'boolean'
  if re.search(r'(?:===|!==|==|!=|<=|>=|<|>)', e) and '?' not in e: return 'boolean'
  if e.startswith('!') or e.startswith('Boolean('): return 'boolean'
  if e.startswith('[') or e.startswith('Array.from('): return 'Array<unknown>'
  if re.search(r'\.(?:map|filter|flatMap)\s*\(', e): return 'Array<unknown>'
  if e.startswith('{'): return 'Object'
  if e.startswith('new Map('): return 'Map<unknown, unknown>'
  if e.startswith('new Set('): return 'Set<unknown>'
  if e.startswith('document.createElement('): return 'HTMLElement'
  if e.startswith('document.querySelector('): return 'Element|null'
  if e.startswith('new URL('): return 'URL'
  if re.search(r'\.length\b', e) and not re.search(r'["\'`]', e): return 'number'
  if re.search(r'\?\.\[\d+\]\s*\?\?\s*null', e) and name.lower().endswith('id'): return 'string|null'
  return None


def name_type(name):
  lower = name.lower()
  if re.match(r'^(?:is|has|can|should)', name) or lower.endswith(('eligible', 'enabled', 'ok', 'issafe')):
    return 'boolean'
  if lower.endswith('count') or lower.startswith('count'):
    return 'number'
  if lower.endswith(('title', 'filename', 'markdown', 'text', 'label', 'tooltip', 'favicon', 'protocol', 'assetkey', 'language')):
    return 'string'
  if lower.endswith('id'):
    return 'string|null'
  if lower.endswith(('records', 'pages', 'parts', 'sources', 'images', 'lines', 'elements')):
    return 'Array<unknown>'
  if lower.endswith(('map', 'index', 'lookup')):
    return 'Map<unknown, unknown>'
  if lower.startswith(('render', 'format', 'quote', 'sanitize', 'bounded')):
    return 'string'
  if lower.startswith(('refresh', 'set', 'start', 'stop', 'install', 'inject', 'persist', 'download', 'log')):
    return 'void'
  if lower.startswith(('build', 'collect', 'group', 'resolve', 'capture', 'snapshot', 'context')):
    return 'Object|null'
  return None


def infer_return(name, body, async_fn, existing_type):
  types = []
  for expr in top_level_returns(body):
    t = infer_expr_type(expr, name)
    if t:
      types.extend(t.split('|'))
  if not types:
    fallback = name_type(name)
    if fallback:
      types.extend(fallback.split('|'))
  if not types:
    if existing_type and existing_type != 'Object|boolean|string|number|null':
      result = existing_type
    else:
      result = 'void'
  else:
    order = ['string', 'number', 'boolean', 'Object', 'Array<unknown>', 'Map<unknown, unknown>', 'Set<unknown>', 'HTMLElement', 'Element', 'URL', 'null', 'void']
    unique = []
    for t in types:
      if t not in unique:
        unique.append(t)
    unique.sort(key=lambda t: order.index(t) if t in order else len(order))
    result = '|'.join(unique)
  if async_fn and not result.startswith('Promise<'):
    result = f'Promise<{result}>'
  return result


def param_description(name, typ):
  n = name.strip('[]')
  base = n.split('.')[-1]
  special = {
    'condition': 'The condition that must be true.',
    'message': 'The assertion failure message.',
    'milliseconds': 'The duration in milliseconds.',
    'markdown': 'The Markdown text to process.',
    'name': 'The name to process.',
    'url': 'The URL to process.',
    'cursor': 'The pagination cursor, or null for the first page.',
    'conversationId': 'The Conversation API conversation identifier.',
    'maxChars': 'The maximum number of characters to retain.',
    'width': 'The maximum wrapped line width in characters.',
    'index': 'The zero-based index to process.',
    'ordinal': 'The ordinal position to process.',
    'imageOrdinal': 'The zero-based image ordinal within the source record.',
    'recordId': 'The provider/source record identifier.',
    'role': 'The message role to match.',
    'kind': 'The export kind to execute.',
    'level': 'The diagnostics severity level.',
    'filename': 'The filename to use for the download.',
    'prefix': 'The status text prefix.',
    'reason': 'The reason the operation is being completed.',
    'path': 'The property path being traversed.',
    'depth': 'The current traversal depth.',
    'key': 'The lookup key to process.',
    'value': 'The value to process.',
    'body': 'The body content to render.',
    'summary': 'The summary label to render.',
    'language': 'The code-fence language identifier.',
    'code': 'The source code to classify.',
    'explicitLanguage': 'The provider-supplied language label, when available.',
    'onProgress': 'The callback invoked with progress updates.',
    'fetchPage': 'The callback used to fetch one Conversation API page.',
    'spine': 'The ordered Conversation API source-record spine.',
    'pages': 'The ordered Conversation API pages.',
    'events': 'The canonical events associated with the source records.',
    'recoveredImages': 'The recovered image state used while rendering.',
    'recoveredImageMap': 'The recovered-image lookup keyed by source record.',
    'reference': 'The provider reference object to process.',
    'token': 'The inline token to parse or render.',
    'source': 'The source value to inspect.',
    'part': 'The provider content part to process.',
    'section': 'The mounted conversation-turn section.',
    'image': 'The image element to inspect.',
    'node': 'The node to process.',
    'target': 'The target element or resolved jump target.',
    'dialog': 'The dialog element whose focusable controls are requested.',
    'overlay': 'The modal overlay element.',
    'opener': 'The element that opened the modal.',
    'fn': 'The test function to execute.',
    'result': 'The test result to format.',
    'entry': 'The diagnostics entry to format.',
    'blob': 'The Blob to download.'
  }
  if base in special:
    return special[base]
  if base.startswith('header'):
    return 'The HTTP header values to inspect.'
  if base.endswith('Ordinal'):
    return f'The zero-based {base[:-7].lower()} ordinal.'
  if base.endswith('Index'):
    return f'The zero-based {base[:-5].lower()} index.'
  if base.endswith('Map'):
    return f'The {base[:-3].lower()} lookup map.'
  if base.endswith('Id'):
    return f'The {base[:-2].lower()} identifier.'
  if 'Array' in typ:
    return f'The ordered {base} values to process.'
  if typ == 'boolean':
    return f'Whether {base} is enabled.'
  return f'The {base} value required by this function.'


def return_description(name, typ):
  if typ == 'void':
    return 'No value is returned.'
  if typ.startswith('Promise<'):
    inner = typ[len('Promise<'):-1]
    return f'A promise that resolves to the {inner} result produced by `{name}`.'
  if typ == 'boolean':
    return f'`true` when `{name}` succeeds or its predicate is satisfied; otherwise `false`.'
  if typ == 'string':
    return f'The string produced by `{name}`.'
  if typ == 'string|null':
    return f'The string produced by `{name}`, or `null` when no value is available.'
  if typ == 'number':
    return f'The numeric value produced by `{name}`.'
  if typ.startswith('Array<'):
    return f'The ordered values produced by `{name}`.'
  if typ.startswith('Map<'):
    return f'The lookup map produced by `{name}`.'
  if typ.endswith('|null'):
    return f'The value produced by `{name}`, or `null` when no value is available.'
  return f'The {typ} value produced by `{name}`.'


def normalize_doc(doc, indent, name, body, async_fn):
  raw_lines = doc.splitlines()
  content = []
  for line in raw_lines[1:-1]:
    m = re.match(r'^\s*\* ?(.*)$', line)
    content.append(m.group(1) if m else line.strip())

  existing_return = None
  for line in content:
    m = re.match(r'@returns?\s+\{([^}]+)\}', line)
    if m:
      existing_return = m.group(1).strip()
      break
  rtype = infer_return(name, body, async_fn, existing_return)

  out = []
  for line in content:
    pm = re.match(r'@param\s+\{([^}]+)\}\s+([^\s]+)\s+-\s+(.+)$', line)
    if pm:
      typ, pname, desc = pm.groups()
      if any(marker in desc for marker in ('value used by this operation', 'The result produced by', 'The Boolean result produced by', 'according to the operation outcome')):
        desc = param_description(pname, typ)
      out.append(f'@param {{{typ}}} {pname} - {desc}')
      continue
    rm = re.match(r'@returns?\s+\{([^}]+)\}\s+(.+)$', line)
    if rm:
      out.append(f'@returns {{{rtype}}} {return_description(name, rtype)}')
      continue
    out.append(line)

  if not any(line.startswith('@returns ') for line in out):
    if out and out[-1] != '': out.append('')
    out.append(f'@returns {{{rtype}}} {return_description(name, rtype)}')

  lines = [f'{indent}/**']
  for line in out:
    lines.append(f'{indent} *' + (f' {line}' if line else ''))
  lines.append(f'{indent} */')
  return '\n'.join(lines)


functions = []
for m in DECL.finditer(text):
  name = m.group('name1') or m.group('name2') or m.group('name3')
  if m.group('name3'):
    open_pos = text.find('(', m.start())
    close_pos = find_closing(text, open_pos, '(', ')')
    if close_pos < 0 or not re.match(r'^\s*=>', text[close_pos + 1:]):
      continue
  functions.append((m.start(), m.group('indent'), name))
for m in SINGLE.finditer(text):
  functions.append((m.start(), m.group('indent'), m.group('name')))
functions = sorted({start: (start, indent, name) for start, indent, name in functions}.values())

edits = []
for start, indent, name in functions:
  prefix = text[:start]
  stripped = prefix.rstrip()
  if not stripped.endswith('*/'):
    continue
  marker = stripped.rfind('/**')
  if marker < 0:
    continue
  doc_start = stripped.rfind('\n', 0, marker) + 1
  doc_end = len(stripped)
  doc = text[doc_start:doc_end]
  body, async_fn = function_body(text, start)
  replacement = normalize_doc(doc, indent, name, body, async_fn)
  edits.append((doc_start, doc_end, replacement))

for start, end, replacement in reversed(edits):
  text = text[:start] + replacement + text[end:]

PATH.write_text(text, encoding='utf-8')
print(f'Updated {len(edits)} JSDoc blocks.')
