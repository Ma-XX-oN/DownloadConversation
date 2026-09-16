from pathlib import Path
import runpy

path = Path(__file__).with_name('issue-134-dry-cleanup.py')
text = path.read_text(encoding='utf-8')
old = '''def remove_unindented_function(text, name):
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
new = '''def remove_unindented_function(text, name):
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
count = text.count(old)
if count != 1:
    raise RuntimeError(f'cleanup helper correction expected one match, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
runpy.run_path(str(path), run_name='__main__')
