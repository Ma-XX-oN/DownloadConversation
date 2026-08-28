from pathlib import Path

userscript_path = Path('chatgpt-conversation-markdown-export.user.js')
test_path = Path('tests/recorder-panel-ui.test.mjs')

userscript = userscript_path.read_text(encoding='utf-8')

old_version = '// @version      0.6.139'
new_version = '// @version      0.6.140'
if userscript.count(old_version) != 1:
  raise SystemExit('Expected userscript v0.6.139 exactly once')
userscript = userscript.replace(old_version, new_version, 1)

old_controls = '<label><input data-role="format-jsonl" type="checkbox" checked> JSONL</label><label><input data-role="format-md" type="checkbox"> MD</label>'
new_controls = '<label><input data-role="format-jsonl" type="checkbox"> JSONL</label><label><input data-role="format-md" type="checkbox" checked> MD</label>'
if userscript.count(old_controls) != 1:
  raise SystemExit('Expected current export format defaults exactly once')
userscript = userscript.replace(old_controls, new_controls, 1)
userscript_path.write_text(userscript, encoding='utf-8')

test = test_path.read_text(encoding='utf-8')
old_assertions = '''  assert.match(userscript, /data-role="format-jsonl" type="checkbox" checked/);\n  assert.match(userscript, /data-role="format-md" type="checkbox"/);\n'''
new_assertions = '''  assert.match(userscript, /data-role="format-jsonl" type="checkbox"> JSONL/);\n  assert.doesNotMatch(userscript, /data-role="format-jsonl" type="checkbox" checked/);\n  assert.match(userscript, /data-role="format-md" type="checkbox" checked> MD/);\n'''
if test.count(old_assertions) != 1:
  raise SystemExit('Expected current export-default assertions exactly once')
test = test.replace(old_assertions, new_assertions, 1)
test_path.write_text(test, encoding='utf-8')
