import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

function productionFunctionSource(name) {
  const start = userscript.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Production function ${name} is missing.`);
  const functionStart = start + 2;
  const brace = userscript.indexOf('{', functionStart);
  assert.ok(brace > functionStart, `Production function ${name} has no body.`);
  let depth = 0;
  for (let index = brace; index < userscript.length; index += 1) {
    if (userscript[index] === '{') depth += 1;
    else if (userscript[index] === '}') {
      depth -= 1;
      if (depth === 0) return userscript.slice(functionStart, index + 1);
    }
  }
  throw new Error(`Production function ${name} has an unterminated body.`);
}

const redactorSource = productionFunctionSource('redactDiagnosticSignedTokens');
const consoleSource = productionFunctionSource('logConsoleDiagnostic');

function consoleCalls({ shown, enabled, level = 'debug', message = 'message', data = null }) {
  const calls = [];
  const context = {
    generalStatusShown: shown,
    consoleDiagnostics: enabled,
    console: {
      log: (...args) => calls.push(['log', args]),
      warn: (...args) => calls.push(['warn', args]),
      error: (...args) => calls.push(['error', args])
    }
  };
  vm.createContext(context);
  vm.runInContext(`${redactorSource}
${consoleSource}
this.emit = logConsoleDiagnostic;`, context);
  context.emit(level, message, data);
  return calls;
}

test('startup console bypasses saved console=false and panel filtering', () => {
  assert.equal(consoleCalls({ shown: false, enabled: false }).length, 1);
  const diagnostic = productionFunctionSource('logDiagnostic');
  assert.ok(
    diagnostic.indexOf('logConsoleDiagnostic(') < diagnostic.indexOf('if (!diagnosticEnabled(level)) return;'),
    'Console mirroring must occur before panel severity filtering.'
  );
});

test('startup console also emits with saved console=true', () => {
  assert.equal(consoleCalls({ shown: false, enabled: true }).length, 1);
});

test('after first status display, saved console option alone controls mirroring', () => {
  assert.equal(consoleCalls({ shown: true, enabled: false }).length, 0);
  assert.equal(consoleCalls({ shown: true, enabled: true }).length, 1);
});

test('hidden panel creation does not end startup; first display is a one-way boundary', () => {
  const panel = productionFunctionSource('makePanel');
  const launcher = productionFunctionSource('makeLauncher');
  assert.doesNotMatch(panel, /generalStatusShown\s*=\s*true/);
  assert.match(launcher, /if \(panel && !generalStatusShown\) \{/);
  assert.match(launcher, /logDiagnostic\('debug', 'general-status-shown'/);
  assert.match(launcher, /generalStatusShown = true/);
  assert.equal((userscript.match(/generalStatusShown = true/g) ?? []).length, 1);
});

test('console checkbox controls continued mirroring independently and persists', () => {
  assert.match(userscript, /data-role="console-diagnostics" type="checkbox"> console/);
  assert.match(userscript, /consoleDiagnostics = localStorage\.getItem\(CONSOLE_DIAGNOSTICS_STORAGE_KEY\) === 'true'/);
  assert.match(userscript, /consoleOutput\.checked = consoleDiagnostics/);
  assert.match(userscript, /consoleDiagnostics = consoleOutput\.checked/);
  assert.match(userscript, /localStorage\.setItem\(CONSOLE_DIAGNOSTICS_STORAGE_KEY, String\(consoleDiagnostics\)\)/);
  assert.doesNotMatch(userscript, /diagnosticsLevel = consoleDiagnostics|consoleDiagnostics = diagnosticsLevel/);
});

test('startup and saved-on console output redact tokens before emission', () => {
  const calls = consoleCalls({
    shown: false,
    enabled: false,
    message: 'https://example.invalid/file?sig=SECRET',
    data: 'https://example.invalid/file?signature=SECRET2'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][0], 'https://example.invalid/file?sig=[redacted]');
  assert.equal(calls[0][1][1], 'https://example.invalid/file?signature=[redacted]');
  const continued = consoleCalls({
    shown: true,
    enabled: true,
    message: 'https://example.invalid/file?sig=SECRET'
  });
  assert.equal(continued[0][1][0], 'https://example.invalid/file?sig=[redacted]');
});

test('all direct recorder console calls use the shared lifecycle gate', () => {
  const helper = `  ${consoleSource}`;
  const withoutHelper = userscript.replace(helper, '');
  assert.doesNotMatch(withoutHelper, /console\.(?:log|warn|error)\s*\(/,
    'Direct recorder console calls must not bypass logConsoleDiagnostic.');
  assert.match(userscript, /logConsoleDiagnostic\('debug', `\[DownloadConversation v\$\{VERSION\}\] bootstrap`/);
});

test('provenance is only a label change; Core preference and diagnostic Debug remain independent', () => {
  assert.match(userscript, /\/\/ @version      0\.6\.177/);
  assert.match(userscript, /data-role="show-debug-provenance" type="checkbox"> provenance/);
  assert.match(userscript, /showDebugProvenance = localStorage\.getItem\(SHOW_DEBUG_PROVENANCE_STORAGE_KEY\) === 'true'/);
  assert.match(userscript, /debugProvenance: showDebugProvenance/);
  assert.match(userscript, /<option value="debug">Debug<\/option>/);
  assert.doesNotMatch(userscript, /data-role="show-debug-provenance" type="checkbox"> Debug/);
});
