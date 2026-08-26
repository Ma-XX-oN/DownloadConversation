from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text()
assert '// @version      0.6.128' in text
text = text.replace('// @version      0.6.128', '// @version      0.6.129', 1)

marker = '  function cgRenderInlineReferences(text, record, fileRefIndex = new Map()) {'
assert marker in text
helper = r'''  function cgGeneratedSandboxDownloadUrl(source, record) {
    if (record?.author?.role !== 'assistant') return null;
    const value = String(source ?? '').trim();
    const match = value.match(/^sandbox:(\/\/)?(\/mnt\/data\/.*)$/i);
    if (!match) return null;
    const conversationId = currentConversationId();
    const messageId = record?.id;
    if (!conversationId || !messageId) return null;
    const sandboxPath = match[2];
    return `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationId)}` +
      `/interpreter/download?message_id=${encodeURIComponent(messageId)}` +
      `&sandbox_path=${encodeURIComponent(sandboxPath)}&download_intent=true`;
  }

  function cgRewriteGeneratedSandboxLinks(text, record) {
    if (!text || record?.author?.role !== 'assistant') return text;
    return String(text).replace(/(\[[^\]]*\]\()(sandbox:(?:\/\/)?\/mnt\/data\/[^)]+)(\))/gi,
      (whole, prefix, source, suffix) => {
        const url = cgGeneratedSandboxDownloadUrl(source, record);
        return url ? `${prefix}${url}${suffix}` : whole;
      });
  }

'''
text = text.replace(marker, helper + marker, 1)

old = "        const rendered = cgStripInlineTokens(cgRenderInlineReferences(value, record, fileRefIndex)).trim();"
new = "        const rendered = cgRewriteGeneratedSandboxLinks(\n          cgStripInlineTokens(cgRenderInlineReferences(value, record, fileRefIndex)), record\n        ).trim();"
assert old in text
text = text.replace(old, new, 1)

needle = "      await run('AI-transcript renderer parity', testRendererParityFeatures);\n"
assert needle in text
# Insert a focused pure helper test before runTests and invoke it.
test_marker = '  async function runTests() {'
assert test_marker in text
test_code = r'''  function testGeneratedSandboxDownloadLink() {
    const conversationId = currentConversationId();
    assert(conversationId, 'Sandbox-link test requires a ChatGPT conversation page.');
    const record = { id: 'assistant-test-id', author: { role: 'assistant' } };
    const source = 'sandbox:/mnt/data/work107/chatgpt-conversation-markdown-export.user.js';
    const url = cgGeneratedSandboxDownloadUrl(source, record);
    assert(url && url.includes(`/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download?`),
      'sandbox file link did not use the observed interpreter/download route.');
    assert(url.includes('message_id=assistant-test-id'), 'sandbox file link omitted Assistant message_id.');
    assert(url.includes('sandbox_path=%2Fmnt%2Fdata%2Fwork107%2Fchatgpt-conversation-markdown-export.user.js'),
      'sandbox file link did not preserve/encode sandbox_path.');
    assert(url.endsWith('&download_intent=true'), 'sandbox file link did not force download_intent=true.');
    const markdown = cgRewriteGeneratedSandboxLinks(`[Download userscript](${source})`, record);
    assert(markdown === `[Download userscript](${url})`, 'sandbox Markdown link rewrite changed label or URL unexpectedly.');
    const userRecord = { id: 'user-test-id', author: { role: 'user' } };
    assert(cgRewriteGeneratedSandboxLinks(`[x](${source})`, userRecord) === `[x](${source})`,
      'sandbox link rewrite should not apply to User records.');
    assert(cgRewriteGeneratedSandboxLinks('[x](sediment://file_123)', record) === '[x](sediment://file_123)',
      'sandbox link rewrite must not rewrite sediment pointers.');
  }

'''
text = text.replace(test_marker, test_code + test_marker, 1)
text = text.replace(needle, needle + "      await run('Generated sandbox download link', testGeneratedSandboxDownloadLink);\n", 1)

path.write_text(text)
