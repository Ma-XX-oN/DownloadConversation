# AI Agent Rules — DownloadConversation

## Purpose

This file is the persistent operating contract for AI agents working on the
`DownloadConversation` project. It exists so work survives conversation limits
and new sessions without silently losing previously established requirements or
verified fixes.

## Source-of-truth roles

- **GitHub Issues** — the canonical work tracker and historical issue ledger.
  Open/closed state, status labels, issue bodies, comments, and links to commits
  preserve proposed work, implementation history, corrections, superseded
  decisions, test evidence, and rationale.
- `AI_AGENT_RULES.md` — how an AI agent must work on this project.
- `DESIGN.md` — what the project is, how it is designed to work, the design
  principles it follows, and why those choices were made.
- `TODO-ISSUE-MIGRATION.json` — historical mapping from the former TODO issue
  numbers to the GitHub issue numbers created during the 2026-08-23 migration.
  Use it when old code, diagnostics, conversations, or documentation refer to
  `ISSUE N` from the retired TODO ledger.
- Git history — preserves prior versions of source and project documents.

`TODO.md` and `generate-TODO.py` were retired after their complete issue set was
migrated to GitHub Issues. Do not recreate a parallel TODO tracker unless the
user explicitly changes this project policy.

## Session-start recovery rule

At the start of a new conversation, or after any context loss:

1. Read `AI_AGENT_RULES.md` and `DESIGN.md`.
2. Read the relevant **open GitHub Issues**, paying particular attention to the
   item labelled `status: work in progress` and any related `status: in review`,
   `status: ready`, or `status: blocked` items.
3. Read relevant closed issues when needed to recover inherited requirements,
   previously verified fixes, rejected approaches, or historical rationale.
4. Follow links to commits, diagnostics, or other evidence when an issue's
   current state depends on them.
5. Reconcile those sources before implementation resumes.

Do not rely on conversation memory when the repository and GitHub Issues can
establish the project state.

Preserve previously verified behaviour by default. Change it only when the
design itself is faulty, the user explicitly changes the requirement, or new
evidence disproves the previous fix or assumption.

## Requirement and code-change discipline

Before changing code or changing/clarifying a requirement:

1. Ensure the work is represented in a GitHub Issue. Small follow-ups that stay
   within the current work-in-progress issue belong in that issue; distinct work
   should receive its own issue.
2. Update the relevant issue with new requirements, implementation decisions,
   test evidence, corrections, or superseding information. Do not leave the only
   durable record in chat.
3. If the change affects the project's current architecture, behaviour, or
   design principles, update `DESIGN.md` in the same revision.
4. If the change affects how AI agents must work on the project, update
   `AI_AGENT_RULES.md` in the same revision.
5. Preserve history. Do not erase earlier issue rationale merely because a later
   decision supersedes it; record the correction or superseding decision in the
   issue history.

Before delivering a revision, compare the implementation and tests against the
inherited requirements recorded in relevant open and closed issues, including
shared UI, lifecycle, recovery, file-safety, and validation behaviour. A new
path or test must not silently reimplement or weaken an established contract.

## Status labels

The migrated tracker uses these status labels:

- `status: ideas` — not fully specified.
- `status: work in progress` — actively being worked on.
- `status: ready` — defined enough to start.
- `status: in review` — implemented and awaiting live verification/review.
- `status: blocked` — cannot proceed until a stated prerequisite is available.
- `status: done` — completed and verified; issue is closed as completed.
- `status: will not fix` — intentionally not being implemented; issue is closed
  as not planned.
- `status: legacy` — superseded approach kept for historical context; issue is
  closed as not planned.

Keep active status meaning explicit. Do not label multiple unrelated pieces of
serial work as `status: work in progress` merely because they are open.

## Legacy TODO references

The former TODO allocated permanent legacy issue numbers 1 through 64. Those
numbers occur throughout older diagnostics, source comments, chat history, and
issue prose. They were preserved during migration rather than renumbered.

GitHub issue #1 predates the migration, so migrated legacy issue numbers do not
match GitHub issue numbers. Consult `TODO-ISSUE-MIGRATION.json` instead of
assuming an arithmetic relationship.

## Verification

Perform the established project preflight for code revisions, including syntax
checks, test-ID uniqueness where applicable, package integrity, packaged-source
byte identity, and a real diff against the previous revision.

For tracker/document migrations or other repository-maintenance changes, verify
the resulting repository state directly: expected files, issue count/mapping,
open/closed states, status labels, and absence of temporary migration files.

If verification cannot be completed, state exactly what was not verified and
why.
