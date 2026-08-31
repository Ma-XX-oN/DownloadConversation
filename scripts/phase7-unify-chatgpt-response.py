#!/usr/bin/env python3
from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

if '// @version      0.6.149' not in text:
  raise SystemExit('userscript version anchor not found')
text = text.replace('// @version      0.6.149', '// @version      0.6.150', 1)

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

old = '''      if (canonicalEvent && canonicalMessageRecordEligible(record, canonicalEvent)) {
        if (record?.author?.role === 'user') {
          flushPendingAssistant();
          output.push(canonicalRecordBlock(record, canonicalEvent));
          continue;
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length > 0) {'''
new = '''      if (canonicalEvent && canonicalMessageRecordEligible(record, canonicalEvent)) {
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
if old not in text:
  raise SystemExit('renderConversationMarkdown commentary routing anchor not found')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
