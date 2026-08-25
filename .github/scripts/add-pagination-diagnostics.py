from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new):
  global text
  count = text.count(old)
  assert count == 1, f'Expected exactly one match, got {count}: {old[:100]!r}'
  text = text.replace(old, new, 1)


replace_once('// @version      0.6.115', '// @version      0.6.116')

old_fetch = '''  async function fetchOneConversationPage(url, description) {
    const response = await apiFetch(url);
    if (!response.ok) throw new Error(`${description} returned HTTP ${response.status}.`);
    const data = await response.json();
    if (!conversationSchemaOk(data)) {
      throw new Error(`${description} did not contain messages[] and page_info.`);
    }
    return data;
  }
'''
new_fetch = '''  function boundedDiagnosticText(text, maxChars = 2000) {
    const value = typeof text === 'string' ? text : String(text ?? '');
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]`;
  }

  function diagnosticRequestPath(url) {
    try {
      const parsed = new URL(url, location.href);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return String(url);
    }
  }

  async function fetchOneConversationPage(url, description, requestInfo = {}) {
    const startedAt = performance.now();
    const requestDetails = {
      page_number: requestInfo.page_number ?? null,
      request_kind: requestInfo.request_kind ?? 'unknown',
      cursor: requestInfo.cursor ?? null,
      request_path: diagnosticRequestPath(url),
      previous_page_info: requestInfo.previous_page_info ?? null
    };

    logDiagnostic('verbose', 'conversation-api-page-request-start', requestDetails);

    let response;
    try {
      response = await apiFetch(url);
    } catch (error) {
      logDiagnostic('errors', 'conversation-api-page-network-failure', {
        ...requestDetails,
        elapsed_ms: Math.round(performance.now() - startedAt),
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    const responseDetails = {
      ...requestDetails,
      elapsed_ms: Math.round(performance.now() - startedAt),
      status: response.status,
      status_text: response.statusText,
      content_type: response.headers.get('content-type') || ''
    };

    if (!response.ok) {
      let bodyPreview = '';
      try {
        bodyPreview = boundedDiagnosticText(await response.clone().text());
      } catch (error) {
        bodyPreview = `[response body unavailable: ${error instanceof Error ? error.message : String(error)}]`;
      }
      logDiagnostic('errors', 'conversation-api-page-http-failure', {
        ...responseDetails,
        response_body_preview: bodyPreview
      });
      throw new Error(`${description} returned HTTP ${response.status}.`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      logDiagnostic('errors', 'conversation-api-page-json-failure', {
        ...responseDetails,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    if (!conversationSchemaOk(data)) {
      logDiagnostic('errors', 'conversation-api-page-schema-failure', {
        ...responseDetails,
        top_level_keys: data && typeof data === 'object' ? Object.keys(data) : [],
        messages_is_array: Array.isArray(data?.messages),
        page_info_type: data?.page_info === null ? 'null' : typeof data?.page_info
      });
      throw new Error(`${description} did not contain messages[] and page_info.`);
    }

    logDiagnostic('debug', 'conversation-api-page-success', {
      ...responseDetails,
      record_count: data.messages.length,
      page_info: {
        start_cursor: data.page_info.start_cursor ?? null,
        end_cursor: data.page_info.end_cursor ?? null,
        has_previous_page: data.page_info.has_previous_page ?? null,
        has_next_page: data.page_info.has_next_page ?? null
      }
    });
    return data;
  }
'''
replace_once(old_fetch, new_fetch)

replace_once(
  '      const data = await fetchPage(cursor);\n',
  '      const previousPageInfo = pages.length ? pages[pages.length - 1].page_info : null;\n'
  '      const data = await fetchPage(cursor, pages.length + 1, previousPageInfo);\n'
)

old_pages = '''  async function fetchConversationPages(conversationId, onProgress) {
    return collectConversationPages(
      cursor => fetchOneConversationPage(
        pageUrl(conversationId, cursor),
        cursor === null ? 'Initial Conversation API request' : 'Conversation pagination request'
      ),
      onProgress
    );
  }
'''
new_pages = '''  async function fetchConversationPages(conversationId, onProgress) {
    return collectConversationPages(
      (cursor, pageNumber, previousPageInfo) => fetchOneConversationPage(
        pageUrl(conversationId, cursor),
        cursor === null ? 'Initial Conversation API request' : 'Conversation pagination request',
        {
          page_number: pageNumber,
          request_kind: cursor === null ? 'initial' : 'pagination',
          cursor,
          previous_page_info: previousPageInfo ? {
            start_cursor: previousPageInfo.start_cursor ?? null,
            end_cursor: previousPageInfo.end_cursor ?? null,
            has_previous_page: previousPageInfo.has_previous_page ?? null,
            has_next_page: previousPageInfo.has_next_page ?? null
          } : null
        }
      ),
      onProgress
    );
  }
'''
replace_once(old_pages, new_pages)

old_test = '''    const data = await fetchOneConversationPage(
      pageUrl(conversationId),
      'Conversation API test request'
    );
'''
new_test = '''    const data = await fetchOneConversationPage(
      pageUrl(conversationId),
      'Conversation API test request',
      { page_number: 1, request_kind: 'test', cursor: null, previous_page_info: null }
    );
'''
replace_once(old_test, new_test)

assert '// @version      0.6.116' in text
assert 'conversation-api-page-http-failure' in text
assert 'conversation-api-page-success' in text
assert 'response_body_preview' in text
assert 'discoverPageCount' not in text
assert 'const PAGE_TURNS = 100;' in text
assert "textContent = 'Record'" in text
assert "panel.style.display = 'none'" in text

path.write_text(text, encoding='utf-8')
