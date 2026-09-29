#!/usr/bin/env python3
from pathlib import Path
import os
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
HEADER = ROOT / "src" / "userscript-header.js"
VERSION_LINE = re.compile(r"^// @version\s+(\S+)\s*$")
STABLE_VERSION = re.compile(r"^\d+\.\d+\.\d+$")
DEVELOPMENT_VERSION = re.compile(r"^\d+\.\d+\.\d+-issue\.\d+\.\d+$")
ISSUE_BRANCH = re.compile(r"^issue-(\d+)(?:-|$)")
INTEGRATION_BRANCH = "main"


def branch_name() -> str:
  for name in ("GITHUB_HEAD_REF", "GITHUB_REF_NAME"):
    value = os.environ.get(name, "").strip()
    if value:
      return value.removeprefix("refs/heads/")
  result = subprocess.run(
    ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    cwd=ROOT,
    text=True,
    capture_output=True,
    check=False,
  )
  return result.stdout.strip().removeprefix("refs/heads/")


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
  branch = branch_name()
  if branch == INTEGRATION_BRANCH:
    if STABLE_VERSION.fullmatch(version) is None:
      print(
        f"integration branch {INTEGRATION_BRANCH} requires plain x.y.z version; "
        f"found {version}",
        file=sys.stderr,
      )
      return 1
  elif ISSUE_BRANCH.match(branch):
    if DEVELOPMENT_VERSION.fullmatch(version) is None:
      print(
        f"issue branch {branch} requires development version; found {version}",
        file=sys.stderr,
      )
      return 1
  elif (
    STABLE_VERSION.fullmatch(version) is None
    and DEVELOPMENT_VERSION.fullmatch(version) is None
  ):
    print(f"invalid workflow version: {version}", file=sys.stderr)
    return 1

  print(version)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
