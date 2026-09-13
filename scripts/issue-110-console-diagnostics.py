from pathlib import Path


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


root = Path('.')
script_path = root / 'chatgpt-conversation-markdown-export.user.js'
text = script_path.read_text(encoding='utf-8')

text = replace_once(text, '// @version      0.6.176', '// @version      0.6.177', 'version')
text = replace_once(
  text,
  "  console.log(`[DownloadConversation] version ${VERSION}`);\n",
  '',
  'direct startup version log'
)
text = replace_once(
  text,
  "  /** Session-storage key for the retained recorder diagnostic log. */\n"
  "  const DIAGNOSTIC_LOG_STORAGE_KEY = 'tm-conversation-recorder-diagnostic-log';",
  "  /** Local-storage key for continued console mirroring after the status panel first appears. */\n"
  "  const CONSOLE_DIAGNOSTICS_STORAGE_KEY = 'tm-conversation-recorder-console-diagnostics';\n"
  "  /** Session-storage key for the retained recorder diagnostic log. */\n"
  "  const DIAGNOSTIC_LOG_STORAGE_KEY = 'tm-conversation-recorder-diagnostic-log';",
  'console storage key'
)
text = replace_once(
  text,
  "  /** Currently selected diagnostic threshold, restored from local storage at startup. */\n"
  "  let diagnosticsLevel = localStorage.getItem('tm-conversation-recorder-diagnostics') || DEFAULT_DIAGNOSTICS;",
  "  /** Currently selected diagnostic threshold, restored from local storage at startup. */\n"
  "  let diagnosticsLevel = localStorage.getItem('tm-conversation-recorder-diagnostics') || DEFAULT_DIAGNOSTICS;\n"
  "  /** Saved opt-in for console output after startup; independent of panel diagnostic verbosity. */\n"
  "  let consoleDiagnostics = localStorage.getItem(CONSOLE_DIAGNOSTICS_STORAGE_KEY) === 'true';\n"
  "  /** One-way startup boundary: hiding or reopening the panel does not restore automatic console output. */\n"
  "  let generalStatusShown = false;",
  'console state'
)
text = replace_once(
  text,
  "  } catch {}\n\n"
  "  /**\n"
  "   * Handles assert.",
  "  } catch {}\n\n"
  "  logConsoleDiagnostic('debug', `[DownloadConversation] version ${VERSION}`);\n\n"
  "  /**\n"
  "   * Handles assert.",
  'startup version gate'
)

old_logging = """  /**
   * Logs diagnostic.
   *
   * @param {Object} level - The diagnostics severity level.
   * @param {string} message - The assertion failure message.
   * @param {Object|null} data - The data value required by this function.
   * @returns {void} No value is returned.
   */
  function logDiagnostic(level, message, data = null) {
    if (!diagnosticEnabled(level)) return;
    const safeData = redactDiagnosticSignedTokens(data);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: safeData
    };
    diagnosticLog.push(entry);
    if (diagnosticLog.length > MAX_DIAGNOSTIC_LOG_ITEMS) {
      diagnosticLog.splice(0, diagnosticLog.length - MAX_DIAGNOSTIC_LOG_ITEMS);
    }
    schedulePersistDiagnosticLog();
    refreshDiagnosticLog();

    const args = [`[ChatGPT Recorder ${level}] ${message}`];
    if (safeData !== null) args.push(safeData);
    (level === 'errors' ? console.error : level === 'warnings' ? console.warn : console.log)(...args);
  }
"""
new_logging = """  /**
   * Writes recorder diagnostics to DevTools during startup or when continued console output is enabled.
   *
   * This gate is independent of the panel's severity filter and covers direct lifecycle messages too.
   *
   * @param {'errors'|'warnings'|'debug'|'verbose'} level - Severity selecting the DevTools console method.
   * @param {string} message - Console message, including its recorder prefix.
   * @param {Object|null} data - Diagnostic payload redacted before console output.
   * @returns {void} No value is returned.
   */
  function logConsoleDiagnostic(level, message, data = null) {
    if (generalStatusShown && !consoleDiagnostics) return;
    const args = [redactDiagnosticSignedTokens(message)];
    if (data !== null) args.push(redactDiagnosticSignedTokens(data));
    (level === 'errors' ? console.error : level === 'warnings' ? console.warn : console.log)(...args);
  }

  /**
   * Mirrors diagnostics through the console gate, then retains entries accepted by the panel filter.
   *
   * @param {Object} level - The diagnostics severity level.
   * @param {string} message - The assertion failure message.
   * @param {Object|null} data - The data value required by this function.
   * @returns {void} No value is returned.
   */
  function logDiagnostic(level, message, data = null) {
    logConsoleDiagnostic(level, `[ChatGPT Recorder ${level}] ${message}`, data);
    if (!diagnosticEnabled(level)) return;
    const safeData = redactDiagnosticSignedTokens(data);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: safeData
    };
    diagnosticLog.push(entry);
    if (diagnosticLog.length > MAX_DIAGNOSTIC_LOG_ITEMS) {
      diagnosticLog.splice(0, diagnosticLog.length - MAX_DIAGNOSTIC_LOG_ITEMS);
    }
    schedulePersistDiagnosticLog();
    refreshDiagnosticLog();
  }
"""
text = replace_once(text, old_logging, new_logging, 'diagnostic logging')

text = text.replace('console.log(', "logConsoleDiagnostic('debug', ")
text = text.replace('console.warn(', "logConsoleDiagnostic('warnings', ")
text = text.replace("'debug', \n", "'debug',\n")
text = text.replace("'warnings', \n", "'warnings',\n")

text = replace_once(
  text,
  "      if (panel) panel.style.display = 'block';\n"
  "      updateUi();",
  "      if (panel) panel.style.display = 'block';\n"
  "      updateUi();\n"
  "      if (panel && !generalStatusShown) {\n"
  "        logDiagnostic('debug', 'general-status-shown', { script_version: VERSION, console_enabled: consoleDiagnostics });\n"
  "        generalStatusShown = true;\n"
  "      }",
  'first status display boundary'
)
text = replace_once(
  text,
  "  function makePanel() {\n"
  "    if (document.getElementById(PANEL_ID) || !document.body) return;\n"
  "    injectStyles();",
  "  function makePanel() {\n"
  "    if (document.getElementById(PANEL_ID) || !document.body) return;\n"
  "    logDiagnostic('debug', 'recorder-panel-create-start', { script_version: VERSION });\n"
  "    injectStyles();",
  'panel create start'
)
text = replace_once(
  text,
  '<div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><button data-role="test" type="button">Test</button></div>',
  '<div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><label><input data-role="console-diagnostics" type="checkbox"> console</label><button data-role="test" type="button">Test</button></div>',
  'console checkbox UI'
)
text = replace_once(
  text,
  '<div class="tm-row tm-md-metadata"><span class="tm-label">MD headings</span><label><input data-role="show-timestamps" type="checkbox"> Timestamp</label><label><input data-role="show-record-numbers" type="checkbox"> Record #</label><label><input data-role="show-turn-ids" type="checkbox"> Turn ID</label><label><input data-role="show-debug-provenance" type="checkbox"> Debug</label></div>',
  '<div class="tm-row tm-md-metadata"><span class="tm-label">MD headings</span><label><input data-role="show-timestamps" type="checkbox"> Timestamp</label><label><input data-role="show-record-numbers" type="checkbox"> Record #</label><label><input data-role="show-turn-ids" type="checkbox"> Turn ID</label><label><input data-role="show-debug-provenance" type="checkbox"> provenance</label></div>',
  'provenance label'
)
text = replace_once(
  text,
  "    const copyLogButton = panel.querySelector('[data-role=\"copy-log\"]');",
  "    const consoleOutput = panel.querySelector('[data-role=\"console-diagnostics\"]');\n"
  "    consoleOutput.checked = consoleDiagnostics;\n"
  "    consoleOutput.addEventListener('change', () => {\n"
  "      consoleDiagnostics = consoleOutput.checked;\n"
  "      localStorage.setItem(CONSOLE_DIAGNOSTICS_STORAGE_KEY, String(consoleDiagnostics));\n"
  "      logDiagnostic('debug', 'console-diagnostics-changed', { enabled: consoleDiagnostics });\n"
  "    });\n"
  "    const copyLogButton = panel.querySelector('[data-role=\"copy-log\"]');",
  'console checkbox listener'
)
text = replace_once(
  text,
  "    document.body.append(panel);\n"
  "    updateUi();\n"
  "    refreshDiagnosticLog();",
  "    document.body.append(panel);\n"
  "    updateUi();\n"
  "    refreshDiagnosticLog();\n"
  "    logDiagnostic('debug', 'recorder-panel-created', { script_version: VERSION });",
  'panel created diagnostic'
)
text = replace_once(
  text,
  "   * Lightweight lifecycle logging stays enabled permanently.  Expensive topology and DOM-method\n"
  "   * instrumentation remains available behind `DEEP_LAUNCHER_DIAGNOSTICS` for future regressions.",
  "   * Lifecycle console output follows the startup/saved-option gate.  Expensive topology and DOM-method\n"
  "   * instrumentation remains available behind `DEEP_LAUNCHER_DIAGNOSTICS` for future regressions.",
  'bootstrap documentation'
)
script_path.write_text(text, encoding='utf-8')

# Keep inherited version/label assertions aligned with the production change.
heading_path = root / 'tests/heading-metadata-controls.test.mjs'
heading = heading_path.read_text(encoding='utf-8')
heading = replace_once(heading, '0\\.6\\.176', '0\\.6\\.177', 'heading version')
heading = replace_once(
  heading,
  'data-role="show-debug-provenance" type="checkbox"> Debug/',
  'data-role="show-debug-provenance" type="checkbox"> provenance/',
  'heading provenance label'
)
heading_path.write_text(heading, encoding='utf-8')

sediment_path = root / 'tests/sediment-resolver.test.mjs'
sediment = sediment_path.read_text(encoding='utf-8')
sediment = replace_once(
  sediment,
  "test('userscript version advances for issue 102 single-snapshot export', () => {\n"
  "  assert.match(userscript, /\\/\\/ @version      0\\.6\\.176/);\n"
  "});",
  "test('userscript version advances for issue 110 console controls', () => {\n"
  "  assert.match(userscript, /\\/\\/ @version      0\\.6\\.177/);\n"
  "});",
  'sediment version test'
)
sediment_path.write_text(sediment, encoding='utf-8')

tool_path = root / 'tests/tool-language-diagnostics.test.mjs'
tool = tool_path.read_text(encoding='utf-8')
tool = replace_once(
  tool,
  '  assert.match(userscript, /args\\.push\\(safeData\\)/);',
  '  assert.match(userscript, /args\\.push\\(redactDiagnosticSignedTokens\\(data\\)\\)/);',
  'console redaction assertion'
)
tool_path.write_text(tool, encoding='utf-8')

focused_path = root / 'tests/console-diagnostics.test.mjs'
focused_path.write_text("""import assert from 'node:assert/strict';
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
""", encoding='utf-8')

ci_path = root / '.github/workflows/ci.yml'
ci = ci_path.read_text(encoding='utf-8')
ci = replace_once(
  ci,
  "      - name: Single-snapshot export regression\n"
  "        run: node --test tests/export-single-snapshot.test.mjs\n",
  "      - name: Single-snapshot export regression\n"
  "        run: node --test tests/export-single-snapshot.test.mjs\n"
  "      - name: Console lifecycle and provenance controls\n"
  "        run: node --test tests/console-diagnostics.test.mjs\n",
  'permanent CI regression'
)
ci_path.write_text(ci, encoding='utf-8')

design_path = root / 'DESIGN.md'
design = design_path.read_text(encoding='utf-8')
design = replace_once(design, '- **Debug**: Core derives source debug provenance', '- **provenance**: Core derives source debug provenance', 'design label')
design = replace_once(design, 'then Turn ID; when Debug\nis enabled', 'then Turn ID; when provenance\nis enabled', 'design heading order')
design = replace_once(design, 'debug provenance itself. The Debug export checkbox', 'debug provenance itself. The provenance export checkbox', 'design independence')
console_design = """## Startup and saved console diagnostics

Recorder diagnostics mirror to DevTools automatically from document startup until
the general status panel is first shown. Creating that panel while it is hidden
does not end startup logging. Once shown, console output depends only on the
persistent checkbox labelled **console** on the panel; its default is unchecked.
Closing, hiding, reopening, or recreating the panel does not restart automatic
startup output. Reloading the page starts a new startup interval, even when the
saved checkbox is off.

The console gate covers both ordinary recorder diagnostics and existing direct
launcher/lifecycle messages. Console mirroring occurs before the panel diagnostic
severity filter, so it remains available at every selected panel verbosity during
startup or while console is checked. Signed-token redaction still occurs before
console output. Panel retention, persistence and filtering keep their existing
behaviour. The checkbox does not enable invasive launcher instrumentation.

The MD headings checkbox is labelled **provenance** to distinguish it from
diagnostic verbosity **Debug**. Its existing storage key and AIConversationCore
`debugProvenance` option are preserved, including the saved selection. This label
change does not alter exported provenance or any other rendering semantics.

"""
design = replace_once(
  design,
  '## Image recovery and export performance diagnostics\n',
  console_design + '## Image recovery and export performance diagnostics\n',
  'design console section'
)
design_path.write_text(design, encoding='utf-8')
