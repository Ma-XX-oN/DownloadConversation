from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text()
assert '// @version      0.6.122' in text
text = text.replace('// @version      0.6.122', '// @version      0.6.123', 1)

old = '''  function cgContentTextParts(record, fileRefIndex = new Map()) {
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
    return cgContentTextParts(record, fileRefIndex).join('\\n\\n').trim();
  }

  function cgVisibleAssistantText(record, fileRefIndex = new Map()) {
    if (cgIsHidden(record) || record?.author?.role !== 'assistant' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex).join('\\n\\n').trim();
  }

  function cgVisibleAssistantMarkdown(record, fileRefIndex = new Map()) {
    return cgVisibleAssistantText(record, fileRefIndex);
  }
'''
new = '''  function cgContentTextParts(record, fileRefIndex = new Map(), recoveredImages = []) {
    const content = record?.content ?? {};
    const parts = content.parts;
    const role = record?.author?.role ?? '';
    const type = content.content_type ?? '';
    const cleaned = [];
    let imageOrdinal = 0;
    if (!Array.isArray(parts)) return cleaned;
    for (const part of parts) {
      const texts = [];
      if (typeof part === 'string') {
        if (part.trim()) texts.push(part);
      } else if (part && typeof part === 'object') {
        if (part.content_type === 'image_asset_pointer') {
          cleaned.push(recoveredImages[imageOrdinal] || '[image missing]');
          imageOrdinal += 1;
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
    return cleaned;
  }

  function cgVisibleUserText(record, fileRefIndex = new Map(), recoveredImages = []) {
    if (cgIsHidden(record) || record?.author?.role !== 'user' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex, recoveredImages).join('\\n\\n').trim();
  }

  function cgVisibleAssistantText(record, fileRefIndex = new Map(), recoveredImages = []) {
    if (cgIsHidden(record) || record?.author?.role !== 'assistant' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex, recoveredImages).join('\\n\\n').trim();
  }

  function cgVisibleAssistantMarkdown(record, fileRefIndex = new Map(), recoveredImages = []) {
    return cgVisibleAssistantText(record, fileRefIndex, recoveredImages);
  }
'''
assert old in text
text = text.replace(old, new, 1)

text = text.replace(
  '  function renderConversationMarkdown(spine, onProgress) {',
  '  function renderConversationMarkdown(spine, onProgress, recoveredImageMap = new Map()) {',
  1
)
text = text.replace(
  '      const userText = cgVisibleUserText(record, fileRefIndex);',
  "      const recoveredImages = recoveredImageMap.get(record.id) ?? [];\n      const userText = cgVisibleUserText(record, fileRefIndex, recoveredImages);",
  1
)
text = text.replace(
  '      const assistantText = cgVisibleAssistantMarkdown(record, fileRefIndex);',
  '      const assistantText = cgVisibleAssistantMarkdown(record, fileRefIndex, recoveredImages);',
  1
)

marker = '  async function runExport(kind) {'
assert marker in text
recovery = r'''  function userImagePointerCount(record) {
    if (record?.author?.role !== 'user' || !Array.isArray(record?.content?.parts)) return 0;
    return record.content.parts.filter(part =>
      part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
    ).length;
  }

  function mountedUserConversationImages(section) {
    if (!(section instanceof HTMLElement) || section.getAttribute('data-turn') !== 'user') return [];
    const images = [];
    const seen = new Set();
    for (const image of section.querySelectorAll(
      'button[aria-label^="Open image:"] img, [class~="group/message-image"] img'
    )) {
      if (!(image instanceof HTMLImageElement) || seen.has(image)) continue;
      const src = image.currentSrc || image.getAttribute('src') || '';
      if (!src) continue;
      seen.add(image);
      images.push(image);
    }
    return images;
  }

  async function imageElementDataUrl(image) {
    const src = image.currentSrc || image.getAttribute('src') || '';
    assert(src, 'Conversational image has no source URL.');
    if (src.startsWith('data:')) return src;
    const response = await fetch(src, { credentials: 'include' });
    assert(response.ok, `Conversational image request returned HTTP ${response.status}.`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read conversational image blob.'));
      reader.readAsDataURL(blob);
    });
  }

  async function recoverUserImages(spine) {
    const recovered = new Map();
    const scrollRoot = conversationScrollRoot();
    const originalScrollTop = scrollRoot.scrollTop;
    const records = (spine?.records ?? []).filter(record => userImagePointerCount(record?.message) > 0);
    try {
      for (const item of records) {
        const record = item.message;
        const expected = userImagePointerCount(record);
        const images = new Array(expected).fill('[image missing]');
        try {
          let section = mountedTurnSection(record.id, 'user');
          if (!(section instanceof HTMLElement)) {
            const target = resolveJumpIdentifier(spine, record.id);
            target.spine = spine;
            section = await jumpToResolvedTarget(target);
          }
          const candidates = mountedUserConversationImages(section);
          for (let index = 0; index < Math.min(expected, candidates.length); index += 1) {
            try {
              const dataUrl = await imageElementDataUrl(candidates[index]);
              if (dataUrl) images[index] = `![image-${record.id}-${index + 1}](${dataUrl})`;
            } catch (error) {
              logDiagnostic('warnings', 'conversation-image-recovery-failure', {
                message_id: record.id,
                image_ordinal: index + 1,
                message: error instanceof Error ? error.message : String(error)
              });
            }
          }
        } catch (error) {
          logDiagnostic('warnings', 'conversation-image-turn-recovery-failure', {
            message_id: record.id,
            expected_image_count: expected,
            message: error instanceof Error ? error.message : String(error)
          });
        }
        recovered.set(record.id, images);
      }
    } finally {
      scrollRoot.scrollTop = originalScrollTop;
    }
    return recovered;
  }

'''
text = text.replace(marker, recovery + marker, 1)

old_run = '''      } else {
        progressState.stage = 'rendering';
        progressState.render_started_at = performance.now();
        progressState.record_count = spine.records.length;
        const markdown = renderConversationMarkdown(spine, progress => {
          progressState.stage = 'rendering';
          progressState.record_number = progress.record_number;
          progressState.record_count = progress.record_count;
          refreshStatus();
        });
'''
new_run = '''      } else {
        progressState.stage = 'recovering-images';
        setStatus('Recovering conversational images…');
        const recoveredImageMap = await recoverUserImages(spine);
        progressState.stage = 'rendering';
        progressState.render_started_at = performance.now();
        progressState.record_count = spine.records.length;
        const markdown = renderConversationMarkdown(spine, progress => {
          progressState.stage = 'rendering';
          progressState.record_number = progress.record_number;
          progressState.record_count = progress.record_count;
          refreshStatus();
        }, recoveredImageMap);
'''
assert old_run in text
text = text.replace(old_run, new_run, 1)

old_test = "    const markdown = renderConversationMarkdown(spine);\n    assert(markdown.includes('First User'), 'multimodal_text User content was not rendered.');\n    assert(markdown.includes('[image missing]'), 'multimodal image pointer was not preserved as a placeholder.');"
new_test = "    const fallbackMarkdown = renderConversationMarkdown(spine);\n    assert(fallbackMarkdown.includes('[image missing]'), 'unrecovered multimodal image pointer did not retain its placeholder.');\n    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';\n    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken]]]));\n    assert(markdown.includes('First User'), 'multimodal_text User content was not rendered.');\n    assert(markdown.includes(recoveredToken), 'recovered multimodal image was not rendered at its API image pointer.');\n    assert(!markdown.includes('[image missing]'), 'recovered multimodal image still rendered as missing.');"
assert old_test in text
text = text.replace(old_test, new_test, 1)

old_parity = "    const markdown = renderConversationMarkdown(spine);\n    assert(markdown.includes('[image missing]'), 'image_asset_pointer was not rendered as an image placeholder.');"
new_parity = "    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';\n    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken]]]));\n    assert(markdown.includes(recoveredToken), 'recovered image_asset_pointer was not rendered.');"
assert old_parity in text
text = text.replace(old_parity, new_parity, 1)

path.write_text(text)
