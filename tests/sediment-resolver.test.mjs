import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

function productionFunctionSource(name) {
  const patterns = [`async function ${name}(`, `function ${name}(`];
  let start = -1;
  for (const pattern of patterns) {
    start = userscript.indexOf(pattern);
    if (start >= 0) break;
  }
  assert.ok(start >= 0, `Production function ${name} is missing.`);
  const brace = userscript.indexOf('{', start);
  assert.ok(brace > start, `Production function ${name} has no body.`);
  let depth = 0;
  for (let index = brace; index < userscript.length; index += 1) {
    if (userscript[index] === '{') depth += 1;
    else if (userscript[index] === '}') {
      depth -= 1;
      if (depth === 0) return userscript.slice(start, index + 1);
    }
  }
  throw new Error(`Production function ${name} has an unterminated body.`);
}

const requireMatch = userscript.match(/^\/\/ @require\s+(https:\/\/raw\.githubusercontent\.com\/Ma-XX-oN\/AIConversationCore\/([0-9a-f]{40})\/dist\/aiconversationcore\.chatgpt\.browser\.js)$/m);
assert.ok(requireMatch, 'Production userscript must pin the AIConversationCore browser bundle to an exact commit.');
assert.equal(requireMatch[2], '3233cba838bbf2d2cea5a2a6f1900ed6014dcfb0');

const response = await fetch(requireMatch[1]);
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

function resolverContext(fetchImpl) {
  return {
    URL,
    Blob,
    FileReader: TestFileReader,
    performance,
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

test('production canonical image lookup consumes Core resources by original part index', () => {
  const context = {
    canonicalCore() {
      return coreContext.AIConversationCore;
    }
  };
  vm.runInNewContext(`${productionFunctionSource('canonicalImageResourcesByPart')}\nthis.__lookup = canonicalImageResourcesByPart;`, context);
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
  const byPart = context.__lookup(record);
  assert.equal(byPart.get(1).source_pointer, 'sediment://file_fixture-image');
  assert.equal(byPart.get(1).download_url, 'https://chatgpt.com/backend-api/files/download/file_fixture-image');
});

test('production resolver follows Core transport to transient image URL and returns image data', async () => {
  const requests = [];
  const context = resolverContext(async url => {
    requests.push(String(url));
    if (requests.length === 1) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_fixture-image&sig=secret' };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async blob() {
        return new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' });
      }
    };
  });
  const resolver = installResolverFunctions(context);
  const timing = {};
  const dataUrl = await resolver.fetchCanonicalResolvedImageDataUrl(
    'https://chatgpt.com/backend-api/files/download/file_fixture-image', timing
  );
  assert.deepEqual(requests, [
    'https://chatgpt.com/backend-api/files/download/file_fixture-image',
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
  assert.match(recovery, /path: hasCanonicalData \? 'core-data' : 'core-resolver'/);
  assert.match(recovery, /const imagePartIndexes = record\.content\.parts/);
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

test('userscript version advances for sediment resolver completion', () => {
  assert.match(userscript, /\/\/ @version      0\.6\.170/);
});
