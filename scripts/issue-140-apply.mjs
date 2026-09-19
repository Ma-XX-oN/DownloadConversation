import fs from 'node:fs';

const userscriptPath = 'chatgpt-conversation-markdown-export.user.js';
const designPath = 'DESIGN.md';

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Missing expected ${label}.`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one ${label}.`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

let source = fs.readFileSync(userscriptPath, 'utf8');
source = replaceOnce(
  source,
  '// @version      1.4.0',
  '// @version      1.4.0-issue.140.1',
  'stable 1.4.0 metadata version'
);

const oldBlock = `        return responsePromise.then(response => {
          stockNetworkTraceFetchResponse(response, stockTrace);
          void communicationLogFetchResponse(response, stockTrace)
            .catch(communicationError => communicationLogReportFailure('fetch-response', communicationError));
          if (capturePromise) {
            void capturePromise.then(capture => {
              if (!capture) return;
              const cloned = cloneSafely(response);
              if (!cloned) return;
              void captureGenerationStreamResponse(cloned, capture);
            });
          }
          return response;
`;

const newBlock = `        return responsePromise.then(response => {
          const generationResponse = capturePromise ? cloneSafely(response) : null;
          stockNetworkTraceFetchResponse(response, stockTrace);
          void communicationLogFetchResponse(response, stockTrace)
            .catch(communicationError => communicationLogReportFailure('fetch-response', communicationError));
          if (capturePromise && !generationResponse) {
            logDiagnostic('warnings', 'conversation-stream-tail-response-clone-failure', {
              url: boundedDiagnosticText(response?.url ?? requestUrl, 320)
            });
          }
          if (capturePromise && generationResponse) {
            void capturePromise.then(capture => {
              if (!capture) {
                const cancelPromise = generationResponse.body?.cancel?.();
                if (cancelPromise && typeof cancelPromise.catch === 'function') {
                  void cancelPromise.catch(() => {});
                }
                return;
              }
              void captureGenerationStreamResponse(generationResponse, capture);
            });
          }
          return response;
`;

source = replaceOnce(source, oldBlock, newBlock, 'deferred generation Response clone block');
fs.writeFileSync(userscriptPath, source);

let design = fs.readFileSync(designPath, 'utf8');
const designHeading = '## Generation response clone ownership';
if (design.includes(designHeading)) throw new Error('Issue #140 DESIGN section already exists.');
design = design.replace(/\s*$/, '') + `\n\n${designHeading}\n\n` +
  'For `POST /backend-api/f/conversation`, DownloadConversation must acquire its passive generation-response clone synchronously in the fetch response handler, before returning the original `Response` to ChatGPT. Request-body parsing may finish later; the already-owned response clone waits for that request capture and is then consumed by the existing structured SSE path. This prevents ChatGPT from locking or disturbing the original response body before DownloadConversation acquires its clone. Clone acquisition failure is diagnostic-only and does not add a rendered-text or DOM terminal fallback.\n';
fs.writeFileSync(designPath, design);
