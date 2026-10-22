import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const shim = readFileSync(new URL(
  '../src/userscript/03-agent-lifecycle/02-interm-subject-agent.js',
  import.meta.url), 'utf8');

function fixture(initial = 'RWF #701 - ACTIVE') {
  let title = initial, node = {}, pathname = '/c/a', errors = 0;
  const listeners = new Map(), watchers = [];
  const head = { querySelector() { return node; } };
  class Observer {
    constructor(fn) { this.fn = fn; watchers.push(this); }
    observe(element) { this.element = element; this.live = true; }
    disconnect() { this.live = false; }
  }
  const ctx = vm.createContext({
    MutationObserver: Observer,
    document: {
      head,
      get title() { return title; },
      addEventListener(type, fn) { listeners.set('document:' + type, fn); },
      removeEventListener(type) { listeners.delete('document:' + type); }
    },
    location: { get pathname() { return pathname; }, search: '' },
    window: {
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      navigation: {
        addEventListener(type, fn) { listeners.set('nav:' + type, fn); },
        removeEventListener(type) { listeners.delete('nav:' + type); }
      }
    },
    console: { error() { errors++; } }
  });
  vm.runInContext(shim + '\nthis.agent = interm_agent;', ctx);
  return {
    agent: ctx.agent, listeners, watchers,
    rename(next) {
      title = next;
      const observer = watchers.find(x => x.live && x.element === node);
      assert.ok(observer);
      observer.fn();
    },
    replace(next) {
      node = {};
      title = next;
      const observer = watchers.find(x => x.live && x.element === head);
      assert.ok(observer);
      observer.fn();
    },
    navigate(next) {
      pathname = next;
      listeners.get('nav:navigatesuccess')();
    },
    get errors() { return errors; }
  };
}

test('initial callback has exactly one immutable AICC V1-shaped snapshot', () => {
  const h = fixture(), messages = [];
  const unsub = h.agent.observeState(x => messages.push(x),
    'subject-identification');
  assert.equal(messages.length, 1);
  const item = messages[0];
  assert.equal(item.subject, 'subject-identification');
  assert.equal(item.readiness, 'unresolved');
  assert.equal(item.conversation.status, 'unresolved');
  assert.equal(item.conversation.id, null);
  assert.equal(item.conversation.name, 'RWF #701 - ACTIVE');
  assert.equal(item.project.status, 'unresolved');
  assert.equal(item.project.name, null);
  assert.ok(Object.isFrozen(item));
  assert.ok(Object.isFrozen(item.project));
  assert.ok(Object.isFrozen(item.conversation));
  unsub();
  unsub();
  assert.equal(h.watchers.filter(x => x.live).length, 0);
  assert.equal(h.listeners.size, 0);
});

test('renames notify synchronously exactly once, no duplicate events', () => {
  const h = fixture(), names = [];
  const unsubscribe = h.agent.observeState(x => names.push(x.conversation.name),
    'subject-identification');
  h.rename('RWF #701 - BLOCKED by RWF #109');
  h.rename('RWF #701 - BLOCKED by RWF #109');
  h.rename('RWF #701 - USER ACTION REQUIRED - ChatGPT');
  assert.deepEqual(names, ['RWF #701 - ACTIVE',
    'RWF #701 - BLOCKED by RWF #109',
    'RWF #701 - USER ACTION REQUIRED']);
  unsubscribe();
});

test('head title-node replacement is observed', () => {
  const h = fixture(), names = [];
  h.agent.observeState(x => names.push(x.conversation.name),
    'subject-identification');
  h.replace('RWF #702 - ACTIVE');
  h.rename('RWF #702 - DONE');
  assert.deepEqual(names, ['RWF #701 - ACTIVE',
    'RWF #702 - ACTIVE', 'RWF #702 - DONE']);
});

test('navigation invalidates stale title before a new title mutation', () => {
  const h = fixture(), names = [];
  h.agent.observeState(x => names.push(x.conversation.name),
    'subject-identification');
  h.navigate('/c/b');
  assert.equal(names.at(-1), null);
  h.rename('RWF #702 - ACTIVE');
  assert.equal(names.at(-1), 'RWF #702 - ACTIVE');
});

test('initial exceptions unregister; bad subject is rejected', () => {
  const h = fixture();
  assert.throws(() => h.agent.observeState(
    () => { throw new Error('expected'); }, 'subject-identification'), /expected/);
  assert.equal(h.watchers.filter(x => x.live).length, 0);
  assert.throws(() => h.agent.observeState(null, 'subject-identification'),
    { name: 'TypeError' });
  assert.throws(() => h.agent.observeState(() => {}, 'wrong'), { name: 'TypeError' });
  assert.equal(h.errors, 0);
});

test('code names the explicit DC #272/AICC #123 retirement gate', () => {
  assert.match(shim, /DC #272/);
  assert.match(shim, /AICC #123/);
  assert.match(shim, /DC #270/);
  assert.doesNotMatch(shim, /conversationTitle\(\)/);
});

