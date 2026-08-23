#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

REPO = "Ma-XX-oN/DownloadConversation"
TODO = Path("TODO.md")

STATUS_LABELS = {
  "IDEAS": ("status: ideas", "Ideas not fully fleshed out.", "C5DEF5"),
  "WORK_IN_PROGRESS": ("status: work in progress", "Actively being worked on.", "FBCA04"),
  "READY": ("status: ready", "Defined enough to start next.", "0E8A16"),
  "IN_REVIEW": ("status: in review", "Implemented and awaiting live verification/review.", "1D76DB"),
  "BLOCKED": ("status: blocked", "Blocked on a prerequisite decision, dependency, or result.", "D93F0B"),
  "DONE": ("status: done", "Completed and verified enough to leave active planning.", "6E7781"),
  "WILL_NOT_FIX": ("status: will not fix", "Will not be fixed.", "B60205"),
  "LEGACY": ("status: legacy", "Superseded approach retained for historical context.", "5319E7"),
}

ACTIVE_STATUSES = {"IDEAS", "WORK_IN_PROGRESS", "READY", "IN_REVIEW", "BLOCKED"}


def run(*args: str, input_text: str | None = None) -> str:
  result = subprocess.run(
    args,
    input=input_text,
    text=True,
    check=True,
    capture_output=True,
  )
  return result.stdout.strip()


def parse_todo(text: str) -> list[dict[str, object]]:
  status = None
  current = None
  issues: list[dict[str, object]] = []

  for line in text.splitlines():
    status_match = re.fullmatch(r"### (IDEAS|WORK_IN_PROGRESS|READY|IN_REVIEW|BLOCKED|DONE|WILL_NOT_FIX|LEGACY)", line)
    if status_match:
      status = status_match.group(1)
      current = None
      continue

    issue_match = re.fullmatch(r"#### ISSUE (\d+): \*\*(.*?)\*\*", line)
    if issue_match and status:
      current = {
        "legacy_number": int(issue_match.group(1)),
        "title": issue_match.group(2),
        "status": status,
        "details": [],
      }
      issues.append(current)
      continue

    if current is not None and line.startswith("- "):
      current["details"].append(line[2:])

  numbers = [int(issue["legacy_number"]) for issue in issues]
  if numbers != sorted(numbers):
    # The TODO is grouped by status rather than number, so only uniqueness/range matter.
    numbers = sorted(numbers)
  if numbers != list(range(1, max(numbers) + 1)):
    raise RuntimeError(f"Legacy issue numbering is not contiguous: {numbers}")
  if len(numbers) != len(set(numbers)):
    raise RuntimeError("Duplicate legacy issue numbers found.")
  return issues


def ensure_labels() -> None:
  for label, description, color in STATUS_LABELS.values():
    subprocess.run(
      ["gh", "label", "create", label, "--repo", REPO, "--description", description, "--color", color, "--force"],
      check=True,
    )


def find_existing(legacy_number: int) -> int | None:
  marker = f"Legacy TODO issue: {legacy_number}"
  raw = run(
    "gh", "issue", "list",
    "--repo", REPO,
    "--state", "all",
    "--search", f'"{marker}" in:body',
    "--limit", "10",
    "--json", "number,body",
  )
  matches = json.loads(raw or "[]")
  exact = [item for item in matches if marker in (item.get("body") or "")]
  if len(exact) > 1:
    raise RuntimeError(f"Multiple GitHub issues already contain marker: {marker}")
  return int(exact[0]["number"]) if exact else None


def body_for(issue: dict[str, object]) -> str:
  legacy_number = int(issue["legacy_number"])
  status = str(issue["status"])
  details = list(issue["details"])
  lines = [
    f"Legacy TODO issue: {legacy_number}",
    f"Migrated status: `{status}`",
    "",
    "## Historical details",
    "",
  ]
  lines.extend(f"- {detail}" for detail in details)
  lines.extend([
    "",
    "---",
    "Migrated from the repository's historical `TODO.md`. The legacy issue number is preserved for references in code, diagnostics, and earlier project history; the GitHub issue number is the canonical tracker ID going forward.",
  ])
  return "\n".join(lines)


def sync_issue(issue: dict[str, object]) -> int:
  legacy_number = int(issue["legacy_number"])
  title = str(issue["title"])
  status = str(issue["status"])
  label = STATUS_LABELS[status][0]
  gh_title = f"Legacy ISSUE {legacy_number} — {title}"
  body = body_for(issue)
  existing = find_existing(legacy_number)

  if existing is None:
    raw = run(
      "gh", "issue", "create",
      "--repo", REPO,
      "--title", gh_title,
      "--body-file", "-",
      "--label", label,
      input_text=body,
    )
    match = re.search(r"/(\d+)$", raw)
    if not match:
      raise RuntimeError(f"Could not parse issue number from: {raw}")
    number = int(match.group(1))
  else:
    number = existing
    run(
      "gh", "issue", "edit", str(number),
      "--repo", REPO,
      "--title", gh_title,
      "--body-file", "-",
      input_text=body,
    )
    # Replace migration status labels while preserving unrelated labels.
    current_raw = run("gh", "issue", "view", str(number), "--repo", REPO, "--json", "labels")
    current_labels = [entry["name"] for entry in json.loads(current_raw)["labels"]]
    for existing_label in current_labels:
      if existing_label.startswith("status: ") and existing_label != label:
        subprocess.run(["gh", "issue", "edit", str(number), "--repo", REPO, "--remove-label", existing_label], check=True)
    if label not in current_labels:
      run("gh", "issue", "edit", str(number), "--repo", REPO, "--add-label", label)

  if status in ACTIVE_STATUSES:
    subprocess.run(["gh", "issue", "reopen", str(number), "--repo", REPO], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
  elif status == "DONE":
    subprocess.run(["gh", "issue", "close", str(number), "--repo", REPO, "--reason", "completed"], check=True)
  else:
    subprocess.run(["gh", "issue", "close", str(number), "--repo", REPO, "--reason", "not planned"], check=True)

  return number


def main() -> None:
  issues = parse_todo(TODO.read_text(encoding="utf-8"))
  ensure_labels()
  mapping = {}
  for issue in sorted(issues, key=lambda item: int(item["legacy_number"])):
    legacy_number = int(issue["legacy_number"])
    github_number = sync_issue(issue)
    mapping[str(legacy_number)] = github_number
    print(f"Legacy ISSUE {legacy_number} -> GitHub #{github_number}")

  Path("TODO-ISSUE-MIGRATION.json").write_text(
    json.dumps(mapping, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
  )


if __name__ == "__main__":
  main()
