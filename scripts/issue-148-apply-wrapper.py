from pathlib import Path
import runpy

runpy.run_path('scripts/issue-148-apply.py', run_name='__main__')

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')
old = """    assert(data instanceof Uint8ClampedArray,
      'Agent favicon recoloring requires a Uint8ClampedArray pixel buffer.');
    assert(Array.isArray(targetRgb) && targetRgb.length === 3,
      'Agent favicon recoloring requires three target RGB channels.');"""
new = """    if (!data || typeof data.length !== 'number') {
      throw new TypeError('Agent favicon recoloring requires an RGBA pixel buffer.');
    }
    if (!Array.isArray(targetRgb) || targetRgb.length !== 3) {
      throw new TypeError('Agent favicon recoloring requires three target RGB channels.');
    }"""
count = text.count(old)
if count != 1:
  raise SystemExit(f'Expected one favicon pixel validation block, found {count}.')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
