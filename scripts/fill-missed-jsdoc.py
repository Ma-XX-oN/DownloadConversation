from pathlib import Path
import re

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

SPECIAL = {
  'cgRenderInlineReference': [
    'Renders one provider-native inline content reference on the legacy/fallback Markdown path.',
    '',
    'Source -> output transformation: grouped web, alt-text, file, memory, and retrieved-file references are converted to their established visible Markdown/HTML representation; unsupported reference kinds render no replacement.'
  ]
}

PREFIXES = [
  ('render', 'Renders'), ('canonical', 'Handles canonical'), ('conversation', 'Handles conversation'),
  ('recover', 'Recovers'), ('resolve', 'Resolves'), ('extract', 'Extracts'), ('fetch', 'Fetches'),
  ('collect', 'Collects'), ('build', 'Builds'), ('create', 'Creates'), ('update', 'Updates'),
  ('refresh', 'Refreshes'), ('set', 'Sets'), ('get', 'Gets'), ('load', 'Loads'), ('save', 'Saves'),
  ('open', 'Opens'), ('close', 'Closes'), ('clear', 'Clears'), ('show', 'Shows'), ('hide', 'Hides'),
  ('toggle', 'Toggles'), ('format', 'Formats'), ('parse', 'Parses'), ('sanitize', 'Sanitizes'),
  ('normalize', 'Normalizes'), ('log', 'Logs'), ('test', 'Tests'), ('assert', 'Validates'),
  ('find', 'Finds'), ('wait', 'Waits for'), ('jump', 'Handles conversation jump'),
  ('mounted', 'Returns mounted'), ('image', 'Handles image'), ('cg', 'Handles fallback')
]

def humanize(name):
  value = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', name)
  value = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', value)
  return value.replace('_', ' ').replace('$', '').strip().lower()

def summary(name):
  for prefix, verb in PREFIXES:
    if name.startswith(prefix) and len(name) > len(prefix):
      return f'{verb} {humanize(name[len(prefix):])}.'
  return f'Handles {humanize(name)}.'

def comment(indent, name):
  lines = SPECIAL.get(name, [summary(name)])
  result = [f'{indent}/**']
  result.extend(f'{indent} *{(" " + line) if line else ""}' for line in lines)
  result.append(f'{indent} */\n')
  return '\n'.join(result)

def documented_before(source, start):
  return bool(re.search(r'/\*\*[\s\S]*?\*/\s*$', source[:start]))

patterns = [
  re.compile(r'(?m)^(?P<indent>[ \t]*)(?:(?:async\s+)?function\*?\s+(?P<name>[A-Za-z_$][\w$]*)\s*\()'),
  re.compile(r'(?m)^(?P<indent>[ \t]*)(?:(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\*?\s*\()'),
  re.compile(r'(?m)^(?P<indent>[ \t]*)(?:(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[^\n;]*=>)')
]

matches = []
seen = set()
for pattern in patterns:
  for match in pattern.finditer(text):
    if match.start() in seen or documented_before(text, match.start()):
      continue
    seen.add(match.start())
    matches.append((match.start(), match.group('indent'), match.group('name')))

for start, indent, name in sorted(matches, reverse=True):
  text = text[:start] + comment(indent, name) + text[start:]

path.write_text(text, encoding='utf-8')
print(f'Added JSDoc to {len(matches)} previously missed named functions.')
