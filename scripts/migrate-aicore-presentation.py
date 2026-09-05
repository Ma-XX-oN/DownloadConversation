from pathlib import Path

OLD = '3233cba838bbf2d2cea5a2a6f1900ed6014dcfb0'
NEW = 'c9c618ab1181109a2cf16f6d5596e886513799ba'


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected one match, found {count}')
  return text.replace(old, new, 1)


userscript = Path('chatgpt-conversation-markdown-export.user.js')
text = userscript.read_text(encoding='utf-8')
text = replace_once(text, OLD, NEW, 'userscript core pin')
text = replace_once(
  text,
  '// @version      0.6.162',
  '// @version      0.6.163',
  'userscript version'
)
text = replace_once(
  text,
  """    assert(typeof core.adaptChatGPTRecords === 'function', 'AIConversationCore ChatGPT adapter is unavailable.');
    assert(typeof core.renderCanonicalMarkdown === 'function', 'AIConversationCore Markdown renderer is unavailable.');
    return core;""",
  """    assert(typeof core.adaptChatGPTRecords === 'function', 'AIConversationCore ChatGPT adapter is unavailable.');
    assert(typeof core.renderCanonicalMarkdown === 'function', 'AIConversationCore Markdown renderer is unavailable.');
    assert(typeof core.projectCanonicalConversation === 'function', 'AIConversationCore structured projection is unavailable.');
    return core;""",
  'canonicalCore seam'
)
text = replace_once(
  text,
  """    const events = canonicalCore().adaptChatGPTRecords(adapterRecords);
    assert(Array.isArray(events), 'AIConversationCore ChatGPT adapter did not return canonical events.');
    // Maps stable source record ids back to their adapted canonical events.""",
  """    const core = canonicalCore();
    const events = core.adaptChatGPTRecords(adapterRecords);
    assert(Array.isArray(events), 'AIConversationCore ChatGPT adapter did not return canonical events.');
    const projection = core.projectCanonicalConversation(events);
    const presentation = projection?.presentation;
    assert(presentation?.schema_version === 1, 'AIConversationCore presentation schema mismatch.');
    assert(
      presentation?.split_policy === 'record-anchor-except-declared-atomic-unit',
      'AIConversationCore presentation split policy mismatch.'
    );
    assert(
      presentation?.structural_unit_marker_class === 'aicore-structural-unit',
      'AIConversationCore structural-unit marker mismatch.'
    );
    assert(Array.isArray(presentation?.structural_units), 'AIConversationCore structural units are unavailable.');
    // Maps stable source record ids back to their adapted canonical events.""",
  'canonical event seam'
)
userscript.write_text(text, encoding='utf-8')

tests = Path('tests/core-integration.test.mjs')
text = tests.read_text(encoding='utf-8')
text = replace_once(text, OLD, NEW, 'core test pin')
text = replace_once(
  text,
  """assert.equal(typeof context.AIConversationCore?.adaptChatGPTRecords, 'function');
assert.equal(typeof context.AIConversationCore?.renderCanonicalMarkdown, 'function');""",
  """assert.equal(typeof context.AIConversationCore?.adaptChatGPTRecords, 'function');
assert.equal(typeof context.AIConversationCore?.renderCanonicalMarkdown, 'function');
assert.equal(typeof context.AIConversationCore?.projectCanonicalConversation, 'function');""",
  'core test API seam'
)
text = replace_once(
  text,
  """  assert.match(rendered, /Inspecting the request\\./);
  assert.match(rendered, /> Done\\./);""",
  """  assert.match(rendered, /Inspecting the request\\./);
  assert.match(rendered, /> Done\\./);
  assert.doesNotMatch(rendered, /aicore-structural-unit/);
  assert.doesNotMatch(rendered, /data-aicore-unit-id/);""",
  'core test thought seam'
)
tests.write_text(text, encoding='utf-8')
