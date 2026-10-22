# CSC Parent-Branch Integration Ledger

Status: SCAFFOLDING ONLY (2026-10-22).  Issue: #359.  Epic: #308.
Independent convergence certification: #319.

## 1. Authority and topology

We are applying the principles of RepoWorkflow now, despite its unfinished
`rwf done` executor.  This file records an *explicit integration procedure*,
not a claim that RWF automatically enforces these gates in this repository.

```text
main @ 094b6994
  |
  +-- issue-359-csc-integration (persistent assembly parent)
        |-- NEW child work branches from this parent, with RWF identity
        |-- reviewed imports from already-owned legacy main-parent branches
        |-- assembled source integration and updated interface contracts
        '-- independent #319 acceptance on an exact candidate

Accepted #359 + independently certified #319
  -> PRELIM-359/main-<GUID> (immutable submission)
  -> INT-ATTEMPT-359/main-<GUID> (coordinator workspace, current main)
  -> destination CAS + exact validation + explicit merge authorization
  -> protected server main
```

The branch identity is **Git history**, not ticket dependency text:
`RWF-Branch: issue-359-csc-integration` and `RWF-Parent: main`
are on an empty first branch-specific commit, with the creation-parent
commit in its first-parent slot.  Recover the parent from history.
Do not change its marker or rebase it away.

For **new** children, create a real branch from
`issue-359-csc-integration` and establish that parent in Git history.
A successful child integrates back into the same parent.  Do not merge
any child directly into `main`.  Existing leaves were created from
`main`; their prior Git identity is historical and cannot be
retroactively changed merely by editing a pull-request base.
Integrate reviewed source into this parent without forging ancestry.
Keep all source-owner restrictions and explicit merge approval gates.

## 2. Source inventory: every entry is UNINTEGRATED here

| Issue | Existing source/PR | Observed source status | This parent |
| --- | --- | --- | --- |
| #301 | PR #304, `3a948a4f` | Historical V1; retired for new format | OMIT V1 codec |
| #309 | PR #324, `22a889e9` | Leaf certified; main-based | PENDING review |
| #310 | PR #327, `68515bfd` | Leaf unmerged; main-based | PENDING review |
| #306 | PR #351, `bff52f99` | Existing stack based on #310 | PENDING owner coordination |
| #311 | PR #326, `a0b06f94` | Worker sanitizer; old HMAC fields | PENDING schema fix |
| #312 | PR #321, `4202b710` | Superseded random-ID scope design | DO NOT import old schema |
| #313 | PR #323, `6020d4bd` | Producer CI PASS; installed Chrome lifecycle PASS | READY FOR ASSEMBLY REVIEW; physical GEN/COMM pending |
| #317 | PR #358, `6cecd18e` | Writer WIP, not accepted | PENDING |
| #318 | No integrated candidate verified | Config/rotation UI incomplete | PENDING |
| #232 | Independent performance evidence | Final assembled measurements missing | PENDING |
| #319 | Independent acceptance ticket | Must test completed #359 candidate | NOT STARTED |

**#313 witness update (2026-10-22):** Exact producer SHA
`6020d4bd9e811a46efe9a14074002cfa16862f05` passed hosted CI
run #39833211392 and signed-in Chrome/Tampermonkey v0.2.1 two-tab
Stage 1 and Stage 2.  Reload persistence, in-flight draining, 25h
simulated overdue and confirmed manual key rotation passed.  An earlier
`at-least-one-peer-required` report was an inconclusive BroadcastChannel
peer-discovery observation within an artificial 850ms window; it does not
show a failing key value, rotation, or cross-tab consistency.  Do NOT
require tab-to-tab response timing as a production acceptance criterion.
Source and exact test evidence: DC #313 issue comment #6349295095.
The #313 producer is **ready for owner-reviewed integration**, not
merged, and complete GEN/COMM disk/header evidence remains unverified.

Other prerequisite probes (#314/#316), previous V1 encoder/decoder
certification (#300/#301/#302/RWF #673/#691), and older source
tests may inform reviews but do NOT become merged functionality or
proof of the revised complete recorder.  All SHAs in this table are
*observed at ledger creation*, not leases or guarantees of freshness.
A coordinator must re-fetch each SHA, PR, issue and evidence before
the corresponding integration operation.

## 3. Non-negotiable integration contracts

1. The active COMM path must record through one dedicated Worker-owned
   streaming sanitizing serializer.  The legacy literal `[redacted]`
   recording path is superseded by HMAC secret markers.  Elimination
   must never permit captured raw credentials to leak: missing/unsafe
   contexts fail closed, with explicit incomplete/omission provenance.
2. One persistent HMAC key is shared across tabs.  The ONLY nonsecret
   public generation identity is its persisted UTC `key_restart`.
   Automatic/manual changes produce a new key + strictly increasing
   timestamp, ordinary reloads do not.  Remove public random IDs.
3. **COMM:** every fragment begins with `version` and the exact
   authoritative `key_restart`, before body/event rows.
   **GEN:** each key-generation segment begins with `version` and
   the SAME `key_restart`, before generation content.  No stream may
   independently timestamp the key boundary or mix different keys.
4. The existing #311 Worker currently expects
   `redaction_scope` / `redaction_key_generation` and old
   `tampermonkey-script-installation` metadata, while revised
   #313 emits `key_restart` under `chatgpt-origin-indexeddb`.
   THIS IS A CONFIRMED SOURCE-CONTRACT MISMATCH.  Resolve explicitly
   with both owners, then retest the assembled integration.
5. Preserve earliest network event timestamps/ordering, untouched
   original fetch/XHR/WebSocket traffic, independent main-thread
   plugin queue and Worker-owned COMM queue.  Both native body clones
   are only for independent consumers; no extra page-thread COMM queue.
6. Historical V1 experimental secret-marker/log backward-compatibility
   is abandoned by operator decision.  Keep prior Git evidence but
   do not require a V1 decoder in the new release.  No authentic
   private log fixture or key bytes in Git.
7. Durable #317 file/ack/rotation/restart recovery and #318 controls
   must be integrated with independent #319 exact physical GEN/COMM
   file readback and the newly aligned decoder.  Test full body sizes,
   errors, backpressure, CPU and UI responsiveness as documented.

## 4. Child-to-parent execution (per candidate)

1. Check claim/owner, actual RWF Git parent marker, source HEAD and
   PR base before touching a child's branch.  Preserve its ownership.
2. Check its current acceptance ledger and provider/test artifacts.
   Old green evidence on different bytes is historical, not approval.
3. Agree exact source import/reimplementation scope with the owner.
   Do not rewrite or delete earlier owner-specific proof.
4. Resolve source conflicts and semantic contract mismatches in a
   reviewable parent candidate, without modifying `main`.
5. Run focused regression and full tests for the exact assembled
   parent SHA.  Record failures and continue independent checks.
6. Obtain needed operator merge authorization before any integration.
   Record landed SHA, source SHA, test evidence and conflict owner.

Never treat a source-only CI PASS as physical installed Chrome or
durable file-write acceptance.  No hidden compensating legacy writer.

## 5. Parent-to-main PRELIM

The current RWF #108/#109 October 17 contract supersedes the older
simple shared-`prelim-main` design.  Publish one immutable
`PRELIM-359/main-<GUID>` submitted SHA after #319 PASS and explicit
authorization.  A destination coordinator then creates a separate
`INT-ATTEMPT-359/main-<GUID>` branch from current server main,
retains current destination-policy checks, resolves any new conflicts,
revalidates changed candidates, and uses expected-old-SHA acceptance.

While #109/#677 are incomplete, perform these steps only under
explicitly authorised manually evidenced discipline.  No ordinary
leaf-to-main merge; no release on a stale source; no assertion that
deferred GitHub branch protection is already installed.

**Current acceptance:** parent identity PASS; source assembly
INCOMPLETE; independent #319 evidence INCOMPLETE; PRELIM DEFERRED;
main promotion NOT AUTHORISED.

## 6. Enforcement gaps verified during setup

- GitHub's reported `main.protected` value is `false` as of this
  checkpoint.  Protected-main server enforcement MUST NOT be claimed.
  Operators and workers must observe the no-direct-merge rule manually.
- DC's pinned `RepoWorkflow` submodule is historical v0.1.1, and
  `.ci/branch-policy.json` is schema 1 with generic `issue-*`
  branches assigned to parent `main`.  That configuration cannot
  enforce new CSC child branches under `issue-359-csc-integration`
  without an independently owned/verified consumer policy migration.
- Current `.ci/repoworkflow.json` is schema 1 and identifies `main`
  as the integration branch.  It does not represent the October 17
  immutable PRELIM / separate INT-ATTEMPT submission/executor.
- New CSC child branches must explicitly record their true Git parent;
  merely editing a pull-request base or issue dependency cannot fix
  existing ancestry.  An unverified manual source import is NOT a
  source integration PASS.
- The parent branch has exactly two new commits at initial setup: one
  empty RWF identity commit and one documentation-only ledger commit.
  `main` and all preexisting leaf PR branch bases are unchanged.

Future enforcement should fail closed on a wrong parent identity,
direct leaf-to-main PR, missing source SHA / artifact provenance,
unsatisfied #319 acceptance, a stale destination tip and missing merge
authorization.  Do not label any of these policies mechanically
enforced until their exact implementation and verification exist.
