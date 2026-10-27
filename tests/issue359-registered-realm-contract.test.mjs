import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const header = readFileSync(new URL('../src/userscript-header.js',
  import.meta.url), 'utf8');
const bridge = readFileSync(new URL(
  '../src/userscript/04-conversation-rendering/08-agent-plugin-bridge.js',
  import.meta.url), 'utf8');

test('assembled recorder preserves released raw page realm without GM grants', () => {
  assert.match(header, /^\/\/ @sandbox\s+raw$/m);
  assert.match(header, /^\/\/ @grant\s+none$/m);
  assert.doesNotMatch(header, /^\/\/ @grant\s+GM_/m);
  assert.doesNotMatch(header, /^\/\/ @connect\s+/m);
});

test('Core registration uses pinned public recognize/create path', () => {
  assert.match(bridge, /core\.recognizeAgentPlugin\(/);
  assert.match(bridge, /core\.createAgent\(/);
  assert.doesNotMatch(bridge, /\bGM_xmlhttpRequest\b/);
  assert.doesNotMatch(bridge, /\bGM_getValue\b/);
  assert.doesNotMatch(bridge, /\bGM_setValue\b/);
});
