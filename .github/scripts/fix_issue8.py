from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

old_version = '// @version      0.6.132'
new_version = '// @version      0.6.133'
if text.count(old_version) != 1:
  raise SystemExit('Expected exactly one v0.6.132 metadata line')
text = text.replace(old_version, new_version, 1)

old_function = r'''  function cgRewriteGeneratedSandboxLinks(text, record) {
    if (!text || record?.author?.role !== 'assistant') return text;
    return String(text).replace(/(\[[^\]]*\]\()(sandbox:(?:\/\/)?\/mnt\/data\/[^)]+)(\))/gi,
      (whole, prefix, source, suffix) => {
        const url = cgGeneratedSandboxDownloadUrl(source, record);
        return url ? `${prefix}${url}${suffix}` : whole;
      });
  }
'''
new_function = r'''  function cgRewriteGeneratedSandboxLinks(text, record) {
    if (!text || record?.author?.role !== 'assistant') return text;
    const value = String(text);
    let rendered = '';
    let cursor = 0;
    while (cursor < value.length) {
      const destinationPrefix = value.indexOf('](', cursor);
      if (destinationPrefix < 0) break;
      const sourceStart = destinationPrefix + 2;
      const remainder = value.slice(sourceStart);
      const sandboxPrefix = remainder.match(/^sandbox:(?:\/\/)?\/mnt\/data\//i)?.[0];
      if (!sandboxPrefix) {
        rendered += value.slice(cursor, sourceStart);
        cursor = sourceStart;
        continue;
      }

      let nestedParentheses = 0;
      let sourceEnd = -1;
      for (let index = sourceStart; index < value.length; index += 1) {
        const character = value[index];
        if (character === '\\') {
          index += 1;
          continue;
        }
        if (character === '(') {
          nestedParentheses += 1;
          continue;
        }
        if (character !== ')') continue;
        if (nestedParentheses > 0) {
          nestedParentheses -= 1;
          continue;
        }
        sourceEnd = index;
        break;
      }
      if (sourceEnd < 0) break;

      const source = value.slice(sourceStart, sourceEnd);
      const url = cgGeneratedSandboxDownloadUrl(source, record);
      if (!url) {
        rendered += value.slice(cursor, sourceEnd + 1);
        cursor = sourceEnd + 1;
        continue;
      }
      rendered += `${value.slice(cursor, sourceStart)}${url})`;
      cursor = sourceEnd + 1;
    }
    return rendered + value.slice(cursor);
  }
'''
if text.count(old_function) != 1:
  raise SystemExit('Expected exactly one old cgRewriteGeneratedSandboxLinks implementation')
text = text.replace(old_function, new_function, 1)

old_test = r'''    const markdown = cgRewriteGeneratedSandboxLinks(`[Download userscript](${source})`, record);
    assert(markdown === `[Download userscript](${url})`, 'sandbox Markdown link rewrite changed label or URL unexpectedly.');
    const userRecord = { id: 'user-test-id', author: { role: 'user' } };
'''
new_test = r'''    const markdown = cgRewriteGeneratedSandboxLinks(`[Download userscript](${source})`, record);
    assert(markdown === `[Download userscript](${url})`, 'sandbox Markdown link rewrite changed label or URL unexpectedly.');
    const parenthesizedSource = 'sandbox:/mnt/data/work/fixture(phase2).txt';
    const parenthesizedUrl = cgGeneratedSandboxDownloadUrl(parenthesizedSource, record);
    const parenthesizedMarkdown = cgRewriteGeneratedSandboxLinks(
      `[Download fixture](${parenthesizedSource})`, record
    );
    assert(parenthesizedMarkdown === `[Download fixture](${parenthesizedUrl})`,
      'sandbox Markdown link rewrite truncated a filename containing parentheses.');
    const nestedSource = 'sandbox:/mnt/data/work/fixture((phase2)).txt';
    const nestedUrl = cgGeneratedSandboxDownloadUrl(nestedSource, record);
    assert(cgRewriteGeneratedSandboxLinks(`[Nested](${nestedSource})`, record) === `[Nested](${nestedUrl})`,
      'sandbox Markdown link rewrite did not preserve nested parentheses.');
    const twoLinks = cgRewriteGeneratedSandboxLinks(
      `[One](${parenthesizedSource}) and [Two](${source})`, record
    );
    assert(twoLinks === `[One](${parenthesizedUrl}) and [Two](${url})`,
      'sandbox Markdown link rewrite did not preserve multiple links.');
    const userRecord = { id: 'user-test-id', author: { role: 'user' } };
'''
if text.count(old_test) != 1:
  raise SystemExit('Expected exactly one sandbox test insertion point')
text = text.replace(old_test, new_test, 1)

path.write_text(text, encoding='utf-8')
