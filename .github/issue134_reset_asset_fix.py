from pathlib import Path
import re

SOURCE_PATH = Path('chatgpt-conversation-markdown-export.user.js')
CONTROLS_TEST_PATH = Path('tests/communication-log-file-controls.test.mjs')

RESET_ICON_BASE64 = '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'

source = SOURCE_PATH.read_text(encoding='utf-8')
if source.count('// @version      1.2.0-issue.134.3') != 1:
  raise SystemExit('expected exactly one .134.3 version marker')
source = source.replace(
  '// @version      1.2.0-issue.134.3',
  '// @version      1.2.0-issue.134.4',
  1)

pattern = re.compile(r'data:image/png;base64,[A-Za-z0-9+/=]+(?=" alt="" aria-hidden="true">)')
matches = list(pattern.finditer(source))
if len(matches) != 1:
  raise SystemExit(f'expected exactly one embedded reset PNG, found {len(matches)}')
source = pattern.sub(f'data:image/png;base64,{RESET_ICON_BASE64}', source, count=1)
SOURCE_PATH.write_text(source, encoding='utf-8')

controls = CONTROLS_TEST_PATH.read_text(encoding='utf-8')
if controls.count(r'/@version\s+1\.2\.0-issue\.134\.3/') != 1:
  raise SystemExit('expected exactly one .134.3 controls version assertion')
controls = controls.replace(
  r'/@version\s+1\.2\.0-issue\.134\.3/',
  r'/@version\s+1\.2\.0-issue\.134\.4/',
  1)
CONTROLS_TEST_PATH.write_text(controls, encoding='utf-8')
