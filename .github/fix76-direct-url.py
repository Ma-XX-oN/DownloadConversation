from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text()
assert '// @version      0.6.124' in text
text = text.replace('// @version      0.6.124', '// @version      0.6.125', 1)

marker = "  function cgImagePointerFallback(part) {\n"
assert marker in text
helper = r'''  function cgImageFailureMarkdown(source, httpStatus = null) {
    if (httpStatus === 404 || httpStatus === 410) return '[image missing]';
    return cgImageUnavailableMarkdown(source);
  }

  async function cgResolveImagePointerMarkdown(part, recordId, imageOrdinal) {
    const source = cgImagePointerSource(part);
    if (!source) return '[image missing]';
    if (source.startsWith('data:image/')) return `![image-${recordId}-${imageOrdinal}](${source})`;
    let parsed = null;
    try { parsed = new URL(source, location.href); } catch {}
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return cgImageUnavailableMarkdown(source);
    try {
      const response = await fetch(source, { method: 'GET', credentials: 'include' });
      if (!response.ok) return cgImageFailureMarkdown(source, response.status);
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read conversational image blob.'));
        reader.readAsDataURL(blob);
      });
      return dataUrl ? `![image-${recordId}-${imageOrdinal}](${dataUrl})` : cgImageUnavailableMarkdown(source);
    } catch {
      return cgImageUnavailableMarkdown(source);
    }
  }

'''
text = text.replace(marker, helper + marker, 1)

old_catch = """              const status = Number(error?.httpStatus);
              if (status === 404 || status === 410) {
                images[index] = '[image missing]';
              } else {
                const source = candidates[index]?.currentSrc || candidates[index]?.getAttribute('src') ||
                  cgImagePointerSource(expectedParts[index]);
                images[index] = cgImageUnavailableMarkdown(source);
              }
"""
new_catch = """              const status = Number(error?.httpStatus);
              const source = candidates[index]?.currentSrc || candidates[index]?.getAttribute('src') ||
                cgImagePointerSource(expectedParts[index]);
              images[index] = cgImageFailureMarkdown(source, status);
"""
assert old_catch in text
text = text.replace(old_catch, new_catch, 1)

old_after_loop = """          for (let index = 0; index < Math.min(expected, candidates.length); index += 1) {
            try {
              const dataUrl = await imageElementDataUrl(candidates[index]);
              if (dataUrl) images[index] = `![image-${record.id}-${index + 1}](${dataUrl})`;
            } catch (error) {
              const status = Number(error?.httpStatus);
              const source = candidates[index]?.currentSrc || candidates[index]?.getAttribute('src') ||
                cgImagePointerSource(expectedParts[index]);
              images[index] = cgImageFailureMarkdown(source, status);
              logDiagnostic('warnings', 'conversation-image-recovery-failure', {
                message_id: record.id,
                image_ordinal: index + 1,
                http_status: Number.isFinite(status) ? status : null,
                fallback: images[index],
                message: error instanceof Error ? error.message : String(error)
              });
            }
          }
"""
new_after_loop = old_after_loop + """          for (let index = candidates.length; index < expected; index += 1) {
            images[index] = await cgResolveImagePointerMarkdown(expectedParts[index], record.id, index + 1);
          }
"""
assert old_after_loop in text
text = text.replace(old_after_loop, new_after_loop, 1)

needle = """    assert(fallbackMarkdown.indexOf(unavailableToken) < fallbackMarkdown.indexOf(missingToken) &&
      fallbackMarkdown.indexOf(missingToken) < fallbackMarkdown.indexOf('First User'),
      'image placeholders did not preserve source order before adjacent User text.');
"""
addition = needle + """    assert(cgImageFailureMarkdown('https://example.test/missing.png', 404) === '[image missing]',
      'HTTP 404 image was not classified as missing.');
    assert(cgImageFailureMarkdown('https://example.test/private.png', 403) ===
      '[image not available](https://example.test/private.png)',
      'HTTP 403 image was not classified as linked image-not-available.');
"""
assert needle in text
text = text.replace(needle, addition, 1)

path.write_text(text)
