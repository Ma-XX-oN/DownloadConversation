import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

import { coreBundle, coreDependency } from './helpers/core-pin.mjs';

const CORE_COMMIT = '2f9b916835f82668ed26d87b07840787b17f5b6c';
const CGP_COMMIT = '190e9ddeb42786abb7f200272fd4bfa7991a5543';
const CGP_CLASSIC_BLOB = '624570704656d2b480688b1de7a213f037b616cc';
const CGP_MODULE_BLOB = '3dbd6861c551785b2b7d13aa7cc4e9af74827b98';

function blobIdentity(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.byteLength + String.fromCharCode(0)))
    .update(bytes).digest('hex');
}

async function exactPlugin(path, expectedBlob) {
  const url = `https://raw.githubusercontent.com/Ma-XX-oN/Chat-Gpt-Plugin-2/${CGP_COMMIT}/${path}`;
  const response = await fetch(url);
  assert.equal(response.status, 200, `Unreachable exact plugin artifact ${path}`);
  const source = await response.text();
  assert.equal(blobIdentity(source), expectedBlob);
  return source;
}

const exactPluginPromise = Promise.all([
  exactPlugin('dist/chatgpt-plugin.browser.js', CGP_CLASSIC_BLOB),
  exactPlugin('dist/chatgpt-plugin.mjs', CGP_MODULE_BLOB)
]);

function sharedRealm() {
  const timers = [];
  const realm = vm.createContext({
    URL,
    console: { error() {}, info() {}, warn() {}, log() {} },
    setTimeout: (callback, delay) => {
      const item = { callback, delay, cancelled: false };
      timers.push(item);
      return item;
    },
    clearTimeout: timer => { if (timer) timer.cancelled = true; }
  });
  return { realm, timers };
}

test('exact CGP2 receipt/reducer publishes newest incoming to exact AICC Core', async () => {
  const [classic, esm] = await exactPluginPromise;
  assert.equal(coreDependency.commit, CORE_COMMIT);
  const module = await import('data:text/javascript;base64,' +
    Buffer.from(esm, 'utf8').toString('base64'));
  assert.equal(module.HEARTBEAT_REDUCER_API_VERSION, 1);
  assert.equal(module.RECEIPT_OBSERVATION_VERSION, 1);

  const { realm, timers } = sharedRealm();
  vm.runInContext(coreBundle, realm);
  const core = realm.AIConversationCore;
  assert.equal(core.getVersion(), '1.1.2-issue.132.5');
  const inventories = [];
  const stopInventory = core.observeAgentPluginRegistrations(items => {
    inventories.push(Array.from(items, item => item.id));
  });
  vm.runInContext(classic, realm);
  assert.deepEqual(inventories, [[], ['chatgpt-web']]);
  assert.equal(timers.filter(item => item.delay === 100).length, 0,
    'Core-first plug-in must not poll its registration');
  const agent = core.createAgent('chatgpt-web').agent;
  assert.equal(agent.version().version, '0.1.2-issue.10.1');
  const observations = [];
  const stop = core.observeActivity(agent, item => {
    observations.push(item.latestIncomingAtMs);
  });
  assert.equal(core.activityState(agent).latestIncomingAtMs, null);

  const now = Date.now();
  const producer = module.createChatGPTReceiptIngress({ now: () => now - 5000 });
  const base = {
    direction: 'incoming', transport: 'fetch', phase: 'response_headers',
    page_instance_id: 'tab-a', network_sequence: 1, captured_at_mono_ms: 42,
    captured_at_epoch_ms: undefined, received_at_epoch_ms: undefined
  };
  const fallback = producer.capture(base);
  assert.equal(fallback.timestamp_ms, now - 5000);
  assert.equal(fallback.timestamp_origin, 'local_observation');
  assert.equal(agent.commTraffic({ type: 'server_receipt', receipt: fallback }), null);
  assert.equal(core.activityState(agent).latestIncomingAtMs, now - 5000);

  const supplied = producer.capture({
    ...base, network_sequence: 2, received_at_epoch_ms: now - 3000
  });
  assert.equal(supplied.timestamp_origin, 'source');
  agent.commTraffic({ type: 'server_receipt', receipt: supplied });
  assert.equal(core.activityState(agent).latestIncomingAtMs, now - 3000);
  agent.commTraffic({ type: 'server_receipt', receipt: fallback });
  assert.equal(core.activityState(agent).latestIncomingAtMs, now - 3000,
    'delayed older receipt must not regress Last');
  assert.equal(producer.capture({ ...base, network_sequence: 3,
    direction: 'outgoing' }), null, 'outgoing traffic must not count');
  agent.commTraffic({
    type: 'received_json_entry', version: 1,
    timestamp_ms: now - 1000, clock_domain: 'unix_epoch_ms'
  });
  assert.equal(core.activityState(agent).latestIncomingAtMs, now - 1000);
  assert.deepEqual(observations, [null, now - 5000, now - 3000, now - 1000]);
  stop();
  stopInventory();
  assert.equal(core.disposeActivity(agent), true);
});

test('plugin-first registration recovers on the shared Core without a second plugin', async () => {
  const [classic] = await exactPluginPromise;
  const { realm, timers } = sharedRealm();
  vm.runInContext(classic, realm);
  assert.equal(timers.filter(item => item.delay === 100).length, 1);
  vm.runInContext(coreBundle, realm);
  const core = realm.AIConversationCore;
  const inventories = [];
  core.observeAgentPluginRegistrations(items =>
    inventories.push(Array.from(items, item => item.id)));
  assert.deepEqual(inventories, [[]]);
  for (const timer of timers.filter(item => item.delay === 100 && !item.cancelled)) {
    timer.callback();
  }
  assert.deepEqual(inventories, [[], ['chatgpt-web']]);
  assert.equal(core.listAgentPlugins().length, 1);
  assert.equal(core.createAgent('chatgpt-web').agent.version().plugin, 'chatgpt-web');
});
