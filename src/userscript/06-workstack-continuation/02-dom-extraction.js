  // BEGIN Issue #163 shared DOM Markdown extraction
  /**
   * Converts all child nodes of one rendered ChatGPT node to Markdown.
   *
   * @param {Object} node - DOM-like node whose childNodes are rendered in source order.
   * @returns {string} Markdown for the node's children with bounded blank-line normalization.
   */
  function extractTurnChildrenMarkdown(node) {
    const markdown = [...(node?.childNodes ?? [])]
      .map(child => extractTurnNodeMarkdown(child))
      .join('');
    return markdown.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }

  /**
   * Converts one rendered DOM node to Markdown using the restored shared #64 extraction seam.
   *
   * @param {Object} node - DOM-like text or element node.
   * @returns {string} Markdown representation of this node and its descendants.
   */
  function extractTurnNodeMarkdown(node) {
    if (!node) return '';
    if (node.nodeType === 3) return String(node.nodeValue ?? '');
    if (node.nodeType !== 1) return '';
    const tag = String(node.tagName ?? '').toUpperCase();
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(tag)) return '';
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') {
      const source = node.getAttribute?.('src') || node.getAttribute?.('data-src') || '';
      if (!source) return '';
      const alt = node.getAttribute?.('alt') || 'image';
      return `![${alt}](${source})`;
    }
    if (tag === 'PRE') {
      const codeNode = [...(node.childNodes ?? [])]
        .find(child => String(child?.tagName ?? '').toUpperCase() === 'CODE') ?? null;
      const className = codeNode?.getAttribute?.('class') || '';
      const language = className.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? '';
      const code = String(codeNode?.textContent ?? node.textContent ?? '').replace(/\n$/, '');
      const longestTicks = Math.max(0, ...[...code.matchAll(/`+/g)].map(match => match[0].length));
      const fence = '`'.repeat(Math.max(3, longestTicks + 1));
      return `${fence}${language}\n${code}\n${fence}\n\n`;
    }
    if (tag === 'BUTTON') {
      const aria = String(node.getAttribute?.('aria-label') ?? '');
      if (/copy|good response|bad response|read aloud|regenerate|edit message/i.test(aria)) return '';
      return extractTurnChildrenMarkdown(node);
    }
    const inner = extractTurnChildrenMarkdown(node);
    if (tag === 'STRONG' || tag === 'B') return inner.trim() ? `**${inner.trim()}**` : '';
    if (tag === 'EM' || tag === 'I') return inner.trim() ? `*${inner.trim()}*` : '';
    if (tag === 'DEL' || tag === 'S') return inner.trim() ? `~~${inner.trim()}~~` : '';
    if (tag === 'CODE') {
      const value = inner || String(node.textContent ?? '');
      const longestTicks = Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length));
      const delimiter = '`'.repeat(Math.max(1, longestTicks + 1));
      return `${delimiter}${value}${delimiter}`;
    }
    if (tag === 'A') {
      const href = node.getAttribute?.('href') || '';
      const label = inner.trim() || href;
      return href ? `[${label}](${href})` : label;
    }
    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      return `${'#'.repeat(level)} ${inner.trim()}\n\n`;
    }
    if (tag === 'P') return inner.trim() ? `${inner.trim()}\n\n` : '\n';
    if (tag === 'BLOCKQUOTE') {
      const quoted = inner.trim().split('\n').map(line => line ? `> ${line}` : '>').join('\n');
      return quoted ? `${quoted}\n\n` : '';
    }
    if (tag === 'UL' || tag === 'OL') {
      let ordinal = tag === 'OL' ? Math.max(1, Number(node.getAttribute?.('start')) || 1) : 1;
      const lines = [];
      for (const child of [...(node.childNodes ?? [])]) {
        if (String(child?.tagName ?? '').toUpperCase() !== 'LI') continue;
        const body = extractTurnChildrenMarkdown(child).trim().replace(/\n+/g, ' ');
        if (!body) continue;
        lines.push(tag === 'OL' ? `${ordinal++}. ${body}` : `- ${body}`);
      }
      return lines.length ? `${lines.join('\n')}\n\n` : '';
    }
    if (tag === 'LI') return inner;
    if (['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'FIGURE', 'FIGCAPTION', 'SPAN', 'SUP', 'SUB'].includes(tag)) {
      return inner;
    }
    return inner;
  }

  /**
   * Extracts one mounted User/Assistant turn through the shared restored DOM-to-Markdown seam.
   *
   * @param {Object} section - Mounted or frozen `section[data-turn-id]` turn container.
   * @returns {string} Normal transcript Markdown block for the rendered turn.
   */
  function extractTurn(section) {
    if (!section) throw new Error('Cannot extract a missing DOM turn.');
    const roleFromSection = section.getAttribute?.('data-turn') || '';
    const messageNode = section.querySelector?.('[data-message-author-role][data-message-id]') ??
      section.querySelector?.('[data-message-id]') ?? null;
    const role = String(
      roleFromSection || messageNode?.getAttribute?.('data-message-author-role') || ''
    ).toLowerCase();
    if (role !== 'user' && role !== 'assistant') {
      throw new Error('Rendered turn has no User/Assistant role identity.');
    }
    const source = messageNode ?? section;
    const markdown = extractTurnChildrenMarkdown(source).trim();
    if (!markdown) throw new Error(`Rendered ${role} turn contains no usable Markdown content.`);
    const heading = role === 'user' ? 'User' : 'Assistant';
    return `## ${heading}\n\n${markdown}`.trimEnd();
  }
  // END Issue #163 shared DOM Markdown extraction
