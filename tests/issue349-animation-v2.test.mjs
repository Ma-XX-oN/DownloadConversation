import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { pulseFrameForSlot } from '../src/favicon/browser-sequence.mjs';
import { functionSourceFrom } from './helpers/userscript-source.mjs';

const load = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const consumer = load('src/userscript/03-agent-lifecycle/02-favicon-cached-lookup.js');
const adapter = load('src/userscript/03-agent-lifecycle/02-favicon-v2-adapter.js');
const provider = load('src/favicon/browser-sequence.mjs');
const cache = load('src/userscript/03-agent-lifecycle/03-favicon-cache-v2.js');
const session = load('src/userscript/03-agent-lifecycle/03-favicon-cache-v2-part2.js');
const header = load('src/userscript-header.js');
const guide = load('docs/FAVICON_ANIMATION_GUIDE.md');

function isolated(name, globals = '') {
  const context = vm.createContext({});
  vm.runInContext(globals + '\n' + functionSourceFrom(consumer, name) +
    '\nthis.selected = ' + name + ';', context);
  return context.selected;
}

test('independent 2.1.0 animation is not selected from userscript build', () => {
  assert.match(adapter, /FAVICON_ANIMATION_VERSION = '2\.1\.0'/);
  assert.match(adapter, /update_every_ms: 1000/);
  assert.match(consumer, /get_compatible_version_key\(FAVICON_ANIMATION_VERSION\)/);
  assert.doesNotMatch(consumer, /get_compatible_version_key\(VERSION\)/);
  const build = /@version\s+(\d+\.\d+\.\d+(?:-issue\.\d+\.\d+)?)/.exec(header)?.[1];
  assert.ok(build, 'the userscript build retains its independent version');
  assert.notEqual(build, '2.1.0');
});

test('one-second slot changes are selected inside unchanged public get_favicon', () => {
  const select = isolated('agentFaviconPulseIndex',
    'const AGENT_FAVICON_PULSE_PERIOD_MS = 2000;');
  for (let i = 0; i < 12; i++) {
    assert.equal(select(i * 1000), i % 2);
    assert.equal(pulseFrameForSlot(i), i % 2);
  }
  assert.equal(select(999), 0);
  assert.equal(select(1000), 1);
  assert.equal(select(1999), 1);
  assert.equal(select(2000), 0);
  assert.equal(select(-1), 1);
  assert.equal(select(-1000), 1);
  assert.equal(select(NaN), null);
  assert.match(consumer,
    /get_favicon\(version_key, base_type, completion_time, time_offset\)/);
});

test('SVG artwork is preferred consistently for all eligible favicon links', () => {
  const choose = isolated('agentFaviconPreferredSource');
  const png = { type: 'image/png',
    original_href: 'https://chatgpt.com/cdn/assets/favicon-48x48.png' };
  const light = { type: 'image/svg+xml',
    original_href: 'https://chatgpt.com/cdn/assets/favicon.abc.svg' };
  const dark = { type: 'image/svg+xml',
    original_href: 'https://chatgpt.com/cdn/assets/favicon-dark.abc.svg' };
  assert.equal(choose([png, light], 'dark'), light.original_href);
  assert.equal(choose([png, light, dark], 'light'), light.original_href);
  assert.equal(choose([png, light, dark], 'dark'), dark.original_href);
  assert.equal(choose([png], 'light'), png.original_href);
  assert.equal(choose([], 'dark'), null);
  assert.match(consumer, /candidates\.map\(candidate => \(\{ link: candidate\.link, href \}\)\)/);
});

test('renderer provides two whole-icon opacity frames without extra states', () => {
  assert.match(provider, /for \(let frame = 0; frame < 2; frame\+\+\)/);
  assert.match(provider, /const opacity = frame === 0 \? 1 : 0\.2/);
  assert.doesNotMatch(provider, /21 distinct pulse frames/);
});

test('shared cache validates and stores actual supplied frame count', () => {
  assert.match(cache, /frames\.length > FAVICON_SEQUENCE_MAX_FRAMES/);
  assert.match(cache, /pulse_index < frames\.length/);
  assert.match(cache, /ready: true, count: frames\.length/);
  assert.match(cache, /index >= meta\.count/);
  assert.match(session, /pulse_index >= FAVICON_SEQUENCE_MAX_FRAMES/);
  assert.match(cache, /FAVICON_SEQUENCE_TTL_MS = 600000/);
  assert.match(session, /mode: 'exclusive', ifAvailable: true/);
  assert.doesNotMatch(cache, /meta\.count !== 21|count: 21/);
  assert.doesNotMatch(session, /pulse_index > 20/);
});

test('future-extension guide retains historical versions without migration', () => {
  assert.match(guide, /\`1\.11\.8\`/);
  assert.match(guide, /\`2\.0\.0\`/);
  assert.match(guide, /no conversion or cross-animation backward compatibility/i);
  assert.match(guide, /600000 ms/);
  assert.match(guide, /network checks/);
});
