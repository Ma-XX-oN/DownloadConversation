from pathlib import Path
import re

USERSCRIPT = Path('chatgpt-conversation-markdown-export.user.js')
DESIGN = Path('DESIGN.md')
HEADING_TESTS = Path('tests/heading-metadata-controls.test.mjs')
DIAGNOSTIC_TESTS = Path('tests/tool-language-diagnostics.test.mjs')


def replace_once(text: str, old: str, new: str, description: str) -> str:
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{description}: expected one match, found {count}')
  return text.replace(old, new, 1)


def replace_function(text: str, name: str, replacement: str) -> str:
  declarations = [
    text.find(f'  function {name}('),
    text.find(f'  async function {name}('),
  ]
  declarations = [index for index in declarations if index >= 0]
  if len(declarations) != 1:
    raise RuntimeError(f'{name}: expected exactly one function declaration, found {len(declarations)}')
  declaration = declarations[0]
  doc_marker = text.rfind('\n  /**', 0, declaration)
  if doc_marker < 0:
    raise RuntimeError(f'{name}: preceding JSDoc not found')
  start = doc_marker + 1
  close = re.search(r'^  }\n', text[declaration:], re.MULTILINE)
  if not close:
    raise RuntimeError(f'{name}: closing brace not found')
  end = declaration + close.end()
  return text[:start] + replacement.rstrip() + '\n' + text[end:]


source = USERSCRIPT.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      0.6.163',
  '// @version      0.6.164',
  'userscript version')
source = replace_once(
  source,
  '  const MAX_DIAGNOSTIC_LOG_ITEMS = 500;',
  '''  const MAX_DIAGNOSTIC_LOG_ITEMS = 10000;
  /** Maximum retained diagnostic entries persisted across a page reload. */
  const MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS = 5000;
  /** Debounce used to keep high-volume debug diagnostics from serializing the full log on every event. */
  const DIAGNOSTIC_PERSIST_DELAY_MS = 1000;''',
  'diagnostic capacity')
source = replace_once(
  source,
  '''  /** In-memory diagnostic history mirrored to session storage for the panel. */
  let diagnosticLog = [];
''',
  '''  /** In-memory diagnostic history mirrored to session storage for the panel. */
  let diagnosticLog = [];
  /** Pending debounced diagnostic-log persistence timer, or null when no write is scheduled. */
  let diagnosticPersistTimer = null;
''',
  'diagnostic persistence timer')

source = replace_function(source, 'persistDiagnosticLog', '''  /**
   * Persists the bounded tail of the diagnostic log to session storage.
   *
   * The larger in-memory capacity is retained for same-page live captures, while the
   * persisted tail is separately bounded to avoid making every browser session write
   * proportional to the full instrumentation history.
   *
   * @returns {void} No value is returned.
   */
  function persistDiagnosticLog() {
    try {
      sessionStorage.setItem(
        DIAGNOSTIC_LOG_STORAGE_KEY,
        JSON.stringify(diagnosticLog.slice(-MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS))
      );
    } catch {}
  }

  /**
   * Schedules a bounded diagnostic-log persistence write.
   *
   * @returns {void} No value is returned.
   */
  function schedulePersistDiagnosticLog() {
    if (diagnosticPersistTimer !== null) return;
    diagnosticPersistTimer = setTimeout(() => {
      diagnosticPersistTimer = null;
      persistDiagnosticLog();
    }, DIAGNOSTIC_PERSIST_DELAY_MS);
  }''')

source = replace_function(source, 'refreshDiagnosticLog', '''  /**
   * Refreshes diagnostic log.
   *
   * Collapsed logs update only their count and controls. Thousands of hidden row
   * elements are not rebuilt on every diagnostic event during an instrumented export.
   *
   * @returns {void} No value is returned.
   */
  function refreshDiagnosticLog() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const count = panel.querySelector('[data-role="log-count"]');
    const output = panel.querySelector('[data-role="log-output"]');
    const toggle = panel.querySelector('[data-role="toggle-log"]');
    if (count) count.textContent = `Log: ${diagnosticLog.length} item${diagnosticLog.length === 1 ? '' : 's'}`;
    if (output && diagnosticLogExpanded) {
      output.replaceChildren(...diagnosticLog.map(entry => {
        const row = document.createElement('div');
        row.className = 'tm-log-row';
        row.textContent = diagnosticLogLine(entry);
        return row;
      }));
      output.scrollTop = output.scrollHeight;
    }
    if (output) output.hidden = !diagnosticLogExpanded;
    if (toggle instanceof HTMLButtonElement) {
      toggle.textContent = diagnosticLogExpanded ? '−' : '+';
      toggle.setAttribute('aria-expanded', String(diagnosticLogExpanded));
      toggle.setAttribute('aria-label', diagnosticLogExpanded ? 'Hide diagnostic log' : 'Show diagnostic log');
      toggle.title = diagnosticLogExpanded ? 'Hide log' : 'Show log';
    }
  }''')

source = replace_once(
  source,
  '''    persistDiagnosticLog();
    refreshDiagnosticLog();
''',
  '''    schedulePersistDiagnosticLog();
    refreshDiagnosticLog();
''',
  'debounced diagnostic persistence')

source = replace_once(
  source,
  "  window.addEventListener('pagehide', () => finishConversationClickDiagnostic(activeClickDiagnostic, 'pagehide'));",
  '''  window.addEventListener('pagehide', () => {
    finishConversationClickDiagnostic(activeClickDiagnostic, 'pagehide');
    if (diagnosticPersistTimer !== null) {
      clearTimeout(diagnosticPersistTimer);
      diagnosticPersistTimer = null;
    }
    persistDiagnosticLog();
  });''',
  'pagehide diagnostic flush')

source = replace_function(source, 'imageElementDataUrl', '''  /**
   * Fetches one conversational image source and converts its bytes to a data URL.
   *
   * @param {string} source - Browser-resolvable image source URL or existing data URL.
   * @param {Object|null} timing - Mutable timing/result object populated without storing image payload data.
   * @returns {Promise<string>} A promise resolving to the image data URL.
   */
  async function fetchImageDataUrl(source, timing = null) {
    const startedAt = performance.now();
    const src = String(source ?? '');
    assert(src, 'Conversational image has no source URL.');
    if (timing) {
      timing.stage = 'source';
      timing.outcome = null;
      timing.source_scheme = null;
      timing.http_status = null;
      timing.fetch_ms = null;
      timing.body_ms = null;
      timing.encode_ms = null;
      timing.blob_bytes = null;
      timing.data_url_chars = null;
      timing.total_ms = null;
      try { timing.source_scheme = new URL(src, location.href).protocol; } catch {}
    }
    if (src.startsWith('data:')) {
      if (timing) {
        timing.stage = 'complete';
        timing.outcome = 'data-url';
        timing.fetch_ms = 0;
        timing.body_ms = 0;
        timing.encode_ms = 0;
        timing.data_url_chars = src.length;
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return src;
    }
    try {
      if (timing) timing.stage = 'fetch';
      const response = await fetch(src, { credentials: 'include' });
      const headersAt = performance.now();
      if (timing) {
        timing.fetch_ms = Math.round(headersAt - startedAt);
        timing.http_status = response.status;
      }
      if (!response.ok) {
        const error = new Error(`Conversational image request returned HTTP ${response.status}.`);
        error.httpStatus = response.status;
        if (timing) timing.outcome = 'http-error';
        throw error;
      }
      if (timing) timing.stage = 'body';
      const blob = await response.blob();
      const bodyAt = performance.now();
      if (timing) {
        timing.body_ms = Math.round(bodyAt - headersAt);
        timing.blob_bytes = blob.size;
        timing.stage = 'encode';
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read conversational image blob.'));
        reader.readAsDataURL(blob);
      });
      const finishedAt = performance.now();
      if (timing) {
        timing.encode_ms = Math.round(finishedAt - bodyAt);
        timing.data_url_chars = dataUrl.length;
        timing.total_ms = Math.round(finishedAt - startedAt);
        timing.outcome = 'success';
        timing.stage = 'complete';
      }
      return dataUrl;
    } catch (error) {
      if (timing) {
        timing.total_ms = Math.round(performance.now() - startedAt);
        if (!timing.outcome) timing.outcome = `${timing.stage || 'unknown'}-error`;
      }
      throw error;
    }
  }

  /**
   * Converts a mounted conversation image element to a data URL while optionally recording timing metrics.
   *
   * @param {HTMLImageElement} image - Mounted conversation image element whose current source is recovered.
   * @param {Object|null} timing - Mutable timing/result object populated by `fetchImageDataUrl`.
   * @returns {Promise<string>} A promise resolving to the image data URL.
   */
  async function imageElementDataUrl(image, timing = null) {
    const src = image.currentSrc || image.getAttribute('src') || '';
    return fetchImageDataUrl(src, timing);
  }''')

source = replace_function(source, 'cgResolveImagePointerMarkdown', '''  /**
   * Resolves one provider image pointer into Markdown while optionally recording timing metrics.
   *
   * @param {Object} part - The provider content part to process.
   * @param {string} recordId - The provider/source record identifier.
   * @param {number} imageOrdinal - The one-based image ordinal within the source record.
   * @param {Object|null} timing - Mutable timing/result object populated without retaining image payload data.
   * @returns {Promise<string>} A promise that resolves to image Markdown or the established unavailable-image fallback.
   */
  async function cgResolveImagePointerMarkdown(part, recordId, imageOrdinal, timing = null) {
    const startedAt = performance.now();
    const source = cgImagePointerSource(part);
    if (!source) {
      if (timing) {
        timing.stage = 'complete';
        timing.outcome = 'missing-pointer';
        timing.source_scheme = null;
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return '[image missing]';
    }
    let parsed = null;
    try { parsed = new URL(source, location.href); } catch {}
    if (!source.startsWith('data:image/') && (!parsed || !['http:', 'https:'].includes(parsed.protocol))) {
      if (timing) {
        timing.stage = 'complete';
        timing.outcome = 'unsupported-pointer';
        timing.source_scheme = parsed?.protocol ?? null;
        timing.total_ms = Math.round(performance.now() - startedAt);
      }
      return cgImageUnavailableMarkdown(source);
    }
    try {
      const dataUrl = await fetchImageDataUrl(source, timing);
      return dataUrl ? `![image-${recordId}-${imageOrdinal}](${dataUrl})` : cgImageUnavailableMarkdown(source);
    } catch {
      return cgImageUnavailableMarkdown(source);
    }
  }''')

source = replace_function(source, 'recoverUserImages', '''  /**
   * Recovers user images while exposing compact per-image and whole-phase timing diagnostics.
   *
   * Existing recovery order and fallback behavior are preserved: images are still
   * recovered serially, mounted DOM candidates are preferred, and provider pointers
   * are used only where the established path already used them.
   *
   * @param {Object} spine - The ordered Conversation API source-record spine.
   * @returns {Promise<Map<unknown, unknown>>} A promise resolving to recovered image Markdown keyed by source message id.
   */
  async function recoverUserImages(spine) {
    // Recovered image Markdown is keyed by source message id for later canonical enrichment.
    const recovered = new Map();
    const scrollRoot = conversationScrollRoot();
    // Preserve the caller scroll position so image recovery can restore the page exactly.
    const originalScrollTop = scrollRoot.scrollTop;
    /** Ordered source records that contain one or more user image pointers. */
    const records = (spine?.records ?? []).filter(record => userImagePointerCount(record?.message) > 0);
    /** Total unique image pointers expected across the source records. */
    const totalImages = records.reduce((total, item) => total + userImagePointerCount(item?.message), 0);
    /** Highest unique image ordinal completed during this recovery phase. */
    let recoveredImages = 0;
    /** Number of mounted-image recovery operations that threw an error. */
    let failedImages = 0;
    /** Number of pointer resolutions that completed with an unavailable/missing outcome. */
    let unavailableImages = 0;
    /** Sum of downloaded Blob byte sizes observed by timed image operations. */
    let totalBlobBytes = 0;
    /** Sum of resulting data-URL character lengths observed by timed image operations. */
    let totalDataUrlChars = 0;
    /** Zero-based count of unique image pointers preceding the current source record. */
    let imageBase = 0;
    /** Monotonic start time for the complete image-recovery phase. */
    const recoveryStartedAt = performance.now();
    /** Whether the whole recovery phase reached the normal loop completion point. */
    let recoveryCompleted = false;

    if (progressState) {
      progressState.stage = 'recovering-images';
      progressState.image_number = 0;
      progressState.image_count = totalImages;
      progressState.image_completed = 0;
      progressState.image_path = null;
      progressState.image_started_at = 0;
    }
    logDiagnostic('debug', 'conversation-image-recovery-start', {
      source_message_count: records.length,
      total_images: totalImages,
      diagnostic_log_capacity: MAX_DIAGNOSTIC_LOG_ITEMS
    });
    refreshStatus();

    /**
     * Runs one existing image-recovery operation while recording compact timing/progress state.
     *
     * @param {Function} loader - Async image loader that accepts one mutable timing object.
     * @param {Object} context - Stable source/image correlation fields for the operation.
     * @returns {Promise<string>} A promise resolving to the existing image recovery result.
     */
    const recoverOne = async (loader, context) => {
      /** Mutable timing fields populated by the underlying image loader. */
      const timing = {};
      /** Monotonic start time for this one image recovery operation. */
      const startedAt = performance.now();
      if (progressState) {
        progressState.stage = 'recovering-images';
        progressState.image_number = context.image_number;
        progressState.image_count = totalImages;
        progressState.image_path = context.path;
        progressState.image_started_at = startedAt;
        progressState.image_message_id = context.message_id;
        progressState.image_ordinal = context.image_ordinal;
      }
      refreshStatus();
      logDiagnostic('debug', 'conversation-image-recovery-item-start', {
        image_number: context.image_number,
        total_images: totalImages,
        message_id: context.message_id,
        image_ordinal: context.image_ordinal,
        path: context.path
      });
      try {
        const value = await loader(timing);
        const outcome = timing.outcome ?? 'success';
        if (!['success', 'data-url'].includes(outcome)) unavailableImages += 1;
        logDiagnostic('debug', 'conversation-image-recovery-item-complete', {
          image_number: context.image_number,
          total_images: totalImages,
          message_id: context.message_id,
          image_ordinal: context.image_ordinal,
          path: context.path,
          outcome,
          source_scheme: timing.source_scheme ?? null,
          http_status: timing.http_status ?? null,
          fetch_ms: timing.fetch_ms ?? null,
          body_ms: timing.body_ms ?? null,
          encode_ms: timing.encode_ms ?? null,
          blob_bytes: timing.blob_bytes ?? null,
          data_url_chars: timing.data_url_chars ?? null,
          elapsed_ms: timing.total_ms ?? Math.round(performance.now() - startedAt)
        });
        return value;
      } catch (error) {
        failedImages += 1;
        logDiagnostic('debug', 'conversation-image-recovery-item-failure', {
          image_number: context.image_number,
          total_images: totalImages,
          message_id: context.message_id,
          image_ordinal: context.image_ordinal,
          path: context.path,
          outcome: timing.outcome ?? 'error',
          last_stage: timing.stage ?? null,
          source_scheme: timing.source_scheme ?? null,
          http_status: timing.http_status ?? Number(error?.httpStatus) || null,
          fetch_ms: timing.fetch_ms ?? null,
          body_ms: timing.body_ms ?? null,
          encode_ms: timing.encode_ms ?? null,
          blob_bytes: timing.blob_bytes ?? null,
          data_url_chars: timing.data_url_chars ?? null,
          elapsed_ms: timing.total_ms ?? Math.round(performance.now() - startedAt),
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        if (Number.isFinite(timing.blob_bytes)) totalBlobBytes += timing.blob_bytes;
        if (Number.isFinite(timing.data_url_chars)) totalDataUrlChars += timing.data_url_chars;
        recoveredImages = Math.max(recoveredImages, context.image_number);
        if (progressState) {
          progressState.image_completed = recoveredImages;
          progressState.image_started_at = 0;
        }
        refreshStatus();
      }
    };

    try {
      for (const item of records) {
        const record = item.message;
        /** Provider image-pointer parts expected for this source record. */
        const expectedParts = record.content.parts.filter(part =>
          part && typeof part === 'object' && part.content_type === 'image_asset_pointer'
        );
        /** Number of expected image pointers in this source record. */
        const expected = expectedParts.length;
        /** Existing fallback Markdown for each expected image pointer. */
        const images = expectedParts.map(part => cgImagePointerFallback(part));
        /** Global image-number offset for this source record. */
        const recordImageBase = imageBase;
        try {
          const section = mountedTurnSection(record.id, 'user');
          if (!(section instanceof HTMLElement)) {
            logDiagnostic('debug', 'conversation-image-dom-recovery-skipped', {
              message_id: record.id,
              reason: 'turn-not-mounted',
              expected_image_count: expected
            });
            throw new Error(`Turn ${record.id} is not mounted; DOM image recovery skipped to avoid scrolling.`);
          }
          const candidates = mountedUserConversationImages(section);
          logInternalImagePointerEvidence(record, section, candidates);
          for (let index = 0; index < Math.min(expected, candidates.length); index += 1) {
            try {
              const dataUrl = await recoverOne(
                timing => imageElementDataUrl(candidates[index], timing),
                {
                  image_number: recordImageBase + index + 1,
                  message_id: record.id,
                  image_ordinal: index + 1,
                  path: 'dom'
                }
              );
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
          for (let index = candidates.length; index < expected; index += 1) {
            images[index] = await recoverOne(
              timing => cgResolveImagePointerMarkdown(expectedParts[index], record.id, index + 1, timing),
              {
                image_number: recordImageBase + index + 1,
                message_id: record.id,
                image_ordinal: index + 1,
                path: 'pointer'
              }
            );
          }
        } catch (error) {
          logDiagnostic('warnings', 'conversation-image-turn-recovery-failure', {
            message_id: record.id,
            expected_image_count: expected,
            message: error instanceof Error ? error.message : String(error)
          });
          for (let index = 0; index < expected; index += 1) {
            images[index] = await recoverOne(
              timing => cgResolveImagePointerMarkdown(expectedParts[index], record.id, index + 1, timing),
              {
                image_number: recordImageBase + index + 1,
                message_id: record.id,
                image_ordinal: index + 1,
                path: 'pointer'
              }
            );
          }
        }
        recovered.set(record.id, images);
        imageBase += expected;
        recoveredImages = Math.max(recoveredImages, imageBase);
        if (progressState) progressState.image_completed = recoveredImages;
        refreshStatus();
      }
      recoveryCompleted = true;
    } finally {
      scrollRoot.scrollTop = originalScrollTop;
      logDiagnostic('debug', 'conversation-image-recovery-complete', {
        outcome: recoveryCompleted ? 'complete' : 'aborted',
        source_message_count: records.length,
        total_images: totalImages,
        completed_images: recoveredImages,
        failed_images: failedImages,
        unavailable_images: unavailableImages,
        blob_bytes: totalBlobBytes,
        data_url_chars: totalDataUrlChars,
        elapsed_ms: Math.round(performance.now() - recoveryStartedAt)
      });
    }
    return recovered;
  }''')

render_marker = "    if (stage === 'rendering') {"
if source.count(render_marker) != 1:
  raise RuntimeError(f'rendering status marker: expected one match, found {source.count(render_marker)}')
source = source.replace(render_marker, '''    if (stage === 'recovering-images') {
      const imageCount = Number(progressState.image_count) || 0;
      const imageNumber = Number(progressState.image_number) || 0;
      const imageCompleted = Number(progressState.image_completed) || 0;
      const imageElapsed = progressState.image_started_at > 0
        ? Math.max(0, now - progressState.image_started_at)
        : 0;
      const path = progressState.image_path ? ` (${progressState.image_path})` : '';
      return `${prefix}: recovering image ${imageNumber}/${imageCount}${path}…\\
Image elapsed: ${formatDuration(imageElapsed)} — Completed: ${imageCompleted}/${imageCount} — Total elapsed: ${formatDuration(elapsed)}`;
    }
''' + render_marker, 1)

source = replace_once(
  source,
  "        const markdown = renderConversationMarkdown(spine, progress => {",
  '''        /** Monotonic start time for synchronous Markdown rendering/final assembly. */
        const renderStartedAt = performance.now();
        logDiagnostic('debug', 'conversation-export-phase-start', {
          phase: 'markdown-render',
          source_record_count: spine.records.length
        });
        const markdown = renderConversationMarkdown(spine, progress => {''',
  'Markdown render timing start')

markdown_tail_pattern = re.compile(
  r"        const filename = `\$\{sanitizeFileName\(conversationTitle\(\)\)\}\.md`;\n"
  r".*?"
  r"        downloadBlob\(markdownBlob, filename\);",
  re.DOTALL)
markdown_tail_replacement = '''        const filename = `${sanitizeFileName(conversationTitle())}.md`;
        logDiagnostic('debug', 'conversation-export-phase-complete', {
          phase: 'markdown-render',
          elapsed_ms: Math.round(performance.now() - renderStartedAt),
          markdown_length: markdown.length
        });
        /** Markdown fingerprint reused by downstream debug boundaries when debug logging is enabled. */
        let markdownHash = null;
        if (diagnosticEnabled('debug')) {
          const diagnosticStartedAt = performance.now();
          logDiagnostic('debug', 'conversation-export-phase-start', {
            phase: 'markdown-diagnostics',
            markdown_length: markdown.length
          });
          markdownHash = diagnosticTextHash(markdown);
          const markdownTurnIds = diagnosticMarkdownTurnInventory(markdown, 32);
          const sourceTail = spine.records.slice(-32).map(item => ({
            source_record_id: item?.message_id ?? item?.message?.id ?? null,
            source_role: item?.role ?? item?.message?.author?.role ?? null,
            source_channel: item?.channel ?? item?.message?.channel ?? null,
            source_content_type: item?.content_type ?? item?.message?.content?.content_type ?? null
          }));
          logDiagnostic('debug', 'conversation-export-markdown-ready', {
            filename,
            source_record_count: spine.records.length,
            source_tail: sourceTail,
            markdown_length: markdown.length,
            markdown_hash: markdownHash,
            markdown_turn_ids: markdownTurnIds
          });
          logDiagnostic('debug', 'conversation-export-phase-complete', {
            phase: 'markdown-diagnostics',
            elapsed_ms: Math.round(performance.now() - diagnosticStartedAt),
            markdown_length: markdown.length
          });
        }
        const blobStartedAt = performance.now();
        logDiagnostic('debug', 'conversation-export-phase-start', {
          phase: 'blob-create',
          markdown_length: markdown.length
        });
        const markdownBlob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        logDiagnostic('debug', 'conversation-export-phase-complete', {
          phase: 'blob-create',
          elapsed_ms: Math.round(performance.now() - blobStartedAt),
          blob_size: markdownBlob.size
        });
        if (diagnosticEnabled('debug')) {
          logDiagnostic('debug', 'conversation-export-blob-created', {
            filename,
            markdown_length: markdown.length,
            markdown_hash: markdownHash,
            blob_size: markdownBlob.size,
            blob_type: markdownBlob.type
          });
        }
        const downloadStartedAt = performance.now();
        logDiagnostic('debug', 'conversation-export-phase-start', {
          phase: 'download-trigger',
          blob_size: markdownBlob.size
        });
        downloadBlob(markdownBlob, filename);
        logDiagnostic('debug', 'conversation-export-phase-complete', {
          phase: 'download-trigger',
          elapsed_ms: Math.round(performance.now() - downloadStartedAt),
          blob_size: markdownBlob.size
        });'''
source, tail_count = markdown_tail_pattern.subn(markdown_tail_replacement, source, count=1)
if tail_count != 1:
  raise RuntimeError(f'Markdown export tail: expected one match, found {tail_count}')

USERSCRIPT.write_text(source, encoding='utf-8')

heading_tests = HEADING_TESTS.read_text(encoding='utf-8')
heading_tests = replace_once(
  heading_tests,
  r"assert.match(userscript, /\/\/ @version      0\.6\.163/);",
  r"assert.match(userscript, /\/\/ @version      0\.6\.164/);",
  'heading test version')
HEADING_TESTS.write_text(heading_tests, encoding='utf-8')

diagnostic_tests = DIAGNOSTIC_TESTS.read_text(encoding='utf-8')
diagnostic_tests += r'''

test('issue 119 times image recovery and post-image export phases without logging image payloads', () => {
  assert.match(userscript, /const MAX_DIAGNOSTIC_LOG_ITEMS = 10000/);
  assert.match(userscript, /const MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS = 5000/);
  assert.match(userscript, /const DIAGNOSTIC_PERSIST_DELAY_MS = 1000/);
  assert.match(userscript, /conversation-image-recovery-start/);
  assert.match(userscript, /conversation-image-recovery-item-start/);
  assert.match(userscript, /conversation-image-recovery-item-complete/);
  assert.match(userscript, /conversation-image-recovery-item-failure/);
  assert.match(userscript, /conversation-image-recovery-complete/);
  assert.match(userscript, /fetch_ms: timing\.fetch_ms/);
  assert.match(userscript, /body_ms: timing\.body_ms/);
  assert.match(userscript, /encode_ms: timing\.encode_ms/);
  assert.match(userscript, /blob_bytes: timing\.blob_bytes/);
  assert.match(userscript, /data_url_chars: timing\.data_url_chars/);
  assert.match(userscript, /recovering image \$\{imageNumber\}\/\$\{imageCount\}/);
  assert.match(userscript, /phase: 'markdown-render'/);
  assert.match(userscript, /phase: 'markdown-diagnostics'/);
  assert.match(userscript, /phase: 'blob-create'/);
  assert.match(userscript, /phase: 'download-trigger'/);
  assert.doesNotMatch(userscript, /conversation-image-recovery-item-(?:start|complete|failure)[\s\S]{0,500}(?:data_url|source):/,
    'Image timing diagnostics must not include image payload/source fields.');
});

test('issue 119 gates expensive export-tail fingerprints behind debug diagnostics and reuses the result', () => {
  const readyIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-export-markdown-ready'");
  const blobIndex = userscript.indexOf("logDiagnostic('debug', 'conversation-export-blob-created'");
  assert.ok(readyIndex > 0 && blobIndex > readyIndex);
  const tailStart = userscript.lastIndexOf("if (diagnosticEnabled('debug'))", readyIndex);
  assert.ok(tailStart > 0, 'Markdown-ready diagnostics must be debug-gated before fingerprint evaluation.');
  const readyBlock = userscript.slice(tailStart, blobIndex + 400);
  assert.match(readyBlock, /markdownHash = diagnosticTextHash\(markdown\)/);
  assert.match(readyBlock, /markdown_hash: markdownHash/);
  assert.equal((readyBlock.match(/diagnosticTextHash\(markdown\)/g) ?? []).length, 1,
    'The export tail should calculate its full Markdown fingerprint only once.');
});

test('issue 119 keeps high-volume diagnostics cheap while the log UI is collapsed', () => {
  assert.match(userscript, /function schedulePersistDiagnosticLog\(\)/);
  assert.match(userscript, /schedulePersistDiagnosticLog\(\);\n    refreshDiagnosticLog\(\);/);
  assert.match(userscript, /diagnosticLog\.slice\(-MAX_PERSISTED_DIAGNOSTIC_LOG_ITEMS\)/);
  assert.match(userscript, /if \(output && diagnosticLogExpanded\) \{/);
});
'''
DIAGNOSTIC_TESTS.write_text(diagnostic_tests, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
design += '''

## Image recovery and export performance diagnostics

Image-heavy Markdown exports keep the established serial recovery order and
fallback semantics, but expose enough timing evidence to locate otherwise silent
waits. With diagnostics set to **Debug**, each image recovery logs a compact start
record before its awaited operation and a completion/failure record containing
fetch/header, response-body, data-URL encoding, byte/character, and total elapsed
measurements. The log deliberately omits image URLs, Base64 payloads, and other
image data. The whole image phase also records aggregate counts, sizes, and
elapsed time.

The live status display advances per image rather than only after an entire
source message finishes. While an image is pending it shows the current global
image ordinal, recovery path (`dom` or `pointer`), current-image elapsed time,
completed count, and whole-export elapsed time. This is observability only: no
parallel fetching, timeout, retry policy, or new fallback path is introduced by
this instrumentation.

After image recovery, Debug diagnostics bracket synchronous Markdown rendering,
full-Markdown diagnostic calculation, Blob construction, and the browser download
trigger. Expensive full-Markdown fingerprints/inventories are evaluated only when
Debug diagnostics are actually enabled, and the export-tail fingerprint is reused
instead of recalculated for the Blob boundary.

Issue #119 raises the same-page diagnostic history from 500 to 10,000 entries so
an image-heavy live run is unlikely to evict its early timing evidence. The
session-storage mirror retains the newest 5,000 entries. High-volume logging is
debounced to at most one persistence write per second, and a collapsed diagnostic
panel does not rebuild hidden log-row DOM on every event. A page-hide event flushes
the pending persisted tail. For live investigation, copy the diagnostic log before
reloading the page so the full in-memory history is preserved.
'''
DESIGN.write_text(design, encoding='utf-8')
