from pathlib import Path

source_path = Path('chatgpt-conversation-markdown-export.user.js')
source = source_path.read_text(encoding='utf-8')

if source.count('// @version      0.6.136') != 1:
  raise SystemExit('Expected v0.6.136 exactly once.')
source = source.replace('// @version      0.6.136', '// @version      0.6.137', 1)

start = source.index('  function builtInTests() {')
end = source.index('\n  function diagnosticEnabled', start)
new_test_block = r'''  const TEST_MATRIX_ID = `${PANEL_ID}-test-matrix`;
  const TEST_RESULT_HISTORY_KEY = 'tm-conversation-recorder-test-result-history';
  let testMatrixPreviousResults = new Map();
  let testMatrixCurrentResults = new Map();

  function builtInTests() {
    return [
      ['API pagination', testApiPaginationLogic],
      ['Stable API message IDs', testStableMessageIds],
      ['Multimodal User + chronological order', testMultimodalUserAndChronologicalOrder],
      ['AI-transcript renderer parity', testRendererParityFeatures],
      ['Generated sandbox download link', testGeneratedSandboxDownloadLink],
      ['Jump identifier resolution', testJumpIdentifierResolution],
      ['Conversation API access/schema', testConversationApiAccessAndSchema]
    ];
  }

  function loadTestResultHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TEST_RESULT_HISTORY_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
      return new Map(Object.entries(parsed).filter(([, value]) => value === 'PASS' || value === 'FAIL'));
    } catch {
      return new Map();
    }
  }

  function saveTestResultHistory() {
    try {
      const history = loadTestResultHistory();
      for (const [name, result] of testMatrixCurrentResults) history.set(name, result.status);
      localStorage.setItem(TEST_RESULT_HISTORY_KEY, JSON.stringify(Object.fromEntries(history)));
    } catch {}
  }

  function testMatrixResultText(result) {
    return result?.status || '—';
  }

  function refreshTestMatrix() {
    const matrix = document.getElementById(TEST_MATRIX_ID);
    if (!matrix) return;
    for (const row of matrix.querySelectorAll('[data-test-name]')) {
      const name = row.getAttribute('data-test-name');
      const previous = row.querySelector('[data-role="previous-result"]');
      const current = row.querySelector('[data-role="current-result"]');
      const run = row.querySelector('[data-role="run-test"]');
      if (previous) previous.textContent = testMatrixPreviousResults.get(name) || '—';
      if (current) current.textContent = testMatrixResultText(testMatrixCurrentResults.get(name));
      if (run instanceof HTMLButtonElement) run.disabled = testInProgress || exportInProgress || jumpInProgress;
    }
    const runAll = matrix.querySelector('[data-role="run-all-tests"]');
    if (runAll instanceof HTMLButtonElement) runAll.disabled = testInProgress || exportInProgress || jumpInProgress;
  }

  async function executeBuiltInTest(name, fn) {
    try {
      await fn();
      testMatrixCurrentResults.set(name, { status: 'PASS', detail: '' });
      return `✅ ${name}`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      testMatrixCurrentResults.set(name, { status: 'FAIL', detail });
      return `❌ ${name}: ${detail}`;
    } finally {
      saveTestResultHistory();
      refreshTestMatrix();
    }
  }

  function currentTestStatusLines() {
    return builtInTests()
      .filter(([name]) => testMatrixCurrentResults.has(name))
      .map(([name]) => {
        const result = testMatrixCurrentResults.get(name);
        return result.status === 'PASS' ? `✅ ${name}` : `❌ ${name}: ${result.detail}`;
      });
  }

  async function runOneTest(name, fn) {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    testInProgress = true;
    updateUi();
    refreshTestMatrix();
    try {
      await executeBuiltInTest(name, fn);
      setStatus(currentTestStatusLines().join('\n'));
    } finally {
      testInProgress = false;
      updateUi();
      refreshTestMatrix();
    }
  }

  async function runTests() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    testInProgress = true;
    updateUi();
    refreshTestMatrix();
    try {
      for (const [name, fn] of builtInTests()) {
        await executeBuiltInTest(name, fn);
        setStatus(currentTestStatusLines().join('\n'));
      }
    } finally {
      testInProgress = false;
      updateUi();
      refreshTestMatrix();
    }
  }

  function closeTestMatrix() {
    document.getElementById(TEST_MATRIX_ID)?.remove();
  }

  function openTestMatrix() {
    if (document.getElementById(TEST_MATRIX_ID)) return;
    testMatrixPreviousResults = loadTestResultHistory();
    testMatrixCurrentResults = new Map();
    const tests = builtInTests();
    const overlay = document.createElement('div');
    overlay.id = TEST_MATRIX_ID;
    overlay.innerHTML = `
      <div class="tm-test-dialog" role="dialog" aria-modal="true" aria-labelledby="${TEST_MATRIX_ID}-title">
        <div class="tm-test-dialog-head">
          <strong id="${TEST_MATRIX_ID}-title">Built-in tests</strong>
          <button type="button" data-role="close-test-matrix" aria-label="Close tests">×</button>
        </div>
        <div class="tm-test-table-wrap">
          <table class="tm-test-table">
            <thead><tr><th>Test</th><th>Type</th><th>Previous Result</th><th>Current Result</th><th></th></tr></thead>
            <tbody>
              ${tests.map(([name]) => `
                <tr data-test-name="${escapeHtmlAttribute(name)}">
                  <td>${escapeHtmlText(name)}</td>
                  <td>Automatic</td>
                  <td data-role="previous-result">—</td>
                  <td data-role="current-result">—</td>
                  <td><button type="button" data-role="run-test">Run</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="tm-test-actions">
          <button type="button" data-role="run-all-tests">Run All</button>
          <button type="button" data-role="close-test-matrix">Close</button>
        </div>
      </div>`;
    overlay.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target === overlay || target.closest('[data-role="close-test-matrix"]')) {
        if (!testInProgress) closeTestMatrix();
        return;
      }
      const row = target.closest('tr[data-test-name]');
      if (target.closest('[data-role="run-test"]') && row) {
        const name = row.getAttribute('data-test-name');
        const test = tests.find(([candidate]) => candidate === name);
        if (test) void runOneTest(test[0], test[1]);
        return;
      }
      if (target.closest('[data-role="run-all-tests"]')) void runTests();
    });
    document.body.append(overlay);
    refreshTestMatrix();
    overlay.querySelector('[data-role="run-all-tests"]')?.focus({ preventScroll: true });
  }
'''
source = source[:start] + new_test_block + source[end:]

old_style = "      #${PANEL_ID} .tm-test-list{margin:6px 0 0;padding:7px 9px;border:1px solid #555;border-radius:8px;background:#191919;color:#ddd;white-space:pre-wrap;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}\n"
new_style = """      #${TEST_MATRIX_ID}{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:24px;box-sizing:border-box}\n      #${TEST_MATRIX_ID} .tm-test-dialog{width:min(920px,96vw);max-height:88vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid #666;border-radius:12px;background:#202020;color:#f2f2f2;box-shadow:0 10px 40px rgba(0,0,0,.5);font:13px/1.35 system-ui,sans-serif}\n      #${TEST_MATRIX_ID} .tm-test-dialog-head,#${TEST_MATRIX_ID} .tm-test-actions{display:flex;align-items:center;gap:10px;padding:10px 12px}\n      #${TEST_MATRIX_ID} .tm-test-dialog-head{justify-content:space-between;border-bottom:1px solid #555}\n      #${TEST_MATRIX_ID} .tm-test-dialog-head strong{font-size:16px}\n      #${TEST_MATRIX_ID} .tm-test-table-wrap{overflow:auto}\n      #${TEST_MATRIX_ID} .tm-test-table{width:100%;border-collapse:collapse}\n      #${TEST_MATRIX_ID} .tm-test-table th,#${TEST_MATRIX_ID} .tm-test-table td{padding:8px 10px;border-bottom:1px solid #444;text-align:left;vertical-align:top}\n      #${TEST_MATRIX_ID} .tm-test-table th{position:sticky;top:0;background:#292929;z-index:1}\n      #${TEST_MATRIX_ID} .tm-test-table td:nth-child(2),#${TEST_MATRIX_ID} .tm-test-table td:nth-child(3),#${TEST_MATRIX_ID} .tm-test-table td:nth-child(4){white-space:nowrap}\n      #${TEST_MATRIX_ID} button{border:1px solid #666;border-radius:8px;background:#292929;color:#fff;padding:7px 10px;font:inherit;cursor:pointer}\n      #${TEST_MATRIX_ID} button:disabled{opacity:.45;cursor:not-allowed}\n      #${TEST_MATRIX_ID} .tm-test-actions{justify-content:flex-end;border-top:1px solid #555}\n"""
if source.count(old_style) != 1:
  raise SystemExit('Expected old static test-list style exactly once.')
source = source.replace(old_style, new_style, 1)

old_markup = '      <div class="tm-test-list" data-role="test-list" aria-label="Built-in tests"></div>\n'
if source.count(old_markup) != 1:
  raise SystemExit('Expected old inline test-list markup exactly once.')
source = source.replace(old_markup, '', 1)

old_populate = "    const testList = panel.querySelector('[data-role=\"test-list\"]');\n    if (testList) testList.textContent = builtInTests().map(([name]) => `• ${name}`).join('\\n');\n"
if source.count(old_populate) != 1:
  raise SystemExit('Expected old inline list population exactly once.')
source = source.replace(old_populate, '', 1)

old_listener = "    panel.querySelector('[data-role=\"test\"]').addEventListener('click', () => void runTests());\n"
new_listener = "    panel.querySelector('[data-role=\"test\"]').addEventListener('click', openTestMatrix);\n"
if source.count(old_listener) != 1:
  raise SystemExit('Expected old Test listener exactly once.')
source = source.replace(old_listener, new_listener, 1)

source_path.write_text(source, encoding='utf-8')

Path('tests/test-list-ui.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

test('Test opens the interactive built-in test matrix instead of immediately running all tests', () => {
  assert.match(userscript, /function builtInTests\(\) \{/,
    'Production userscript must expose one built-in-test registry.');
  assert.match(userscript,
    /panel\.querySelector\('\[data-role="test"\]'\)\.addEventListener\('click', openTestMatrix\);/,
    'Test button must open the matrix, not immediately execute Run All.');
  assert.doesNotMatch(userscript, /data-role="test-list"/,
    'The rejected v0.6.136 static inline list must not remain.');
  assert.match(userscript, /<strong id="\$\{TEST_MATRIX_ID\}-title">Built-in tests<\/strong>/,
    'Matrix must identify the built-in test set before execution.');
  for (const heading of ['Type', 'Previous Result', 'Current Result']) {
    assert.ok(userscript.includes(`<th>${heading}</th>`), `Matrix is missing ${heading}.`);
  }
  assert.match(userscript, /data-role="run-test">Run<\/button>/,
    'Every matrix row must expose an individual Run control.');
  assert.match(userscript, /data-role="run-all-tests">Run All<\/button>/,
    'Matrix must expose Run All.');
  assert.match(userscript,
    /for \(const \[name, fn\] of builtInTests\(\)\) \{/,
    'Run All must execute the same registry shown by the matrix.');

  for (const name of [
    'API pagination',
    'Stable API message IDs',
    'Multimodal User + chronological order',
    'AI-transcript renderer parity',
    'Generated sandbox download link',
    'Jump identifier resolution',
    'Conversation API access/schema'
  ]) {
    assert.ok(userscript.includes(`['${name}',`), `Built-in registry is missing ${name}.`);
  }
});
''', encoding='utf-8')
