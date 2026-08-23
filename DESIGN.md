# DESIGN — DownloadConversation

## Document role

`DESIGN.md` is the canonical statement of the project's **current intended design**.
It should describe the design that is supposed to be true now, without retaining
obsolete alternatives in the visible document merely for historical purposes.

Historical design evolution belongs in Git history.  `TODO.md` remains the visible
historical work ledger: it records what was proposed, implemented, tested,
superseded, corrected, and why.

## Project identity

- Canonical project/repository name: `DownloadConversation`
- Canonical current-design document: `DESIGN.md`
- Canonical work/history ledger: `TODO.md`

## Continuity rule

Before resuming implementation in a new session, reconcile the current `DESIGN.md`
and `TODO.md` iteratively until the active work, inherited verified behaviour, and
latest corrections are all accounted for.  Preserve previously verified behaviour
unless the design itself is faulty or new evidence disproves the prior fix.
