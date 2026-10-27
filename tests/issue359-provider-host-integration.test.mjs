import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL(
  '../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js',
  import.meta.url), 'utf8');

function fixture({ invalidHost = false, unavailable = false } = {}) {
  const events = [];
  let hostConnections = 0;
  const host = {
    navigation: () => true,
    request: () => true,
    response: () => true,
    dispose: () => { events.push('dispose-host'); }
  };
  const create = new Function(
    'assert', 'logDiagnostic', 'cscEnsureEarlyNavigationIngress',
    'cscDisposeEarlyNavigationIngress', 'cscPluginQueueConnect',
    'cscPluginQueueDisconnect', 'window', 'unsafeWindow',
    source + '\nreturn {' +
      ' set(a,m) {chatGPTAgent=a; chatGPTPluginModule=m;},' +
      ' connect: reconnectChatGPTSubjectHost,' +
      ' disconnect: disconnectChatGPTSubjectHost };'
  );
  const api = create(assert,
    (...args) => events.push(['diagnostic', ...args]),
    () => events.push('ensure-early-navigation'),
    () => events.push('dispose-early-navigation'),
    () => events.push('queue-connect'),
    () => events.push('queue-disconnect'),
    { location: { origin: 'https://chatgpt.com' } }, undefined
  );
  api.set({}, unavailable ? {} : {
    connectChatGPTSubjectHost() {
      hostConnections++;
      return invalidHost ? { dispose: host.dispose } : host;
    }
  });
  return { api, events, get hostConnections() { return hostConnections; } };
}

test('one active provider host attaches one queue and disposes once', () => {
  const f = fixture();
  f.api.connect();
  f.api.connect();
  assert.equal(f.hostConnections, 1);
  assert.equal(f.events.filter(v => v === 'queue-connect').length, 1);
  f.api.disconnect();
  f.api.disconnect();
  assert.equal(f.events.filter(v => v === 'queue-disconnect').length, 1);
  assert.equal(f.events.filter(v => v === 'dispose-host').length, 1);
  f.api.connect();
  assert.equal(f.hostConnections, 2);
  assert.equal(f.events.filter(v => v === 'queue-connect').length, 2);
  f.api.disconnect();
});

test('unsupported provider host is disposed without queue connection', () => {
  const f = fixture({ invalidHost: true });
  f.api.connect();
  assert.equal(f.hostConnections, 1);
  assert.equal(f.events.filter(v => v === 'dispose-host').length, 1);
  assert.equal(f.events.filter(v => v === 'queue-connect').length, 0);
  assert.equal(f.events.some(v =>
    Array.isArray(v) && v[1] === 'agent-plugin-navigation-interface-unavailable'), true);
});

test('provider without navigation interface never attaches queue', () => {
  const f = fixture({ unavailable: true });
  f.api.connect();
  assert.equal(f.hostConnections, 0);
  assert.equal(f.events.filter(v => v === 'queue-connect').length, 0);
  assert.equal(f.events.some(v =>
    Array.isArray(v) && v[1] === 'agent-plugin-navigation-interface-unavailable'), true);
});
