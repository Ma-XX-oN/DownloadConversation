from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
  global text
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'Expected exactly one match, found {count}: {old!r}')
  text = text.replace(old, new, 1)


replace_once(
  '// @version      1.5.0-issue.148.2',
  '// @version      1.5.0-issue.140.3'
)

replace_once(
  """      if (typeof target[key] === 'string' && typeof value === 'string') target[key] += value;
      else if (Array.isArray(target[key])) target[key].push(streamTailClone(value));
      else target[key] = streamTailClone(value);""",
  """      if (typeof target[key] === 'string' && typeof value === 'string') target[key] += value;
      else if (Array.isArray(target[key])) target[key].push(streamTailClone(value));
      else if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) &&
               value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(target[key], streamTailClone(value));
      } else target[key] = streamTailClone(value);"""
)

path.write_text(text, encoding='utf-8')
