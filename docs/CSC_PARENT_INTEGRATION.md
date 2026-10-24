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
## 7. V3 coordinator audit (2026-10-23)

Session: `dc-csc-359-v3-20261023T115716Z`. Exclusive claim is
[#359 comment 6364342545](https://github.com/Ma-XX-oN/DownloadConversation/issues/359#issuecomment-6364342545).
All previous #359 comments were reviewed for competing ownership.
The posted claim was re-fetched and confirmed as the only active
`DC-CSC-AGENT-CLAIM-V1` on #359. This is not merge authorization.

### Live completion graph and source inventory

The topmost 2026-10-22 Mermaid graph in #308 is authoritative:
`#318 -> #359 -> #232 -> #319 -> #308`, with independent direct
`#359 -> #319`. The required upstream #306/#310/#311/#313/#317
leaves are DONE. The independent #297/AICC #127 identity witness
is not an incoming #359 prerequisite. #320 remains DEFERRED.
#318 is now STARTED (claim comment 6364205193; separate session
`dc-csc-318-v3-20261023T114923Z`), but still INCOMPLETE.
It must not be taken over by the #359 coordinator.

All six PRs below are still open, draft, unmerged, and
UNINTEGRATED into #359. They have separately retained owners.

| Leaf | PR | Observed exact HEAD |
| --- | --- | --- |
| #309 | #324 | `22a889e9872a1eb21fb750de9cf8619c2b3fb0c7` |
| #310 | #327 | `68515bfd38afad6d7eba389a7bc39e51d35d3584` |
| #306 | #351 | `bff52f9996365e996e3dbe1a56b0c5fcb7a231b2` |
| #311 | #326 | `a0b06f94033d321970b7781ccfb0b47b663433ef` |
| #313 | #323 | `6020d4bd9e811a46efe9a14074002cfa16862f05` |
| #317 | #358 | `197b346b505b2318e3155bf2557df416dd1702e3` |
| #318 | — | no accepted completed source candidate |

#306 PR #351 is stacked on #310; #317 contains inherited #311
source. Import must compare exact deltas, resolve overlap under
source-owner review and not cherry-pick cumulative changes twice.
The original branch/PR parent identities must never be rewritten.

Current observed server main:
`9e52016e8271845873ab32914a79f18252391b17`.
#359 parent before this documentation update:
`f03d90d0dc76426df8fd96f88728a0627bfc382c`.
Preserve #359's original RWF parent-identity commit
`c0f9e6095488fb4d2fedc7250d7e36f02c41e826`.

### Exact source-contract audit (not an assembled runtime test)

9/9 static diagnostic assertions matched the pinned source bytes.

1. #313 `communicationPersistentHmacService().admit()` returns
   a private token and metadata containing canonical `key_restart`,
   `redaction_key_epoch`, `redaction_key_storage` and format.
   `provision(token,worker)` transfers the HMAC key privately;
   `complete(token)` requires a terminal disposition.
2. #313 committed `cycleEvents` use
   `id = 'hmac-key-cycle:' + key_restart` and fields
   `{type,id,key_restart,epoch,occurred_at_ms,reason}`.
3. #311 `04-csc-comm-worker-processing-part3.js` still requires
   `redaction_scope == redaction_key_generation` and storage
   `tampermonkey-script-installation`. Its `csc-comm-start`
   frame has no `key_restart`. The #313 metadata fails this
   Worker check and then fails the #317 Writer start check.
4. #311 `04-csc-comm-worker-processing-part2.js` still validates
   a 32-hex `generation` and
   `hmac-key-cycle:<epoch>:<generation>`. It does not emit the
   #313 canonical cycle event, so #317 rejects the frame.
5. #317 `04-csc-comm-disk-writer.js` already emits physical
   `{version:{comm,gen},key_restart}` before fragment records,
   requires start-record `key_restart` to match, and validates
   `hmac-key-cycle:<key_restart>` plus matching timestamp.
6. #317 `04-csc-comm-disk-bridge.js` includes the #311 processor
   in the default Worker build. It uses Worker-local
   `self.cscCommWriteChunk` as its sink. The isolated Writer
   and processor tests DO NOT prove their joint compatibility.
7. #309 exposes `cscBindCommWorker` and
   `cscBindPluginIngress` as distinct consumer interfaces;
   #310 binds `cscPluginQueuePublish` and uses
   `cscPluginQueueConnect/Disconnect` for #306's existing
   main-thread host. Preserve exactly this LEGO separation.

**Confirmed failure:** these old #311 and new #313/#317 frame
schemas are incompatible. This diagnosis belongs to #359; it
does not reopen or invalidate the isolated DONE leaves.

Required owner-reviewed #359 source correction:

- Retire the *public* random generation/scope identity.
  Validate canonical #313 `key_restart` and current storage scope.
  Do not log private admission tokens, keys or credentials.
- Pin each capture to its admitted key until a separately durable
  terminal acknowledgement; allow old-key draining and only then
  advance Writer/GEN fragment boundaries.
- Carry the identical producer `key_restart` into every COMM start,
  Writer control/header, GEN start and committed cycle event.
  Never independently timestamp the persisted key boundary.
- Align #311 event validation/serialization with the canonical
  #313 shape and #317 idempotent durable-write protocol.
- Leave #318's UI/GEN/confirmed Randomize implementation to its
  current worker; coordinate Worker configuration and GEN handoff.
- Keep original network timestamps, strict sequence, both
  independent native clone consumers, and Worker-only COMM queue.
  No source-size truncation, no legacy literal `[redacted]`
  replacement and no unreviewed private-data exposure.
- Review old main-thread log storage versus new
  `dc-csc-comm-segments/2` and test physical export, recovery,
  duplication, reset, key rotation and decoder compatibility.
- Run negative tests for malformed/stale key timestamps, old/new
  key mixing, missing Writer acknowledgements, duplicate cycles,
  unsafe/opaque payloads and interrupted physical writes, then
  test the exact assembled SHA. #232/#319 retain performance
  and independent real-browser certification ownership.

### V3 acceptance ledger

| Gate | Evidence | Status / owner |
| --- | --- | --- |
| Exclusive #359 claim | Issue comment/readback | PASS / #359 |
| Graph and separate #318 ownership | Live issues | PASS / #359 |
| Six exact leaf HEADs and draft PRs | GitHub PR reads | PASS / #359 |
| #306/#310 public host/queue contract | Pinned source | PASS / #359 |
| #311/#313/#317 mismatch diagnosis | 9 static assertions | PASS / #359 |
| Executable combined schema | Rejected current fields | FAIL / #359 |
| #318 UI/GEN/Randomize acceptance | Worker active | INCOMPLETE / #318 |
| Reviewed import + assembled source | No merge authorization | INCOMPLETE / #359 |
| Exact GEN+COMM readback | No candidate | INCOMPLETE / #319 |
| Decoder and full privacy certification | No candidate | INCOMPLETE / #319 |
| 10/23/40/>100MiB sustained tests | No candidate | INCOMPLETE / #232 |
| Exact assembly/full hosted/browser CI | No candidate | INCOMPLETE / #359 |
| Automatic parent policy enforcement | Historic schema only | FAIL / policy |
| PRELIM/INT-ATTEMPT/main promotion | Not authorized | DEFERRED |

This audit is **documentation only**, not an imported source,
a test run on assembled code, a rewritten child PR base or a
certified release. All previous ledger evidence is retained.
No existing source owner has authorized source import/merge here.
## 8. DC #318 live interface and branch-policy observation

As of 2026-10-23, #318's separately owned draft PR #362 exists:
`issue-318-csc-controls`, targeting `issue-359-csc-integration`.
Its first branch-specific commit
`f52d572448f4688ea592c3fb281fb44ab950c6a5`
has the correct `RWF-Branch` and `RWF-Parent` trailers.
It points to #359's pre-doc-update `f03d90d0` and has the
**identical Git tree**, confirming a real empty parent-marker commit.
The branch remains active; the observed initial source HEAD
`abe1a34a643d5b043409d1931cebabe73e32a565` was already
followed by additional #318 commits during this audit.
Do not record that provisional HEAD as accepted.

#318 exports `cscCaptureControlPlane` with independent adapter ports:

- Worker: `pause, configure, resume, provisionTarget, awaitKey`.
- COMM: `drain, beginKeyBoundary, writeCycle, hasCycle`.
- GEN: `beginSegment, writeCycle, hasCycle`.

Its config-handshake contract requires an acknowledgement containing
`type:'csc-comm-configured'` plus matching `schema` and `request_id`.
The current #311 processor emits **only** the type (without those
fields).  It therefore cannot satisfy #318's strict Worker adapter
without reviewed #359 implementation.

Additionally, #318 requires a positive durable COMM key-boundary
acknowledgement.  #317's current `setRestart` implementation seals
and updates its key; the `csc-writer-key-restart` message listener
returns **no correlated success event**.  A reviewed #359 adapter or
Worker extension must produce a *real* durable boundary result, not
assume a queued control message proves persistence.  Do not weaken the #318
acknowledgement standard to accommodate the old producer.

PR #362 hosted run
[39950479289](https://github.com/Ma-XX-oN/DownloadConversation/actions/runs/39950479289)
finished FAIL at the **branch policy** stage.  Jobs prepare,
validate and finalize were SKIPPED.  Exact policy diagnostic:

`RepoWorkflow error: pull request base issue-359-csc-integration`
`does not match integration target main`

This exposes the existing stale RWF main-parent schema.  The
#318 PR has the correct new parent topology.  **Do not retarget
it to main to silence policy CI.** The separate authorized
branch-policy consumer migration must accept the true parent
and re-execute actual hosted source validation before PASS.
A policy-only failure does not certify or refute #318 source tests.

#318 worker was notified in its issue at comment 6364545558;
ownership and pending source acceptance remain unchanged.
## 9. Final V3 exact-source verification and replay-fidelity gap

The coordinator independently re-opened the actual four GitHub Actions
jobs (`policy`, `prepare`, `validate`, `finalize`) at each
historical accepted leaf run.  All four jobs finished SUCCESS for
each of the six sources below.  These are **leaf source tests**;
they are not #359's unbuilt assembled test.

| Leaf | Hosted Actions run | Four real jobs |
| --- | --- | --- |
| #306 | 39639619645 | 4/4 SUCCESS |
| #309 | 39145603779 | 4/4 SUCCESS |
| #310 | 39323944036 | 4/4 SUCCESS |
| #311 | 39641245082 | 4/4 SUCCESS |
| #313 | 39833211392 | 4/4 SUCCESS |
| #317 | 39850208578 | 4/4 SUCCESS |

#318 owner source handoff comment
[#6364592750](https://github.com/Ma-XX-oN/DownloadConversation/issues/318#issuecomment-6364592750)
confirms independent PR #362 remains INCOMPLETE and separately
owned.  Its latest observed live HEAD is
`4c1c0a629683be42d437514905e9ea6786bb0d3a`; source may
continue changing under its original worker.  Its exact hosted
source tests have **not** passed: run #39951490406 fails
old parent policy; push run #39951483861 executes policy only.
The #359 coordinator must not retarget the PR or treat policy
success as source certification.

**Additional fidelity defect (verified directly in pinned #311
`04-csc-comm-worker-processing.js`):** selector `selected(event)`
handles JSON, SSE and certain binary transport classes, but for
other browser-accessible text returns
`{status:'unsupported',reason:'csc-unsupported-text-format'}`
even in `policy.mode === 'everything'`.  This violates the
record-everything product requirement for selected accessible
text; it explicitly records omission instead of preserving the
requested data.  Preserve the fail-closed credential/privacy
properties; parent #359 must negotiate a context-aware safe text
serializer or an explicit user-approved exception.  Do not
silently reinterpret `everything` as JSON/SSE-only and do not
disable sanitization to force raw output.

The currently accepted leaf code, #318 public control ports,
#317 durability guarantees, existing recording group `1`,
and all user-approved original-source boundaries remain unchanged.
## 10. Continuation: refreshed #318 and source-delta map

Coordinator V3 resumed 2026-10-23 22:20 EDT, original claim
`dc-csc-359-v3-20261023T115716Z` (#6364342545), unchanged.
The current #308 graph remains authoritative; #318 is STARTED,
not DONE, and is #359's genuine incoming completion prerequisite.

### #318 exact isolated source evidence

New #318 PR #362 HEAD is
`bde7e9ef137281ae914803b56c5104ad7f38f3ec`.
Its dedicated *push* run [39971645269](https://github.com/Ma-XX-oN/DownloadConversation/actions/runs/39971645269)
has one real hosted `focused-controls` job, completed SUCCESS;
#318's owner's test artifact reports 27/27 controller+GM,
4/4 native headless Chromium and 34/34 adjacent regressions,
65/65 combined. The compiled isolated userscript artifact is
#12509870623 (1,280,676 bytes; SHA-256
`c043a9dda9a524d5ec44bde0d231dc21e24d1a4d8ff8acfbdbdc7cb3726ef0b5`).
This is *isolated #318 evidence*, not the routine PR matrix,
signed-in Tampermonkey, real Worker/writer or #359 assembly.

Pinned #318 source in `03-csc-control-plane.js` implements
`cscControlsRegisterHmacFactory(factory)` and locks registration
after the singleton has been constructed. The #318
`05-bootstrap-part2.js` invokes `cscControlsCurrent().init()`.
Therefore #359's real assembly must register the authoritative
#313 factory **before first controller construction** and then
supply actual Worker, GEN and COMM ports. This chronology was
inspected directly in the exact #318 code, not inferred from CI.

Current `.ci/branch-policy.json` blob
`0737b8f141c74b2a29642bcf18d8bd8542db1e05`
still maps pattern `issue-*` to parent `main`. Current
`.ci/repoworkflow.json` blob
`244742ec7cb9fce1dbdb61a72c89daedd6cb9fc3`
declares repository integration branch `main`. The ordinary
PR #362 branch-policy FAIL is an actual contract mismatch.
A scoped, owner-approved rule for the true #318 parent is
required, **not** a PR retarget or wholesale disabling of policy.

### Reviewed immutable delta precedence (NO source imported)

Live source compares, independent of cumulative PR file counts:

| Verified SHA range | Distinct source delta |
| --- | --- |
| #309 -> #310 | Plugin backlog; manifest/build metadata |
| #310 -> #306 | Early navigation/host bridge; manifest/bootstrap |
| #309 -> #311 | Worker processing and processor test seam |
| #311 -> #317 | Worker disk writer/bridge and Test probe |
| #359 -> #318 | UI popup/control, bootstrap and settings |

All five GitHub source comparisons succeeded. The #318
source comparison currently diverges because #359 acquired
additional **documentation-only** ledger commits after its
correct empty child marker. Do not rewrite the child marker.
#313 is a separate historical #312-derived branch; review
its canonical current producer modules without reintroducing
the retired experimental scope as an active data contract.

Every stream changes the same manifest/version/build surfaces;
cumulative cherry-picks or overlapping generated artifacts
would be invalid without content-level review and new tests.
No source import authorization has been granted in #359/#308,
and no leaf is merged by this continued source audit.

### Pending final gate

#359 still needs explicit owner/operator source-import approval,
completed #318 source/UI acceptance, review of #311/#313/#317
contract changes, real GEN+COMM ports/headers and actual
combined candidate testing. #232 and #319 remain independent.
