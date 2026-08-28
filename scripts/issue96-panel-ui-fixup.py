from pathlib import Path

source_path = Path('chatgpt-conversation-markdown-export.user.js')
source = source_path.read_text(encoding='utf-8')

old_css = "      #${PANEL_ID} .tm-copy-confirmed{transition:opacity .2s ease}\n"
new_css = "      #${PANEL_ID} .tm-icon-button{transition:opacity .2s ease}\n      #${PANEL_ID} .tm-copy-fade{opacity:0}\n"
if source.count(old_css) != 1:
  raise SystemExit(f'Expected one copy-feedback CSS hook, found {source.count(old_css)}')
source = source.replace(old_css, new_css, 1)

old_copy = '''    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove('tm-copy-confirmed');
      button.innerHTML = copyIconMarkup();
      button.setAttribute('aria-label', 'Copy diagnostic log');
    }, 1000);
'''
new_copy = '''    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.add('tm-copy-fade');
      setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove('tm-copy-confirmed');
        button.innerHTML = copyIconMarkup();
        button.setAttribute('aria-label', 'Copy diagnostic log');
        requestAnimationFrame(() => button.classList.remove('tm-copy-fade'));
      }, 200);
    }, 800);
'''
if source.count(old_copy) != 1:
  raise SystemExit(f'Expected one copy-feedback timer block, found {source.count(old_copy)}')
source = source.replace(old_copy, new_copy, 1)
source_path.write_text(source, encoding='utf-8')

# #92's test must allow the opener-aware listener required for focus restoration.
test_list_path = Path('tests/test-list-ui.test.mjs')
test_list = test_list_path.read_text(encoding='utf-8')
old_assert = '''  assert.match(userscript,
    /panel\\.querySelector\\('\\[data-role="test"\\]'\\)\\.addEventListener\\('click', openTestMatrix\\);/,
    'Test button must open the matrix, not immediately execute Run All.');
'''
new_assert = '''  assert.match(userscript,
    /panel\\.querySelector\\('\\[data-role="test"\\]'\\)\\.addEventListener\\('click', event => openTestMatrix\\(event\\.currentTarget\\)\\);/,
    'Test button must open the matrix with its opener for focus restoration, not immediately execute Run All.');
'''
if test_list.count(old_assert) != 1:
  raise SystemExit(f'Expected one #92 Test-listener assertion, found {test_list.count(old_assert)}')
test_list_path.write_text(test_list.replace(old_assert, new_assert, 1), encoding='utf-8')

panel_test_path = Path('tests/recorder-panel-ui.test.mjs')
panel_test = panel_test_path.read_text(encoding='utf-8')
old_panel_assert = "  assert.match(userscript, /setTimeout\\(\\(\\) => \\{/);\n"
new_panel_assert = """  assert.match(userscript, /button\\.classList\\.add\\('tm-copy-fade'\\)/,
    'Copy confirmation must fade before the copy icon returns.');
  assert.match(userscript, /requestAnimationFrame\\(\\(\\) => button\\.classList\\.remove\\('tm-copy-fade'\\)\\)/,
    'Copy icon must fade back in after the confirmation checkmark.');
"""
if panel_test.count(old_panel_assert) != 1:
  raise SystemExit(f'Expected one copy timer assertion, found {panel_test.count(old_panel_assert)}')
panel_test_path.write_text(panel_test.replace(old_panel_assert, new_panel_assert, 1), encoding='utf-8')
