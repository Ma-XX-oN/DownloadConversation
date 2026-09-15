import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

function sourceBlock() {
  const start = userscript.indexOf('  // BEGIN Issue #123 stock network diagnostics');
  const endMarker = '  // END Issue #123 stock network diagnostics';
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start,
    'Issue #123 stock-network diagnostics production block is missing.');
  return userscript.slice(start, end + endMarker.length);
}

function harness() {
  const context = {
    URL,
    location: {
      origin: 'https://chatgpt.com',
      href: 'https://chatgpt.com/c/conversation-1'
    },
    STOCK_NETWORK_ID_LIMIT: 64,
    STOCK_NETWORK_JSON_BYTE_LIMIT: 1024 * 1024,
    boundedDiagnosticText(value, maxChars = 2000) {
      const text = String(value ?? '');
      return text.length <= maxChars
        ? text
        : `${text.slice(0, maxChars)}… [truncated ${text.length - maxChars} chars]`;
    },
    redactDiagnosticSignedTokens(value) {
      return typeof value === 'string'
        ? value.replace(/([?&](?:sig|signature)=)[^&#\s]*/gi, '$1[redacted]')
        : value;
    }
  };
  vm.runInNewContext(
    `${sourceBlock()}\nthis.__network={stockNetworkSafeUrl,stockNetworkSafeResponseHeaders,stockNetworkJsonIdentitySummary};`,
    context
  );
  return context.__network;
}

function message(id, role = 'assistant') {
  return {
    id,
    author: { role },
    channel: role === 'assistant' ? 'final' : null,
    status: role === 'assistant' ? 'finished_successfully' : undefined,
    end_turn: role === 'assistant',
    content: { content_type: 'text', parts: [`text ${id}`] }
  };
}

test('same-origin request URL keeps routing data but redacts signed secrets', () => {
  const api = harness();
  assert.equal(
    api.stockNetworkSafeUrl(
      'https://chatgpt.com/backend-api/conversation/c1?before=m1&signature=SECRET&sig=ALSOSECRET'
    ),
    '/backend-api/conversation/c1?before=m1&signature=[redacted]&sig=[redacted]'
  );
});

test('cross-origin request URL never logs query parameters', () => {
  const api = harness();
  assert.equal(
    api.stockNetworkSafeUrl('https://example.test/path/to/data?token=SECRET&x=1'),
    'https://example.test/path/to/data'
  );
});

test('response header diagnostics retain only explicit safe cache metadata', () => {
  const api = harness();
  const headers = new Headers({
    date: 'Mon, 15 Sep 2026 00:00:00 GMT',
    age: '12',
    'cache-control': 'private, max-age=0',
    etag: '"abc"',
    'cf-cache-status': 'DYNAMIC',
    'set-cookie': 'session=SECRET',
    authorization: 'Bearer SECRET',
    'x-openai-internal-token': 'SECRET'
  });
  const result = api.stockNetworkSafeResponseHeaders(headers);
  assert.equal(result.date, 'Mon, 15 Sep 2026 00:00:00 GMT');
  assert.equal(result.age, '12');
  assert.equal(result.cache_control, 'private, max-age=0');
  assert.equal(result.etag, '"abc"');
  assert.equal(result.cf_cache_status, 'DYNAMIC');
  assert.equal('set_cookie' in result, false);
  assert.equal('authorization' in result, false);
  assert.equal('x_openai_internal_token' in result, false);
});

test('identity summary recognizes plural messages and singular current-node mapping', () => {
  const api = harness();
  const payload = {
    messages: [message('u1', 'user'), message('a1')],
    current_node: 'a3',
    mapping: {
      u2: { id: 'u2', parent: 'a1', message: message('u2', 'user') },
      a2: { id: 'a2', parent: 'u2', message: message('a2') },
      a3: { id: 'a3', parent: 'a2', message: message('a3') }
    }
  };
  const result = api.stockNetworkJsonIdentitySummary(payload);
  assert.equal(result.current_node, 'a3');
  assert.deepEqual(Array.from(result.message_ids), ['u1', 'a1', 'u2', 'a2', 'a3']);
  assert.equal(result.tail_messages.at(-1).id, 'a3');
  assert.equal(result.tail_messages.at(-1).role, 'assistant');
});

test('identity summary is bounded even for a very large response', () => {
  const api = harness();
  const payload = {
    messages: Array.from({ length: 500 }, (_, index) => message(`m${index}`))
  };
  const result = api.stockNetworkJsonIdentitySummary(payload);
  assert.ok(result.message_ids.length <= 64);
  assert.ok(result.tail_messages.length <= 64);
  assert.equal(result.message_ids.at(-1), 'm499');
});

test('fetch tracing observes every stock request without consuming the original response', () => {
  assert.match(userscript, /stockNetworkTraceFetchStart\(/,
    'Fetch interception must start one global stock-network trace.');
  assert.match(userscript, /stockNetworkTraceFetchResponse\(/,
    'Fetch interception must record the stock response.');
  assert.match(userscript, /response\.clone\(\)/,
    'Response inspection must operate on a clone.');
  assert.match(userscript, /return response;/,
    'The page must receive its original Response object unchanged.');
  assert.match(userscript, /\.body\.getReader\(\)/,
    'JSON body inspection must use a bounded stream reader rather than unbounded response.text().');
});

test('stock request metadata includes request cache mode and XHR completion metadata', () => {
  assert.match(userscript, /cache_mode:\s*request\?\.cache/,
    'Fetch trace must retain Request.cache when observable.');
  assert.match(userscript, /addEventListener\(['"]loadend['"]/,
    'XHR tracing must observe response completion.');
});

test('click diagnostics explicitly distinguish trusted from synthetic input', () => {
  assert.match(userscript, /is_trusted:\s*event\.isTrusted\s*===\s*true/,
    'Click diagnostics must record Event.isTrusted.');
  assert.match(userscript, /pointer_type:/,
    'Click diagnostics must retain pointer type when supplied.');
  assert.match(userscript, /button:/,
    'Click diagnostics must retain mouse/pointer button metadata.');
});
