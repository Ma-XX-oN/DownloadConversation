from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text()
assert '// @version      0.6.126' in text
text = text.replace('// @version      0.6.126', '// @version      0.6.127', 1)

old = "  let jumpInProgress = false;\n  let diagnosticLog = [];"
new = "  let jumpInProgress = false;\n  let clickDiagnosticSequence = 0;\n  let activeClickDiagnostic = null;\n  let diagnosticLog = [];"
assert old in text
text = text.replace(old, new, 1)

marker = "  function installNetworkCapture() {"
assert marker in text
instrumentation = r'''  function clickDiagnosticElementSnapshot(element) {
    if (!(element instanceof Element)) return null;
    const attributes = {};
    for (const attribute of [...element.attributes].slice(0, 40)) {
      if (attribute.name.startsWith('data-') ||
          ['href', 'src', 'aria-label', 'title', 'alt', 'download', 'target', 'role'].includes(attribute.name)) {
        attributes[attribute.name] = boundedDiagnosticText(attribute.value, 1000);
      }
    }
    return {
      tag: element.tagName.toLowerCase(),
      attributes,
      href_property: element instanceof HTMLAnchorElement ? element.href || null : null,
      src_property: element instanceof HTMLImageElement ? element.src || null : null,
      current_src: element instanceof HTMLImageElement ? element.currentSrc || null : null,
      text: boundedDiagnosticText(element.textContent?.trim() || '', 500) || null
    };
  }

  function clickDiagnosticTurnContext(target) {
    const section = target instanceof Element ? target.closest('section[data-turn-id]') : null;
    if (!(section instanceof HTMLElement)) return null;
    const message = section.querySelector('[data-message-id]');
    const clickedImage = target.closest('img');
    let imageOrdinal = null;
    if (clickedImage instanceof HTMLImageElement) {
      const images = [...section.querySelectorAll(
        'button[aria-label^="Open image:"] img, [class~="group/message-image"] img'
      )];
      const index = images.indexOf(clickedImage);
      if (index >= 0) imageOrdinal = index + 1;
    }
    return {
      turn_id: section.getAttribute('data-turn-id') || null,
      message_id: message?.getAttribute('data-message-id') || null,
      role: section.getAttribute('data-turn') || null,
      image_ordinal: imageOrdinal
    };
  }

  function recordClickDiagnosticNetworkRequest(url, initiatorType) {
    const active = activeClickDiagnostic;
    if (!active || performance.now() > active.deadline) return;
    const value = typeof url === 'string' ? url : String(url ?? '');
    if (!value) return;
    const item = {
      url: boundedDiagnosticText(value, 2000),
      initiator_type: initiatorType,
      elapsed_ms: Math.round(performance.now() - active.started_at)
    };
    active.network_requests.push(item);
    if (active.network_requests.length > 50) active.network_requests.shift();
    logDiagnostic('debug', 'conversation-click-network-request', {
      click_sequence: active.sequence,
      ...item
    });
  }

  function finishConversationClickDiagnostic(observation, reason = 'timer') {
    if (!observation || observation.finished) return;
    observation.finished = true;
    if (activeClickDiagnostic === observation) activeClickDiagnostic = null;
    const endedAt = performance.now();
    const resources = performance.getEntriesByType('resource')
      .filter(entry => entry instanceof PerformanceResourceTiming &&
        entry.startTime >= observation.started_at - 1 && entry.startTime <= endedAt + 1)
      .slice(-100)
      .map(entry => ({
        url: boundedDiagnosticText(entry.name, 2000),
        initiator_type: entry.initiatorType || null,
        response_status: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
        transfer_size: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
        decoded_body_size: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
        start_offset_ms: Math.round(entry.startTime - observation.started_at),
        duration_ms: Math.round(entry.duration)
      }));
    logDiagnostic('debug', 'conversation-click-resolution-result', {
      click_sequence: observation.sequence,
      finish_reason: reason,
      observation_ms: Math.round(endedAt - observation.started_at),
      turn: observation.turn,
      clicked: observation.clicked,
      closest_anchor: observation.closest_anchor,
      closest_button: observation.closest_button,
      closest_image: observation.closest_image,
      network_requests: observation.network_requests,
      new_performance_resources: resources
    });
  }

  function captureConversationClickDiagnostic(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest('#thread')) return;
    const turn = clickDiagnosticTurnContext(target);
    if (!turn) return;
    if (activeClickDiagnostic) finishConversationClickDiagnostic(activeClickDiagnostic, 'superseded-by-next-click');
    const startedAt = performance.now();
    const observation = {
      sequence: ++clickDiagnosticSequence,
      started_at: startedAt,
      deadline: startedAt + 2500,
      turn,
      clicked: clickDiagnosticElementSnapshot(target),
      closest_anchor: clickDiagnosticElementSnapshot(target.closest('a[href]')),
      closest_button: clickDiagnosticElementSnapshot(target.closest('button')),
      closest_image: clickDiagnosticElementSnapshot(target.closest('img')),
      network_requests: [],
      finished: false
    };
    activeClickDiagnostic = observation;
    logDiagnostic('debug', 'conversation-click-resolution-start', {
      click_sequence: observation.sequence,
      turn: observation.turn,
      clicked: observation.clicked,
      closest_anchor: observation.closest_anchor,
      closest_button: observation.closest_button,
      closest_image: observation.closest_image
    });
    setTimeout(() => finishConversationClickDiagnostic(observation, 'timer'), 2500);
  }

'''
text = text.replace(marker, instrumentation + marker, 1)

old_fetch = "        rememberApiRequestContext(request?.url ?? String(input), request?.headers, init.headers);\n        return originalFetch.apply(this, args);"
new_fetch = "        const requestUrl = request?.url ?? String(input);\n        rememberApiRequestContext(requestUrl, request?.headers, init.headers);\n        recordClickDiagnosticNetworkRequest(requestUrl, 'fetch');\n        return originalFetch.apply(this, args);"
assert old_fetch in text
text = text.replace(old_fetch, new_fetch, 1)

old_xhr = "        const info = this.__tmApiRequest || { url: '', headers: {} };\n        rememberApiRequestContext(info.url, info.headers);\n        return originalSend.call(this, body);"
new_xhr = "        const info = this.__tmApiRequest || { url: '', headers: {} };\n        rememberApiRequestContext(info.url, info.headers);\n        recordClickDiagnosticNetworkRequest(info.url, 'xmlhttprequest');\n        return originalSend.call(this, body);"
assert old_xhr in text
text = text.replace(old_xhr, new_xhr, 1)

old_capture_end = "    captureInstalled = true;\n  }"
new_capture_end = "    if (typeof pageWindow.open === 'function') {\n      const originalOpen = pageWindow.open;\n      pageWindow.open = function(url, ...rest) {\n        recordClickDiagnosticNetworkRequest(url, 'window.open');\n        return originalOpen.call(this, url, ...rest);\n      };\n    }\n\n    captureInstalled = true;\n  }"
assert old_capture_end in text
text = text.replace(old_capture_end, new_capture_end, 1)

old_boot = "  installNetworkCapture();\n  bootstrapUi();"
new_boot = "  document.addEventListener('click', captureConversationClickDiagnostic, true);\n  window.addEventListener('pagehide', () => finishConversationClickDiagnostic(activeClickDiagnostic, 'pagehide'));\n  installNetworkCapture();\n  bootstrapUi();"
assert old_boot in text
text = text.replace(old_boot, new_boot, 1)

path.write_text(text)
