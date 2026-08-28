from pathlib import Path

source_path = Path('chatgpt-conversation-markdown-export.user.js')
source = source_path.read_text(encoding='utf-8')

replacements = [
  ('// @version      0.6.135', '// @version      0.6.136'),
  ('''  async function runTests() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    testInProgress = true;
    updateUi();
    const results = [];
    const run = async (name, fn) => {
      try {
        await fn();
        results.push(`✅ ${name}`);
      } catch (error) {
        results.push(`❌ ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      setStatus(results.join('\\n'));
    };
    try {
      await run('API pagination', testApiPaginationLogic);
      await run('Stable API message IDs', testStableMessageIds);
      await run('Multimodal User + chronological order', testMultimodalUserAndChronologicalOrder);
      await run('AI-transcript renderer parity', testRendererParityFeatures);
      await run('Generated sandbox download link', testGeneratedSandboxDownloadLink);
      await run('Jump identifier resolution', testJumpIdentifierResolution);
      await run('Conversation API access/schema', testConversationApiAccessAndSchema);
    } finally {
      testInProgress = false;
      updateUi();
    }
  }
''', '''  function builtInTests() {
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

  async function runTests() {
    if (exportInProgress || testInProgress || jumpInProgress) return;
    testInProgress = true;
    updateUi();
    const results = [];
    const run = async (name, fn) => {
      try {
        await fn();
        results.push(`✅ ${name}`);
      } catch (error) {
        results.push(`❌ ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      setStatus(results.join('\\n'));
    };
    try {
      for (const [name, fn] of builtInTests()) await run(name, fn);
    } finally {
      testInProgress = false;
      updateUi();
    }
  }
'''),
  ('''      #${PANEL_ID} .tm-label{color:#ddd}
      #${PANEL_ID} .tm-log-head''', '''      #${PANEL_ID} .tm-label{color:#ddd}
      #${PANEL_ID} .tm-test-list{margin:6px 0 0;padding:7px 9px;border:1px solid #555;border-radius:8px;background:#191919;color:#ddd;white-space:pre-wrap;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}
      #${PANEL_ID} .tm-log-head'''),
  ('''      <div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><button data-role="test" type="button">Test</button></div>
      <div class="tm-log-head">''', '''      <div class="tm-row"><span class="tm-label">Diagnostics</span><select data-role="diagnostics"><option value="errors">Errors</option><option value="warnings">Warnings</option><option value="debug">Debug</option><option value="verbose">Verbose</option></select><button data-role="test" type="button">Test</button></div>
      <div class="tm-test-list" data-role="test-list" aria-label="Built-in tests"></div>
      <div class="tm-log-head">'''),
  ('''    const diagnostics = panel.querySelector('[data-role="diagnostics"]');
''', '''    const testList = panel.querySelector('[data-role="test-list"]');
    if (testList) testList.textContent = builtInTests().map(([name]) => `• ${name}`).join('\\n');
    const diagnostics = panel.querySelector('[data-role="diagnostics"]');
''')
]

for old, new in replacements:
  count = source.count(old)
  if count != 1:
    raise SystemExit(f'Expected exactly one source match, found {count}: {old[:100]!r}')
  source = source.replace(old, new, 1)

source_path.write_text(source, encoding='utf-8')

Path('tests/test-list-ui.test.mjs').write_text('''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(
  new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

test('built-in tests are visible before Test is pressed and share the execution registry', () => {
  assert.match(userscript, /function builtInTests\\(\\) \\{/,
    'Production userscript must expose one built-in-test registry.');
  assert.match(userscript, /data-role="test-list" aria-label="Built-in tests"/,
    'Recorder panel must contain a visible built-in-test list.');
  assert.match(userscript,
    /testList\\.textContent = builtInTests\\(\\)\\.map\\(\\(\\[name\\]\\) => `• \\${name}`\\)\\.join\\('\\\\n'\\)/,
    'Pre-run test list must be populated from the same registry used for execution.');
  assert.match(userscript,
    /for \\(const \\[name, fn\\] of builtInTests\\(\\)\\) await run\\(name, fn\\);/,
    'Test execution must use the visible built-in-test registry.');

  for (const name of [
    'API pagination',
    'Stable API message IDs',
    'Multimodal User + chronological order',
    'AI-transcript renderer parity',
    'Generated sandbox download link',
    'Jump identifier resolution',
    'Conversation API access/schema'
  ]) {
    assert.ok(userscript.includes(`['${name}',`), `Visible registry is missing ${name}.`);
  }
});
''', encoding='utf-8')

ci_path = Path('.github/workflows/ci.yml')
ci = ci_path.read_text(encoding='utf-8')
old_ci = '''      - name: Phase 5 canonical integration regression
        run: node --test tests/core-integration.test.mjs
'''
new_ci = old_ci + '''      - name: Built-in test list UI regression
        run: node --test tests/test-list-ui.test.mjs
'''
if ci.count(old_ci) != 1:
  raise SystemExit('Expected exactly one CI insertion point.')
ci_path.write_text(ci.replace(old_ci, new_ci, 1), encoding='utf-8')
