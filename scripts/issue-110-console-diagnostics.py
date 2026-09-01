from pathlib import Path


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


root = Path('.')
path = root / 'chatgpt-conversation-markdown-export.user.js'
text = path.read_text(encoding='utf-8')

text = replace_once(text, '// @version      0.6.152', '// @version      0.6.153', 'version')
text = replace_once(
  text,
  "  /** Session-storage key for the retained recorder diagnostic log. */\n  const DIAGNOSTIC_LOG_STORAGE_KEY",
  "  /** Local-storage key controlling DevTools console diagnostic output. */\n  const CONSOLE_DIAGNOSTICS_STORAGE_KEY = 'tm-conversation-recorder-console-diagnostics';\n  /** Session-storage key for the retained recorder diagnostic log. */\n  const DIAGNOSTIC_LOG_STORAGE_KEY",
  'console diagnostics storage key')
text = replace_once(
  text,
  "  /** Whether active exports should request a screen wake lock. */\n  let screenOnWhenCapturing",
  "  /** Whether diagnostics should also be mirrored to the DevTools console. */\n  let consoleDiagnostics = localStorage.getItem(CONSOLE_DIAGNOSTICS_STORAGE_KEY) !== 'false';\n  /** Whether active exports should request a screen wake lock. */\n  let screenOnWhenCapturing",
  'console diagnostics state')

old = """  function logDiagnostic(level, message, data = null) {
    if (!diagnosticEnabled(level)) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };
    diagnosticLog.push(entry);
    if (diagnosticLog.length > MAX_DIAGNOSTIC_LOG_ITEMS) {
      diagnosticLog.splice(0, diagnosticLog.length - MAX_DIAGNOSTIC_LOG_ITEMS);
    }
    persistDiagnosticLog();
    refreshDiagnosticLog();
  }
"""
new = """  function logDiagnostic(level, message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };
    if (consoleDiagnostics) {
      const method = level === 'errors' ? 'error' : level === 'warnings' ? 'warn' :
        level === 'debug' ? 'debug' : 'log';
      const prefix = `[DownloadConversation ${VERSION}] ${entry.timestamp} ${level} ${message}`;
      if (data === null || data === undefined) console[method](prefix);
      else console[method](prefix, data);
    }
    if (!diagnosticEnabled(level)) return;
    diagnosticLog.push(entry);
    if (diagnosticLog.length > MAX_DIAGNOSTIC_LOG_ITEMS) {
      diagnosticLog.splice(0, diagnosticLog.length - MAX_DIAGNOSTIC_LOG_ITEMS);
    }
    persistDiagnosticLog();
    refreshDiagnosticLog();
  }
"""
text = replace_once(text, old, new, 'logDiagnostic')

text = replace_once(
  text,
  '<div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><button data-role="test" type="button">Test</button></div>',
  '<div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><label><input data-role="console-diagnostics" type="checkbox"> Console</label><button data-role="test" type="button">Test</button></div>',
  'diagnostics row')

text = replace_once(
  text,
  "    const diagnostics = panel.querySelector('[data-role=\"diagnostics\"]');\n    diagnostics.value = diagnosticsLevel;",
  "    const diagnostics = panel.querySelector('[data-role=\"diagnostics\"]');\n    const consoleOutput = panel.querySelector('[data-role=\"console-diagnostics\"]');\n    diagnostics.value = diagnosticsLevel;",
  'console query')
text = replace_once(
  text,
  "    const copyLogButton = panel.querySelector('[data-role=\"copy-log\"]');",
  "    if (consoleOutput) {\n      consoleOutput.checked = consoleDiagnostics;\n      consoleOutput.addEventListener('change', () => {\n        consoleDiagnostics = consoleOutput.checked;\n        localStorage.setItem(CONSOLE_DIAGNOSTICS_STORAGE_KEY, String(consoleDiagnostics));\n        logDiagnostic('debug', 'console-diagnostics-changed', { enabled: consoleDiagnostics });\n      });\n    }\n    const copyLogButton = panel.querySelector('[data-role=\"copy-log\"]');",
  'console listener')

text = replace_once(
  text,
  "  function makePanel() {\n    if (document.getElementById(PANEL_ID) || !document.body) return;",
  "  function makePanel() {\n    if (document.getElementById(PANEL_ID) || !document.body) return;\n    logDiagnostic('verbose', 'recorder-panel-create-start', { body_connected: document.body.isConnected });",
  'panel create start')
text = replace_once(
  text,
  "  function bootstrapUi() {\n    if (document.body) {",
  "  function bootstrapUi() {\n    logDiagnostic('verbose', 'recorder-bootstrap-ui', { body_present: Boolean(document.body), ready_state: document.readyState });\n    if (document.body) {",
  'bootstrap log')

path.write_text(text, encoding='utf-8')

panel_test = root / 'tests/recorder-panel-ui.test.mjs'
panel = panel_test.read_text(encoding='utf-8')
panel = replace_once(
  panel,
  "  assert.match(userscript, /data-role=\"show-turn-ids\" type=\"checkbox\"> Turn ID/);",
  "  assert.match(userscript, /data-role=\"show-turn-ids\" type=\"checkbox\"> Turn ID/);\n  assert.match(userscript, /data-role=\"console-diagnostics\" type=\"checkbox\"> Console/);\n  assert.match(userscript, /CONSOLE_DIAGNOSTICS_STORAGE_KEY/);\n  assert.match(userscript, /consoleDiagnostics = localStorage\\.getItem\\(CONSOLE_DIAGNOSTICS_STORAGE_KEY\\) !== 'false'/);",
  'panel test console')
panel_test.write_text(panel, encoding='utf-8')

focused = root / 'tests/console-diagnostics.test.mjs'
focused.write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('console diagnostics are enabled by default and independent of panel threshold', () => {
  assert.match(userscript, /\/\/ @version      0\\.6\\.153/);
  assert.match(userscript, /consoleDiagnostics = localStorage\\.getItem\\(CONSOLE_DIAGNOSTICS_STORAGE_KEY\\) !== 'false'/);
  const start = userscript.indexOf('  function logDiagnostic(');
  const end = userscript.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start);
  const body = userscript.slice(start, end + 4);
  assert.ok(body.indexOf('if (consoleDiagnostics)') < body.indexOf('if (!diagnosticEnabled(level)) return;'),
    'Console mirroring must occur before panel-threshold filtering.');
  assert.match(body, /\[DownloadConversation \\${VERSION}\]/);
  assert.match(body, /console\[method\]\(prefix, data\)/);
});

test('startup lifecycle emits console-visible bootstrap diagnostics', () => {
  assert.match(userscript, /recorder-bootstrap-ui/);
  assert.match(userscript, /recorder-panel-create-start/);
});
""", encoding='utf-8')
