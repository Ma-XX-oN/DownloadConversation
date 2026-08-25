from pathlib import Path
import subprocess

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')
assert '// @version      0.6.117' in text


def extract_js_function(source, name):
  marker = f'  function {name}('
  start = source.index(marker)
  brace = source.index('{', start)
  depth = 0
  quote = None
  escape = False
  i = brace
  while i < len(source):
    ch = source[i]
    if quote:
      if escape:
        escape = False
      elif ch == '\\':
        escape = True
      elif ch == quote:
        quote = None
    else:
      if ch in "'\"`":
        quote = ch
      elif ch == '{':
        depth += 1
      elif ch == '}':
        depth -= 1
        if depth == 0:
          end = i + 1
          while end < len(source) and source[end] in '\r\n':
            end += 1
          return source[start:end]
    i += 1
  raise RuntimeError(name)


commits = subprocess.check_output(
  ['git', 'log', '--format=%H', '--', str(path)], text=True
).splitlines()
historical = None
for commit in commits:
  try:
    src = subprocess.check_output(['git', 'show', f'{commit}:{path}'], text=True)
  except subprocess.CalledProcessError:
    continue
  names = (
    'apiConversationSpineFromPages',
    'apiLinkageKeyIsIdentifierLike',
    'apiLinkageScalarIsSafe',
    'apiRecordLinkageStructure',
    'apiUnresolvedUapLinkageAnalysis',
    'apiConversationUapGrouping',
    'apiConversationUapFinalGrouping',
  )
  if all(f'function {name}' in src for name in names):
    historical = src
    break
assert historical is not None, 'No historical Phase-2 UAP implementation found'

old_spine = extract_js_function(text, 'conversationSpineFromPages')
hist_spine = extract_js_function(historical, 'apiConversationSpineFromPages')
hist_spine = hist_spine.replace(
  'function apiConversationSpineFromPages(',
  'function conversationSpineFromPages(', 1
)
text = text.replace(old_spine, hist_spine, 1)

insertion_point = text.index('  function cgIsHidden(')
helpers = '\n'.join(
  extract_js_function(historical, name)
  for name in (
    'apiLinkageKeyIsIdentifierLike',
    'apiLinkageScalarIsSafe',
    'apiRecordLinkageStructure',
    'apiUnresolvedUapLinkageAnalysis',
    'apiConversationUapGrouping',
    'apiConversationUapFinalGrouping',
  )
) + '\n'
text = text[:insertion_point] + helpers + text[insertion_point:]

old = """    if (record?.author?.role !== 'user' ||
        record?.content?.content_type !== 'text') return '';
"""
new = """    if (record?.author?.role !== 'user' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
"""
assert old in text
text = text.replace(old, new, 1)

search_func = extract_js_function(text, 'cgRecordSearchTexts')
assert "if (type === 'text')" in search_func
text = text.replace(
  search_func,
  search_func.replace(
    "if (type === 'text')",
    "if (type === 'text' || type === 'multimodal_text')",
    1
  ),
  1
)

old_render = extract_js_function(text, 'renderConversationMarkdown')
new_render = '''  function renderConversationMarkdown(spine, onProgress) {
    assert(Array.isArray(spine?.records), 'Conversation API Markdown export requires spine records.');
    const grouping = apiConversationUapFinalGrouping(spine);
    assert(grouping.unresolved_record_count === 0,
      `Conversation API Markdown export has ${grouping.unresolved_record_count} unresolved records.`);
    assert(grouping.conflicting_record_count === 0,
      `Conversation API Markdown export has ${grouping.conflicting_record_count} conflicting records.`);

    const output = [];
    const renderableRecordCount = grouping.groups.reduce(
      (sum, group) => sum + group.record_ordinals.length, 0
    );
    let renderedRecordCount = 0;

    const renderRecords = records => {
      let pendingThoughts = [];
      const blocks = [];
      const flushAssistantBlock = (body = '', record = null) => {
        if (!body && !pendingThoughts.length) return;
        const headingRecord = record ?? pendingThoughts[0];
        const parts = [transcriptHeading(headingRecord)];
        const thoughts = cgRenderThoughtBlock(pendingThoughts);
        if (thoughts) parts.push(thoughts);
        if (body) parts.push(quoteMarkdown(body));
        blocks.push(parts.join('\\n\\n'));
        pendingThoughts = [];
      };

      for (const record of records) {
        renderedRecordCount += 1;
        onProgress?.({
          stage: 'rendering',
          record_number: renderedRecordCount,
          record_count: renderableRecordCount
        });
        const userText = cgVisibleUserText(record);
        if (userText) {
          flushAssistantBlock();
          blocks.push(`${transcriptHeading(record)}\\n\\n${quoteMarkdown(userText)}`);
          continue;
        }
        const assistantText = cgVisibleAssistantMarkdown(record);
        if (assistantText) {
          flushAssistantBlock(assistantText, record);
          continue;
        }
        if (cgRenderThoughtItem(record)) pendingThoughts.push(record);
      }
      flushAssistantBlock();
      return blocks;
    };

    for (const group of grouping.groups) {
      const records = group.record_ordinals
        .map(recordOrdinal => spine.records[recordOrdinal]?.message)
        .filter(Boolean);
      const users = records.filter(record => record?.author?.role === 'user');
      assert(users.length === 1,
        `Conversation API Markdown export UAP ${group.ordinal + 1} has ${users.length} User records.`);
      output.push(...renderRecords(records));
    }
    return `${output.join('\\n\\n')}\\n`;
  }

'''
text = text.replace(old_render, new_render, 1)

insert_at = text.index('  async function runTests() {')
regression = '''  function testMultimodalUserAndUapIdentity() {
    const pages = [{
      messages: [
        {
          id: 'u1', author: { role: 'user' },
          content: { content_type: 'multimodal_text', parts: ['Multimodal question', { content_type: 'image_asset_pointer' }] },
          metadata: { turn_exchange_id: 'e1', working_turn_id: 'w1' }
        },
        {
          id: 'u2', author: { role: 'user' },
          content: { content_type: 'text', parts: ['Second question'] },
          metadata: { turn_exchange_id: 'e2', working_turn_id: 'w2' }
        },
        {
          id: 'a2', author: { role: 'assistant' }, channel: 'final',
          content: { content_type: 'text', parts: ['Second answer'] },
          metadata: { turn_exchange_id: 'e2', working_turn_id: 'w2' }
        },
        {
          id: 'a1', author: { role: 'assistant' }, channel: 'final',
          content: { content_type: 'text', parts: ['Multimodal answer'] },
          metadata: { turn_exchange_id: 'e1', working_turn_id: 'w1' }
        }
      ],
      page_info: { has_previous_page: false, has_next_page: false }
    }];
    const spine = conversationSpineFromPages(pages);
    const grouping = apiConversationUapFinalGrouping(spine);
    assert(grouping.groups.length === 2, 'UAP regression did not create two User anchors.');
    const firstIds = grouping.groups[0].record_ordinals.map(i => spine.records[i].message_id);
    const secondIds = grouping.groups[1].record_ordinals.map(i => spine.records[i].message_id);
    assert(firstIds.includes('u1') && firstIds.includes('a1') && !firstIds.includes('a2'),
      'Exchange identity did not link a1 to u1.');
    assert(secondIds.includes('u2') && secondIds.includes('a2') && !secondIds.includes('a1'),
      'Exchange identity did not link a2 to u2.');
    const markdown = renderConversationMarkdown(spine);
    assert(markdown.includes('Multimodal question'), 'multimodal_text User text was omitted.');
    assert(markdown.indexOf('Multimodal answer') < markdown.indexOf('Second question'),
      'UAP output order followed record adjacency instead of User-anchor identity.');
  }

'''
text = text[:insert_at] + regression + text[insert_at:]
needle = "      await run('Stable API message IDs', testStableMessageIds);\n"
assert needle in text
text = text.replace(
  needle,
  needle + "      await run('Multimodal User + UAP identity', testMultimodalUserAndUapIdentity);\n",
  1
)

text = text.replace('// @version      0.6.117', '// @version      0.6.118', 1)
assert text.count('function apiConversationUapFinalGrouping') == 1
assert "['text', 'multimodal_text']" in text
assert 'testMultimodalUserAndUapIdentity' in text
path.write_text(text, encoding='utf-8')
