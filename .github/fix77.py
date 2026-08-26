from pathlib import Path

p = Path('chatgpt-conversation-markdown-export.user.js')
s = p.read_text()
s = s.replace('// @version      0.6.125', '// @version      0.6.126', 1)

anchor = '''  async function imageElementDataUrl(image) {\n'''
insert = r'''  function internalImagePointerProtocol(source) {
    const value = String(source ?? '').trim().toLowerCase();
    if (value.startsWith('sandbox://')) return 'sandbox';
    if (value.startsWith('sediment://')) return 'sediment';
    return null;
  }

  function internalImagePointerAssetKey(source) {
    const value = String(source ?? '').trim();
    const protocol = internalImagePointerProtocol(value);
    if (!protocol) return '';
    return value
      .replace(/^[a-z]+:\/\//i, '')
      .split(/[?#]/, 1)[0]
      .split('/')
      .filter(Boolean)
      .pop() ?? '';
  }

  function imagePointerDomCandidate(image, ordinal) {
    if (!(image instanceof HTMLImageElement)) return null;
    const button = image.closest('button');
    const anchor = image.closest('a[href]');
    return {
      ordinal,
      src: image.getAttribute('src') || null,
      current_src: image.currentSrc || null,
      alt: image.getAttribute('alt') || null,
      title: image.getAttribute('title') || null,
      button_aria_label: button?.getAttribute('aria-label') || null,
      anchor_href: anchor?.getAttribute('href') || null
    };
  }

  function imagePointerResourceEvidence(source, domCandidate) {
    const assetKey = internalImagePointerAssetKey(source);
    const exactUrls = new Set([
      domCandidate?.src,
      domCandidate?.current_src,
      domCandidate?.anchor_href
    ].filter(Boolean));
    const exact = [];
    const heuristic = [];
    const entries = performance.getEntriesByType('resource').slice(-500);
    for (const entry of entries) {
      if (!(entry instanceof PerformanceResourceTiming)) continue;
      const name = String(entry.name || '');
      const record = {
        url: name,
        initiator_type: entry.initiatorType || null,
        response_status: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
        transfer_size: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
        decoded_body_size: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null
      };
      if (exactUrls.has(name)) {
        exact.push({ ...record, basis: 'dom-url-match' });
        continue;
      }
      if (assetKey && (name.includes(assetKey) || name.includes(encodeURIComponent(assetKey)))) {
        exact.push({ ...record, basis: 'asset-token-match' });
        continue;
      }
      if (['img', 'fetch', 'xmlhttprequest'].includes(entry.initiatorType) && /(?:image|file|asset|download|backend-api)/i.test(name)) {
        heuristic.push({ ...record, basis: 'recent-image-like-resource' });
      }
    }
    return {
      asset_key: assetKey || null,
      exact: exact.slice(-20),
      heuristic: heuristic.slice(-30)
    };
  }

  function logInternalImagePointerEvidence(record, section, candidates) {
    const parts = Array.isArray(record?.content?.parts) ? record.content.parts : [];
    let imageOrdinal = 0;
    for (const part of parts) {
      if (!part || typeof part !== 'object' || part.content_type !== 'image_asset_pointer') continue;
      imageOrdinal += 1;
      const source = cgImagePointerSource(part);
      const protocol = internalImagePointerProtocol(source);
      if (!protocol) continue;
      const image = candidates[imageOrdinal - 1] ?? null;
      const domCandidate = imagePointerDomCandidate(image, imageOrdinal);
      logDiagnostic('debug', 'conversation-image-pointer-resolution-evidence', {
        message_id: record.id ?? null,
        turn_id: section?.getAttribute?.('data-turn-id') ?? null,
        image_ordinal: imageOrdinal,
        pointer_protocol: protocol,
        pointer_source: source,
        dom_match_basis: domCandidate ? 'same-turn-image-ordinal' : null,
        dom_candidate: domCandidate,
        mounted_image_count: candidates.length,
        resource_candidates: imagePointerResourceEvidence(source, domCandidate)
      });
    }
  }

'''
if anchor not in s:
  raise SystemExit('imageElementDataUrl anchor not found')
s = s.replace(anchor, insert + anchor, 1)

old_jump = '''      await jumpToResolvedTarget(target);\n      setStatus(`Jumped to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id}.`);\n'''
new_jump = '''      const section = await jumpToResolvedTarget(target);\n      if (target.role === 'user') {\n        const targetRecord = spine.records.find(item => item?.message_id === target.message_id)?.message;\n        if (targetRecord && userImagePointerCount(targetRecord) > 0) {\n          logInternalImagePointerEvidence(targetRecord, section, mountedUserConversationImages(section));\n        }\n      }\n      setStatus(`Jumped to ${target.role === 'assistant' ? 'Assistant' : 'User'} turn ${target.message_id}.`);\n'''
if old_jump not in s:
  raise SystemExit('runJump anchor not found')
s = s.replace(old_jump, new_jump, 1)

old_recovery = '''          const candidates = mountedUserConversationImages(section);\n          for (let index = 0; index < Math.min(expected, candidates.length); index += 1) {\n'''
new_recovery = '''          const candidates = mountedUserConversationImages(section);\n          logInternalImagePointerEvidence(record, section, candidates);\n          for (let index = 0; index < Math.min(expected, candidates.length); index += 1) {\n'''
if old_recovery not in s:
  raise SystemExit('recoverUserImages anchor not found')
s = s.replace(old_recovery, new_recovery, 1)

p.write_text(s)
