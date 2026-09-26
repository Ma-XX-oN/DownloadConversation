import {
  downloadConversationSource,
  productionFunctionSource
} from './helpers/userscript-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

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
  vm.runInContext(`${redactorSource}\n${consoleSource}\nthis.emit = logConsoleDiagnostic;`, context);
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
  assert.equal((downloadConversationSource.match(/generalStatusShown = true/g) ?? []).length, 1);
});

test('console checkbox controls continued mirroring independently and persists', () => {
  assert.match(downloadConversationSource, /data-role="console-diagnostics" type="checkbox"> console/);
  assert.match(downloadConversationSource, /consoleDiagnostics = localStorage\.getItem\(CONSOLE_DIAGNOSTICS_STORAGE_KEY\) === 'true'/);
  assert.match(downloadConversationSource, /consoleOutput\.checked = consoleDiagnostics/);
  assert.match(downloadConversationSource, /consoleDiagnostics = consoleOutput\.checked/);
  assert.match(downloadConversationSource, /localStorage\.setItem\(CONSOLE_DIAGNOSTICS_STORAGE_KEY, String\(consoleDiagnostics\)\)/);
  assert.doesNotMatch(downloadConversationSource, /diagnosticsLevel = consoleDiagnostics|consoleDiagnostics = diagnosticsLevel/);
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
  const withoutHelper = downloadConversationSource.replace(helper, '');
  assert.doesNotMatch(withoutHelper, /console\.(?:log|warn|error)\s*\(/,
    'Direct recorder console calls must not bypass logConsoleDiagnostic.');
  assert.match(downloadConversationSource, /logConsoleDiagnostic\('debug', `\[DownloadConversation v\$\{VERSION\} \| AIConversationCore v\$\{CORE_VERSION\}\] bootstrap`/);
});

test('provenance is only a label change; Core preference and diagnostic Debug remain independent', () => {
  assert.match(downloadConversationSource, /data-role="show-debug-provenance" type="checkbox"> provenance/);
  assert.match(downloadConversationSource, /showDebugProvenance = localStorage\.getItem\(SHOW_DEBUG_PROVENANCE_STORAGE_KEY\) === 'true'/);
  assert.match(downloadConversationSource, /debugProvenance: showDebugProvenance/);
  assert.match(downloadConversationSource, /<option value="debug">Debug<\/option>/);
  assert.doesNotMatch(downloadConversationSource, /data-role="show-debug-provenance" type="checkbox"> Debug/);
});


test('Issue 166 Copy and Save share one canonical diagnostic serialization', () => {
  const canonical = productionFunctionSource('diagnosticLogText');
  assert.match(canonical, /diagnosticLog\.map\(diagnosticLogLine\)\.join\('\\n'\)/);
  const copy = productionFunctionSource('copyDiagnosticLog');
  const save = productionFunctionSource('saveDiagnosticLog');
  assert.match(copy, /diagnosticLogText\(\)/);
  assert.match(save, /diagnosticLogText\(\)/);
  assert.match(save, /create7zArchive/);
  assert.match(save, /downloadBlob/);
});

test('Issue 166 diagnostic Save has explicit empty and busy behaviour', () => {
  const save = productionFunctionSource('saveDiagnosticLog');
  assert.match(save, /if \(!text\) return/);
  assert.match(save, /disabled\s*=\s*true/);
  assert.match(save, /finally/);
  assert.match(save, /disabled\s*=\s*false/);
});
