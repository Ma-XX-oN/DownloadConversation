from pathlib import Path

path = Path('scripts/issue77_patch.py')
text = path.read_text(encoding='utf-8')
old = """if source.count(old) < 2:\n  raise SystemExit('timing diagnostic fields not found twice')\nsource = source.replace(old, new, 2)\n"""
new = """if source.count(old) != 1:\n  raise SystemExit('completion timing diagnostic fields not found exactly once')\nsource = source.replace(old, new, 1)\n\nold_failure = r'''          source_scheme: timing.source_scheme ?? null,\n          http_status: (timing.http_status ?? Number(error?.httpStatus)) || null,\n          fetch_ms: timing.fetch_ms ?? null,\n'''\nnew_failure = r'''          source_scheme: timing.source_scheme ?? null,\n          resolver_status: timing.resolver_status ?? null,\n          resolver_ms: timing.resolver_ms ?? null,\n          http_status: (timing.http_status ?? Number(error?.httpStatus)) || null,\n          fetch_ms: timing.fetch_ms ?? null,\n'''\nif source.count(old_failure) != 1:\n  raise SystemExit('failure timing diagnostic fields not found exactly once')\nsource = source.replace(old_failure, new_failure, 1)\n"""
if old not in text:
  raise SystemExit('timing replacement block not found in helper')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
