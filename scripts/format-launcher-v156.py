from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

old = '// @version      0.6.155'
new = '// @version      0.6.156'
assert text.count(old) == 1, f'expected one {old!r}'
text = text.replace(old, new, 1)

old = '''        if (summary.removes_launcher || summary.removes_original_body) {
          relevantMutations.push(summary);
        }
'''
new = '''        if (summary.removes_launcher || summary.removes_original_body)
          relevantMutations.push(summary);
'''
assert text.count(old) == 1, 'formatter-only launcher block not found exactly once'
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
