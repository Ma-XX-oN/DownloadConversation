from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
path = Path(__file__).with_name('issue-134-dry-cleanup.py')
text = path.read_text(encoding='utf-8')

old_remove = '''def remove_unindented_function(text, name):
    start = text.find(f'function {name}(')
    if start < 0:
        raise RuntimeError(f'test helper function {name} is missing')
    brace = text.find('{', start)
    if brace < 0:
        raise RuntimeError(f'test helper function {name} has no body')
    depth = 0
    end = None
    for index in range(brace, len(text)):
        char = text[index]
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        raise RuntimeError(f'test helper function {name} has no end')
    while text[end:end + 1] == '\\n':
        end += 1
    return text[:start] + text[end:]
'''
new_remove = '''def remove_unindented_function(text, name):
    start = text.find(f'function {name}(')
    if start < 0:
        raise RuntimeError(f'test helper function {name} is missing')
    boundary = re.search(
        r'\\n\\n(?=(?:function |async function |const |let |class |test\\())',
        text[start:],
    )
    if boundary is None:
        return text[:start]
    end = start + boundary.start()
    return text[:start] + text[end + 2:]
'''
if text.count(old_remove) != 1:
    raise RuntimeError('cleanup helper correction no longer matches remove_unindented_function')
text = text.replace(old_remove, new_remove, 1)

old_span = '''    end = text.find('\\n\\n  /**', start + 1)
    if end < 0:
        end = text.find('\\n  // END ', start + 1)
    if end < 0:
        raise RuntimeError(f'production function {name} boundary is missing')
    return start, end
'''
new_span = '''    boundaries = [
        text.find('\\n\\n  /**', start + 1),
        text.find('\\n  // END ', start + 1),
    ]
    boundaries = [boundary for boundary in boundaries if boundary >= 0]
    if not boundaries:
        raise RuntimeError(f'production function {name} boundary is missing')
    return start, min(boundaries)
'''
if text.count(old_span) != 1:
    raise RuntimeError('cleanup helper correction no longer matches top_level_function_span')
text = text.replace(old_span, new_span, 1)
path.write_text(text, encoding='utf-8')

runpy.run_path(str(path), run_name='__main__')

userscript_path = ROOT / 'chatgpt-conversation-markdown-export.user.js'
userscript = userscript_path.read_text(encoding='utf-8')
for marker in [
    '  // BEGIN Issue #123 stock network diagnostics',
    '  // END Issue #123 stock network diagnostics',
    '  // BEGIN Issue #123 disk communication recorder',
    '  // END Issue #123 disk communication recorder',
]:
    if marker not in userscript:
        raise RuntimeError(f'DRY cleanup removed required production marker: {marker}')

helper = ROOT / 'tests' / 'helpers' / 'userscript-source.mjs'
helper.write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const userscript = await readFile(
  new URL('../../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

export function markedBlock(startMarker, endMarker) {
  const start = userscript.indexOf(startMarker);
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Production block ${startMarker} is missing.`);
  return userscript.slice(start, end + endMarker.length);
}

export function diskBlock() {
  return markedBlock(
    '  // BEGIN Issue #123 disk communication recorder',
    '  // END Issue #123 disk communication recorder'
  );
}

function functionSourceFrom(source, name) {
  const starts = [
    source.indexOf(`  async function ${name}(`),
    source.indexOf(`  function ${name}(`)
  ].filter(index => index >= 0);
  assert.ok(starts.length > 0, `Production function ${name} is missing.`);
  const start = Math.min(...starts);
  const boundaries = [
    source.indexOf('\n\n  /**', start + 3),
    source.indexOf('\n  // END ', start + 3)
  ].filter(index => index >= 0);
  assert.ok(boundaries.length > 0, `Production function ${name} boundary is missing.`);
  return source.slice(start, Math.min(...boundaries)).trimStart();
}

export function productionFunctionSource(name) {
  return functionSourceFrom(userscript, name);
}

export function diskFunctionSource(name) {
  return functionSourceFrom(diskBlock(), name);
}

export function diskHarnessSource() {
  return [
    productionFunctionSource('errorMessage'),
    productionFunctionSource('cloneSafely'),
    productionFunctionSource('releaseReaderLockQuietly'),
    productionFunctionSource('abortWritableQuietly'),
    productionFunctionSource('cancelReadableBodyQuietly'),
    diskBlock()
  ].join('\n');
}
''', encoding='utf-8')

dry_test = ROOT / 'tests' / 'dry-contract.test.mjs'
dry_source = dry_test.read_text(encoding='utf-8')
dry_source = dry_source.replace(
    "/const userscript = await readFile\\([\\s\\S]{0,160}chatgpt-conversation-markdown-export\\.user\\.js/",
    "/^const userscript = await readFile\\([\\s\\S]{0,160}chatgpt-conversation-markdown-export\\.user\\.js/m",
)
dry_test.write_text(dry_source, encoding='utf-8')

print('Issue #134 DRY cleanup wrapper corrections applied.')
