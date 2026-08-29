from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
USER_SCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'
CORE_TEST = ROOT / 'tests' / 'core-integration.test.mjs'

OLD_CORE = 'cf09b70b525983301e9d4cc7d9cbc7c4b50ba6f3'
NEW_CORE = 'b5afdafee5a732b35e491a2227c892b34c86370f'

HELPERS = r'''  // BEGIN AIConversationCore Phase 5 integration
  function canonicalCore() {
    const core = globalThis.AIConversationCore;
    assert(core && typeof core === 'object', 'AIConversationCore browser bundle is not loaded.');
    assert(typeof core.adaptChatGPTRecords === 'function', 'AIConversationCore ChatGPT adapter is unavailable.');
    assert(typeof core.renderCanonicalMarkdown === 'function', 'AIConversationCore Markdown renderer is unavailable.');
    return core;
  }

  function canonicalRecoveredImageState(markdown) {
    const value = String(markdown ?? '').trim();
    if (!value) return null;
    if (value === '[image missing]') return { status: 'missing' };
    const data = value.match(/^!\[[^\]]*\]\((data:image\/[^)]+)\)$/s);
    if (data) return { status: 'available', data_url: data[1] };
    if (value === '[image not available]') return { status: 'unavailable' };
    const unavailable = value.match(/^\[image not available\]\((.*)\)$/s);
    if (unavailable) return { status: 'unavailable', source_pointer: unavailable[1] };
    return null;
  }

  function canonicalEnrichRecoveredImages(event, recoveredImages = []) {
    if (!event || !Array.isArray(recoveredImages) || !recoveredImages.length) return event;
    let imageIndex = 0;
    const resources = (event.resources ?? []).map(resource => {
      if (resource?.type !== 'image' || resource?.resource_kind !== 'conversation_image') return resource;
      const recovered = canonicalRecoveredImageState(recoveredImages[imageIndex]);
      imageIndex += 1;
      if (!recovered) return resource;
      const enriched = { ...resource, ...recovered };
      if (recovered.data_url) enriched.data_url = recovered.data_url;
      if (recovered.source_pointer) enriched.source_pointer = recovered.source_pointer;
      return enriched;
    });
    return { ...event, resources };
  }

  function canonicalEventsBySourceRecord(records, recoveredImageMap = new Map()) {
    const conversationId = typeof currentConversationId === 'function' ? currentConversationId() : null;
    const hasMetadata = records.some(record => record?.record_type === 'chatgpt_conversation_metadata');
    const adapterRecords = conversationId && !hasMetadata
      ? [...records, {
          record_type: 'chatgpt_conversation_metadata',
          schema_version: 1,
          conversation_id: conversationId
        }]
      : records;
    const events = canonicalCore().adaptChatGPTRecords(adapterRecords);
    assert(Array.isArray(events), 'AIConversationCore ChatGPT adapter did not return canonical events.');
    const bySourceRecord = new Map();
    for (const event of events) {
      const sourceIndex = event?.source_index;
      const sourceRecordId = event?.source_record_id;
      if (!Number.isInteger(sourceIndex) || typeof sourceRecordId !== 'string' || !sourceRecordId) continue;
      const original = records[sourceIndex];
      if (!original) continue;
      assert(original?.id === sourceRecordId,
        `AIConversationCore source record mismatch at JSONL index ${sourceIndex}.`);
      assert(event?.source?.record_id === sourceRecordId,
        `AIConversationCore did not preserve source record ID ${sourceRecordId}.`);
      assert(event?.source?.record_index === sourceIndex,
        `AIConversationCore did not preserve source record index ${sourceIndex}.`);
      assert(event?.source?.turn_id === sourceRecordId,
        `AIConversationCore source turn identity differs from record ${sourceRecordId}.`);
      assert(event?.source?.create_time === (original?.create_time ?? null),
        `AIConversationCore did not preserve create_time for ${sourceRecordId}.`);
      assert(event?.source?.update_time === (original?.update_time ?? null),
        `AIConversationCore did not preserve update_time for ${sourceRecordId}.`);
      bySourceRecord.set(sourceRecordId,
        canonicalEnrichRecoveredImages(event, recoveredImageMap.get(sourceRecordId) ?? []));
    }
    return bySourceRecord;
  }

  function canonicalRenderedHasUnresolvedInlineTokens(rendered) {
    return String(rendered ?? '').includes(CG_INLINE_TOKEN_START);
  }

  function canonicalMessageRecordEligible(record, event) {
    if (!event || cgIsHidden(record) || event?.visibility === 'hidden') return false;
    const role = record?.author?.role;
    if (!['user', 'assistant'].includes(role)) return false;
    if (role === 'user' && event.kind !== 'message') return false;
    if (role === 'assistant' && !['message', 'commentary'].includes(event.kind)) return false;
    if (!['text', 'multimodal_text'].includes(record?.content?.content_type)) return false;
    if (!(event.blocks ?? []).some(block => block?.type === 'text' || block?.type === 'image')) return false;
    const sourceText = Array.isArray(record?.content?.parts)
      ? record.content.parts.filter(part => typeof part === 'string').join('')
      : '';
    if (role === 'user' && /sandbox:\/\/?/i.test(sourceText)) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown([event]);
    return Boolean(rendered.trim()) && !canonicalRenderedHasUnresolvedInlineTokens(rendered);
  }

  function canonicalRecordBlock(record, event) {
    assert(canonicalMessageRecordEligible(record, event),
      `AIConversationCore message record ${record?.id ?? 'unknown'} is not eligible for canonical rendering.`);
    const role = record?.author?.role;
    const plainHeading = role === 'user'
      ? '## User'
      : record?.channel === 'commentary' ? '## ChatGPT Commentary' : '## ChatGPT';
    const rendered = canonicalCore().renderCanonicalMarkdown([event]).trimEnd();
    assert(rendered === plainHeading || rendered.startsWith(`${plainHeading}\n`),
      `AIConversationCore rendered an unexpected heading for source record ${record?.id ?? 'unknown'}.`);
    return `${transcriptHeading(record)}${rendered.slice(plainHeading.length)}`;
  }

  function canonicalThoughtRecordEligible(record, event) {
    if (!event || cgIsHidden(record) || event?.visibility === 'hidden') return false;
    return ['reasoning_summary', 'tool_call', 'tool_result'].includes(event.kind);
  }

  function canonicalAssistantSegmentEligible(records, events) {
    if (!Array.isArray(records) || !records.length || !Array.isArray(events) || events.length !== records.length) {
      return false;
    }
    let messageIndex = -1;
    let hasTool = false;
    let hasAssistantSource = false;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const event = events[index];
      if (record?.author?.role === 'assistant') hasAssistantSource = true;
      if (canonicalMessageRecordEligible(record, event)) {
        if (record?.author?.role !== 'assistant' || messageIndex >= 0) return false;
        messageIndex = index;
        continue;
      }
      if (!canonicalThoughtRecordEligible(record, event)) return false;
      if (event.kind === 'tool_call' || event.kind === 'tool_result') hasTool = true;
    }
    if (!hasAssistantSource) return false;
    if (messageIndex >= 0 && messageIndex !== records.length - 1) return false;
    if (messageIndex >= 0 && records[messageIndex]?.channel === 'commentary' && hasTool) return false;
    const rendered = canonicalCore().renderCanonicalMarkdown(events);
    return Boolean(rendered.trim()) && !canonicalRenderedHasUnresolvedInlineTokens(rendered);
  }

  function canonicalAssistantSegmentBlock(records, events) {
    assert(canonicalAssistantSegmentEligible(records, events),
      'AIConversationCore Assistant segment contains an unsupported record.');
    const rendered = canonicalCore().renderCanonicalMarkdown(events).trimEnd();
    const messageRecord = [...records].reverse().find((record, indexFromEnd) => {
      const index = records.length - 1 - indexFromEnd;
      return canonicalMessageRecordEligible(record, events[index]);
    }) ?? null;
    const headingRecord = messageRecord ?? records.find(record => record?.author?.role === 'assistant') ?? records[0];
    const plainHeading = messageRecord?.channel === 'commentary' ? '## ChatGPT Commentary' : '## ChatGPT';
    assert(rendered === plainHeading || rendered.startsWith(`${plainHeading}\n`),
      'AIConversationCore rendered an unexpected Assistant segment heading.');
    assert(!rendered.slice(plainHeading.length).includes('\n## ChatGPT'),
      'AIConversationCore Assistant segment unexpectedly produced multiple transcript sections.');
    return `${transcriptHeading(headingRecord)}${rendered.slice(plainHeading.length)}`;
  }

  // Compatibility helpers retained for the already-established #93/#97 regressions.
  function canonicalPlainRecordEligible(record) {
    if (cgIsHidden(record)) return false;
    if (!['user', 'assistant'].includes(record?.author?.role)) return false;
    if (record?.content?.content_type !== 'text') return false;
    const parts = record?.content?.parts;
    if (!Array.isArray(parts) || !parts.length || parts.some(part => typeof part !== 'string')) return false;
    if (!parts.some(part => part.trim())) return false;
    const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    if (Array.isArray(metadata.content_references) && metadata.content_references.length) return false;
    if (Array.isArray(metadata.citations) && metadata.citations.length) return false;
    const text = parts.join('');
    if (text.includes(CG_INLINE_TOKEN_START)) return false;
    if (/sandbox:\/\/?/i.test(text)) return false;
    return true;
  }

  function canonicalPlainRecordBlock(record, event) {
    return canonicalRecordBlock(record, event);
  }

  function canonicalPlainAssistantSegmentEligible(records) {
    if (!Array.isArray(records) || records.length < 2) return false;
    let hasAssistantMessage = false;
    for (const record of records) {
      if (cgIsHidden(record)) return false;
      if (record?.author?.role !== 'assistant') return false;
      const type = record?.content?.content_type;
      if (type === 'thoughts') continue;
      if (type !== 'text' || !canonicalPlainRecordEligible(record)) return false;
      hasAssistantMessage = true;
    }
    return hasAssistantMessage;
  }

  function canonicalPlainAssistantSegmentBlock(records, events) {
    assert(canonicalPlainAssistantSegmentEligible(records),
      'AIConversationCore Assistant segment requires only plain visible Assistant records.');
    return canonicalAssistantSegmentBlock(records, events);
  }
  // END AIConversationCore Phase 5 integration'''

RENDER = r'''  function renderConversationMarkdown(spine, onProgress, recoveredImageMap = new Map()) {
    assert(Array.isArray(spine?.records), 'Conversation API Markdown export requires spine records.');
    const records = spine.records.map(item => item.message).filter(Boolean);
    const output = [];
    const fileRefIndex = cgBuildFileReferenceIndex(records);
    const canonicalEventBySourceRecord = canonicalEventsBySourceRecord(records, recoveredImageMap);
    let pendingThoughts = [];

    const flushAssistantBlock = (body = '', record = null) => {
      if (!body && !pendingThoughts.length) return;
      const headingRecord = record ?? pendingThoughts[0];
      const parts = [transcriptHeading(headingRecord)];
      const thoughts = cgRenderThoughtBlock(pendingThoughts, fileRefIndex);
      if (thoughts) parts.push(thoughts);
      if (body) parts.push(quoteMarkdown(body));
      output.push(parts.join('\n\n'));
      pendingThoughts = [];
    };

    const flushPendingAssistant = () => {
      if (!pendingThoughts.length) return;
      const events = pendingThoughts
        .map(record => canonicalEventBySourceRecord.get(record.id) ?? null)
        .filter(Boolean);
      if (events.length === pendingThoughts.length &&
          canonicalAssistantSegmentEligible(pendingThoughts, events)) {
        output.push(canonicalAssistantSegmentBlock(pendingThoughts, events));
        pendingThoughts = [];
        return;
      }
      flushAssistantBlock();
    };

    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      onProgress?.({
        stage: 'rendering',
        record_number: i + 1,
        record_count: records.length
      });
      const recoveredImages = recoveredImageMap.get(record.id) ?? [];
      const canonicalEvent = canonicalEventBySourceRecord.get(record.id) ?? null;

      if (canonicalEvent && canonicalMessageRecordEligible(record, canonicalEvent)) {
        if (record?.author?.role === 'user') {
          flushPendingAssistant();
          output.push(canonicalRecordBlock(record, canonicalEvent));
          continue;
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length > 0) {
          const segmentRecords = [...pendingThoughts, record];
          const segmentEvents = segmentRecords
            .map(item => canonicalEventBySourceRecord.get(item.id) ?? null)
            .filter(Boolean);
          if (segmentEvents.length === segmentRecords.length &&
              canonicalAssistantSegmentEligible(segmentRecords, segmentEvents)) {
            output.push(canonicalAssistantSegmentBlock(segmentRecords, segmentEvents));
            pendingThoughts = [];
            continue;
          }
        }
        if (record?.author?.role === 'assistant' && pendingThoughts.length === 0) {
          output.push(canonicalRecordBlock(record, canonicalEvent));
          continue;
        }
      }

      if (canonicalEvent && canonicalThoughtRecordEligible(record, canonicalEvent)) {
        pendingThoughts.push(record);
        continue;
      }

      const userText = cgVisibleUserText(record, fileRefIndex, recoveredImages);
      if (userText) {
        flushPendingAssistant();
        output.push(`${transcriptHeading(record)}\n\n${quoteMarkdown(userText)}`);
        continue;
      }
      const assistantText = cgVisibleAssistantMarkdown(record, fileRefIndex, recoveredImages);
      if (assistantText) {
        flushAssistantBlock(assistantText, record);
        continue;
      }
      if (cgRenderThoughtItem(record, fileRefIndex)) pendingThoughts.push(record);
    }
    flushPendingAssistant();
    return `${output.join('\n\n')}\n`;
  }
'''


def replace_between(text: str, begin: str, end: str, replacement: str) -> str:
  start = text.index(begin)
  finish = text.index(end, start) + len(end)
  return text[:start] + replacement + text[finish:]


text = USER_SCRIPT.read_text(encoding='utf-8')
assert '// @version      0.6.140' in text
assert OLD_CORE in text
text = text.replace('// @version      0.6.140', '// @version      0.6.141', 1)
text = text.replace(OLD_CORE, NEW_CORE, 1)
text = replace_between(
  text,
  '  // BEGIN AIConversationCore Phase 5 integration',
  '  // END AIConversationCore Phase 5 integration',
  HELPERS
)
render_start = text.index('  function renderConversationMarkdown(spine, onProgress, recoveredImageMap = new Map()) {')
render_end = text.index('\n  function conversationMetadataJsonlRecord', render_start)
text = text[:render_start] + RENDER + text[render_end:]
USER_SCRIPT.write_text(text, encoding='utf-8')

core_test = CORE_TEST.read_text(encoding='utf-8')
assert OLD_CORE in core_test
core_test = core_test.replace(OLD_CORE, NEW_CORE, 1)
CORE_TEST.write_text(core_test, encoding='utf-8')

print('Phase 5 production patch applied.')
