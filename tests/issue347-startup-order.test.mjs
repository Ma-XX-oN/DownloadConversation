import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {downloadConversationSource} from './helpers/userscript-source.mjs';

const read = name => readFileSync(new URL(
  '../src/userscript/' + name, import.meta.url
), 'utf8');
const provenance = read('03-agent-lifecycle/02-favicon-provenance.js');
const finalBootstrap = read('07-panel-launcher/05-bootstrap-part2.js');

test('favicon instrumentation starts after capture state, not during module loading', () => {
  const invocation = '  faviconProvenanceStart();';
  const epoch = downloadConversationSource.indexOf('const logCaptureEpoch =');
  const captureSequence = downloadConversationSource.indexOf('let logCaptureSequence = 0;');
  const logging = downloadConversationSource.indexOf(
    "logDiagnostic('lifecycle', 'dc-version-transition', { version: VERSION });"
  );
  const start = downloadConversationSource.indexOf(invocation);
  assert.ok(epoch >= 0 && captureSequence > epoch);
  assert.ok(logging > captureSequence);
  assert.ok(start > logging, 'Debug provenance must not run before logCaptureEpoch');
  assert.equal(downloadConversationSource.split(invocation).length - 1, 1);
  assert.ok(finalBootstrap.includes(invocation));
  assert.ok(!provenance.includes(invocation),
    'the early favicon provenance module must not invoke logging at module scope');
});

test('Debug enabled and stock favicon present do not trigger logCaptureEpoch TDZ', () => {
  const events = [];
  const ctx = {
    events,
    URL,
    document: {
      baseURI: 'https://chatgpt.com/',
      documentElement: {getAttribute() {return null;}},
      querySelectorAll() {return []; }
    },
    window: {
      matchMedia() {return {matches: false};},
      addEventListener() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    }
  };
  vm.runInNewContext(`
    const agentFaviconOriginalSources = new Map();
    const agentFaviconDisplayedHrefs = new Map();
    function agentFaviconCurrentCandidates() { return []; }
    function diagnosticEnabled(level) { return level === 'debug'; }
    function logDiagnostic(level, message, data) {
      events.push({ level, message, epoch: logCaptureEpoch, data });
    }
    ${provenance}
    this.countBeforeCaptureInitialization = events.length;
    const logCaptureEpoch = 'ready';
    faviconProvenanceStart();
  `, ctx);
  assert.equal(ctx.countBeforeCaptureInitialization, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].epoch, 'ready');
  assert.equal(events[0].message, 'agent-favicon-browser-theme-changed');
});
