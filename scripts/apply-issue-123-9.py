from pathlib import Path

SOURCE = Path('chatgpt-conversation-markdown-export.user.js')
DESIGN = Path('DESIGN.md')


def replace_once(text: str, old: str, new: str, label: str) -> str:
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


source = SOURCE.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      1.0.1-issue.123.8',
  '// @version      1.0.1-issue.123.9',
  'version'
)

source = replace_once(
  source,
  "          if (!handle) {\n"
  "            handle = await window.showDirectoryPicker({ mode: 'readwrite' });\n"
  "            const permission = await communicationLogPermissionState(handle);\n",
  "          if (!handle) {\n"
  "            const pickerWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;\n"
  "            if (typeof pickerWindow.showDirectoryPicker !== 'function') {\n"
  "              throw new Error('This browser does not expose showDirectoryPicker().');\n"
  "            }\n"
  "            handle = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });\n"
  "            const permission = await communicationLogPermissionState(handle);\n",
  'page-realm directory picker'
)

source = replace_once(
  source,
  "      if (parsed.origin !== location.origin) return false;\n"
  "      if (communicationLogIsTextContentType(contentType)) return true;\n"
  "      return parsed.pathname.startsWith('/backend-api/');\n",
  "      if (parsed.origin !== location.origin) return false;\n"
  "      const normalizedContentType = String(contentType ?? '').split(';', 1)[0].trim().toLowerCase();\n"
  "      if (communicationLogIsTextContentType(normalizedContentType)) return true;\n"
  "      if (normalizedContentType) return false;\n"
  "      return parsed.pathname.startsWith('/backend-api/');\n",
  'binary body policy'
)

source = replace_once(
  source,
  "    await communicationLogRecord('communication_fetch_request', {\n"
  "      network_sequence: trace?.sequence ?? null,\n",
  "    await communicationLogRecord('communication_fetch_request', {\n"
  "      origin: trace?.origin ?? 'stock-chatgpt',\n"
  "      network_sequence: trace?.sequence ?? null,\n",
  'fetch request origin'
)

source = replace_once(
  source,
  "    await communicationLogRecord('communication_fetch_response', {\n"
  "      network_sequence: trace?.sequence ?? null,\n",
  "    await communicationLogRecord('communication_fetch_response', {\n"
  "      origin: trace?.origin ?? 'stock-chatgpt',\n"
  "      network_sequence: trace?.sequence ?? null,\n",
  'fetch response origin'
)

old_api_fetch = r'''  async function apiFetch(url) {
    const conversationId = currentConversationId();
    // Snapshot the captured request context used to authorize this direct API request.
    const context = apiRequestContext;
    if (!context?.headers?.authorization || context.conversation_id !== conversationId) {
      throw new Error('No authenticated Conversation API context is available. Reload this conversation, then try again.');
    }
    // Use the page realm rather than the userscript sandbox when intercepting page networking.
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    // Prefer the pre-interception fetch implementation to avoid recursively capturing ourselves.
    const fetchFn = originalPageFetch || pageWindow.fetch;
    return fetchFn.call(pageWindow, url, {
      method: 'GET',
      headers: { ...context.headers },
      credentials: 'include'
    });
  }
'''

new_api_fetch = r'''  async function apiFetch(url) {
    const conversationId = currentConversationId();
    // Snapshot the captured request context used to authorize this direct API request.
    const context = apiRequestContext;
    if (!context?.headers?.authorization || context.conversation_id !== conversationId) {
      throw new Error('No authenticated Conversation API context is available. Reload this conversation, then try again.');
    }
    // Use the page realm rather than the userscript sandbox when intercepting page networking.
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    // Prefer the pre-interception fetch implementation to avoid recursively capturing ourselves.
    const fetchFn = originalPageFetch || pageWindow.fetch;
    const requestInit = {
      method: 'GET',
      headers: { ...context.headers },
      credentials: 'include'
    };
    const trace = {
      sequence: ++stockNetworkSequence,
      started_at: performance.now(),
      method: 'GET',
      url: stockNetworkSafeUrl(url),
      same_origin: true,
      origin: 'downloadconversation'
    };
    let loggingRequest = null;
    try {
      const PageRequest = pageWindow.Request || Request;
      loggingRequest = new PageRequest(url, requestInit);
    } catch {}
    void communicationLogFetchRequest(loggingRequest, trace)
      .catch(communicationError => communicationLogReportFailure('direct-api-request', communicationError));
    const response = await fetchFn.call(pageWindow, url, requestInit);
    void communicationLogFetchResponse(response, trace)
      .catch(communicationError => communicationLogReportFailure('direct-api-response', communicationError));
    return response;
  }
'''
source = replace_once(source, old_api_fetch, new_api_fetch, 'direct apiFetch logging')
SOURCE.write_text(source, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
section = r'''

## Issue #123 communication-recorder source-completeness correction

The disk recorder must distinguish stock ChatGPT traffic from DownloadConversation's
own authenticated Conversation API acquisition.  The latter intentionally uses the
pre-interception page `fetch` implementation, so it is now traced explicitly with
`origin: "downloadconversation"` while ordinary intercepted page fetches retain
`origin: "stock-chatgpt"`.  Logging still consumes only cloned Request/Response data
and does not alter the request used by the exporter.

Body persistence is now content-type conservative.  Explicitly textual MIME types
remain eligible for body capture; any explicit non-text MIME type is metadata-only,
even beneath `/backend-api/`.  A missing content type may still be inspected for a
same-origin backend API because current ChatGPT endpoints occasionally omit a useful
MIME declaration.  This preserves diagnostic coverage without decoding known binary
assets into the JSONL trace.

Directory selection uses the page realm (`unsafeWindow` when available) from the
existing user-gesture prompt, matching the realm used for the intercepted networking
objects and avoiding a sandbox-only File System Access lookup.
'''
if '## Issue #123 communication-recorder source-completeness correction' in design:
  raise SystemExit('DESIGN source-completeness section already exists')
DESIGN.write_text(design.rstrip() + section.rstrip() + '\n', encoding='utf-8')
