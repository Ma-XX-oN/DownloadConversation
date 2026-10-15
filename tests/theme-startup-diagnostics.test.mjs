import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/userscript/07-panel-launcher/05-bootstrap.js', import.meta.url), 'utf8');
const start = source.indexOf('  function installThemeStartupDiagnostics() {');
const end = source.indexOf('\n  installThemeStartupDiagnostics();', start);
test('theme observer records bounded transitions without polling or subtree observation', () => {
  assert.ok(start >= 0 && end > start);
  const observer = source.slice(start, end);
  assert.match(observer, /theme-startup-snapshot/);
  assert.match(observer, /prefers-color-scheme: dark/);
  assert.match(observer, /html_background: background\(html\)/);
  assert.match(observer, /body_background: background\(body\)/);
  assert.match(observer, /app_background: background\(app\)/);
  assert.match(observer, /body_replaced:/);
  assert.match(observer, /attributeFilter: \['class', 'style', 'data-theme', 'data-appearance-theme'\]/);
  assert.match(observer, /htmlObserver\.disconnect\(\)/);
  assert.match(observer, /bodyObserver\?\.disconnect\(\)/);
  assert.doesNotMatch(observer, /setInterval|setTimeout|subtree:\s*true|childList:\s*true/);
});

test('direct root theme attribute writes are traced without changing native results', () => {
  const observer = source.slice(start, end);
  assert.match(observer, /Element\.prototype\.setAttribute = tracedSetAttribute/);
  assert.match(observer, /Element\.prototype\.removeAttribute = tracedRemoveAttribute/);
  assert.match(observer, /this !== document\.documentElement/);
  assert.match(observer, /theme-attribute-writer/);
  assert.match(observer, /Reflect\.apply\(nativeSetAttribute, this, \[name, value\]\)/);
  assert.match(observer, /Reflect\.apply\(nativeRemoveAttribute, this, \[name\]\)/);
  assert.match(observer, /Element\.prototype\.setAttribute = nativeSetAttribute/);
  assert.match(observer, /Element\.prototype\.removeAttribute = nativeRemoveAttribute/);
});
