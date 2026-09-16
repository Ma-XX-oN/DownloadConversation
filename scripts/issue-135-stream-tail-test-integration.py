from pathlib import Path

path = Path('tests/stream-tail-recovery.test.mjs')
text = path.read_text(encoding='utf-8')
old = "    logDiagnostic() {},\n    conversationSpineFromPages(pages) {\n"
new = "    logDiagnostic() {},\n    agentSoundObserveTerminal() {},\n    conversationSpineFromPages(pages) {\n"
count = text.count(old)
if count != 1:
  raise SystemExit(f'stream-tail harness hook: expected one match, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
