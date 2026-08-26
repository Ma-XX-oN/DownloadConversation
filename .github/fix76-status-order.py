from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text()
assert '// @version      0.6.123' in text
text = text.replace('// @version      0.6.123', '// @version      0.6.124', 1)

marker = '  function cgContentTextParts(record, fileRefIndex = new Map(), recoveredImages = []) {'
assert marker in text
helper = r'''  function cgImagePointerSource(part) {
    if (!part || typeof part !== 'object') return '';
    const metadata = part.metadata && typeof part.metadata === 'object' ? part.metadata : {};
    for (const value of [metadata.asset_pointer_link, part.asset_pointer_link, part.asset_pointer]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function cgImageUnavailableMarkdown(source) {
    const clean = typeof source === 'string' ? source.trim() : '';
    return clean ? `[image not available](${clean})` : '[image not available]';
  }

  function cgImagePointerFallback(part) {
    const source = cgImagePointerSource(part);
    return source ? cgImageUnavailableMarkdown(source) : '[image missing]';
  }

'''
text = text.replace(marker, helper + marker, 1)

old = """        if (part.content_type === 'image_asset_pointer') {
          cleaned.push(recoveredImages[imageOrdinal] || '[image missing]');
          imageOrdinal += 1;
          continue;
        }
"""
new = """        if (part.content_type === 'image_asset_pointer') {
          cleaned.push(recoveredImages[imageOrdinal] || cgImagePointerFallback(part));
          imageOrdinal += 1;
          continue;
        }
"""
assert old in text
text = text.replace(old, new, 1)

old_fetch = """    const response = await fetch(src, { credentials: 'include' });
    assert(response.ok, `Conversational image request returned HTTP ${response.status}.`);
    const blob = await response.blob();
"""
new_fetch = """    const response = await fetch(src, { credentials: 'include' });
    if (!response.ok) {
      const error = new Error(`Conversational image request returned HTTP ${response.status}.`);
      error.httpStatus = response.status;
      throw error;
    }
    const blob = await response.blob();
"""
assert old_fetch in text
text = text.replace(old_fetch, new_fetch, 1)

old_recover = """        const expected = userImagePointerCount(record);
        const images = new Array(expected).fill('[image missing]');
        try {
"""
new_recover = """        const expectedParts = record.content.parts.filter(part =>
          part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
        );
        const expected = expectedParts.length;
        const images = expectedParts.map(part => cgImagePointerFallback(part));
        try {
"""
assert old_recover in text
text = text.replace(old_recover, new_recover, 1)

old_catch = """            } catch (error) {
              logDiagnostic('warnings', 'conversation-image-recovery-failure', {
                message_id: record.id,
                image_ordinal: index + 1,
                message: error instanceof Error ? error.message : String(error)
              });
            }
"""
new_catch = """            } catch (error) {
              const status = Number(error?.httpStatus);
              if (status === 404 || status === 410) {
                images[index] = '[image missing]';
              } else {
                const source = candidates[index]?.currentSrc || candidates[index]?.getAttribute('src') ||
                  cgImagePointerSource(expectedParts[index]);
                images[index] = cgImageUnavailableMarkdown(source);
              }
              logDiagnostic('warnings', 'conversation-image-recovery-failure', {
                message_id: record.id,
                image_ordinal: index + 1,
                http_status: Number.isFinite(status) ? status : null,
                fallback: images[index],
                message: error instanceof Error ? error.message : String(error)
              });
            }
"""
assert old_catch in text
text = text.replace(old_catch, new_catch, 1)

old_test_block = """    const spine = {
      records: [
        { ordinal: 0, message: record('u1', 'user', 'multimodal_text', ['First User', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://example' }]) },
        { ordinal: 1, message: record('a1', 'assistant', 'text', ['First Assistant']) },
        { ordinal: 2, message: record('u2', 'user', 'text', ['Second User']) },
        { ordinal: 3, message: record('a2', 'assistant', 'text', ['Second Assistant']) }
      ]
    };
    const fallbackMarkdown = renderConversationMarkdown(spine);
    assert(fallbackMarkdown.includes('[image missing]'), 'unrecovered multimodal image pointer did not retain its placeholder.');
    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';
    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken]]]));
    assert(markdown.includes('First User'), 'multimodal_text User content was not rendered.');
    assert(markdown.includes(recoveredToken), 'recovered multimodal image was not rendered at its API image pointer.');
    assert(!markdown.includes('[image missing]'), 'recovered multimodal image still rendered as missing.');
"""
new_test_block = """    const spine = {
      records: [
        { ordinal: 0, message: record('u1', 'user', 'multimodal_text', [
          { content_type: 'image_asset_pointer', asset_pointer: 'sediment://fixture-image' },
          { content_type: 'image_asset_pointer' },
          'First User'
        ]) },
        { ordinal: 1, message: record('a1', 'assistant', 'text', ['First Assistant']) },
        { ordinal: 2, message: record('u2', 'user', 'text', ['Second User']) },
        { ordinal: 3, message: record('a2', 'assistant', 'text', ['Second Assistant']) }
      ]
    };
    const fallbackMarkdown = renderConversationMarkdown(spine);
    const unavailableToken = '[image not available](sediment://fixture-image)';
    const missingToken = '[image missing]';
    assert(fallbackMarkdown.includes(unavailableToken), 'protected image pointer did not render as linked image-not-available.');
    assert(fallbackMarkdown.includes(missingToken), 'image pointer without a source did not render as image missing.');
    assert(fallbackMarkdown.indexOf(unavailableToken) < fallbackMarkdown.indexOf(missingToken) &&
      fallbackMarkdown.indexOf(missingToken) < fallbackMarkdown.indexOf('First User'),
      'image placeholders did not preserve source order before adjacent User text.');
    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';
    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken, missingToken]]]));
    assert(markdown.includes('First User'), 'multimodal_text User content was not rendered.');
    assert(markdown.includes(recoveredToken), 'recovered multimodal image was not rendered at its API image pointer.');
    assert(markdown.indexOf(recoveredToken) < markdown.indexOf(missingToken) &&
      markdown.indexOf(missingToken) < markdown.indexOf('First User'),
      'recovered/missing image tokens did not remain in source order.');
"""
assert old_test_block in text
text = text.replace(old_test_block, new_test_block, 1)

old_parity = """    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';
    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken]]]));
    assert(markdown.includes(recoveredToken), 'recovered image_asset_pointer was not rendered.');
"""
new_parity = """    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';
    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken]]]));
    assert(markdown.includes(recoveredToken), 'recovered image_asset_pointer was not rendered.');
    assert(markdown.indexOf(recoveredToken) < markdown.indexOf('Question'),
      'recovered image_asset_pointer did not preserve its position before User text.');
"""
assert old_parity in text
text = text.replace(old_parity, new_parity, 1)

path.write_text(text)
