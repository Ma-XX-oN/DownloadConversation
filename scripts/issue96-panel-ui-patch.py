from pathlib import Path
import re

p = Path('chatgpt-conversation-markdown-export.user.js')
s = p.read_text(encoding='utf-8')

if s.count('// @version      0.6.137') != 1:
  raise SystemExit('Expected v0.6.137 exactly once')
s = s.replace('// @version      0.6.137', '// @version      0.6.138', 1)

# Shared UI state.
s = s.replace(
  "  let diagnosticLog = [];\n",
  "  let diagnosticLog = [];\n  let diagnosticLogExpanded = false;\n  let lastModalOpener = null;\n",
  1
)

# Test results stay in their dialog, not the general status area.
s = s.replace("      setStatus(currentTestStatusLines().join('\\n'));\n", "", 1)
s = s.replace("        setStatus(currentTestStatusLines().join('\\n'));\n", "", 1)

# Add reusable modal focus/keyboard contract before test-matrix close/open helpers.
needle = "  function closeTestMatrix() {\n"
modal_helpers = r'''  function modalFocusableElements(dialog) {
    return [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => element instanceof HTMLElement && !element.hidden && element.offsetParent !== null);
  }

  function installModalContract(overlay, { defaultButton = null, onClose = null, opener = null } = {}) {
    lastModalOpener = opener instanceof HTMLElement ? opener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = overlay.querySelector('[role="dialog"]');
    if (!(dialog instanceof HTMLElement)) return;
    const focusables = () => modalFocusableElements(dialog);
    const close = () => {
      if (typeof onClose === 'function') onClose();
      const restore = lastModalOpener;
      lastModalOpener = null;
      if (restore?.isConnected) restore.focus({ preventScroll: true });
    };
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (testInProgress) return;
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab') {
        const items = focusables();
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const current = document.activeElement;
        const index = items.indexOf(current);
        const next = event.shiftKey
          ? (index <= 0 ? items.length - 1 : index - 1)
          : (index < 0 || index === items.length - 1 ? 0 : index + 1);
        event.preventDefault();
        items[next].focus();
        return;
      }
      if (event.key === 'Enter') {
        if (document.activeElement instanceof HTMLTextAreaElement) return;
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement) return;
        const button = typeof defaultButton === 'function' ? defaultButton() : defaultButton;
        if (button instanceof HTMLButtonElement && !button.disabled) {
          event.preventDefault();
          button.click();
        }
      }
    });
    const initial = typeof defaultButton === 'function' ? defaultButton() : defaultButton;
    (initial instanceof HTMLElement ? initial : focusables()[0])?.focus({ preventScroll: true });
  }

'''
if needle not in s:
  raise SystemExit('Missing test-matrix close helper')
s = s.replace(needle, modal_helpers + needle, 1)

# Test matrix: use shared modal mechanism, pass opener, backdrop/close through shared close.
s = s.replace('  function openTestMatrix() {\n', '  function openTestMatrix(opener = null) {\n', 1)
s = s.replace(
  "      if (target === overlay || target.closest('[data-role=\"close-test-matrix\"]')) {\n        if (!testInProgress) closeTestMatrix();\n        return;\n      }\n",
  "      if (target === overlay || target.closest('[data-role=\"close-test-matrix\"]')) {\n        if (!testInProgress) { closeTestMatrix(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }\n        return;\n      }\n",
  1
)
s = s.replace(
  "    document.body.append(overlay);\n    refreshTestMatrix();\n    overlay.querySelector('[data-role=\"run-all-tests\"]')?.focus({ preventScroll: true });\n",
  "    document.body.append(overlay);\n    refreshTestMatrix();\n    installModalContract(overlay, {\n      defaultButton: () => overlay.querySelector('[data-role=\"run-all-tests\"]'),\n      onClose: closeTestMatrix,\n      opener\n    });\n",
  1
)

# Diagnostic log: rows, icon feedback, hide/show toggle.
start = s.index('  function refreshDiagnosticLog() {')
end = s.index('\n  function logDiagnostic', start)
log_block = r'''  function copyIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M15 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';
  }

  function checkIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7"></path></svg>';
  }

  function refreshDiagnosticLog() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const count = panel.querySelector('[data-role="log-count"]');
    const output = panel.querySelector('[data-role="log-output"]');
    const toggle = panel.querySelector('[data-role="toggle-log"]');
    if (count) count.textContent = `Log: ${diagnosticLog.length} item${diagnosticLog.length === 1 ? '' : 's'}`;
    if (output) {
      output.replaceChildren(...diagnosticLog.map(entry => {
        const row = document.createElement('div');
        row.className = 'tm-log-row';
        row.textContent = diagnosticLogLine(entry);
        return row;
      }));
      output.hidden = !diagnosticLogExpanded;
      output.scrollTop = output.scrollHeight;
    }
    if (toggle instanceof HTMLButtonElement) {
      toggle.textContent = diagnosticLogExpanded ? '−' : '+';
      toggle.setAttribute('aria-expanded', String(diagnosticLogExpanded));
      toggle.setAttribute('aria-label', diagnosticLogExpanded ? 'Hide diagnostic log' : 'Show diagnostic log');
      toggle.title = diagnosticLogExpanded ? 'Hide log' : 'Show log';
    }
  }

  async function copyDiagnosticLog() {
    const text = diagnosticLog.map(diagnosticLogLine).join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    const button = document.querySelector(`#${PANEL_ID} [data-role="copy-log"]`);
    if (!(button instanceof HTMLButtonElement)) return;
    button.innerHTML = checkIconMarkup();
    button.classList.add('tm-copy-confirmed');
    button.setAttribute('aria-label', 'Copied');
    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove('tm-copy-confirmed');
      button.innerHTML = copyIconMarkup();
      button.setAttribute('aria-label', 'Copy diagnostic log');
    }, 1000);
  }
'''
s = s[:start] + log_block + s[end:]

# Styles: replace panel/log/switch pieces and add extract format layout.
s = s.replace(
  "      #${PANEL_ID} .tm-log-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}\n      #${PANEL_ID} .tm-log-copy{padding:5px 9px}\n      #${PANEL_ID} .tm-log-output{margin:6px 0 0;max-height:190px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #555;border-radius:8px;background:#111;padding:8px;font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:#ddd}\n",
  "      #${PANEL_ID} .tm-log-head{display:flex;align-items:center;gap:6px;margin-top:4px}\n      #${PANEL_ID} .tm-log-head [data-role=\"log-count\"]{margin-right:auto}\n      #${PANEL_ID} .tm-icon-button{width:30px;height:28px;padding:4px;display:grid;place-items:center}\n      #${PANEL_ID} .tm-icon-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}\n      #${PANEL_ID} .tm-copy-confirmed{transition:opacity .2s ease}\n      #${PANEL_ID} .tm-log-output{margin:6px 0 10px;max-height:190px;overflow:auto;border:1px solid #555;border-radius:8px;background:#111;font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:#ddd}\n      #${PANEL_ID} .tm-log-row{padding:6px 8px;white-space:pre-wrap;overflow-wrap:anywhere}\n      #${PANEL_ID} .tm-log-row:nth-child(even){background:rgba(255,255,255,.055)}\n      #${PANEL_ID} .tm-switch{margin-left:auto;width:42px;height:24px;padding:2px;border-radius:999px;position:relative}\n      #${PANEL_ID} .tm-switch-thumb{display:block;width:18px;height:18px;border-radius:50%;background:#aaa;transform:translateX(0);transition:transform .16s ease,background .16s ease}\n      #${PANEL_ID} .tm-switch[aria-checked=\"true\"] .tm-switch-thumb{transform:translateX(16px);background:#fff}\n      #${PANEL_ID} .tm-extract-formats{display:grid;grid-template-columns:auto auto auto;gap:6px 12px;align-items:center}\n      #${PANEL_ID} .tm-extract-formats label{display:flex;gap:5px;align-items:center}\n",
  1
)
# Remove obsolete old switch style if still present.
s = s.replace("      #${PANEL_ID} .tm-switch{margin-left:auto;border-radius:999px;padding:6px 13px;font-weight:600}\n", "", 1)

# Update updateUi selectors/control states.
old = r'''    const md = panel.querySelector('[data-role="extract-md"]');
    const jsonl = panel.querySelector('[data-role="extract-jsonl"]');
    const test = panel.querySelector('[data-role="test"]');
    const jump = panel.querySelector('[data-role="jump"]');
    if (md) {
      md.disabled = exportInProgress || testInProgress || jumpInProgress;
      md.textContent = exportInProgress && exportKind === 'md' ? 'Extracting…' : 'Extract MD';
    }
    if (jsonl) {
      jsonl.disabled = exportInProgress || testInProgress || jumpInProgress;
      jsonl.textContent = exportInProgress && exportKind === 'jsonl' ? 'Extracting…' : 'Extract JSONL';
    }
'''
new = r'''    const extract = panel.querySelector('[data-role="extract"]');
    const jsonl = panel.querySelector('[data-role="format-jsonl"]');
    const md = panel.querySelector('[data-role="format-md"]');
    const test = panel.querySelector('[data-role="test"]');
    const jump = panel.querySelector('[data-role="jump"]');
    const formatsSelected = Boolean(jsonl?.checked || md?.checked);
    if (extract) {
      extract.disabled = exportInProgress || testInProgress || jumpInProgress || !formatsSelected;
      extract.textContent = exportInProgress ? 'Extracting…' : 'Extract';
    }
    if (jsonl) jsonl.disabled = exportInProgress || testInProgress || jumpInProgress;
    if (md) md.disabled = exportInProgress || testInProgress || jumpInProgress;
'''
if old not in s:
  raise SystemExit('Missing updateUi extraction block')
s = s.replace(old, new, 1)
s = s.replace(
  "    if (screen) screen.textContent = screenOnWhenCapturing ? 'ON' : 'OFF';\n",
  "    if (screen) screen.setAttribute('aria-checked', String(screenOnWhenCapturing));\n",
  1
)

# Panel layout: log immediately under title; test/status later; switch and combined extraction controls.
old_panel = r'''      <button class="tm-close" type="button" aria-label="Close">×</button>
      <div class="tm-title" data-role="title"></div>
      <div class="tm-status" data-role="status"></div>
      <div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><button data-role="test" type="button">Test</button></div>
      <div class="tm-log-head"><span class="tm-label" data-role="log-count">Log: 0 items</span><button class="tm-log-copy" data-role="copy-log" type="button">Copy</button></div>
      <pre class="tm-log-output" data-role="log-output"></pre>
      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button"></button></div>
      <div class="tm-row"><button data-role="jump" type="button">Jump</button></div>
      <div class="tm-row"><button data-role="extract-jsonl" type="button">Extract JSONL</button><button data-role="extract-md" type="button">Extract MD</button></div>
'''
new_panel = r'''      <button class="tm-close" type="button" aria-label="Close">×</button>
      <div class="tm-title" data-role="title"></div>
      <div class="tm-log-head"><span class="tm-label" data-role="log-count">Log: 0 items</span><button class="tm-icon-button" data-role="copy-log" type="button" aria-label="Copy diagnostic log" title="Copy log"></button><button class="tm-icon-button" data-role="toggle-log" type="button" aria-label="Show diagnostic log" aria-expanded="false" title="Show log">+</button></div>
      <div class="tm-log-output" data-role="log-output" hidden></div>
      <div class="tm-status" data-role="status"></div>
      <div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><button data-role="test" type="button">Test</button></div>
      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button" role="switch" aria-checked="false" aria-label="Keep screen on while extracting"><span class="tm-switch-thumb"></span></button></div>
      <div class="tm-row"><button data-role="jump" type="button">Jump</button></div>
      <div class="tm-row tm-extract-formats"><button data-role="extract" type="button">Extract</button><label><input data-role="format-jsonl" type="checkbox" checked> JSONL</label><label><input data-role="format-md" type="checkbox"> MD</label></div>
'''
if old_panel not in s:
  raise SystemExit('Missing current panel markup')
s = s.replace(old_panel, new_panel, 1)

# Panel setup: initialize icons/toggle, test opener, combined extract runner.
s = s.replace(
  "    panel.querySelector('[data-role=\"copy-log\"]').addEventListener('click', () => {\n",
  "    const copyLogButton = panel.querySelector('[data-role=\"copy-log\"]');\n    if (copyLogButton) copyLogButton.innerHTML = copyIconMarkup();\n    panel.querySelector('[data-role=\"toggle-log\"]').addEventListener('click', () => {\n      diagnosticLogExpanded = !diagnosticLogExpanded;\n      refreshDiagnosticLog();\n    });\n    panel.querySelector('[data-role=\"copy-log\"]').addEventListener('click', () => {\n",
  1
)
s = s.replace(
  "    panel.querySelector('[data-role=\"test\"]').addEventListener('click', openTestMatrix);\n",
  "    panel.querySelector('[data-role=\"test\"]').addEventListener('click', event => openTestMatrix(event.currentTarget));\n",
  1
)
s = s.replace(
  "    panel.querySelector('[data-role=\"extract-jsonl\"]').addEventListener('click', () => void runExport('jsonl'));\n    panel.querySelector('[data-role=\"extract-md\"]').addEventListener('click', () => void runExport('md'));\n",
  "    const runSelectedExports = async () => {\n      const jsonl = panel.querySelector('[data-role=\"format-jsonl\"]');\n      const md = panel.querySelector('[data-role=\"format-md\"]');\n      if (jsonl?.checked) await runExport('jsonl');\n      if (md?.checked) await runExport('md');\n    };\n    panel.querySelector('[data-role=\"extract\"]').addEventListener('click', () => void runSelectedExports());\n    panel.querySelector('[data-role=\"format-jsonl\"]').addEventListener('change', updateUi);\n    panel.querySelector('[data-role=\"format-md\"]').addEventListener('change', updateUi);\n",
  1
)

p.write_text(s, encoding='utf-8')

Path('tests/recorder-panel-ui.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

test('recorder panel restores dialog/log/switch/extract UI contracts', () => {
  assert.match(userscript, /function installModalContract\(/);
  assert.match(userscript, /event\.key === 'Escape'/);
  assert.match(userscript, /event\.key === 'Tab'/);
  assert.match(userscript, /event\.shiftKey/);
  assert.match(userscript, /event\.key === 'Enter'/);
  assert.match(userscript, /restore\?\.isConnected/);
  assert.doesNotMatch(userscript, /setStatus\(currentTestStatusLines\(\)\.join/,
    'Test results belong in the test dialog, not general status.');

  const titleAt = userscript.indexOf('<div class="tm-title" data-role="title"></div>');
  const logAt = userscript.indexOf('<div class="tm-log-head">', titleAt);
  const statusAt = userscript.indexOf('<div class="tm-status" data-role="status"></div>', titleAt);
  assert.ok(titleAt >= 0 && logAt > titleAt && statusAt > logAt, 'Log must be directly below title, before status/other controls.');
  assert.match(userscript, /data-role="copy-log"[^>]*aria-label="Copy diagnostic log"/);
  assert.match(userscript, /checkIconMarkup\(\)/);
  assert.match(userscript, /setTimeout\(\(\) => \{/);
  assert.match(userscript, /data-role="toggle-log"/);
  assert.match(userscript, /data-role="log-output" hidden/);
  assert.match(userscript, /\.tm-log-row:nth-child\(even\)/);

  assert.match(userscript, /data-role="screen-on"[^>]*role="switch"[^>]*aria-checked="false"/);
  assert.match(userscript, /class="tm-switch-thumb"/);
  assert.match(userscript, /screen\.setAttribute\('aria-checked', String\(screenOnWhenCapturing\)\)/);

  assert.match(userscript, /data-role="extract" type="button">Extract<\/button>/);
  assert.match(userscript, /data-role="format-jsonl" type="checkbox" checked/);
  assert.match(userscript, /data-role="format-md" type="checkbox"/);
  assert.doesNotMatch(userscript, /data-role="extract-jsonl"/);
  assert.doesNotMatch(userscript, /data-role="extract-md"/);
  assert.match(userscript, /if \(jsonl\?\.checked\) await runExport\('jsonl'\)/);
  assert.match(userscript, /if \(md\?\.checked\) await runExport\('md'\)/);
});
''', encoding='utf-8')

ci = Path('.github/workflows/ci.yml')
text = ci.read_text(encoding='utf-8')
line = '      - name: Built-in test list UI regression\n        run: node --test tests/test-list-ui.test.mjs\n'
if line not in text:
  raise SystemExit('Missing UI CI insertion point')
text = text.replace(line, line + '      - name: Recorder panel UI regression\n        run: node --test tests/recorder-panel-ui.test.mjs\n', 1)
ci.write_text(text, encoding='utf-8')
