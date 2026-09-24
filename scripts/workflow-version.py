#!/usr/bin/env python3
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
HEADER = ROOT / "src" / "userscript-header.js"
VERSION_LINE = re.compile(r"^// @version\s+(\S+)\s*$")
DEVELOPMENT_VERSION = re.compile(r"^\d+\.\d+\.\d+-issue\.\d+\.\d+$")


def main() -> int:
  matches = []
  for line in HEADER.read_text(encoding="utf-8").splitlines():
    match = VERSION_LINE.fullmatch(line)
    if match is not None:
      matches.append(match.group(1))
  if len(matches) != 1:
    print("userscript header must contain exactly one @version", file=sys.stderr)
    return 1
  version = matches[0]
  if DEVELOPMENT_VERSION.fullmatch(version) is None:
    print(f"invalid development version: {version}", file=sys.stderr)
    return 1
  print(version)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
