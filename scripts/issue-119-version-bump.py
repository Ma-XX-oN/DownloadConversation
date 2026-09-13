from pathlib import Path
import argparse
import difflib

USERSCRIPT = Path('chatgpt-conversation-markdown-export.user.js')
TEST = Path('tests/heading-metadata-controls.test.mjs')


def replace_once(text, old, new, description):
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{description}: expected one match, found {count}')
  return text.replace(old, new, 1)


def patched_files():
  userscript = USERSCRIPT.read_text(encoding='utf-8')
  userscript_new = replace_once(
    userscript,
    '// @version      0.6.164\n',
    '// @version      0.6.168\n',
    'userscript version'
  )

  test = TEST.read_text(encoding='utf-8')
  test_new = replace_once(
    test,
    r'assert.match(userscript, /\/\/ @version      0\.6\.164/);',
    r'assert.match(userscript, /\/\/ @version      0\.6\.168/);',
    'version regression expectation'
  )
  return [(USERSCRIPT, userscript, userscript_new), (TEST, test, test_new)]


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--check', action='store_true')
  args = parser.parse_args()
  changes = patched_files()

  if args.check:
    for path, old, new in changes:
      print(''.join(difflib.unified_diff(
        old.splitlines(keepends=True),
        new.splitlines(keepends=True),
        fromfile=f'a/{path}',
        tofile=f'b/{path}'
      )), end='')
    return

  for path, _, new in changes:
    path.write_text(new, encoding='utf-8')


if __name__ == '__main__':
  main()
