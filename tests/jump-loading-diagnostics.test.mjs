import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function diagnosticsHarness() {
  class FakeElement {
    constructor({ turnId = null, role = null, messageId = null, tocIndex = null } = {}) {
      this.turnId = turnId;
      this.role = role;
      this.messageId = messageId;
      this.tocIndex = tocIndex;
    }

    getAttribute(name) {
      if (name === 'data-turn-id') return this.turnId;
      if (name === 'data-turn') return this.role;
      if (name === 'data-toc-item-index') return this.tocIndex == null ? null : String(this.tocIndex);
      if (name === 'data-message-id') return this.messageId;
      return null;
    }

    querySelector(selector) {
      if (selector === '[data-message-id]' && this.messageId) {
        return new FakeElement({ messageId: this.messageId });
      }
      return null;
    }
  }

  const scrollRoot = {
    scrollTop: 120,
    scrollHeight: 2400,
    clientHeight: 800
  };
  const sections = [
    new FakeElement({ turnId: 'turn-old', role: 'user', messageId: 'message-old' }),
    new FakeElement({ turnId: 'turn-new', role: 'assistant', messageId: 'message-new' })
  ];
  const toc = [
    new FakeElement({ tocIndex: 17 }),
    new FakeElement({ tocIndex: 18 }),
    new FakeElement({ tocIndex: 19 })
  ];
  const context = vm.createContext({
    URL,
    HTMLElement: FakeElement,
    location: {
      origin: 'https://chatgpt.com',
      href: 'https://chatgpt.com/c/conversation-1'
    },
    document: {
      querySelectorAll(selector) {
        if (selector === 'section[data-turn-id]') return sections;
        if (selector === 'button[data-toc-item-index]') return toc;
        return [];
      }
    },
    conversationScrollRoot: () => scrollRoot
  });
  vm.runInContext(`
    ${productionFunctionSource('isStockHistoricalConversationPageUrl')}
    ${productionFunctionSource('jumpLoadingTurnSnapshot')}
    ${productionFunctionSource('jumpLoadingDiagnosticSnapshot')}
    this.api = {
      isHistorical: isStockHistoricalConversationPageUrl,
      snapshot: jumpLoadingDiagnosticSnapshot
    };
  `, context);
  return context.api;
}

test('stock historical-page URL classifier is exact and excludes DownloadConversation first-page/API routes', () => {
  const { isHistorical } = diagnosticsHarness();
  assert.equal(isHistorical('/backend-api/conversations/c1/messages?before=cursor-1&num_turns=100'), true);
  assert.equal(isHistorical('/backend-api/conversations/c1?include_has_versions=true&num_turns=100'), false);
  assert.equal(isHistorical('/backend-api/f/conversation'), false);
  assert.equal(isHistorical('https://example.test/backend-api/conversations/c1/messages?before=x'), false);
});

test('historical-loading snapshot retains only bounded virtual-window identity and extent evidence', () => {
  const snapshot = JSON.parse(JSON.stringify(diagnosticsHarness().snapshot()));
  assert.deepEqual(snapshot, {
    scroll_top: 120,
    scroll_height: 2400,
    client_height: 800,
    at_top: false,
    at_bottom: false,
    mounted_turn_count: 2,
    oldest_mounted_turn: {
      turn_id: 'turn-old',
      role: 'user',
      message_id: 'message-old'
    },
    newest_mounted_turn: {
      turn_id: 'turn-new',
      role: 'assistant',
      message_id: 'message-new'
    },
    toc_count: 3,
    toc_min_index: 17,
    toc_max_index: 19
  });
});

test('diagnostics capture trusted user scroll direction/distance and stock historical request lifecycle', () => {
  const install = productionFunctionSource('installJumpLoadingDiagnostics');
  assert.match(install, /conversation-jump-loading-user-scroll/);
  assert.match(install, /event\.isTrusted\s*!==\s*true/);
  assert.match(install, /\bdirection(?:,|:)/);
  assert.match(install, /distance_px:/);
  assert.match(install, /document\.addEventListener\('scroll'/);
  assert.match(install, /document\.addEventListener\('wheel'/);
  assert.match(install, /document\.addEventListener\('keydown'/);

  const start = productionFunctionSource('jumpLoadingHistoricalRequestStart');
  const complete = productionFunctionSource('jumpLoadingHistoricalRequestComplete');
  assert.match(start, /conversation-jump-loading-historical-request-start/);
  assert.match(complete, /conversation-jump-loading-historical-response/);
  assert.match(complete, /conversation-jump-loading-historical-post-response/);
  assert.match(complete, /JUMP_LOADING_POST_RESPONSE_DELAYS_MS/);
});

test('stock network interception wires historical-loading diagnostics without instrumenting direct API fetch', () => {
  const installNetwork = productionFunctionSource('installNetworkCapture');
  assert.match(installNetwork, /jumpLoadingHistoricalRequestStart\(requestUrl, stockTrace\.sequence/);
  assert.match(installNetwork, /jumpLoadingHistoricalRequestComplete\(historicalLoadingTrace, response/);
  assert.match(installNetwork, /jumpLoadingHistoricalRequestComplete\(historicalLoadingTrace, null, error/);
  assert.match(installNetwork, /installJumpLoadingDiagnostics\(\)/);

  const directApi = productionFunctionSource('apiFetch');
  assert.doesNotMatch(directApi, /jumpLoadingHistoricalRequestStart|jumpLoadingHistoricalRequestComplete/,
    'DownloadConversation direct API pagination must not be mistaken for stock ChatGPT historical loading.');
});

test('historical-loading evidence collection remains independent from Jump materialization', () => {
  for (const name of ['primeNumericJumpMaterialization', 'populateJumpTocIndex', 'jumpToResolvedTarget', 'runJump']) {
    assert.doesNotMatch(productionFunctionSource(name), /jumpLoadingHistoricalRequest|installJumpLoadingDiagnostics/,
      `${name} must remain independent of the evidence collector.`);
  }
});
