from pathlib import Path


FILES = (
  'tests/phase5-rich-core-integration.test.mjs',
  'tests/phase7-cross-consumer-parity.mjs',
  'tests/phase7-cross-consumer-markdown-shape.mjs',
  'tests/phase7-cross-consumer-adversarial.mjs',
)

for name in FILES:
  path = Path(name)
  text = path.read_text(encoding='utf-8')
  old = "  showTurnIds: false,\n  assert(condition, message) {\n"
  new = "  showTurnIds: false,\n  showDebugProvenance: false,\n  assert(condition, message) {\n"
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{name}: expected one harness context, found {count}')
  path.write_text(text.replace(old, new, 1), encoding='utf-8')
