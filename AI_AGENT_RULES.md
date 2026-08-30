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

### Scope and evidence rule

When implementing a requested fix or update:

- Make only the change the user asked for.
- Do not alter working production behaviour to address a hypothetical failure
  mode, theoretical concern, synthetic-only scenario, cleanup opportunity,
  refactor, or unsolicited improvement.
- A synthetic test demonstrates what code would do under invented conditions;
  it is not evidence that the production problem exists.
- If a separate real issue is discovered, require concrete evidence from the
  actual implementation, real API/DOM/data, diagnostics, or a reproducible
  production failure before changing production behaviour for it.
- Track that separate evidenced issue independently and discuss it with the user
  rather than silently broadening the current task.
- Implement a separate issue in its own commit. Do not bundle an unrelated fix,
  redesign, refactor, cleanup, or speculative protection into the commit for the
  user's requested change.
- If stronger validation or diagnostics can gather evidence without changing
  production behaviour, prefer that over speculative behaviour changes.

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

## Code documentation standard

Every named production JavaScript function and named function-valued constant
must have an immediately preceding JSDoc block using `/** ... */`. The comment
must state the function's purpose. Every declared parameter must have an
`@param` tag with the actual expected JSDoc type and a description of what the
parameter represents. Every function must have a typed `@returns` tag whose
description states what the return value represents; functions with no
meaningful return value use `@returns {void}`.

Every production-scope constant and variable must also have an immediately
associated explanatory comment stating what the value represents, controls, or
tracks. This includes top-level `const`, `let`, and `var` declarations throughout
the userscript, not only the declarations near the file header. Local variables
must be commented when their role is not self-evident from the identifier and
immediate expression. In particular, document state/lifecycle guards, protocol
or ordering state, correlation state, cursor/ordinal semantics, caches/lookups,
recovery state, and other variables whose meaning depends on an invariant.
Trivial loop counters and direct one-use values should not receive redundant
comments merely to increase comment density.

JSDoc indentation is part of the code style contract. The opening `/**` and
closing `*/` must use the same indentation as the declaration they document.
Every interior JSDoc line must use that same indentation followed by exactly one
space and `*`. Tags and blank `*` lines must follow the same alignment. Do not
emit partially de-indented generated blocks. Inline comments for local state
must use the same indentation as the declaration or statement they explain.

Types must describe what the implementation actually accepts and returns. Do
not use broad placeholder unions or guessed types merely to satisfy the audit.
When a function normalizes, transforms, projects, or otherwise changes the
representation of source/provider data, its documentation must also state the
actual source representation and the canonical/output representation when they
differ.

Do not use ordinary `//` comments as the function-level documentation marker.
Inline comments remain appropriate for local algorithm details and rationale.
Anonymous inline callbacks do not require separate JSDoc unless they are
promoted to named reusable functions.

## Verification

Perform the established project preflight for code revisions, including syntax
checks, test-ID uniqueness where applicable, package integrity, packaged-source
byte identity, and a real diff against the previous revision.

For tracker/document migrations or other repository-maintenance changes, verify
the resulting repository state directly: expected files, issue count/mapping,
open/closed states, status labels, and absence of temporary migration files.

If verification cannot be completed, state exactly what was not verified and
why.
