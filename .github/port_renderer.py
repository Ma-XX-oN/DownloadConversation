from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')
assert '// @version      0.6.120' in text
text = text.replace('// @version      0.6.120', '// @version      0.6.121', 1)

helper_marker = '  function cgRenderInlineReference(reference, urlIndex = new Map()) {'
assert helper_marker in text
helpers = r'''  const CG_INLINE_TOKEN_START = '\ue200';
  const CG_INLINE_TOKEN_END = '\ue201';
  const CG_INLINE_TOKEN_SEP = '\ue202';
  const CG_INLINE_TOKEN_RX = /\ue200[^\ue201]*\ue201/g;

  function cgInlineTokenSegments(token) {
    if (typeof token !== 'string' ||
        !token.startsWith(CG_INLINE_TOKEN_START) ||
        !token.endsWith(CG_INLINE_TOKEN_END)) return [];
    return token.slice(1, -1).split(CG_INLINE_TOKEN_SEP);
  }

  function cgStripInlineTokens(text) {
    return typeof text === 'string' ? text.replace(CG_INLINE_TOKEN_RX, '') : '';
  }

  function cgFileTokenSpec(token) {
    const segments = cgInlineTokenSegments(token);
    if (segments.length < 2 || segments[0] !== 'filecite') return { key: null, lineRef: '' };
    const match = /^turn(\d+)file(\d+)$/.exec(segments[1]);
    if (!match) return { key: null, lineRef: '' };
    return {
      key: `${Number(match[1])}:${Number(match[2])}`,
      lineRef: segments.length > 2 ? segments[2].trim() : ''
    };
  }

  function cgRegisterFileReference(index, record) {
    if (!(index instanceof Map) || !record?.metadata || typeof record.metadata !== 'object') return;
    const metadata = record.metadata;
    const citation = metadata.citation_metadata;
    if (!citation || typeof citation !== 'object') return;
    const turnNumber = Number(metadata.retrieval_turn_number);
    const fileIndex = Number(metadata.retrieval_file_index);
    if (!Number.isInteger(turnNumber) || !Number.isInteger(fileIndex)) return;
    const title = typeof citation.title === 'string' ? citation.title.trim() : '';
    const url = typeof citation.url === 'string' ? citation.url.trim() : '';
    if (!title && !url) return;
    index.set(`${turnNumber}:${fileIndex}`, citation);
  }

  function cgBuildFileReferenceIndex(records) {
    const index = new Map();
    for (const record of records ?? []) cgRegisterFileReference(index, record);
    return index;
  }

  function cgCollectMemoryCitationSources(record) {
    const entries = Array.isArray(record?.metadata?.conversation_context_citation_metadata)
      ? record.metadata.conversation_context_citation_metadata
      : [];
    const sources = [];
    const seen = new Set();
    for (const entry of entries) {
      const citation = entry?.citation;
      if (!citation || typeof citation !== 'object') continue;
      const url = typeof citation.url === 'string' ? citation.url.trim() : '';
      let label = typeof citation.title === 'string' ? citation.title.trim() : '';
      if (!label && typeof citation.attribution === 'string') label = citation.attribution.trim();
      if (!label) label = cgCitationHostname(url) || 'memory';
      if (!url && !label) continue;
      const dedupe = `${url}\u0000${label}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      sources.push({ url, label, tooltip: cgCitationTooltip(citation, {}, label) });
    }
    return sources;
  }

  function cgRenderSourceCitation(kind, sources) {
    const links = [];
    for (const source of sources ?? []) {
      const titleAttribute = source.tooltip
        ? ` title="${escapeHtmlAttribute(source.tooltip).replace(/\n/g, '&#10;')}"`
        : '';
      const favicon = source.url ? cgCitationFavicon(source.url) : '';
      const icon = favicon
        ? `<img alt="" src="${escapeHtmlAttribute(favicon)}" width="15" height="15"${titleAttribute} style="width:0.97em;height:0.97em;vertical-align:-0.13em;margin-right:0.22em;border-radius:2px;">`
        : '';
      if (source.url) {
        links.push(`<a href="${escapeHtmlAttribute(source.url)}"${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</a>`);
      } else {
        links.push(`<span${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</span>`);
      }
    }
    return links.length ? `**(${kind}: ${links.join(', ')})**` : '';
  }

  function cgRenderMemoryCitation(record) {
    const sources = cgCollectMemoryCitationSources(record);
    return sources.length ? cgRenderSourceCitation('memory', sources) : '**(memory context)**';
  }

  function cgDisplayFileUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    const cleaned = url.trim();
    try {
      const parsed = new URL(cleaned);
      if (parsed.hostname.toLowerCase() !== 'api.github.com') return cleaned;
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 4 || segments[0] !== 'repos' || segments[3] !== 'contents') return cleaned;
      const owner = segments[1];
      const repo = segments[2];
      const relative = segments.slice(4).map(decodeURIComponent);
      const ref = parsed.searchParams.get('ref') || 'main';
      if (!relative.length) return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(ref)}`;
      const target = relative[relative.length - 1].includes('.') ? 'blob' : 'tree';
      const rel = relative.map(segment => encodeURIComponent(segment)).join('/');
      return `https://github.com/${owner}/${repo}/${target}/${encodeURIComponent(ref)}/${rel}`;
    } catch {
      return cleaned;
    }
  }

  function cgDisplayFileLabel(name, url) {
    let shown = typeof name === 'string' ? name.trim().replace(/`/g, '') : '';
    const displayUrl = cgDisplayFileUrl(url);
    let parsed = null;
    try { parsed = displayUrl ? new URL(displayUrl) : null; } catch {}
    const segments = parsed ? parsed.pathname.split('/').filter(Boolean) : [];
    const generic = new Set(['', 'file', 'content', 'contents']);
    if (generic.has(shown.toLowerCase())) {
      if (parsed?.hostname.toLowerCase() === 'github.com') {
        if (segments.length >= 4 && segments[2] === 'tree' && segments.length === 4) {
          shown = `${segments[1]} contents`;
        } else if (segments.length >= 5 && ['blob', 'tree'].includes(segments[2])) {
          shown = decodeURIComponent(segments[segments.length - 1] || '');
        } else if (segments.length) shown = decodeURIComponent(segments[segments.length - 1]);
      } else if (segments.length) shown = decodeURIComponent(segments[segments.length - 1]);
    }
    return shown || 'file';
  }

  function cgRenderNamedFileReference(name, matchedText = '', url = '') {
    const shown = cgDisplayFileLabel(name, url);
    const { lineRef } = cgFileTokenSpec(matchedText);
    const label = `${shown}${lineRef ? ` ${lineRef}` : ''}`;
    const displayUrl = cgDisplayFileUrl(url);
    if (displayUrl) return `<a href="${escapeHtmlAttribute(displayUrl)}">${escapeHtmlText(label)}</a>`;
    return lineRef ? `\`${shown}\` ${lineRef}` : `\`${shown}\``;
  }

  function cgHiddenFileReference(reference, record, fileRefIndex) {
    const token = reference?.matched_text ?? '';
    const { key } = cgFileTokenSpec(token);
    if (!key) return '';
    let citation = null;
    const metadata = record?.metadata;
    if (metadata && typeof metadata === 'object') {
      const currentTurn = Number(metadata.retrieval_turn_number);
      const currentFile = Number(metadata.retrieval_file_index);
      if (Number.isInteger(currentTurn) && Number.isInteger(currentFile) &&
          `${currentTurn}:${currentFile}` === key && metadata.citation_metadata &&
          typeof metadata.citation_metadata === 'object') citation = metadata.citation_metadata;
    }
    if (!citation && fileRefIndex instanceof Map) citation = fileRefIndex.get(key) ?? null;
    return cgRenderNamedFileReference(citation?.title ?? '', token, citation?.url ?? '');
  }

'''
text = text.replace(helper_marker, helpers + helper_marker, 1)

start = text.index('  function cgRenderInlineReference(reference, urlIndex = new Map()) {')
end = text.index('  function cgVisibleUserText(record) {', start)
replacement = r'''  function cgRenderInlineReference(reference, record, urlIndex = new Map(), fileRefIndex = new Map()) {
    if (reference?.type === 'grouped_webpages') return cgRenderWebCitation(reference, urlIndex);
    if (reference?.type === 'alt_text') {
      for (const key of ['alt', 'prompt_text']) {
        const value = reference[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    }
    if (reference?.type === 'file') {
      return cgRenderNamedFileReference(reference.name ?? '', reference.matched_text ?? '', reference.url ?? '');
    }
    if (reference?.type === 'hidden') {
      const segments = cgInlineTokenSegments(reference.matched_text ?? '');
      if (!segments.length) return '';
      if (segments[0] === 'memcite') return cgRenderMemoryCitation(record);
      if (segments[0] === 'filecite') return cgHiddenFileReference(reference, record, fileRefIndex);
    }
    return '';
  }

  function cgRenderUnstructuredInlineToken(token, record, fileRefIndex) {
    const segments = cgInlineTokenSegments(token);
    if (!segments.length) return '';
    if (segments[0] === 'memcite') return cgRenderMemoryCitation(record);
    if (segments[0] === 'filecite') return cgHiddenFileReference({ type: 'hidden', matched_text: token }, record, fileRefIndex);
    return '';
  }

  function cgRenderInlineReferences(text, record, fileRefIndex = new Map()) {
    if (!text) return text;
    const references = Array.isArray(record?.metadata?.content_references)
      ? record.metadata.content_references
      : [];
    const urlIndex = cgSearchResultUrlIndex(record);
    let rendered = text;
    for (const reference of references) {
      const matched = reference?.matched_text;
      if (typeof matched !== 'string' || !matched || !rendered.includes(matched)) continue;
      const replacement = cgRenderInlineReference(reference, record, urlIndex, fileRefIndex);
      if (replacement) rendered = rendered.split(matched).join(replacement);
    }
    for (const token of rendered.match(CG_INLINE_TOKEN_RX) ?? []) {
      const fallback = cgRenderUnstructuredInlineToken(token, record, fileRefIndex);
      if (fallback) rendered = rendered.split(token).join(fallback);
    }
    return rendered;
  }

  function cgContentTextParts(record, fileRefIndex = new Map()) {
    const content = record?.content ?? {};
    const parts = content.parts;
    const role = record?.author?.role ?? '';
    const type = content.content_type ?? '';
    const cleaned = [];
    const imagePlaceholders = [];
    if (!Array.isArray(parts)) return cleaned;
    for (const part of parts) {
      const texts = [];
      if (typeof part === 'string') {
        if (part.trim()) texts.push(part);
      } else if (part && typeof part === 'object') {
        if (part.content_type === 'image_asset_pointer') {
          imagePlaceholders.push('[image missing]');
          continue;
        }
        for (const key of ['text', 'content']) {
          const value = part[key];
          if (typeof value === 'string' && value.trim()) texts.push(value);
        }
      }
      for (const value of texts) {
        const stripped = value.trim();
        if (role === 'tool' && type === 'multimodal_text' &&
            stripped.startsWith('Make sure to include ') && stripped.includes('cite this file')) continue;
        const rendered = cgStripInlineTokens(cgRenderInlineReferences(value, record, fileRefIndex)).trim();
        if (rendered) cleaned.push(rendered);
      }
    }
    cleaned.push(...imagePlaceholders);
    return cleaned;
  }

  function cgVisibleUserText(record, fileRefIndex = new Map()) {
    if (cgIsHidden(record) || record?.author?.role !== 'user' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex).join('\n\n').trim();
  }

  function cgVisibleAssistantText(record, fileRefIndex = new Map()) {
    if (cgIsHidden(record) || record?.author?.role !== 'assistant' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex).join('\n\n').trim();
  }

  function cgVisibleAssistantMarkdown(record, fileRefIndex = new Map()) {
    return cgVisibleAssistantText(record, fileRefIndex);
  }

  function cgRecordSearchTexts(record, fileRefIndex = new Map()) {
    if (cgIsHidden(record) || record?.author?.role === 'system') return [];
    const content = record?.content ?? {};
    const type = content.content_type ?? '';
    const texts = [];
    if (type === 'text' || type === 'multimodal_text') {
      texts.push(...cgContentTextParts(record, fileRefIndex));
    } else if (type === 'thoughts' && Array.isArray(content.thoughts)) {
      for (const thought of content.thoughts) {
        if (!thought || typeof thought !== 'object') continue;
        if (typeof thought.summary === 'string' && thought.summary.trim()) texts.push(thought.summary);
        if (typeof thought.content === 'string' && thought.content.trim()) texts.push(thought.content);
        else if (Array.isArray(thought.chunks)) {
          for (const chunk of thought.chunks) if (typeof chunk === 'string' && chunk.trim()) texts.push(chunk);
        }
      }
    } else if (type === 'code' || type === 'execution_output') {
      for (const key of ['text', 'content']) if (typeof content[key] === 'string' && content[key].trim()) texts.push(content[key]);
    } else if (type === 'reasoning_recap') {
      if (typeof content.content === 'string' && content.content.trim()) texts.push(content.content);
    } else if (type === 'model_editable_context') {
      for (const key of ['model_set_context', 'repo_summary']) if (typeof content[key] === 'string' && content[key].trim()) texts.push(content[key]);
    } else if (type === 'tether_browsing_display') {
      for (const key of ['summary', 'result']) if (typeof content[key] === 'string' && content[key].trim()) texts.push(content[key]);
      const assets = Array.isArray(content.assets) ? content.assets : [content.assets];
      for (const asset of assets) {
        if (!asset || typeof asset !== 'object') continue;
        for (const key of ['title', 'text', 'alt', 'caption', 'url']) if (typeof asset[key] === 'string' && asset[key].trim()) texts.push(asset[key]);
      }
    }
    return texts;
  }

'''
text = text[:start] + replacement + text[end:]
dup_start = text.index('  function cgVisibleUserText(record) {', start + len(replacement))
dup_end = text.index("  function cgCodeFence(text, language = '') {", dup_start)
text = text[:dup_start] + text[dup_end:]

thought_start = text.index('  function cgRenderThoughtItem(record) {')
thought_end = text.index('  function transcriptHeading(record) {', thought_start)
thought_replacement = r'''  function cgRenderThoughtItem(record, fileRefIndex = new Map()) {
    if (cgIsHidden(record)) return '';
    const role = record?.author?.role ?? '';
    const content = record?.content ?? {};
    const type = content.content_type ?? '';
    if (role === 'assistant' && type === 'thoughts') {
      const blocks = [];
      for (const thought of Array.isArray(content.thoughts) ? content.thoughts : []) {
        if (!thought || typeof thought !== 'object') continue;
        const summary = typeof thought.summary === 'string' ? thought.summary.trim() : '';
        const body = typeof thought.content === 'string' ? thought.content.trim() : '';
        if (body) blocks.push(summary ? `**${summary}**\n\n${body}` : body);
        else if (summary) blocks.push(summary);
        else if (Array.isArray(thought.chunks)) {
          const chunkText = thought.chunks.filter(chunk => typeof chunk === 'string' && chunk.trim()).join('\n\n');
          if (chunkText) blocks.push(chunkText);
        }
      }
      return blocks.join('\n\n');
    }
    if (role === 'assistant' && type === 'reasoning_recap') return typeof content.content === 'string' ? content.content.trim() : '';
    if (role === 'assistant' && type === 'code') {
      const code = typeof content.text === 'string' ? content.text : '';
      if (!code.trim()) return '';
      return cgRenderDetail(`${record?.recipient || 'tool'} code`, cgCodeFence(code, cgInferCodeLanguage(record, code, content.language ?? '')));
    }
    if (role === 'assistant' && type === 'model_editable_context') {
      const texts = cgRecordSearchTexts(record, fileRefIndex);
      return texts.length ? cgRenderDetail('editable context', quoteMarkdown(texts.join('\n\n'))) : '';
    }
    if (role === 'tool') {
      const texts = cgRecordSearchTexts(record, fileRefIndex);
      if (!texts.length) return '';
      return cgRenderDetail(`${record?.author?.name || record?.recipient || 'tool'} output`, cgCodeFence(texts.join('\n\n')));
    }
    return '';
  }

  function cgRenderThoughtBlock(items, fileRefIndex = new Map()) {
    const rendered = [];
    for (const record of items) {
      const body = cgRenderThoughtItem(record, fileRefIndex);
      if (body) rendered.push(body);
    }
    return rendered.length ? `<details>\n<summary>Thoughts</summary>\n\n${rendered.join('\n\n')}\n\n</details>` : '';
  }

'''
text = text[:thought_start] + thought_replacement + text[thought_end:]

render_start = text.index('  function renderConversationMarkdown(spine, onProgress) {')
render_end = text.index('  function apiRecordsJsonl(spine) {', render_start)
render_block = text[render_start:render_end]
needle = '    const records = spine.records.map(item => item.message).filter(Boolean);\n    const output = [];\n'
assert render_block.count(needle) == 1
render_block = render_block.replace(needle, needle + '    const fileRefIndex = cgBuildFileReferenceIndex(records);\n', 1)
render_block = render_block.replace('cgRenderThoughtBlock(pendingThoughts)', 'cgRenderThoughtBlock(pendingThoughts, fileRefIndex)')
render_block = render_block.replace('cgVisibleUserText(record)', 'cgVisibleUserText(record, fileRefIndex)')
render_block = render_block.replace('cgVisibleAssistantMarkdown(record)', 'cgVisibleAssistantMarkdown(record, fileRefIndex)')
render_block = render_block.replace('cgRenderThoughtItem(record)', 'cgRenderThoughtItem(record, fileRefIndex)')
text = text[:render_start] + render_block + text[render_end:]

test_marker = '  async function runTests() {'
assert test_marker in text
parity_test = r'''  function testRendererParityFeatures() {
    const fileToken = `${CG_INLINE_TOKEN_START}filecite${CG_INLINE_TOKEN_SEP}turn7file2${CG_INLINE_TOKEN_SEP}L1-L2${CG_INLINE_TOKEN_END}`;
    const citeToken = `${CG_INLINE_TOKEN_START}cite${CG_INLINE_TOKEN_SEP}web${CG_INLINE_TOKEN_END}`;
    const memoryToken = `${CG_INLINE_TOKEN_START}memcite${CG_INLINE_TOKEN_END}`;
    const records = [
      { id: 'file-meta', author: { role: 'tool' }, content: { content_type: 'text', parts: [] }, metadata: { is_visually_hidden_from_conversation: true, retrieval_turn_number: 7, retrieval_file_index: 2, citation_metadata: { title: 'notes.txt', url: 'https://example.com/notes.txt' } } },
      { id: 'u1', author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: ['Question', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://image' }] }, metadata: {} },
      { id: 'tool1', author: { role: 'tool', name: 'tether_browsing_display' }, content: { content_type: 'tether_browsing_display', summary: 'Waiting for sources.' }, metadata: {} },
      { id: 'a1', author: { role: 'assistant' }, channel: 'final', content: { content_type: 'multimodal_text', parts: [`File ${fileToken}\n\nWeb ${citeToken}\n\nMemory ${memoryToken}`] }, metadata: { content_references: [ { type: 'hidden', matched_text: fileToken }, { type: 'grouped_webpages', matched_text: citeToken, items: [{ url: 'https://example.com/web', attribution: 'Example', title: 'Example source' }] }, { type: 'hidden', matched_text: memoryToken } ], conversation_context_citation_metadata: [{ citation: { url: 'https://example.com/memory', title: 'Prior note' } }] } }
    ];
    const spine = { records: records.map((message, ordinal) => ({ ordinal, message })) };
    const markdown = renderConversationMarkdown(spine);
    assert(markdown.includes('[image missing]'), 'image_asset_pointer was not rendered as an image placeholder.');
    assert(markdown.includes('<a href="https://example.com/notes.txt">notes.txt L1-L2</a>'), 'hidden file citation was not resolved to its link.');
    assert(markdown.includes('**(cite:'), 'web citation was not rendered.');
    assert(markdown.includes('**(memory:'), 'memory citation was not rendered.');
    assert(markdown.includes('Waiting for sources.'), 'tether browsing content was not preserved.');
    assert(!markdown.includes(CG_INLINE_TOKEN_START), 'raw ChatGPT inline reference tokens leaked into Markdown.');
  }

'''
text = text.replace(test_marker, parity_test + test_marker, 1)
run_needle = "      await run('Multimodal User + chronological order', testMultimodalUserAndChronologicalOrder);\n"
assert text.count(run_needle) == 1
text = text.replace(run_needle, run_needle + "      await run('AI-transcript renderer parity', testRendererParityFeatures);\n", 1)
old_parts = "['First User', { asset_pointer: 'file-service://example' }]"
assert old_parts in text
text = text.replace(old_parts, "['First User', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://example' }]", 1)
old_assert = "    assert(markdown.includes('First User'), 'multimodal_text User content was not rendered.');\n"
assert old_assert in text
text = text.replace(old_assert, old_assert + "    assert(markdown.includes('[image missing]'), 'multimodal image pointer was not preserved as a placeholder.');\n", 1)
render_start = text.index('  function renderConversationMarkdown(spine, onProgress) {')
render_end = text.index('  function apiRecordsJsonl(spine) {', render_start)
assert 'apiConversationUapFinalGrouping(spine)' not in text[render_start:render_end]
assert 'cgBuildFileReferenceIndex(records)' in text[render_start:render_end]
path.write_text(text, encoding='utf-8')
