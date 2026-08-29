from pathlib import Path

OLD_CORE = 'fdf4cfef6c387fcb6e130486a18af4045c30bd9b'
NEW_CORE = 'd6d5f90aabab4d106265113bad09fc5984f4808e'

script = Path('chatgpt-conversation-markdown-export.user.js')
text = script.read_text(encoding='utf-8')
assert text.count('// @version      0.6.146') == 1, 'userscript version changed'
assert text.count(OLD_CORE) == 1, 'userscript core pin changed'
text = text.replace('// @version      0.6.146', '// @version      0.6.147', 1)
text = text.replace(OLD_CORE, NEW_CORE, 1)
script.write_text(text, encoding='utf-8')

for name in ['tests/core-integration.test.mjs', 'tests/phase5-rich-core-integration.test.mjs']:
  path = Path(name)
  value = path.read_text(encoding='utf-8')
  assert value.count(OLD_CORE) == 1, f'{name}: old core assertion changed'
  path.write_text(value.replace(OLD_CORE, NEW_CORE, 1), encoding='utf-8')

path = Path('tests/phase5-rich-core-integration.test.mjs')
value = path.read_text(encoding='utf-8')
assert "tool-role text/code results keep complete Assistant segments canonical" not in value
append = r'''

test('tool-role text/code results keep complete Assistant segments canonical', () => {
  for (const [contentType, content, expectedOutput] of [
    ['text', { content_type: 'text', parts: ['text tool output'] }, 'text tool output'],
    ['code', { content_type: 'code', text: '{"code":true}', language: 'json' }, '{"code":true}']
  ]) {
    const call = textRecord(`call-${contentType}`, 'assistant', '', {
      channel: 'analysis',
      recipient: 'example_tool',
      end_turn: false,
      content: { content_type: 'code', text: '{"request":true}', language: 'json' }
    });
    const result = textRecord(`result-${contentType}`, 'tool', '', {
      author_name: 'example_tool',
      channel: 'commentary',
      end_turn: false,
      content
    });
    const commentary = textRecord(`commentary-${contentType}`, 'assistant', 'After tool.', {
      channel: 'commentary',
      end_turn: false
    });
    const records = [call, result, commentary];
    const byRecord = phase5.canonicalEventsBySourceRecord(records);
    const events = records.map(record => byRecord.get(record.id));

    assert.equal(events[1]?.kind, 'tool_result', `${contentType} tool record kind`);
    assert.equal(events[1]?.blocks?.[0]?.type, 'tool_result', `${contentType} tool block type`);
    assert.equal(events[1]?.blocks?.[0]?.output_format, contentType, `${contentType} source format`);
    assert.equal(events[1]?.blocks?.[0]?.output, expectedOutput, `${contentType} payload`);
    assert.equal(phase5.canonicalThoughtRecordEligible(result, events[1]), true,
      `${contentType} result must be eligible thought/tool activity`);
    assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true,
      `${contentType} complete Assistant/tool segment must stay canonical`);

    const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
    assert.match(rendered, new RegExp(`^## ChatGPT Commentary <!-- turn_id=commentary-${contentType} -->`));
    assert.match(rendered, /<summary>example_tool output<\/summary>/);
    assert.ok(rendered.includes(expectedOutput), `${contentType} output must be rendered`);
    assert.match(rendered, /> After tool\./);
  }
});
'''
path.write_text(value + append, encoding='utf-8')
