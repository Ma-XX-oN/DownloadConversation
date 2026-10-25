import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { coreBundle } from '../tests/helpers/core-bundle.mjs';

// Explicit private input: never download or publish provider implementation.
const [providerPath, expectedHash] = process.argv.slice(2);
assert.ok(providerPath, 'Supply a local authorized provider classic artifact.');
assert.match(expectedHash ?? '', /^[a-f0-9]{64}$/, 'Supply its expected SHA256.');
const provider = await readFile(providerPath, 'utf8');
assert.equal(createHash('sha256').update(provider).digest('hex'), expectedHash);
const bridge = await readFile(new URL(
  '../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js', import.meta.url), 'utf8');
let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed += 1;
    console.log(`PASS ${name}`);
  });
}
function realm() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const diagnostics = [];
  const context = vm.createContext({ URL,
    console: Object.fromEntries(['error', 'info', 'warn', 'log'].map(level =>
      [level, (...args) => diagnostics.push([level, ...args])])),
    setTimeout(fn, delay) {
      timers.set(++id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(key) { timers.delete(key); }
  });
  function advance(to) {
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= to)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [key, timer] = due;
      timers.delete(key);
      now = timer.at;
      timer.fn();
    }
    now = to;
  }
  return { context, timers, diagnostics, advance,
    core() { vm.runInContext(coreBundle, context); return context.AIConversationCore; },
    provider() { vm.runInContext(provider, context); } };
}
function attach(r) {
  Object.assign(r.context, { canonicalCore: () => r.context.AIConversationCore,
    assert: (ok, message) => assert.ok(ok, message),
    currentConversationId: () => null, logDiagnostic() {},
    canonicalEnrichRecoveredImages: event => event });
  vm.runInContext(bridge + '\nthis.ready = ensureChatGPTCanonicalAgent;'
    + '\nthis.events = canonicalEventsFromChatGPTAgent;'
    + '\nthis.images = canonicalImageResourcesByRecordAndPart;'
    + '\nthis.byRecord = canonicalEventsBySourceRecord;', r.context);
  return r.context;
}
const record = (id, role, text) => ({ id, author: { role, metadata: {} },
  create_time: null, update_time: null, content: { content_type: 'text', parts: [text] },
  metadata: {}, recipient: 'all', channel: role === 'assistant' ? 'final' : null,
  status: 'finished_successfully', end_turn: role === 'assistant' });

await check('Core-first, exact provider registration and zero continuing timers', () => {
  const r = realm(); const core = r.core(); r.provider();
  const descriptor = core.getAgentPlugin('chatgpt-web');
  assert.equal(descriptor.name, 'ChatGPT');
  assert.equal(descriptor.apiVersion, 1);
  assert.equal(r.timers.size, 0);
  r.advance(60000);
  assert.equal(core.listAgentPlugins().length, 1);
  assert.equal(r.timers.size, 0);
});
await check('provider-first recovers and permanently stops startup polling', () => {
  const r = realm(); r.provider(); assert.equal(r.timers.size, 1);
  r.advance(1000); const core = r.core(); r.advance(1100);
  assert.ok(core.getAgentPlugin('chatgpt-web'));
  assert.equal(r.timers.size, 0);
  r.advance(60000); assert.equal(r.timers.size, 0);
});
await check('duplicate and invalid descriptors preserve authoritative entry', () => {
  const r = realm(); const core = r.core(); r.provider();
  const original = core.getAgentPlugin('chatgpt-web');
  r.provider();
  assert.equal(core.getAgentPlugin('chatgpt-web'), original);
  assert.throws(() => core.registerAgentPlugin({ id: 'bad' }));
  assert.equal(core.listAgentPlugins().length, 1);
  assert.ok(r.diagnostics.some(d => d[0] === 'error'));
  assert.equal(r.timers.size, 0);
});
await check('one-shot 15000ms diagnostic, no early firing and late recovery', () => {
  const r = realm(); r.core(); assert.equal(r.timers.size, 1);
  r.advance(14999); assert.equal(r.diagnostics.filter(d => d[0] === 'error').length, 0);
  r.advance(15000); assert.equal(r.diagnostics.filter(d => d[0] === 'error').length, 1);
  r.advance(30000); assert.equal(r.diagnostics.filter(d => d[0] === 'error').length, 1);
  r.provider(); assert.ok(r.diagnostics.some(d => d[0] === 'info'));
  assert.equal(r.timers.size, 0);
});
await check('real provider, Core-owned identity, production DC source mapping and replacement', async () => {
  const r = realm(); r.core(); r.provider(); const host = attach(r);
  const agent = await host.ready();
  assert.equal(await host.ready(), agent);
  assert.equal(agent.version().plugin, 'chatgpt-web');
  const records = [record('u1', 'user', 'Question'), record('a1', 'assistant', 'Answer')];
  assert.deepEqual([...host.byRecord(records).keys()], ['u1', 'a1']);
  assert.equal(host.images(records).size, 0);
  assert.deepEqual(Array.from(host.events([records[1]]), e => e.source_record_id), ['a1']);
});
await check('observer snapshot, exchange isolation and unsubscribe use real provider', () => {
  const r = realm(); const core = r.core(); r.provider();
  const first = core.createAgent('chatgpt-web').agent;
  const second = core.createAgent('chatgpt-web').agent;
  const states = [];
  const stop = first.observeState(state => states.push(state));
  assert.equal(states.length, 1);
  first.commTraffic({ type: 'submission_committed', exchange_id: 'cert-exchange', activate: true });
  assert.equal(first.currentState().exchange.id, 'cert-exchange');
  assert.equal(second.currentState().exchange.id, null);
  assert.ok(states.length > 1);
  const count = states.length; stop(); stop();
  first.commTraffic({ type: 'submission_committed', exchange_id: 'cert-next', activate: true });
  assert.equal(states.length, count);
});
await check('real provider preserves original image part and source record identity', async () => {
  const r = realm(); r.core(); r.provider(); const host = attach(r);
  await host.ready();
  const image = record('image-u', 'user', 'After image');
  image.content = { content_type: 'multimodal_text', parts: [
    { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_one' },
    'After image'
  ] };
  const resources = host.images([image]);
  assert.ok(resources.has('image-u'));
  assert.ok(resources.get('image-u').has(0));
  const resource = resources.get('image-u').get(0);
  assert.equal(resource.source.part_index, 0);
  assert.equal(resource.source_pointer, 'sediment://file_one');
});
await check('missing provider fails immediately and same DC bridge retries after registration', async () => {
  const r = realm(); r.core(); const host = attach(r);
  await assert.rejects(host.ready(), /No AICC-registered provider/);
  r.provider(); assert.ok(await host.ready()); assert.equal(r.timers.size, 0);
});
await check('independent alternate provider works through DC with CGP2 absent', async () => {
  const r = realm(); const core = r.core();
  vm.runInContext(`AIConversationCore.registerAgentPlugin({
    id: 'alternate', name: 'Alternate', iconUrl: 'https://example.com/icon.png',
    apiVersion: 1, recognize: input => input.provider === 'chatgpt',
    create(context) { return {
      sendMessage() {}, getResponse() {}, getTurns() { return []; },
      currentState() { return {}; }, observeState() { return () => {}; },
      commTraffic() { context.core.publishEvents([]); },
      version() { return { plugin: 'alternate', apiVersion: 1, version: '1', ref: 'fixture' }; }
    }; }
  });`, r.context);
  const agent = await attach(r).ready();
  assert.equal(agent.version().plugin, 'alternate');
  assert.equal(core.getAgentPlugin('chatgpt-web'), null);
  r.provider(); assert.equal(core.listAgentPlugins().length, 2);
  const first = core.createAgent('alternate');
  const second = core.createAgent('chatgpt-web');
  assert.notEqual(first.session, second.session);
  assert.notEqual(first.agent, second.agent);
});
console.log(`SUMMARY ${passed} PASS; controlled VM only, installed browser acceptance INCOMPLETE`);
