from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

old_version = '// @version      1.2.0-issue.134.5'
new_version = '// @version      1.2.0-issue.134.6'
if text.count(old_version) != 1:
  raise SystemExit(f'expected one old version marker, found {text.count(old_version)}')
text = text.replace(old_version, new_version, 1)

old_markup = '''      <div class="tm-row tm-communication-log-row"><div class="tm-log-name-viewport" data-role="communication-log-name-viewport" role="textbox" aria-readonly="true" aria-label="Current communication log filename" title="Current communication log filename"><span class="tm-log-name-text" data-role="communication-log-name"></span></div><button class="tm-icon-button" data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log"></button><button class="tm-icon-button" data-role="duplicate-communication-log" type="button" aria-label="Duplicate communication log" title="Duplicate communication log"></button></div>
      <div class="tm-row"><button class="tm-icon-button" data-role="reset-communication-log" type="button" aria-label="Reset communication log" title="Reset communication log"></button></div>'''
new_markup = '''      <div class="tm-row tm-communication-log-row"><div class="tm-log-name-viewport" data-role="communication-log-name-viewport" role="textbox" aria-readonly="true" aria-label="Current communication log filename" title="Current communication log filename"><span class="tm-log-name-text" data-role="communication-log-name"></span></div><button class="tm-icon-button" data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log"></button><button class="tm-icon-button" data-role="duplicate-communication-log" type="button" aria-label="Duplicate communication log" title="Duplicate communication log"></button><button class="tm-icon-button" data-role="reset-communication-log" type="button" aria-label="Reset communication log" title="Reset communication log"></button></div>'''
if text.count(old_markup) != 1:
  raise SystemExit(f'expected one communication-log markup block, found {text.count(old_markup)}')
text = text.replace(old_markup, new_markup, 1)

path.write_text(text, encoding='utf-8')
