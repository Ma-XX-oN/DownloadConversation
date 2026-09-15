from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
USERSCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'
DESIGN = ROOT / 'DESIGN.md'


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


source = USERSCRIPT.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      1.0.1-issue.123.11',
  '// @version      1.1.0',
  'release version'
)
USERSCRIPT.write_text(source, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
design = replace_once(
  design,
  'Development builds use the\nissue-qualified `x.y.z-issue.<issue>.<iteration>` form; accepted releases use the\nplain `x.y.z` release version.\n',
  'Development builds use the\nissue-qualified `x.y.z-issue.<issue>.<iteration>` form.  When an accepted development\nline is promoted, the release increments the minor component `y` from the current\nrelease, resets `z` to zero, and drops the issue qualifier; accepted releases therefore\nuse the plain `x.y.0` form for that promotion.\n',
  'promotion version policy'
)
DESIGN.write_text(design, encoding='utf-8')
