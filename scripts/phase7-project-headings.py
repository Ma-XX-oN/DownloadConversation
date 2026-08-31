#!/usr/bin/env python3
from pathlib import Path

OLD_CORE = 'd6d5f90aabab4d106265113bad09fc5984f4808e'
NEW_CORE = '2b746b121ed0e44cfe86ba8377969b8d8bf197c7'


def replace_function(text, name, end_marker, replacement):
  start = text.find(f'  function {name}(')
  if start < 0:
    raise SystemExit(f'{name} start not found')
  end = text.find(end_marker, start)
  if end < 0:
    raise SystemExit(f'{name} end marker not found')
  return text[:start] + replacement + text[end:]


userscript = Path('chatgpt-conversation-markdown-export.user.js')
text = userscript.read_text(encoding='utf-8')
if OLD_CORE not in text:
  raise SystemExit('old userscript core pin not found')
text = text.replace(OLD_CORE, NEW_CORE, 1)
if '// @version      0.6.148' not in text:
  raise SystemExit('userscript version anchor not found')
text = text.replace('// @version      0.6.148', '// @version      0.6.149', 1)

text = replace_function(
  text,
  'canonicalRecordBlock',
  '\n\n  /**\n   * Determines whether one non-message canonical Assistant activity event',
  '''  function canonicalRecordBlock(record, event) {
    assert(canonicalMessageRecordEligible(record, event),
      `AIConversationCore message record ${record?.id ?? 'unknown'} is not eligible for canonical rendering.`);
    // Provider/source ID projected onto renderer-generated headings for this record.
    const sourceId = typeof record?.id === 'string' ? record.id : '';
    // Canonical event clone carrying only DownloadConversation heading decoration.
    const projectedEvent = sourceId
      ? {
          ...event,
          projection: {
            ...(event?.projection ?? {}),
            heading_suffix: ` <!-- turn_id=${sourceId} -->`
          }
        }
      : event;
    return canonicalCore().renderCanonicalMarkdown([projectedEvent]).trimEnd();
  }'''
)

text = replace_function(
  text,
  'canonicalAssistantSegmentBlock',
  '\n\n  // Compatibility helpers retained for the already-established #93/#97 regressions.',
  '''  function canonicalAssistantSegmentBlock(records, events) {
    assert(canonicalAssistantSegmentEligible(records, events),
      'AIConversationCore Assistant segment contains an unsupported record.');
    /**
     * Handles message record.
     */
    const messageRecord = [...records].reverse().find((record, indexFromEnd) => {
      const index = records.length - 1 - indexFromEnd;
      return canonicalMessageRecordEligible(record, events[index]);
    }) ?? null;
    /**
     * Handles heading record.
     */
    const headingRecord = messageRecord ?? records.find(record => record?.author?.role === 'assistant') ?? records[0];
    // Source ID retained on the one enclosing ChatGPT response heading.
    const headingSourceId = typeof headingRecord?.id === 'string' ? headingRecord.id : '';
    // Canonical event sequence decorated only with source heading identities.
    const projectedEvents = events.map((event, index) => {
      const commentarySourceId = event?.kind === 'commentary' && typeof records[index]?.id === 'string'
        ? records[index].id
        : '';
      const sourceId = commentarySourceId || (index === 0 ? headingSourceId : '');
      if (!sourceId) return event;
      return {
        ...event,
        projection: {
          ...(event?.projection ?? {}),
          heading_suffix: ` <!-- turn_id=${sourceId} -->`
        }
      };
    });
    return canonicalCore().renderCanonicalMarkdown(projectedEvents).trimEnd();
  }'''
)
userscript.write_text(text, encoding='utf-8')

for filename in ['tests/core-integration.test.mjs', 'tests/phase5-rich-core-integration.test.mjs']:
  path = Path(filename)
  value = path.read_text(encoding='utf-8')
  if OLD_CORE not in value:
    raise SystemExit(f'old test core pin not found in {filename}')
  value = value.replace(OLD_CORE, NEW_CORE, 1)
  value = value.replace('/<summary>Thoughts<\\/summary>/', '/<summary>Having a thought<\\/summary>/')
  path.write_text(value, encoding='utf-8')

rich = Path('tests/phase5-rich-core-integration.test.mjs')
value = rich.read_text(encoding='utf-8')
old = "assert.match(rendered, /^## ChatGPT Commentary <!-- turn_id=commentary-message -->/);\n  assert.equal((rendered.match(/^## ChatGPT$/gm) ?? []).length, 0,\n    'Commentary + tool activity must not manufacture a second ChatGPT section.');"
new = "assert.match(rendered, /^## ChatGPT <!-- turn_id=commentary-message -->/);\n  assert.match(rendered, /^### ChatGPT Commentary <!-- turn_id=commentary-message -->$/m);\n  assert.equal((rendered.match(/^## ChatGPT(?: |$)/gm) ?? []).length, 1,\n    'Commentary + tool activity must remain inside exactly one ChatGPT response section.');"
if old not in value:
  raise SystemExit('rich commentary expectation anchor not found')
value = value.replace(old, new, 1)
old = "assert.match(rendered, new RegExp(`^## ChatGPT Commentary <!-- turn_id=commentary-${contentType} -->`));"
new = "assert.match(rendered, new RegExp(`^## ChatGPT <!-- turn_id=commentary-${contentType} -->`));\n    assert.match(rendered, new RegExp(`^### ChatGPT Commentary <!-- turn_id=commentary-${contentType} -->$`, 'm'));"
if old not in value:
  raise SystemExit('tool-role commentary expectation anchor not found')
rich.write_text(value.replace(old, new, 1), encoding='utf-8')

core_test = Path('tests/core-integration.test.mjs')
value = core_test.read_text(encoding='utf-8')
old_start = "  for (const record of [\n    textRecord('markdown-user', 'user', markdown),\n    textRecord('markdown-assistant', 'assistant', markdown),\n    textRecord('markdown-commentary', 'assistant', markdown, { channel: 'commentary' })\n  ]) {"
start = value.find(old_start)
if start < 0:
  raise SystemExit('core commentary loop start not found')
end = value.find("\n  }\n});", start)
if end < 0:
  raise SystemExit('core commentary loop end not found')
end += len("\n  }")
replacement = '''  for (const record of [
    textRecord('markdown-user', 'user', markdown),
    textRecord('markdown-assistant', 'assistant', markdown)
  ]) {
    const event = phase5.canonicalEventsBySourceRecord([record]).get(record.id);
    assert.equal(phase5.canonicalPlainRecordBlock(record, event), productionPlainBlock(record));
  }
  const commentary = textRecord('markdown-commentary', 'assistant', markdown, { channel: 'commentary' });
  const commentaryEvent = phase5.canonicalEventsBySourceRecord([commentary]).get(commentary.id);
  const commentaryRendered = phase5.canonicalPlainRecordBlock(commentary, commentaryEvent);
  assert.match(commentaryRendered, /^## ChatGPT <!-- turn_id=markdown-commentary -->/);
  assert.match(commentaryRendered, /^### ChatGPT Commentary <!-- turn_id=markdown-commentary -->$/m);
  assert.ok(commentaryRendered.endsWith(context.__productionQuoteMarkdown(markdown)));'''
core_test.write_text(value[:start] + replacement + value[end:], encoding='utf-8')

ci = Path('.github/workflows/ci.yml')
value = ci.read_text(encoding='utf-8')
old_cmd = 'node --test tests/core-integration.test.mjs tests/phase5-rich-core-integration.test.mjs tests/fallback-adaptive-fence.test.mjs'
new_cmd = old_cmd + ' tests/tool-language-diagnostics.test.mjs'
if old_cmd not in value:
  raise SystemExit('CI rendering regression command not found')
ci.write_text(value.replace(old_cmd, new_cmd, 1), encoding='utf-8')
