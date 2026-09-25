import { coreDependency, coreUrl } from './helpers/core-pin.mjs';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

assert.equal(coreDependency.commit, '259376c1f16a3c67cc13ab05cc5f50c22fe3f060');
assert.equal(coreDependency.git_blob_sha1, '84a1fcf72a8da76f837a791a142c1c95ed37d607');
assert.doesNotMatch(userscript, /^\/\/ @require\s+/m,
  'Generated userscript must not use runtime @require for AIConversationCore.');

const response = await fetch(coreUrl);
assert.equal(response.status, 200, `Could not load pinned AIConversationCore bundle: HTTP ${response.status}`);
const bundle = await response.text();
const coreContext = {};
coreContext.globalThis = coreContext;
vm.runInNewContext(bundle, coreContext, { filename: 'aiconversationcore.chatgpt.browser.js' });

class TestFileReader {
  async readAsDataURL(blob) {
    const bytes = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type || 'application/octet-stream'};base64,${bytes.toString('base64')}`;
    queueMicrotask(() => this.onload?.());
  }
}

function resolverContext(apiFetchImpl, fetchImpl = apiFetchImpl) {
  return {
    URL,
    Blob,
    FileReader: TestFileReader,
    performance,
    apiFetch: apiFetchImpl,
    fetch: fetchImpl,
    location: { href: 'https://chatgpt.com/c/test' },
    assert(condition, message) {
      if (!condition) throw new Error(message);
    }
  };
}

function installResolverFunctions(context) {
  const names = [
    'cgImagePointerSource',
    'cgImageUnavailableMarkdown',
    'cgImageFailureMarkdown',
    'fetchImageDataUrl',
    'fetchCanonicalResolvedImageDataUrl',
    'cgResolveImagePointerMarkdown'
  ];
  vm.runInNewContext(`${names.map(productionFunctionSource).join('\n')}\nthis.__resolver = { ${names.join(', ')} };`, context);
  return context.__resolver;
}

test('pinned Core supplies sediment source identity and deterministic transport URL', () => {
  const record = {
    id: 'user-image',
    author: { role: 'user' },
    content: {
      content_type: 'multimodal_text',
      parts: [
        'Before',
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_fixture-image' },
        'After'
      ]
    },
    metadata: {}
  };
  const [event] = coreContext.AIConversationCore.adaptChatGPTRecords([record]);
  const image = event.resources.find(resource => resource.type === 'image');
  assert.equal(image.source_pointer, 'sediment://file_fixture-image');
  assert.equal(image.download_url, 'https://chatgpt.com/backend-api/files/download/file_fixture-image');
  assert.equal(image.source.part_index, 1);
});

test('production canonical image lookup adapts the exact ordered record set once and keys by source identity plus part index', () => {
  let adaptedRecords = null;
  const context = {
    canonicalCore() {
      return {
        adaptChatGPTRecords(records) {
          adaptedRecords = records;
          return coreContext.AIConversationCore.adaptChatGPTRecords(records);
        }
      };
    },
    assert(condition, message) {
      if (!condition) throw new Error(message);
    }
  };
  vm.runInNewContext(`${productionFunctionSource('canonicalImageResourcesByRecordAndPart')}\nthis.__lookup = canonicalImageResourcesByRecordAndPart;`, context);
  const record = {
    id: 'user-image',
    author: { role: 'user' },
    content: {
      content_type: 'multimodal_text',
      parts: [
        'Before',
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_fixture-image' },
        'After'
      ]
    },
    metadata: {}
  };
  const earlierRecord = {
    id: 'context-record',
    author: { role: 'assistant' },
    content: { content_type: 'text', parts: ['Context'] },
    metadata: {}
  };
  const orderedRecords = [earlierRecord, record];
  const byRecord = context.__lookup(orderedRecords);
  assert.equal(adaptedRecords, orderedRecords);
  const byPart = byRecord.get('user-image');
  assert.equal(byPart.get(1).source_pointer, 'sediment://file_fixture-image');
  assert.equal(byPart.get(1).download_url, 'https://chatgpt.com/backend-api/files/download/file_fixture-image');
});

test('production resolver follows Core transport to transient image URL and returns image data', async () => {
  const transportRequests = [];
  const contentRequests = [];
  const context = resolverContext(
    async url => {
      transportRequests.push(String(url));
      return {
        ok: true,
        status: 200,
        async json() {
          return { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_fixture-image&sig=secret' };
        }
      };
    },
    async url => {
      contentRequests.push(String(url));
      return {
        ok: true,
        status: 200,
        async blob() {
          return new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' });
        }
      };
    }
  );
  const resolver = installResolverFunctions(context);
  const timing = {};
  const dataUrl = await resolver.fetchCanonicalResolvedImageDataUrl(
    'https://chatgpt.com/backend-api/files/download/file_fixture-image', timing
  );
  assert.deepEqual(transportRequests, [
    'https://chatgpt.com/backend-api/files/download/file_fixture-image'
  ]);
  assert.deepEqual(contentRequests, [
    'https://chatgpt.com/backend-api/estuary/content?id=file_fixture-image&sig=secret'
  ]);
  assert.equal(dataUrl, 'data:image/png;base64,AQID');
  assert.equal(timing.resolver_status, 200);
  assert.equal(timing.http_status, 200);
  assert.equal(timing.blob_bytes, 3);
});

test('production sediment recovery maps 404/410 to missing and other resolver failures to unavailable', async () => {
  const part = { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_fixture-image' };
  const resource = {
    type: 'image',
    resource_kind: 'conversation_image',
    source_pointer: 'sediment://file_fixture-image',
    download_url: 'https://chatgpt.com/backend-api/files/download/file_fixture-image'
  };
  for (const status of [404, 410, 403]) {
    const context = resolverContext(async () => ({ ok: false, status }));
    const resolver = installResolverFunctions(context);
    const markdown = await resolver.cgResolveImagePointerMarkdown(part, resource, 'user-image', 1, {});
    if (status === 404 || status === 410) assert.equal(markdown, '[image missing]');
    else assert.equal(markdown, '[image not available](sediment://file_fixture-image)');
  }
});

test('Core transport/data recovery is selected before optional mounted-DOM fallback', () => {
  const recoverStart = userscript.indexOf('  async function recoverUserImages(spine)');
  const recoverEnd = userscript.indexOf('\n  async function runExport(', recoverStart);
  assert.ok(recoverStart >= 0 && recoverEnd > recoverStart);
  const recovery = userscript.slice(recoverStart, recoverEnd);
  const transportAt = recovery.indexOf("const hasCanonicalTransport = typeof resource?.download_url === 'string'");
  const coreBranchAt = recovery.indexOf('if (hasCanonicalTransport || hasCanonicalData)', transportAt);
  const domAt = recovery.indexOf('if (candidates[index] instanceof HTMLImageElement)', coreBranchAt);
  assert.ok(transportAt >= 0 && coreBranchAt > transportAt && domAt > coreBranchAt,
    'Core transport/data recovery must be selected before optional mounted-DOM fallback.');
  assert.match(recovery, /path: hasCanonicalData \? 'core-data' : 'core-download'/);
  assert.match(recovery, /const imagePartIndexes = record\.content\.parts/);
  assert.match(recovery, /const sourceRecords = \(spine\?\.records \?\? \[\]\)\.map\(item => item\?\.message\)\.filter\(Boolean\)/);
  assert.match(recovery, /canonicalImageResourcesByRecordAndPart\(sourceRecords\)/);
  assert.match(recovery, /canonicalResourcesByRecord\.get\(record\.id\) \?\? new Map\(\)/);
  const sedimentGuardAt = recovery.indexOf("const isSediment = internalImagePointerProtocol(sourcePointer) === 'sediment'");
  const missingResourceAt = recovery.indexOf("conversation-image-core-resource-missing", sedimentGuardAt);
  assert.ok(sedimentGuardAt >= 0 && missingResourceAt > sedimentGuardAt && missingResourceAt < domAt,
    'Sediment recovery must fail explicitly on a missing Core transport before any DOM/raw-pointer fallback.');
  assert.match(recovery, /script_version: VERSION/);
});

test('Core download transport uses the captured authenticated API request context', () => {
  const source = productionFunctionSource('fetchCanonicalResolvedImageDataUrl');
  assert.match(source, /await apiFetch\(resolverUrl\)/);
  assert.doesNotMatch(source, /fetch\(resolverUrl/);
});

test('DownloadConversation does not duplicate sediment-to-download URL construction', () => {
  assert.doesNotMatch(
    userscript,
    /sediment:\/\/[^\n]*backend-api\/files\/download/,
    'Provider sediment-to-download mapping belongs to AIConversationCore, not DownloadConversation.'
  );
  assert.doesNotMatch(userscript, /logDiagnostic\([^\n]*download_url/,
    'Transient signed resolver URLs must not be emitted directly to diagnostics.');
});

test('userscript version metadata follows the project semantic-version contract', () => {
  assert.match(userscript, /^\/\/ @version\s+\d+\.\d+\.\d+(?:-issue\.\d+\.\d+)?$/m);
});
