    }
  }

  /**
   * Handles fallback image pointer fallback.
   *
   * @param {Object} part - The provider content part to process.
   * @returns {string} The string produced by `cgImagePointerFallback`.
   */
  function cgImagePointerFallback(part) {
    const source = cgImagePointerSource(part);
    return source ? cgImageUnavailableMarkdown(source) : '[image missing]';
  }

  /**
   * Handles fallback content text parts.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {Array<unknown>} The ordered values produced by `cgContentTextParts`.
   */
  function cgContentTextParts(record, fileRefIndex = new Map(), recoveredImages = []) {
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
          cleaned.push(recoveredImages[imageOrdinal] || cgImagePointerFallback(part));
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
        const rendered = cgRewriteGeneratedSandboxLinks(
          cgStripInlineTokens(cgRenderInlineReferences(value, record, fileRefIndex)), record
        ).trim();
        if (rendered) cleaned.push(rendered);
      }
    }
    return cleaned;
  }

  /**
   * Handles fallback visible user text.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {string} The string produced by `cgVisibleUserText`.
   */
  function cgVisibleUserText(record, fileRefIndex = new Map(), recoveredImages = []) {
    if (cgIsHidden(record) || record?.author?.role !== 'user' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex, recoveredImages).join('\n\n').trim();
  }

  /**
   * Handles fallback visible assistant text.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {string} The string produced by `cgVisibleAssistantText`.
   */
  function cgVisibleAssistantText(record, fileRefIndex = new Map(), recoveredImages = []) {
    if (cgIsHidden(record) || record?.author?.role !== 'assistant' ||
        !['text', 'multimodal_text'].includes(record?.content?.content_type)) return '';
    return cgContentTextParts(record, fileRefIndex, recoveredImages).join('\n\n').trim();
  }

  /**
   * Handles fallback visible assistant markdown.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @param {Array<unknown>} recoveredImages - The recovered image state used while rendering.
   * @returns {string} The string produced by `cgVisibleAssistantMarkdown`.
   */
  function cgVisibleAssistantMarkdown(record, fileRefIndex = new Map(), recoveredImages = []) {
    return cgVisibleAssistantText(record, fileRefIndex, recoveredImages);
  }

  /**
   * Handles fallback record search texts.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {Array<unknown>} The ordered values produced by `cgRecordSearchTexts`.
   */
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

  /**
   * Wraps opaque source/tool payload text in a collision-safe Markdown code fence.
   *
   * Source -> output transformation: scans the literal payload for its longest run of backtick characters, then emits an outer fence one character longer (minimum three). The payload itself is not rewritten.
   *
   * @param {string} text - The text to process.
   * @param {string} language - The code-fence language identifier.
   * @returns {string} The string produced by `cgCodeFence`.
   */
  function cgCodeFence(text, language = '') {
    const body = String(text ?? '').replace(/\s+$/, '');
    const runs = body.match(/`+/g) ?? [];
    /**
     * Handles longest.
     */
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}${language || ''}\n${body}\n${fence}`;
  }

  /**
   * Wraps a summary and opaque body in the HTML `details` structure used by fallback Markdown output.
   *
   * @param {Object} summary - The summary label to render.
   * @param {Object} body - The body content to render.
   * @returns {string} The string produced by `cgRenderDetail`.
   */
  function cgRenderDetail(summary, body) {
    return body ? `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>` : '';
  }

  /**
   * Infers a Markdown fence language only for the legacy/fallback renderer when no stronger canonical language is available.
   *
   * Source -> output transformation: explicit source language wins; otherwise provider metadata/recipient and limited code-prefix evidence may map to a fence language such as `python` or `bash`. This fallback does not alter payload text.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Object} code - The source code to classify.
   * @param {string} explicitLanguage - The provider-supplied language label, when available.
   * @returns {string} The string produced by `cgInferCodeLanguage`.
   */
  function cgInferCodeLanguage(record, code, explicitLanguage = '') {
    if (typeof explicitLanguage === 'string' && explicitLanguage.trim()) return explicitLanguage.trim();
    const language = record?.metadata?.language;
    if (typeof language === 'string' && language.trim()) return language.trim();
    const recipient = String(record?.recipient ?? '').toLowerCase();
    if (recipient.includes('python')) return 'python';
    if (recipient.includes('shell') || recipient.includes('bash') || recipient.includes('terminal')) return 'bash';
    const trimmed = String(code ?? '').trimStart();
    if (/^(?:import |from \w+ import |def |class )/.test(trimmed)) return 'python';
    return '';
  }

  /**
   * Handles fallback render thought item.
   *
   * @param {Object} record - The provider/source record to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderThoughtItem`.
   */
  function cgRenderThoughtItem(record, fileRefIndex = new Map()) {
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
          /**
           * Handles chunk text.
           */
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

  /**
   * Handles fallback render thought block.
   *
   * @param {Array<Object>} items - The ordered items values to process.
   * @param {Map<unknown, unknown>} fileRefIndex - The zero-based file ref index.
   * @returns {string} The string produced by `cgRenderThoughtBlock`.
