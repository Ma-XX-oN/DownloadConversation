#!/usr/bin/env python3
import subprocess
from pathlib import Path

CORE_OLD = '2b746b121ed0e44cfe86ba8377969b8d8bf197c7'
CORE_NEW = '29a9fea4903f0214d450e1399a7af8e20823fcd1'
RESTORE_TEST_REF = 'da5ef383b368a639cb1792417e2b5f7d2db05399'

# Restore the exact regression file from before the accidental broad test edit.
test_path = Path('tests/phase5-rich-core-integration.test.mjs')
restored_test = subprocess.check_output(
  ['git', 'show', f'{RESTORE_TEST_REF}:{test_path.as_posix()}'],
  text=True,
  encoding='utf-8'
)
old_test = '''test('commentary plus final message is rejected semantically before canonical block rendering', () => {
  const commentary = textRecord('split-commentary', 'assistant', 'Interim.', {
    channel: 'commentary',
    end_turn: false
  });
  const final = textRecord('split-final', 'assistant', 'Final.');
  const records = [commentary, final];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));
  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), false);
});'''
new_test = r'''test('commentary plus final message is accepted as one canonical ChatGPT response', () => {
  const commentary = textRecord('split-commentary', 'assistant', 'Interim.', {
    channel: 'commentary',
    end_turn: false
  });
  const final = textRecord('split-final', 'assistant', 'Final.');
  const records = [commentary, final];
  const byRecord = phase5.canonicalEventsBySourceRecord(records);
  const events = records.map(record => byRecord.get(record.id));
  assert.equal(phase5.canonicalAssistantSegmentEligible(records, events), true);
  const rendered = phase5.canonicalAssistantSegmentBlock(records, events);
  assert.match(rendered, /^## ChatGPT <!-- turn_id=split-final -->/);
  assert.match(rendered, /^### ChatGPT Commentary <!-- turn_id=split-commentary -->$/m);
  assert.equal((rendered.match(/^## ChatGPT(?: |$)/gm) ?? []).length, 1);
  assert.match(rendered, /> Interim\./);
  assert.match(rendered, /> Final\./);
});'''
if old_test not in restored_test:
  raise SystemExit('obsolete commentary/final regression anchor not found in restored test')
restored_test = restored_test.replace(old_test, new_test, 1)
if CORE_OLD not in restored_test:
  raise SystemExit('restored rich-core test pin anchor not found')
restored_test = restored_test.replace(CORE_OLD, CORE_NEW, 1)
test_path.write_text(restored_test, encoding='utf-8')

# Move the plain integration test's exact pin expectation with the production pin.
core_test_path = Path('tests/core-integration.test.mjs')
core_test_text = core_test_path.read_text(encoding='utf-8')
if CORE_OLD not in core_test_text:
  raise SystemExit('core-integration pin anchor not found')
core_test_path.write_text(core_test_text.replace(CORE_OLD, CORE_NEW, 1), encoding='utf-8')

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

if '// @version      0.6.149' not in text:
  raise SystemExit('userscript version anchor not found')
text = text.replace('// @version      0.6.149', '// @version      0.6.150', 1)
if CORE_OLD not in text:
  raise SystemExit('AIConversationCore pin anchor not found')
text = text.replace(CORE_OLD, CORE_NEW, 1)

start = text.find('  function canonicalAssistantSegmentEligible(')
end = text.find('\n\n  /**\n   * Renders one eligible canonical Assistant activity segment', start)
if start < 0 or end < 0:
  raise SystemExit('canonicalAssistantSegmentEligible boundaries not found')
replacement = '''  function canonicalAssistantSegmentEligible(records, events) {
    if (!Array.isArray(records) || !records.length || !Array.isArray(events) || events.length !== records.length) {
      return false;
    }
    // Tracks the one ordinary final Assistant message allowed in a canonical response segment.
    let finalMessageIndex = -1;
    let hasAssistantSource = false;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const event = events[index];
      if (record?.author?.role === 'assistant') hasAssistantSource = true;
      if (canonicalMessageRecordEligible(record, event)) {
        if (record?.author?.role !== 'assistant') return false;
        if (event?.kind === 'commentary') continue;
        if (event?.kind !== 'message' || finalMessageIndex >= 0) return false;
        finalMessageIndex = index;
        continue;
      }
      if (!canonicalThoughtRecordEligible(record, event)) return false;
    }
    if (!hasAssistantSource) return false;
    if (finalMessageIndex >= 0 && finalMessageIndex !== records.length - 1) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown(events);
    // Tool payloads are opaque literal data and may legitimately contain ChatGPT
    // inline-token character sequences. Message/commentary records were already
    // checked individually above, so do not reject the whole segment by scanning
    // rendered tool payload text.
    return Boolean(rendered.trim());
  }'''
text = text[:start] + replacement + text[end:]

old_projection = '''    const projectedEvents = events.map((event, index) => {
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
    });'''
new_projection = '''    const projectedEvents = events.map((event, index) => {
      const commentarySourceId = event?.kind === 'commentary' && typeof records[index]?.id === 'string'
        ? records[index].id
        : '';
      const sourceId = commentarySourceId || (index === 0 ? headingSourceId : '');
      const responseHeadingSuffix = index === 0 && headingSourceId
        ? ` <!-- turn_id=${headingSourceId} -->`
        : '';
      if (!sourceId && !responseHeadingSuffix) return event;
      return {
        ...event,
        projection: {
          ...(event?.projection ?? {}),
          ...(sourceId ? { heading_suffix: ` <!-- turn_id=${sourceId} -->` } : {}),
          ...(responseHeadingSuffix ? { response_heading_suffix: responseHeadingSuffix } : {})
        }
      };
    });'''
if old_projection not in text:
  raise SystemExit('Assistant projection anchor not found')
text = text.replace(old_projection, new_projection, 1)

old_routing = '''      if (canonicalEvent && canonicalMessageRecordEligible(record, canonicalEvent)) {
        if (record?.author?.role === 'user') {
          flushPendingAssistant();
          output.push(canonicalRecordBlock(record, canonicalEvent));
          continue;
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length > 0) {'''
new_routing = '''      if (canonicalEvent && canonicalMessageRecordEligible(record, canonicalEvent)) {
        if (record?.author?.role === 'user') {
          flushPendingAssistant();
          output.push(canonicalRecordBlock(record, canonicalEvent));
          continue;
        }
        if (record?.author?.role === 'assistant' && canonicalEvent?.kind === 'commentary') {
          pendingThoughts.push(record);
          continue;
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length > 0) {'''
if old_routing not in text:
  raise SystemExit('renderConversationMarkdown commentary routing anchor not found')
text = text.replace(old_routing, new_routing, 1)

path.write_text(text, encoding='utf-8')
