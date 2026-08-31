from pathlib import Path

path = Path('tests/core-integration.test.mjs')
text = path.read_text(encoding='utf-8')
old = "  showTimestamps: false,\n  showRecordNumbers: false,\n"
new = "  showTimestamps: false,\n  showRecordNumbers: false,\n  showTurnIds: true,\n"
if text.count(old) != 1:
  raise RuntimeError(f'core integration globals: expected exactly one match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
