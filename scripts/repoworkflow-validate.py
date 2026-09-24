#!/usr/bin/env python3
from pathlib import Path
import os
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str]) -> int:
  environment = os.environ.copy()
  environment["PYTHONDONTWRITEBYTECODE"] = "1"
  try:
    return subprocess.run(
      command,
      cwd=ROOT,
      env=environment,
      check=False,
    ).returncode
  except OSError as exc:
    print(f"infrastructure error running {command[0]}: {exc}", file=sys.stderr)
    return 2


def main() -> int:
  results = [
    run(["node", "scripts/ci-environment.mjs"]),
    run([sys.executable, "-m", "unittest", "tests/test_ci_contract.py"]),
  ]
  if 2 in results:
    return 2
  if any(result != 0 for result in results):
    return 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
