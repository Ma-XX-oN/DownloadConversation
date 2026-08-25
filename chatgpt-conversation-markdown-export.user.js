// ==UserScript==
// @name         ChatGPT Conversation Markdown Recorder
// @namespace    https://chatgpt.com/
// @version      0.6.113
// @description  Exports the current ChatGPT conversation directly from the Conversation API as Markdown or JSONL.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || 'unknown';
  const PANEL_ID = 'tm-conversation-recorder';
  const DIAGNOSTIC_LEVELS = Object.freeze({ errors: 0, warnings: 1, debug: 2, verbose: 3 });
  const DEFAULT_DIAGNOSTICS = 'warnings';
  const PAGE_TURNS = 10;
  const MAX_PAGES = 10000;
  const SCREEN_ON_STORAGE_KEY = 'tm-conversation-recorder-screen-on-when-capturing';
  const encoder = new TextEncoder();

  let originalPageFetch = null;
  let apiRequestContext = null;
  let captureInstalled = false;
  let diagnosticsLevel = localStorage.getItem('tm-conversation-recorder-diagnostics') || DEFAULT_DIAGNOSTICS;
  let screenOnWhenCapturing = localStorage.getItem(SCREEN_ON_STORAGE_KEY) !== 'false';
  let wakeLockSentinel = null;
  let exportInProgress = false;
  let exportKind = null;
  let statusText = 'Ready.';
  let statusTimer = null;
  let progressState = null;

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function escapeHtmlText(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtmlAttribute(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function quoteMarkdown(markdown) {
    const text = String(markdown ?? '').replace(/\s+$/, '');
    if (!text) return '>';
    return text.split('\n').map(line => line.length ? `> ${line}` : '>').join('\n');
  }

  function conversationTitle() {
    const heading = document.querySelector('h1')?.textContent?.trim();
    const title = heading || document.title || 'ChatGPT conversation';
    return title.replace(/\s*[-–—]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT conversation';
  }

  function sanitizeFileName(name) {
    return String(name || 'ChatGPT conversation')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim() || 'ChatGPT conversation';
  }

  function currentConversationId() {
    return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
  }

  function isConversationApiUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return false;
      return /^\/backend-api\/conversations\/[^/]+(?:\/messages)?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function rawHeadersToObject(headers) {
    const result = {};
    const put = (name, value) => {
      if (name == null || value == null) return;
      const key = String(name).toLowerCase();
      result[key] = result[key] ? `${result[key]}, ${value}` : String(value);
    };
    try {
      if (typeof headers?.forEach === 'function') {
        headers.forEach((value, key) => put(key, value));
      } else if (Array.isArray(headers)) {
        for (const entry of headers) if (Array.isArray(entry) && entry.length >= 2) put(entry[0], entry[1]);
      } else if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) put(key, value);
      }
    } catch {}
    return result;
  }

  function rememberApiRequestContext(url, ...headerCandidates) {
    if (!isConversationApiUrl(url)) return;
    try {
      const parsed = new URL(url, location.href);
      const match = parsed.pathname.match(/^\/backend-api\/conversations\/([^/]+)/);
      if (!match) return;
      const headers = {};
      for (const candidate of headerCandidates) {
        for (const [key, value] of Object.entries(rawHeadersToObject(candidate))) {
          if (!(key in headers)) headers[key] = value;
        }
      }
      if (!headers.authorization) return;
      apiRequestContext = {
        conversation_id: match[1],
        headers,
        captured_at: new Date().toISOString()
      };
    } catch {}
  }

  function installNetworkCapture() {
    if (captureInstalled) return;
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    if (typeof pageWindow.fetch === 'function') {
      const originalFetch = pageWindow.fetch;
      originalPageFetch = originalFetch;
      pageWindow.fetch = function(...args) {
        const input = args[0];
        const init = args[1] || {};
        let request = null;
        try {
          const PageRequest = pageWindow.Request || Request;
          request = input instanceof PageRequest ? input : new PageRequest(input, init);
        } catch {}
        rememberApiRequestContext(request?.url ?? String(input), request?.headers, init.headers);
        return originalFetch.apply(this, args);
      };
    }

    const XHR = pageWindow.XMLHttpRequest;
    if (XHR?.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      const originalSetRequestHeader = XHR.prototype.setRequestHeader;
      XHR.prototype.open = function(method, url, ...rest) {
        this.__tmApiRequest = { method: String(method), url: String(url), headers: {} };
        return originalOpen.call(this, method, url, ...rest);
      };
      XHR.prototype.setRequestHeader = function(name, value) {
        if (this.__tmApiRequest) {
          const key = String(name).toLowerCase();
          const prior = this.__tmApiRequest.headers[key];
          this.__tmApiRequest.headers[key] = prior ? `${prior}, ${value}` : String(value);
        }
        return originalSetRequestHeader.call(this, name, value);
      };
      XHR.prototype.send = function(body) {
        const info = this.__tmApiRequest || { url: '', headers: {} };
        rememberApiRequestContext(info.url, info.headers);
        return originalSend.call(this, body);
      };
    }

    captureInstalled = true;
  }

  async function apiFetch(url) {
    const conversationId = currentConversationId();
    const context = apiRequestContext;
    if (!context?.headers?.authorization || context.conversation_id !== conversationId) {
      throw new Error('No authenticated Conversation API context is available. Reload this conversation, then try again.');
    }
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const fetchFn = originalPageFetch || pageWindow.fetch;
    return fetchFn.call(pageWindow, url, {
      method: 'GET',
      headers: { ...context.headers },
      credentials: 'include'
    });
  }

  function conversationSchemaOk(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.messages) &&
      !!data.page_info && typeof data.page_info === 'object';
  }

  function pageUrl(conversationId, cursor = null) {
    if (cursor === null) {
      return `${location.origin}/backend-api/conversations/${encodeURIComponent(conversationId)}?include_has_versions=true&num_turns=${PAGE_TURNS}`;
    }
    return `${location.origin}/backend-api/conversations/${encodeURIComponent(conversationId)}/messages?before=${encodeURIComponent(cursor)}&include_has_versions=true&num_turns=${PAGE_TURNS}`;
  }

  async function fetchOneConversationPage(url, description) {
    const response = await apiFetch(url);
    if (!response.ok) throw new Error(`${description} returned HTTP ${response.status}.`);
    const data = await response.json();
    if (!conversationSchemaOk(data)) throw new Error(`${description} did not contain messages[] and page_info.`);
    return data;
  }

  async function discoverPageCount(conversationId, onProgress) {
    let data = await fetchOneConversationPage(pageUrl(conversationId), 'Initial Conversation API request');
    if (data.page_info.has_next_page === true) {
      throw new Error('Initial Conversation API page reports has_next_page=true; newest boundary is not established.');
    }
    let count = 1;
    const seen = new Set();
    onProgress?.({ stage: 'counting', page_count: count });
    while (data.page_info.has_previous_page === true) {
      const cursor = data.page_info.start_cursor;
      if (!cursor) throw new Error('Conversation API reports a previous page but supplied no start_cursor.');
      if (seen.has(cursor)) throw new Error(`Conversation pagination repeated start_cursor ${cursor}.`);
      seen.add(cursor);
      if (count >= MAX_PAGES) throw new Error(`Conversation pagination exceeded the ${MAX_PAGES}-page safety limit.`);
      data = await fetchOneConversationPage(pageUrl(conversationId, cursor), 'Conversation pagination request');
      count += 1;
      onProgress?.({ stage: 'counting', page_count: count });
    }
    return count;
  }

  async function fetchConversationPages(conversationId, totalPages, onProgress) {
    const pages = [];
    const seen = new Set();
    let rawRecordCount = 0;
    let data = await fetchOneConversationPage(pageUrl(conversationId), 'Initial Conversation API request');
    if (data.page_info.has_next_page === true) {
      throw new Error('Initial Conversation API page reports has_next_page=true; newest boundary is not established.');
    }
    for (;;) {
      pages.push(data);
      rawRecordCount += data.messages.length;
      onProgress?.({
        stage: 'fetching',
        page_count: pages.length,
        page_total: totalPages,
        raw_record_count: rawRecordCount
      });
      if (data.page_info.has_previous_page !== true) break;
      const cursor = data.page_info.start_cursor;
      if (!cursor) throw new Error('Conversation API reports a previous page but supplied no start_cursor.');
      if (seen.has(cursor)) throw new Error(`Conversation pagination repeated start_cursor ${cursor}.`);
      seen.add(cursor);
      if (pages.length >= MAX_PAGES) throw new Error(`Conversation pagination exceeded the ${MAX_PAGES}-page safety limit.`);
      data = await fetchOneConversationPage(pageUrl(conversationId, cursor), 'Conversation pagination request');
    }
    assert(pages.length === totalPages,
      `Conversation API page count changed during export: expected ${totalPages}, fetched ${pages.length}.`);
    return { pages, raw_record_count: rawRecordCount };
  }

  function conversationSpineFromPages(pages) {
    const messageIndexById = new Map();
    const messages = [];
    for (const page of [...pages].reverse()) {
      for (const message of page?.messages ?? []) {
        const id = typeof message?.id === 'string' ? message.id : '';
        if (!id) throw new Error('Conversation API message is missing a stable id.');
        const existingIndex = messageIndexById.get(id);
        if (existingIndex !== undefined) {
          messages[existingIndex] = message;
          continue;
        }
        messageIndexById.set(id, messages.length);
        messages.push(message);
      }
    }
    return { pages: [...pages], messages, records: messages.map((message, ordinal) => ({ ordinal, message })) };
  }

  function cgIsHidden(record) {
    return Boolean(record?.metadata?.is_visually_hidden_from_conversation);
  }

  function cgTextParts(parts) {
    const texts = [];
    if (!Array.isArray(parts)) return texts;
    for (const part of parts) {
      if (typeof part === 'string') {
        if (part.trim()) texts.push(part);
      } else if (part && typeof part === 'object') {
        for (const key of ['text', 'content']) {
          const value = part[key];
          if (typeof value === 'string' && value.trim()) texts.push(value);
        }
      }
    }
    return texts;
  }

  function cgCitationRoot(url) {
    try {
      const parsed = new URL(url);
      return parsed.host ? `${parsed.protocol}//${parsed.host}` : '';
    } catch {
      return '';
    }
  }

  function cgCitationHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function cgNormalizeCitationUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    const raw = url.trim();
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      parsed.protocol = parsed.protocol.toLowerCase();
      parsed.hostname = parsed.hostname.toLowerCase();
      parsed.searchParams.delete('utm_source');
      return parsed.toString();
    } catch {
      return raw;
    }
  }

  function cgSearchResultUrlIndex(record) {
    const metadata = record?.metadata;
    const groups = metadata && typeof metadata === 'object' ? metadata.search_result_groups : null;
    if (!Array.isArray(groups)) return new Map();
    const result = new Map();
    for (const group of groups) {
      if (!group || typeof group !== 'object' || !Array.isArray(group.entries)) continue;
      for (const entry of group.entries) {
        if (!entry || typeof entry !== 'object') continue;
        const key = cgNormalizeCitationUrl(entry.url);
        if (!key) continue;
        const merged = result.get(key) ?? { title: '', snippet: '', attribution: '' };
        for (const field of ['title', 'snippet', 'attribution']) {
          const value = entry[field];
          if (!merged[field] && typeof value === 'string' && value.trim()) merged[field] = value.trim();
        }
        result.set(key, merged);
      }
    }
    return result;
  }

  function cgShortenInlineText(text, maxChars = 200) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxChars) return clean;
    let clipped = clean.slice(0, maxChars - 1).trimEnd();
    if (clipped.includes(' ')) clipped = clipped.slice(0, clipped.lastIndexOf(' '));
    return `${clipped.replace(/[ ,;:-]+$/g, '')}…`;
  }

  function cgWrapTooltipBlock(text, width = 78, maxChars = 520) {
    const shortened = cgShortenInlineText(text, maxChars);
    if (!shortened) return '';
    const words = shortened.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  function cgCleanCitationBlurb(text) {
    if (typeof text !== 'string' || !text.trim()) return [];
    let clean = text.replace(/\s+/g, ' ').trim()
      .replace(/\s*Read more\.?$/i, '')
      .replace(/^Abstract\b[:.]?\s*/i, '')
      .replace(/\.\s*\./g, '.')
      .replace(/\s+\./g, '.');
    let meta = '';
    let body = clean;
    const dash = clean.indexOf('—');
    if (dash >= 0) {
      const head = clean.slice(0, dash).trim().replace(/^[- ]+|[- ]+$/g, '');
      const tail = clean.slice(dash + 1).trim();
      if (tail && (head.toLowerCase().startsWith('by ') || head.toLowerCase().includes('cited by') || /^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}$/.test(head))) {
        meta = head;
        body = tail;
      }
    }
    body = body.replace(/\s*[•·]\s*/g, ' • ');
    const blocks = [];
    if (meta) blocks.push(cgWrapTooltipBlock(meta, 78, 180));
    const wrappedBody = cgWrapTooltipBlock(body, 78, 520);
    if (wrappedBody) blocks.push(wrappedBody);
    return blocks;
  }

  function cgCitationTooltip(node, urlInfo = {}, fallback = '') {
    let title = typeof node?.title === 'string' ? node.title.trim() : '';
    if (!title) title = typeof urlInfo?.title === 'string' ? urlInfo.title.trim() : '';
    let snippet = typeof node?.snippet === 'string' ? node.snippet.trim() : '';
    if (!snippet) snippet = typeof urlInfo?.snippet === 'string' ? urlInfo.snippet.trim() : '';
    const parts = [];
    if (title) {
      const wrapped = cgWrapTooltipBlock(title, 78, 220);
      if (wrapped) parts.push(wrapped);
    }
    if (snippet) {
      for (const block of cgCleanCitationBlurb(snippet)) if (block && !parts.includes(block)) parts.push(block);
    }
    if (parts.length) return parts.join('\n\n');
    return cgWrapTooltipBlock(fallback, 78, 220);
  }

  function cgCitationFavicon(url) {
    const root = cgCitationRoot(url);
    return root ? `https://www.google.com/s2/favicons?domain=${root}&sz=32` : '';
  }

  function cgCollectWebCitationSources(reference, urlIndex = new Map()) {
    const sources = [];
    const seen = new Set();
    const append = (url, label, tooltip) => {
      if (typeof url !== 'string' || !url.trim() || seen.has(url.trim())) return;
      const clean = url.trim();
      seen.add(clean);
      const shown = typeof label === 'string' && label.trim() ? label.trim() : (cgCitationHostname(clean) || 'source');
      sources.push({ url: clean, label: shown, tooltip: typeof tooltip === 'string' ? tooltip.trim() : '' });
    };
    const visit = (node, inheritedTooltip = '') => {
      if (!node || typeof node !== 'object') return;
      const url = node.url;
      if (typeof url === 'string' && url.trim()) {
        const urlInfo = urlIndex.get(cgNormalizeCitationUrl(url)) ?? {};
        let label = typeof node.attribution === 'string' ? node.attribution.trim() : '';
        if (!label && typeof urlInfo.attribution === 'string') label = urlInfo.attribution.trim();
        if (!label) label = cgCitationHostname(url);
        const tooltip = cgCitationTooltip(node, urlInfo, inheritedTooltip || label);
        append(url, label, tooltip);
        inheritedTooltip = tooltip;
      }
      for (const key of ['items', 'supporting_websites', 'webpages', 'sources']) {
        if (Array.isArray(node[key])) for (const item of node[key]) visit(item, inheritedTooltip);
      }
    };
    visit(reference);
    if (!sources.length && Array.isArray(reference?.safe_urls)) {
      for (const url of reference.safe_urls) append(url, cgCitationHostname(url), '');
    }
    return sources;
  }

  function cgRenderWebCitation(reference, urlIndex = new Map()) {
    const links = [];
    for (const source of cgCollectWebCitationSources(reference, urlIndex)) {
      const titleAttribute = source.tooltip ? ` title="${escapeHtmlAttribute(source.tooltip).replace(/\n/g, '&#10;')}"` : '';
      const favicon = cgCitationFavicon(source.url);
      const icon = favicon
        ? `<img alt="" src="${escapeHtmlAttribute(favicon)}" width="15" height="15"${titleAttribute} style="width:0.97em;height:0.97em;vertical-align:-0.13em;margin-right:0.22em;border-radius:2px;">`
        : '';
      links.push(`<a href="${escapeHtmlAttribute(source.url)}"${titleAttribute} style="display:inline-block;white-space:nowrap;">${icon}${escapeHtmlText(source.label)}</a>`);
    }
    return links.length ? `**(cite: ${links.join(', ')})**` : '';
  }

  function cgRenderInlineReference(reference, urlIndex = new Map()) {
    if (reference?.type === 'grouped_webpages') return cgRenderWebCitation(reference, urlIndex);
    if (reference?.type === 'alt_text') {
      for (const key of ['alt', 'prompt_text']) {
        const value = reference[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    }
    if (reference?.type === 'file') {
      const name = typeof reference.name === 'string' ? reference.name.trim().replace(/`/g, '') : '';
      return `\`${name || 'file'}\``;
    }
    return '';
  }

  function cgRenderInlineReferences(text, record) {
    if (!text) return text;
    const references = Array.isArray(record?.metadata?.content_references) ? record.metadata.content_references : [];
    if (!references.length) return text;
    const urlIndex = cgSearchResultUrlIndex(record);
    let rendered = text;
    for (const reference of references) {
      const matched = reference?.matched_text;
      if (typeof matched !== 'string' || !matched || !rendered.includes(matched)) continue;
      const replacement = cgRenderInlineReference(reference, urlIndex);
      if (replacement) rendered = rendered.split(matched).join(replacement);
    }
    return rendered;
  }

  function cgVisibleUserText(record) {
    if (cgIsHidden(record) || record?.author?.role !== 'user' || record?.content?.content_type !== 'text') return '';
    return cgTextParts(record.content.parts).join('\n\n').trim();
  }

  function cgVisibleAssistantText(record) {
    if (cgIsHidden(record) || record?.author?.role !== 'assistant' || record?.content?.content_type !== 'text') return '';
    return cgTextParts(record.content.parts).join('\n\n').trim();
  }

  function cgVisibleAssistantMarkdown(record) {
    return cgRenderInlineReferences(cgVisibleAssistantText(record), record);
  }

  function cgRecordSearchTexts(record) {
    if (cgIsHidden(record) || record?.author?.role === 'system') return [];
    const content = record?.content ?? {};
    const type = content.content_type ?? '';
    const texts = [];
    if (type === 'text') texts.push(...cgTextParts(content.parts));
    else if (type === 'thoughts' && Array.isArray(content.thoughts)) {
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
    }
    return texts;
  }

  function cgCodeFence(text, language = '') {
    const body = String(text ?? '').replace(/\s+$/, '');
    const fence = body.includes('```') ? '````' : '```';
    return `${fence}${language || ''}\n${body}\n${fence}`;
  }

  function cgRenderDetail(summary, body) {
    return body ? `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>` : '';
  }

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

  function cgRenderThoughtItem(record) {
    if (cgIsHidden(record)) return '';
    const role = record?.author?.role ?? '';
    const content = record?.content ?? {};
    const type = content.content_type ?? '';
    if (role === 'assistant' && type === 'thoughts') {
      const blocks = [];
      const thoughts = Array.isArray(content.thoughts) ? content.thoughts : [];
      for (const thought of thoughts) {
        if (!thought || typeof thought !== 'object') continue;
        const summary = typeof thought.summary === 'string' ? thought.summary.trim() : '';
        const body = typeof thought.content === 'string' ? thought.content.trim() : '';
        const chunks = thought.chunks;
        if (body) blocks.push(summary ? `**${summary}**\n\n${body}` : body);
        else if (summary) blocks.push(summary);
        else if (Array.isArray(chunks)) {
          const chunkText = chunks.filter(chunk => typeof chunk === 'string' && chunk.trim()).join('\n\n');
          if (chunkText) blocks.push(chunkText);
        }
      }
      return blocks.join('\n\n');
    }
    if (role === 'assistant' && type === 'reasoning_recap') {
      return typeof content.content === 'string' ? content.content.trim() : '';
    }
    if (role === 'assistant' && type === 'code') {
      const code = typeof content.text === 'string' ? content.text : '';
      if (!code.trim()) return '';
      const language = cgInferCodeLanguage(record, code, content.language ?? '');
      return cgRenderDetail(`${record?.recipient || 'tool'} code`, cgCodeFence(code, language));
    }
    if (role === 'assistant' && type === 'model_editable_context') {
      const texts = cgRecordSearchTexts(record);
      return texts.length ? cgRenderDetail('editable context', quoteMarkdown(texts.join('\n\n'))) : '';
    }
    if (role === 'tool') {
      const texts = cgRecordSearchTexts(record);
      if (!texts.length) return '';
      return cgRenderDetail(`${record?.author?.name || record?.recipient || 'tool'} output`, cgCodeFence(texts.join('\n\n')));
    }
    return '';
  }

  function cgRenderThoughtBlock(items) {
    const rendered = [];
    for (const record of items) {
      const body = cgRenderThoughtItem(record);
      if (body) rendered.push(body);
    }
    return rendered.length
      ? `<details>\n<summary>Thoughts</summary>\n\n${rendered.join('\n\n')}\n\n</details>`
      : '';
  }

  function transcriptHeading(record) {
    const id = typeof record?.id === 'string' ? record.id : '';
    if (record?.author?.role === 'user') return `## User${id ? ` <!-- turn_id=${id} -->` : ''}`;
    if (record?.author?.role === 'assistant' && record?.channel === 'commentary') {
      return `## ChatGPT Commentary${id ? ` <!-- turn_id=${id} -->` : ''}`;
    }
    if (record?.author?.role === 'assistant') return `## ChatGPT${id ? ` <!-- turn_id=${id} -->` : ''}`;
    return '';
  }

  function renderConversationMarkdown(spine, onProgress) {
    const records = spine.records.map(item => item.message);
    const output = [];
    let pendingThoughts = [];

    const flushAssistantBlock = (text = '', record = null) => {
      if (!text && !pendingThoughts.length) return;
      const headingRecord = record ?? pendingThoughts[0];
      const parts = [transcriptHeading(headingRecord)];
      const thoughts = cgRenderThoughtBlock(pendingThoughts);
      if (thoughts) parts.push(thoughts);
      if (text) parts.push(quoteMarkdown(text));
      output.push(parts.join('\n\n'));
      pendingThoughts = [];
    };

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      onProgress?.({ stage: 'rendering', record_number: index + 1, record_count: records.length });
      const userText = cgVisibleUserText(record);
      if (userText) {
        flushAssistantBlock();
        output.push(`${transcriptHeading(record)}\n\n${quoteMarkdown(userText)}`);
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
    return `${output.join('\n\n')}\n`;
  }

  function apiRecordsJsonl(spine) {
    return `${spine.records.map(record => JSON.stringify(record.message)).join('\n')}\n`;
  }

  function progressStatus(prefix, stageOverride = null) {
    if (!progressState) return statusText;
    const now = performance.now();
    const elapsed = now - progressState.started_at;
    const stage = stageOverride ?? progressState.stage;
    let eta = 'calculating…';
    if (stage === 'fetching' && progressState.page_count > 0 && progressState.page_total > progressState.page_count) {
      eta = formatDuration((elapsed / progressState.page_count) * (progressState.page_total - progressState.page_count));
    } else if (stage === 'fetching' && progressState.page_total === progressState.page_count) {
      eta = '0s';
    } else if (stage === 'rendering' && progressState.record_number > 0 && progressState.record_count > progressState.record_number) {
      const renderElapsed = Math.max(0, now - progressState.render_started_at);
      eta = formatDuration((renderElapsed / progressState.record_number) * (progressState.record_count - progressState.record_number));
    } else if (stage === 'rendering' && progressState.record_number === progressState.record_count) {
      eta = '0s';
    }

    if (stage === 'counting') {
      return `${prefix}: determining total API page count — ${progressState.page_count} page(s) found…\nElapsed: ${formatDuration(elapsed)}`;
    }
    if (stage === 'fetching') {
      return `${prefix}: fetched ${progressState.page_count}/${progressState.page_total} API page(s), ${progressState.raw_record_count} raw record(s)…\nElapsed: ${formatDuration(elapsed)} — ETA: ${eta}`;
    }
    if (stage === 'rendering') {
      return `${prefix}: rendering API record ${progressState.record_number}/${progressState.record_count}…\nElapsed: ${formatDuration(elapsed)} — ETA: ${eta}`;
    }
    return statusText;
  }

  function refreshStatus() {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (status) status.textContent = progressState ? progressStatus(exportKind === 'md' ? 'Extract MD' : 'Extract JSONL') : statusText;
  }

  function setStatus(text) {
    statusText = text;
    refreshStatus();
  }

  function startStatusTimer() {
    if (statusTimer !== null) clearInterval(statusTimer);
    statusTimer = setInterval(refreshStatus, 1000);
  }

  function stopStatusTimer() {
    if (statusTimer !== null) clearInterval(statusTimer);
    statusTimer = null;
  }

  async function acquireWakeLock() {
    if (!screenOnWhenCapturing || !exportInProgress || document.visibilityState !== 'visible' || !navigator.wakeLock?.request) return;
    if (wakeLockSentinel) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; }, { once: true });
    } catch {}
  }

  async function releaseWakeLock() {
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel) {
      try { await sentinel.release(); } catch {}
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function runExport(kind) {
    if (exportInProgress) return;
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    exportInProgress = true;
    exportKind = kind;
    progressState = {
      started_at: performance.now(),
      stage: 'counting',
      page_count: 0,
      page_total: 0,
      raw_record_count: 0,
      record_number: 0,
      record_count: 0,
      render_started_at: 0
    };
    startStatusTimer();
    updateUi();
    await acquireWakeLock();
    try {
      const totalPages = await discoverPageCount(conversationId, progress => {
        progressState.stage = 'counting';
        progressState.page_count = progress.page_count;
        refreshStatus();
      });
      progressState.stage = 'fetching';
      progressState.page_count = 0;
      progressState.page_total = totalPages;
      progressState.raw_record_count = 0;
      const fetched = await fetchConversationPages(conversationId, totalPages, progress => {
        progressState.stage = 'fetching';
        progressState.page_count = progress.page_count;
        progressState.page_total = progress.page_total;
        progressState.raw_record_count = progress.raw_record_count;
        refreshStatus();
      });
      const spine = conversationSpineFromPages(fetched.pages);
      if (kind === 'jsonl') {
        const filename = `${sanitizeFileName(conversationTitle())}.jsonl`;
        downloadBlob(new Blob([apiRecordsJsonl(spine)], { type: 'application/x-ndjson;charset=utf-8' }), filename);
        setStatus(`Extracted ${spine.records.length} API records to ${filename}.`);
      } else {
        progressState.stage = 'rendering';
        progressState.render_started_at = performance.now();
        progressState.record_count = spine.records.length;
        const markdown = renderConversationMarkdown(spine, progress => {
          progressState.stage = 'rendering';
          progressState.record_number = progress.record_number;
          progressState.record_count = progress.record_count;
          refreshStatus();
        });
        const filename = `${sanitizeFileName(conversationTitle())}.md`;
        downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), filename);
        setStatus(`Extracted ${spine.records.length} API records to ${filename}.`);
      }
    } catch (error) {
      setStatus(`${kind === 'md' ? 'Markdown' : 'JSONL'} extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      progressState = null;
      exportInProgress = false;
      exportKind = null;
      stopStatusTimer();
      await releaseWakeLock();
      updateUi();
      refreshStatus();
    }
  }

  function diagnosticEnabled(level) {
    return (DIAGNOSTIC_LEVELS[level] ?? 0) <= (DIAGNOSTIC_LEVELS[diagnosticsLevel] ?? 0);
  }

  function logDiagnostic(level, message, data = null) {
    if (!diagnosticEnabled(level)) return;
    const args = [`[ChatGPT Recorder ${level}] ${message}`];
    if (data !== null) args.push(data);
    (level === 'errors' ? console.error : level === 'warnings' ? console.warn : console.log)(...args);
  }

  function injectStyles() {
    if (document.getElementById(`${PANEL_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${PANEL_ID}-style`;
    style.textContent = `
      #${PANEL_ID}{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(405px,calc(100vw - 36px));box-sizing:border-box;padding:16px 18px;border:1px solid #555;border-radius:16px;background:#191919;color:#f2f2f2;box-shadow:0 10px 35px rgba(0,0,0,.5);font:16px/1.45 system-ui,sans-serif}
      #${PANEL_ID} .tm-title{font-size:16px;margin:0 28px 8px 0}
      #${PANEL_ID} .tm-close{position:absolute;right:9px;top:7px;border:0;background:transparent;color:#fff;font-size:24px;cursor:pointer}
      #${PANEL_ID} .tm-status{white-space:pre-wrap;margin:10px 0 12px;min-height:24px}
      #${PANEL_ID} .tm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
      #${PANEL_ID} select,#${PANEL_ID} button{border:1px solid #666;border-radius:9px;background:#292929;color:#fff;padding:9px 12px;font:inherit}
      #${PANEL_ID} select{flex:1;min-width:150px}
      #${PANEL_ID} button{cursor:pointer}
      #${PANEL_ID} button:disabled{opacity:.45;cursor:not-allowed}
      #${PANEL_ID} .tm-switch{margin-left:auto;border-radius:999px;padding:6px 13px;font-weight:600}
      #${PANEL_ID} .tm-label{color:#ddd}
    `;
    (document.head || document.documentElement).append(style);
  }

  function updateUi() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const title = panel.querySelector('[data-role="title"]');
    if (title) title.textContent = `ChatGPT Recorder v${VERSION}`;
    const md = panel.querySelector('[data-role="extract-md"]');
    const jsonl = panel.querySelector('[data-role="extract-jsonl"]');
    if (md) {
      md.disabled = exportInProgress;
      md.textContent = exportInProgress && exportKind === 'md' ? 'Extracting…' : 'Extract MD';
    }
    if (jsonl) {
      jsonl.disabled = exportInProgress;
      jsonl.textContent = exportInProgress && exportKind === 'jsonl' ? 'Extracting…' : 'Extract JSONL';
    }
    const screen = panel.querySelector('[data-role="screen-on"]');
    if (screen) screen.textContent = screenOnWhenCapturing ? 'ON' : 'OFF';
    refreshStatus();
  }

  function makePanel() {
    if (document.getElementById(PANEL_ID) || !document.body) return;
    injectStyles();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <button class="tm-close" type="button" aria-label="Close">×</button>
      <div class="tm-title" data-role="title"></div>
      <div class="tm-status" data-role="status"></div>
      <div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select></div>
      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button"></button></div>
      <div class="tm-row"><button data-role="extract-jsonl" type="button">Extract JSONL</button><button data-role="extract-md" type="button">Extract MD</button></div>
    `;
    panel.querySelector('.tm-close').addEventListener('click', () => panel.remove());
    const diagnostics = panel.querySelector('[data-role="diagnostics"]');
    diagnostics.value = diagnosticsLevel;
    diagnostics.addEventListener('change', () => {
      diagnosticsLevel = diagnostics.value;
      localStorage.setItem('tm-conversation-recorder-diagnostics', diagnosticsLevel);
      logDiagnostic('debug', 'diagnostics-level-changed', { diagnostics_level: diagnosticsLevel });
    });
    panel.querySelector('[data-role="screen-on"]').addEventListener('click', () => {
      screenOnWhenCapturing = !screenOnWhenCapturing;
      localStorage.setItem(SCREEN_ON_STORAGE_KEY, String(screenOnWhenCapturing));
      if (screenOnWhenCapturing) void acquireWakeLock();
      else void releaseWakeLock();
      updateUi();
    });
    panel.querySelector('[data-role="extract-jsonl"]').addEventListener('click', () => void runExport('jsonl'));
    panel.querySelector('[data-role="extract-md"]').addEventListener('click', () => void runExport('md'));
    document.body.append(panel);
    updateUi();
  }

  function bootstrapUi() {
    if (document.body) {
      makePanel();
      return;
    }
    new MutationObserver((_, observer) => {
      if (!document.body) return;
      observer.disconnect();
      makePanel();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquireWakeLock();
    else void releaseWakeLock();
  });

  installNetworkCapture();
  bootstrapUi();
})();
