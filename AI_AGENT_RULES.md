# AI Agent Rules — DownloadConversation

## Purpose

This file is the persistent operating contract for AI agents working on the `DownloadConversation` project. It exists so that work survives conversation limits and new sessions without silently losing previously established requirements or verified fixes.

## Source-of-truth roles

- `AI_AGENT_RULES.md` — how an AI agent must work on this project.
- `DESIGN.md` — what the project is, how it is designed to work, the design principles it follows, and why those choices were made.
- `TODO.md` — the historical work ledger. It records proposed work, implementation history, corrections, superseded decisions, test results, and rationale. Historical entries are not deleted merely because a later decision supersedes them.
- Git history — preserves the evolution of current documents and source without cluttering the visible current design with obsolete alternatives.

## Session-start recovery rule

At the start of a new conversation, or after any context loss, iteratively reread `AI_AGENT_RULES.md`, `DESIGN.md`, and `TODO.md` until the current `WORK_IN_PROGRESS` item, inherited `DONE`/`IN_REVIEW` requirements, latest verified fixes, and current design have been reconciled.

Do not rely on conversation memory when the repository documents can establish the current project state.

Preserve previously verified behaviour by default. Change it only when the design itself is faulty, the user explicitly changes the requirement, or new evidence disproves the previous fix or assumption.

## Requirement and code-change discipline

Before changing code or changing/clarifying a requirement:

1. Ensure the work is represented in `TODO.md`.
2. If the change affects the project's current architecture, behaviour, or design principles, update `DESIGN.md` in the same revision.
3. If the change affects how AI agents must work on the project, update `AI_AGENT_RULES.md` in the same revision.
4. Preserve TODO history. Mark superseded requirements as superseded or add later corrective history rather than erasing the historical record.
5. Keep the TODO generator and generated `TODO.md` semantically aligned.

Before delivering a revision, compare the implementation and tests against the documented inherited requirements, including shared UI, lifecycle, recovery, file-safety, and validation behaviour. A new path or test must not silently reimplement or weaken an already established contract.

## Verification

Perform the established project preflight for code revisions, including syntax checks, test-ID uniqueness where applicable, package integrity, packaged-source byte identity, and a real diff against the previous revision.

If verification cannot be completed, state exactly what was not verified and why.
