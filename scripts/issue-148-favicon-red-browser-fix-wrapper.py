from pathlib import Path
import runpy

runpy.run_path('scripts/issue-148-favicon-red-browser-fix.py', run_name='__main__')

path = Path('tests/agent-favicon-state.test.mjs')
text = path.read_text(encoding='utf-8')
old = "      href: () => stockLink.href\n"
new = "      href: () => document.querySelectorAll('link[rel~=\"icon\"]')[0].href\n"
count = text.count(old)
if count != 1:
  raise SystemExit(f'Expected one isolated stockLink harness reference, found {count}.')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
