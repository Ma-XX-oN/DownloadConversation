            markdown_length: markdown.length,
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
        });
        setStatus(`Extracted ${spine.records.length} API records from ${fetched.pages.length} API page(s) to ${filename}.`);
      }
      if (tailConsistencyWarnings.length) {
        setStatus(`⚠ Export completed with tail consistency warning: ${tailConsistencyWarnings.join(' | ')}`);
      }
    } catch (error) {
      const message = errorMessage(error);
      logDiagnostic('errors', 'conversation-export-failure', {
        kind: activeKind,
        stage: progressState?.stage ?? null,
        record_number: progressState?.record_number ?? null,
        record_count: progressState?.record_count ?? null,
        message
      });
      setStatus(
        `${activeKind === 'md' ? 'Markdown' : 'JSONL'} extraction failed: ${message}`
      );
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

  /**
   * Tests API pagination logic.
   *
   * @returns {void} No value is returned.
   */
  async function testApiPaginationLogic() {
    const calls = [];
    const pagesByCursor = new Map([
      [null, {
        messages: [{ id: 'newest' }],
        page_info: { has_next_page: false, has_previous_page: true, start_cursor: 'cursor-2' }
      }],
      ['cursor-2', {
        messages: [{ id: 'middle' }],
        page_info: { has_next_page: true, has_previous_page: true, start_cursor: 'cursor-3' }
      }],
      ['cursor-3', {
        messages: [{ id: 'oldest' }],
        page_info: { has_next_page: true, has_previous_page: false, start_cursor: null }
      }]
    ]);
    /**
     * Collects ed.
     */
    const collected = await collectConversationPages(async cursor => {
      calls.push(cursor);
      assert(pagesByCursor.has(cursor), `Unexpected test cursor ${cursor}.`);
      return pagesByCursor.get(cursor);
    });
    assert(collected.pages.length === 3, 'Pagination test did not collect all three pages.');
    assert(calls.length === 3, 'Pagination test fetched a page more than once.');
    assert(calls[0] === null && calls[1] === 'cursor-2' && calls[2] === 'cursor-3',
      'Pagination test followed cursors in the wrong order.');

    let repeatedCursorRejected = false;
    try {
      await collectConversationPages(async cursor => ({
        messages: [{ id: String(cursor ?? 'first') }],
        page_info: { has_next_page: cursor !== null, has_previous_page: true, start_cursor: 'loop' }
      }));
    } catch (error) {
      repeatedCursorRejected = /repeated start_cursor/.test(errorMessage(error));
    }
    assert(repeatedCursorRejected, 'Pagination test did not reject a repeated cursor.');
  }

  /**
   * Tests stable message ids.
   *
   * @returns {void} No value is returned.
   */
  function testStableMessageIds() {
    const pages = [
      { messages: [{ id: 'b', marker: 'new-b' }, { id: 'c' }], page_info: {} },
      { messages: [{ id: 'a' }, { id: 'b', marker: 'old-b' }], page_info: {} }
    ];
    const spine = conversationSpineFromPages(pages);
    assert(spine.messages.length === 3, 'Stable-ID test did not deduplicate overlapping pages.');
    assert(spine.messages.map(message => message.id).join(',') === 'a,b,c',
      'Stable-ID test did not preserve oldest-to-newest order.');
    assert(spine.messages.find(message => message.id === 'b')?.marker === 'new-b',
      'Stable-ID test did not retain the newer duplicate record.');

    let missingIdRejected = false;
    try {
      conversationSpineFromPages([{ messages: [{}], page_info: {} }]);
    } catch (error) {
      missingIdRejected = /missing a stable id/.test(errorMessage(error));
    }
    assert(missingIdRejected, 'Stable-ID test did not reject a message without an id.');
  }

  /**
   * Tests conversation API access and schema.
   *
   * @returns {void} No value is returned.
   */
  async function testConversationApiAccessAndSchema() {
    const conversationId = currentConversationId();
    assert(conversationId, 'Current page is not a ChatGPT conversation.');
    const data = await fetchOneConversationPage(
      pageUrl(conversationId),
      'Conversation API test request',
      { page_number: 1, request_kind: 'test', cursor: null, previous_page_info: null }
    );
    assert(conversationSchemaOk(data), 'Conversation API test response schema is unsupported.');
    for (const message of data.messages) {
      assert(typeof message?.id === 'string' && message.id.length > 0,
        'Conversation API test page contains a message without a stable id.');
    }
  }

  /**
   * Tests multimodal user and chronological order.
   *
   * @returns {void} No value is returned.
   */
  async function testMultimodalUserAndChronologicalOrder() {
    /**
     * Handles record.
     *
     * @param {string} id - The id value required by this function.
     * @param {Object} role - The message role to match.
     * @param {string} contentType - The contentType value required by this function.
     * @param {Array<unknown>} parts - The ordered parts values to process.
     * @returns {void} No value is returned.
     */
    const record = (id, role, contentType, parts) => ({
      id,
      author: { role },
      content: { content_type: contentType, parts },
      metadata: {}
    });
    const spine = {
      records: [
        { ordinal: 0, message: record('u1', 'user', 'multimodal_text', [
          { content_type: 'image_asset_pointer', asset_pointer: 'sediment://fixture-image' },
          { content_type: 'image_asset_pointer' },
          'First User'
        ]) },
        { ordinal: 1, message: record('a1', 'assistant', 'text', ['First Assistant']) },
        { ordinal: 2, message: record('u2', 'user', 'text', ['Second User']) },
        { ordinal: 3, message: record('a2', 'assistant', 'text', ['Second Assistant']) }
      ]
    };
    const fallbackMarkdown = renderConversationMarkdown(spine);
    const unavailableToken = '[image not available](sediment://fixture-image)';
    const missingToken = '[image missing]';
    assert(fallbackMarkdown.includes(unavailableToken), 'protected image pointer did not render as linked image-not-available.');
    assert(fallbackMarkdown.includes(missingToken), 'image pointer without a source did not render as image missing.');
    assert(fallbackMarkdown.indexOf(unavailableToken) < fallbackMarkdown.indexOf(missingToken) &&
      fallbackMarkdown.indexOf(missingToken) < fallbackMarkdown.indexOf('First User'),
      'image placeholders did not preserve source order before adjacent User text.');
    assert(cgImageFailureMarkdown('https://example.test/missing.png', 404) === '[image missing]',
      'HTTP 404 image was not classified as missing.');
    assert(cgImageFailureMarkdown('https://example.test/private.png', 403) ===
      '[image not available](https://example.test/private.png)',
      'HTTP 403 image was not classified as linked image-not-available.');
    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';
    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken, missingToken]]]));
    assert(markdown.includes('First User'), 'multimodal_text User content was not rendered.');
    assert(markdown.includes(recoveredToken), 'recovered multimodal image was not rendered at its API image pointer.');
    assert(markdown.indexOf(recoveredToken) < markdown.indexOf(missingToken) &&
      markdown.indexOf(missingToken) < markdown.indexOf('First User'),
      'recovered/missing image tokens did not remain in source order.');
    const u1 = markdown.indexOf('First User');
    const a1 = markdown.indexOf('First Assistant');
    const u2 = markdown.indexOf('Second User');
    const a2 = markdown.indexOf('Second Assistant');
    assert(u1 >= 0 && a1 >= 0 && u2 >= 0 && a2 >= 0,
      'chronological rendering test did not emit all expected source content.');
    assert(u1 < a1 && a1 < u2 && u2 < a2,
      'Conversation API Markdown rendering did not preserve chronological record order.');
}

  /**
   * Tests renderer parity features.
   *
   * @returns {void} No value is returned.
   */
  function testRendererParityFeatures() {
    const fileToken = `${CG_INLINE_TOKEN_START}filecite${CG_INLINE_TOKEN_SEP}turn7file2${CG_INLINE_TOKEN_SEP}L1-L2${CG_INLINE_TOKEN_END}`;
    const citeToken = `${CG_INLINE_TOKEN_START}cite${CG_INLINE_TOKEN_SEP}web${CG_INLINE_TOKEN_END}`;
    const memoryToken = `${CG_INLINE_TOKEN_START}memcite${CG_INLINE_TOKEN_END}`;
    const records = [
      { id: 'file-meta', author: { role: 'tool' }, content: { content_type: 'text', parts: [] }, metadata: { is_visually_hidden_from_conversation: true, retrieval_turn_number: 7, retrieval_file_index: 2, citation_metadata: { title: 'notes.txt', url: 'https://example.com/notes.txt' } } },
      { id: 'u1', author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: ['Question', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://image' }] }, metadata: {} },
      { id: 'tool1', author: { role: 'tool', name: 'tether_browsing_display' }, content: { content_type: 'tether_browsing_display', summary: 'Waiting for sources.' }, metadata: {} },
      { id: 'a1', author: { role: 'assistant' }, channel: 'final', content: { content_type: 'multimodal_text', parts: [`File ${fileToken}\n\nWeb ${citeToken}\n\nMemory ${memoryToken}`] }, metadata: { content_references: [ { type: 'hidden', matched_text: fileToken }, { type: 'grouped_webpages', matched_text: citeToken, items: [{ url: 'https://example.com/web', attribution: 'Example', title: 'Example source' }] }, { type: 'hidden', matched_text: memoryToken } ], conversation_context_citation_metadata: [{ citation: { url: 'https://example.com/memory', title: 'Prior note' } }] } }
    ];
    /**
     * Handles spine.
     */
    const spine = { records: records.map((message, ordinal) => ({ ordinal, message })) };
    const recoveredToken = '![image-u1-1](data:image/png;base64,AAAA)';
    const markdown = renderConversationMarkdown(spine, undefined, new Map([['u1', [recoveredToken]]]));
    assert(markdown.includes(recoveredToken), 'recovered image_asset_pointer was not rendered.');
    assert(markdown.indexOf(recoveredToken) < markdown.indexOf('Question'),
      'recovered image_asset_pointer did not preserve its position before User text.');
    assert(markdown.includes('<a href="https://example.com/notes.txt">notes.txt L1-L2</a>'), 'hidden file citation was not resolved to its link.');
    assert(markdown.includes('**(cite:'), 'web citation was not rendered.');
    assert(markdown.includes('**(memory:'), 'memory citation was not rendered.');
    assert(markdown.includes('Waiting for sources.'), 'tether browsing content was not preserved.');
    assert(!markdown.includes(CG_INLINE_TOKEN_START), 'raw ChatGPT inline reference tokens leaked into Markdown.');
  }

  /**
   * Tests jump identifier resolution.
   *
   * @returns {void} No value is returned.
   */
  function testJumpIdentifierResolution() {
    const records = [
      { ordinal: 0, message_id: 'u1', role: 'user' },
      { ordinal: 1, message_id: 'a1', role: 'assistant' },
      { ordinal: 2, message_id: 'u2', role: 'user' },
      { ordinal: 3, message_id: 'a2', role: 'assistant' },
      { ordinal: 4, message_id: 'u3', role: 'user' },
      { ordinal: 5, message_id: 'a3', role: 'assistant' }
    ];
    const spine = { records };
