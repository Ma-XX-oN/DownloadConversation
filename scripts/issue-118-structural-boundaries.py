from pathlib import Path

ROOT = Path('.')
USERSCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'
TEST = ROOT / 'tests' / 'heading-metadata-controls.test.mjs'
DESIGN = ROOT / 'DESIGN.md'

source = USERSCRIPT.read_text(encoding='utf-8')
old = r'''    const lines = String(markdown ?? '').split('\n');
    const output = [];
    let previousBoundarySeconds = null;
    for (const line of lines) {
      const match = line.match(boundaryPattern);
      if (!match) {
        output.push(line);
        continue;
      }
'''
new = r'''    const lines = String(markdown ?? '').split('\n');
    const output = [];
    let previousBoundarySeconds = null;
    let detailsDepth = 0;
    let fence = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (fence) {
        output.push(line);
        if (trimmed.length >= fence.length &&
            [...trimmed].every(char => char === fence.char)) {
          fence = null;
        }
        continue;
      }
      const fenceStart = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceStart) {
        fence = { char: fenceStart[1][0], length: fenceStart[1].length };
        output.push(line);
        continue;
      }
      if (/^ {0,3}<\/details\s*>/i.test(line) && detailsDepth > 0) {
        detailsDepth -= 1;
        output.push(line);
        continue;
      }
      if (/^ {0,3}<details(?:\s|>)/i.test(line)) {
        detailsDepth += 1;
        output.push(line);
        continue;
      }
      if (detailsDepth > 0) {
        output.push(line);
        continue;
      }
      const match = line.match(boundaryPattern);
      if (!match) {
        output.push(line);
        continue;
      }
'''
if source.count(old) != 1:
  raise SystemExit('worked-duration scanner insertion point not found exactly once')
source = source.replace(old, new, 1)
USERSCRIPT.write_text(source, encoding='utf-8')

test = TEST.read_text(encoding='utf-8').rstrip()
marker = "test('worked-duration annotation ignores transcript-looking headings inside opaque rendered content'"
if marker in test:
  raise SystemExit('opaque-content worked-duration regression already exists')
addition = r'''


test('worked-duration annotation ignores transcript-looking headings inside opaque rendered content', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '## ChatGPT [2026-01-15 00:00:01]:',
    '',
    '<details><summary>Having a thought</summary>',
    '',
    '```text',
    '## User [2025-12-31 23:59:00]:',
    '',
    '### ChatGPT Commentary [2025-12-31 23:59:59]:',
    '```',
    '',
    '<details><summary>tool output</summary>',
    '',
    '### ChatGPT Commentary [2025-12-31 23:59:58]:',
    '',
    '</details>',
    '',
    '</details>',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:05]:',
    '',
    '> real report'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.equal((annotated.match(/Worked for 0m 5s/g) ?? []).length, 1);
  assert.equal((annotated.match(/Thought for less than a sec/g) ?? []).length, 0);
  assert.equal((annotated.match(/Duration error/g) ?? []).length, 0);
  assert.match(annotated,
    /## User \[2025-12-31 23:59:00\]:\n\n### ChatGPT Commentary \[2025-12-31 23:59:59\]:/);
});

test('worked-duration annotation ignores transcript-looking headings in top-level fenced content', () => {
  const markdown = [
    '## User [2026-01-15 00:00:00]:',
    '',
    '> prompt',
    '',
    '````text',
    '### ChatGPT Commentary [2025-12-31 23:59:59]:',
    '```',
    '````',
    '',
    '### ChatGPT Commentary [2026-01-15 00:00:03]:',
    '',
    '> real report'
  ].join('\n');
  const annotated = annotateWorkedDuration(markdown);
  assert.equal((annotated.match(/Worked for 0m 3s/g) ?? []).length, 1);
  assert.equal((annotated.match(/Duration error/g) ?? []).length, 0);
});
'''
TEST.write_text(test + addition + '\n', encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
old_design = (
  'The preceding rendered `## User` prompt or `### ChatGPT Commentary` report is\n'
  'the timing boundary. The enclosing `## ChatGPT` response heading is ignored for\n'
  'timing because real ChatGPT data can make that heading inherit an older\n'
)
new_design = (
  'The preceding rendered `## User` prompt or `### ChatGPT Commentary` report is\n'
  'the timing boundary. Only structural headings are eligible: transcript-looking\n'
  'text inside fenced blocks or rendered `<details>` content remains opaque. The\n'
  'enclosing `## ChatGPT` response heading is ignored for timing because real\n'
  'ChatGPT data can make that heading inherit an older\n'
)
if design.count(old_design) != 1:
  raise SystemExit('worked-duration design paragraph not found exactly once')
design = design.replace(old_design, new_design, 1)
DESIGN.write_text(design, encoding='utf-8')
