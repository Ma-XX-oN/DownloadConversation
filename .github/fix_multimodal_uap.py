from pathlib import Path

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


old_spine = extract_js_function(text, 'conversationSpineFromPages')
new_spine = '''  function conversationSpineFromPages(pages) {
    const messageIndexById = new Map();
    const messages = [];
    let duplicateMessageIds = 0;
    for (const page of [...pages].reverse()) {
      for (const message of page?.messages ?? []) {
        const id = typeof message?.id === 'string' ? message.id : '';
        if (!id) throw new Error('Conversation API message is missing a stable id.');
        const existingIndex = messageIndexById.get(id);
        if (existingIndex !== undefined) {
          duplicateMessageIds += 1;
          messages[existingIndex] = message;
          continue;
        }
        messageIndexById.set(id, messages.length);
        messages.push(message);
      }
    }

    const records = messages.map((message, ordinal) => {
      const metadata = message?.metadata && typeof message.metadata === 'object'
        ? message.metadata
        : {};
      return {
        ordinal,
        message_id: message.id,
        role: typeof message?.author?.role === 'string' ? message.author.role : null,
        channel: typeof message?.channel === 'string' ? message.channel : null,
        content_type: typeof message?.content?.content_type === 'string'
          ? message.content.content_type
          : null,
        turn_exchange_id: typeof metadata.turn_exchange_id === 'string'
          ? metadata.turn_exchange_id
          : null,
        working_turn_id: typeof metadata.working_turn_id === 'string'
          ? metadata.working_turn_id
          : null,
        message
      };
    });

    const uapAnchors = [];
    for (const record of records) {
      if (record.role !== 'user') continue;
      uapAnchors.push({
        ordinal: uapAnchors.length,
        user_message_id: record.message_id,
        user_record_ordinal: record.ordinal,
        turn_exchange_id: record.turn_exchange_id,
        working_turn_id: record.working_turn_id
      });
    }

    return {
      pages: [...pages],
      messages,
      records,
      uap_anchors: uapAnchors,
      duplicate_message_ids: duplicateMessageIds
    };
  }

'''
text = text.replace(old_spine, new_spine, 1)

insertion_point = text.index('  function cgIsHidden(')
helpers = '''  function apiLinkageKeyIsIdentifierLike(key) {
    return /(?:^id$|_id$|_ids$|call|parent|source|reference|tool|exchange|working|request|response)/i
      .test(String(key ?? ''));
  }

  function apiLinkageScalarIsSafe(key, value) {
    if (value === null || value === undefined) return false;
    if (!['string', 'number'].includes(typeof value)) return false;
    if (/(?:authorization|cookie|token|secret|password)/i.test(String(key ?? ''))) return false;
    if (typeof value === 'string' && value.length > 256) return false;
    return true;
  }

  function apiRecordIdentifierScalars(record) {
    const raw = record?.message && typeof record.message === 'object' ? record.message : {};
    const result = [];
    const seen = new Set();
    const freeformKeys = new Set([
      'text', 'parts', 'thinking', 'summary', 'message', 'prompt', 'output', 'input', 'content'
    ]);
    const walk = (value, path, depth) => {
      if (depth > 8 || value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(value.length, 12); i += 1) {
          walk(value[i], `${path}[${i}]`, depth + 1);
        }
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (child && typeof child === 'object') {
          if (!freeformKeys.has(key)) walk(child, childPath, depth + 1);
          continue;
        }
        if (freeformKeys.has(key)) continue;
        if (apiLinkageKeyIsIdentifierLike(key) && apiLinkageScalarIsSafe(key, child)) {
          result.push({ path: childPath, key, value: child });
        }
      }
    };
    walk(raw, '', 0);
    return result;
  }

  function apiConversationUapGrouping(spine) {
    const anchors = spine?.uap_anchors ?? [];
    const records = spine?.records ?? [];
    const exchangeToAnchors = new Map();
    const workingToAnchors = new Map();
    const add = (map, key, ordinal) => {
      if (!key) return;
      const values = map.get(key) ?? [];
      values.push(ordinal);
      map.set(key, values);
    };
    for (const anchor of anchors) {
      add(exchangeToAnchors, anchor.turn_exchange_id, anchor.ordinal);
      add(workingToAnchors, anchor.working_turn_id, anchor.ordinal);
    }

    const groups = anchors.map(anchor => ({
      ordinal: anchor.ordinal,
      user_message_id: anchor.user_message_id,
      user_record_ordinal: anchor.user_record_ordinal,
      record_ordinals: [],
      exact_record_ordinals: []
    }));
    const classifications = [];
    const counts = { exact: 0, fallback: 0, ungrouped: 0, conflict: 0 };

    const chronologicalAnchor = recordOrdinal => {
      let candidate = null;
      for (const anchor of anchors) {
        if (anchor.user_record_ordinal > recordOrdinal) break;
        candidate = anchor.ordinal;
      }
      return candidate;
    };

    for (const record of records) {
      const exchangeCandidates = record.turn_exchange_id
        ? (exchangeToAnchors.get(record.turn_exchange_id) ?? [])
        : [];
      const workingCandidates = record.working_turn_id
        ? (workingToAnchors.get(record.working_turn_id) ?? [])
        : [];
      const exactCandidates = [...new Set([...exchangeCandidates, ...workingCandidates])];
      const disagreement = exchangeCandidates.length === 1 && workingCandidates.length === 1 &&
        exchangeCandidates[0] !== workingCandidates[0];
      let classification;
      let uapOrdinal = null;
      let basis = null;
      if (disagreement || exactCandidates.length > 1) {
        classification = 'conflict';
      } else if (exactCandidates.length === 1) {
        classification = 'exact';
        uapOrdinal = exactCandidates[0];
        basis = exchangeCandidates.length === 1 && workingCandidates.length === 1
          ? 'turn_exchange_id+working_turn_id'
          : exchangeCandidates.length === 1 ? 'turn_exchange_id' : 'working_turn_id';
        groups[uapOrdinal].exact_record_ordinals.push(record.ordinal);
      } else {
        uapOrdinal = chronologicalAnchor(record.ordinal);
        if (uapOrdinal === null) classification = 'ungrouped';
        else {
          classification = 'fallback';
          basis = 'chronological-window';
        }
      }
      counts[classification] += 1;
      classifications.push({
        record_ordinal: record.ordinal,
        message_id: record.message_id,
        role: record.role,
        classification,
        uap_ordinal: uapOrdinal,
        basis
      });
    }
    return { groups, classifications, counts };
  }

  function apiUnresolvedUapLinkageAnalysis(spine, primary) {
    const records = spine?.records ?? [];
    const exactMessageToUap = new Map();
    const exactIdentifierToUaps = new Map();
    const keyFor = value => `${typeof value}:${String(value)}`;
    const addRef = (map, value, uapOrdinal) => {
      const key = keyFor(value);
      const values = map.get(key) ?? new Set();
      values.add(uapOrdinal);
      map.set(key, values);
    };

    for (const item of primary.classifications) {
      if (item.classification !== 'exact') continue;
      const record = records[item.record_ordinal];
      exactMessageToUap.set(record.message_id, item.uap_ordinal);
      for (const scalar of apiRecordIdentifierScalars(record)) {
        addRef(exactIdentifierToUaps, scalar.value, item.uap_ordinal);
      }
    }

    const exactBeforeAfter = ordinal => {
      let before = null;
      let after = null;
      for (let i = ordinal - 1; i >= 0; i -= 1) {
        const item = primary.classifications[i];
        if (item?.classification === 'exact') {
          before = item;
          break;
        }
      }
      for (let i = ordinal + 1; i < primary.classifications.length; i += 1) {
        const item = primary.classifications[i];
        if (item?.classification === 'exact') {
          after = item;
          break;
        }
      }
      return { before, after };
    };

    const unresolved = [];
    for (const item of primary.classifications) {
      if (!['fallback', 'ungrouped'].includes(item.classification)) continue;
      const record = records[item.record_ordinal];
      const refs = new Set();
      for (const scalar of apiRecordIdentifierScalars(record)) {
        const exactUap = exactMessageToUap.get(String(scalar.value));
        if (exactUap !== undefined) refs.add(exactUap);
      }
      for (const uap of exactIdentifierToUaps.get(keyFor(record.message_id)) ?? []) refs.add(uap);
      const { before, after } = exactBeforeAfter(item.record_ordinal);
      const sameUapBounded = before && after && before.uap_ordinal === after.uap_ordinal;
      unresolved.push({
        record_ordinal: item.record_ordinal,
        referenced_uap_ordinals: [...refs].sort((a, b) => a - b),
        same_uap_bounded: Boolean(sameUapBounded),
        bounded_uap_ordinal: sameUapBounded ? before.uap_ordinal : null
      });
    }
    return { unresolved };
  }

  function apiConversationUapFinalGrouping(spine) {
    const primary = apiConversationUapGrouping(spine);
    const linkage = apiUnresolvedUapLinkageAnalysis(spine, primary);
    const linkageByOrdinal = new Map(
      linkage.unresolved.map(item => [item.record_ordinal, item])
    );
    const records = spine?.records ?? [];
    const groups = (spine?.uap_anchors ?? []).map(anchor => ({
      ordinal: anchor.ordinal,
      user_message_id: anchor.user_message_id,
      record_ordinals: []
    }));
    const classifications = [];
    const counts = { exact: 0, linked: 0, bounded: 0, global: 0, conflict: 0, unresolved: 0 };

    for (const item of primary.classifications) {
      const record = records[item.record_ordinal];
      let classification = item.classification;
      let uapOrdinal = item.uap_ordinal;
      let basis = item.basis;
      if (classification === 'fallback' || classification === 'ungrouped') {
        const evidence = linkageByOrdinal.get(item.record_ordinal);
        const refs = evidence?.referenced_uap_ordinals ?? [];
        const boundedOrdinal = evidence?.same_uap_bounded
          ? evidence.bounded_uap_ordinal
          : null;
        if (refs.length > 1 ||
            (refs.length === 1 && boundedOrdinal !== null && refs[0] !== boundedOrdinal)) {
          classification = 'conflict';
          uapOrdinal = null;
          basis = 'unresolved-evidence-conflict';
        } else if (refs.length === 1) {
          classification = 'linked';
          uapOrdinal = refs[0];
          basis = 'identifier-linkage';
        } else if (boundedOrdinal !== null && record?.role !== 'system') {
          classification = 'bounded';
          uapOrdinal = boundedOrdinal;
          basis = 'exact-neighbour-containment';
        } else if (record?.role === 'system' &&
                   record?.message?.metadata?.is_visually_hidden_from_conversation === true) {
          classification = 'global';
          uapOrdinal = null;
          basis = 'hidden-system-outside-exchange';
        } else {
          classification = 'unresolved';
          uapOrdinal = null;
          basis = 'insufficient-evidence';
        }
      }
      if (classification === 'conflict') uapOrdinal = null;
      counts[classification] = (counts[classification] ?? 0) + 1;
      if (uapOrdinal !== null && groups[uapOrdinal]) {
        groups[uapOrdinal].record_ordinals.push(item.record_ordinal);
      }
      classifications.push({ ...item, classification, uap_ordinal: uapOrdinal, basis });
    }

    return {
      groups,
      classifications,
      exact_record_count: counts.exact,
      linked_record_count: counts.linked,
      bounded_record_count: counts.bounded,
      global_record_count: counts.global,
      conflicting_record_count: counts.conflict,
      unresolved_record_count: counts.unresolved
    };
  }

'''
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
