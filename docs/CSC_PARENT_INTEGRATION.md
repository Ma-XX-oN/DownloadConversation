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
Keep all source-owner restrictions. Internal reviewed child-to-parent assembly
is authorised under the standing RWF parent-owner rule; explicit operator
approval applies to destination promotion, not routine non-release imports.

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

**Authority clarification (2026-10-27, user-approved):** The exclusive DC #359
owner may perform ordinary owner-reviewed source imports of individually
accepted leaves into this dedicated parent branch without a separate user
permission request each time. Earlier statements that this issue does
not *itself* authorize import or that operator merge authorization is
required *before any integration* are superseded for this non-release
parent assembly step. Owner reviews, acceptance gates, exact SHA provenance,
scope restrictions and assembled regression remain mandatory. An
incomplete #318 candidate supports only bounded speculation until accepted;
it must not be represented as accepted or used for parent DONE. No
authority to merge to `main`, submit PRELIM without its own gate,
or activate production is granted.

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
6. The existing #359 parent owner has standing authority for routine,
   reviewed, independently accepted child-source imports into the non-release
   `issue-359-csc-integration` parent branch; no per-import operator approval
   is required. Record landed SHA, source SHA, test evidence and conflict owner.
   Preserve source-owner review and any separately explicit restriction.
   Operator approval remains required for PRELIM/main promotion and release.

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
Its dedicated *push* run `39971645269`
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

## 11. Follow-up source/CI diagnostic matrix

See [DC #359 source contract diagnostics](CSC_359_INTERFACE_NEGATIVE_MATRIX.md)
for the pinned #311/#313/#317/#318 contract checks (28/28 structural),
16/16 isolated Node fixture checks and RWF exact-rule policy analysis.
These are NOT assembled-source PASS, source-import authorization or release.

## 12. Released main 1.11.15 rebase CI diagnosis

See [exact hosted failure analysis](CSC_359_11115_REBASE_CI_DIAGNOSIS.md).
The #359 test-only matrix had 4 PASS / 1 FAIL jobs; #318 had
6 PASS / 1 FAIL.  Old GM grants conflict with released raw/no-grant
registration.  No source import or final candidate is authorised.


## 13. 2026-10-27 non-release accepted-source staging under RWF §13.5

Authority: RWF PR #750 merged 2026-10-27T14:02:25Z and DC PR #380 merged 2026-10-27T14:02:34Z. The earlier requirement for separate operator permission on each ordinary accepted-source import is superseded. Destination promotion, release and production activation remain separately gated. Existing exclusive #359 claim #6364342545 and branch identity are unchanged.

**Staged source is not yet assembled or runnable**: source modules below are exact-byte copies at their accepted revisions, not inserted into the executable build manifest or combined with current released main network path. No browser or physical GEN/COMM acceptance is asserted. The current source contract REDs remain until approved parent-owned adapters and full exact-built tests.

| Accepted leaf | Original revision | Source blob/file staging |
| --- | --- | --- |
| #310 | 68515bfd38afad6d7eba389a7bc39e51d35d3584 | 03-csc-plugin-backlog.js; blob 4a5954fa12a8ab1371a58b594bf2f97388ad464a |
| #306 | bff52f9996365e996e3dbe1a56b0c5fcb7a231b2 | 03-csc-provider-navigation-ingress.js; blob 7f9c32f077260c6436b70389da5432d9a563b4ac |
| #309 | 22a889e9872a1eb21fb750de9cf8619c2b3fb0c7 | 03-csc-canonical-ingress.js; blob 61cd5e92006847b0d53d0dc89d27b0f8e935df75 |
| #313 | 6020d4bd9e811a46efe9a14074002cfa16862f05 | 04b, 04ba, 04c, 04d persistent-HMAC modules; blobs b8f54530, 6c2d8a3e, b1aa7a5c, d9650c98 |
| #311 | a0b06f94033d321970b7781ccfb0b47b663433ef | 04-csc-comm-worker-processing.js and part2/part3; blobs 7ea591ba, 749057a4, 739e67a5 |
| #317 | 197b346b505b2318e3155bf2557df416dd1702e3 | Worker disk bridge/lock/manifest/copy/writer/part2; blobs ecec6240, e8fb505e, 9846d575, aabd7d8f, c57509c8, 21e84520 |

**Stacking/overlap:** #306 inherits #310; #317 inherits #311. The above leaf-specific module paths were staged only once. No generated userscript, shared manifest, shared released code, branch markers, original child branches, or main were overwritten. #318 remains incomplete at provisional revision 882c6322be425a07b4259a9764e1ba668d68e6cf and was not imported.

**Required before executable assembly:** integrate and test affected existing released source callsites, reconcile canonical #313 key_restart with #311 worker cycle validation, implement correlated settings ACK and durable #317/GEN key boundaries, preserve two native clones and plugin queue startup ordering, reconstruct the manifest and generated userscript, then test exact assembled SHA. For any semantic conflict, coordinate adaptations with affected source owners and record dispositions. DC #232/#319 are not entitled to an exact assembled handoff yet.

Ledger for this source-staging operation: PASS standing authority and exact staging/provenance; FAIL known incompatible interfaces (pre-existing); INCOMPLETE executable assembly/manifest/build parity, #318 independent acceptance, installed/physical behaviour and downstream certification; DEFERRED release/main. Historical text above referring to mandatory per-import operator consent remains superseded by this section and RWF §13.5.


## 14. October 27, 2026 — parent Worker adapter tests and CI blocker

Owner: DC #359 original exclusive claim 6364342545. DC #318 remains OPEN and provisional; no #318 import. Original child branches and main remain untouched.

### Executed exact-source V8 checks, not browser/disk acceptance

The current three #311 Worker processor modules were retrieved from the parent, concatenated in source order and compiled/executed in V8 with minimal simulated TextEncoder/TextDecoder, URL, WebCrypto, Worker event listener and asynchronous sink. No installed browser, actual native Worker, physical filesystem or complete userscript was used.

- Worker configure ACK: valid schema 1/request_id correlated positive; wrong schema and malformed ID receive negative acknowledgements (3 observed matching responses).
- Committed canonical HMAC cycle: six rejected malformed/retired events, one valid event written. The first exact-source execution exposed the queue dropping key_restart. Corrected in parent commit 466a2cce; subsequent exact-source execution emitted matching key_restart and reported durable:false.
- Canonical admitted JSON capture: 5/5 checks PASS; positive start/body/end with identical key_restart, and legacy storage, missing admission token, malformed UTC time, retired scope fail closed. This is mock-sink proof, NOT actual Worker/GEN/COMM disk durability.

Parent-only #311 changes: 91f1c04c (correlated ACK), 57a389ea (cycle shape), 7dbe7311 and 4a3a0ac8 (UTC validation), ed26faa7 (canonical HMAC admission) and 466a2cce (cycle queue projection). Original source-owner review requests and coordination evidence: #311 comments 6445790635 / 6446084095, #317 comments 6445791743 / 6446085033, #318 comment 6445793145.

### Hosted CI exact result, not waived

Run https://github.com/Ma-XX-oN/DownloadConversation/actions/runs/40529719614 triggered by parent SHA 7357b3b7faaa4e159fc4dd5a246bcd04fdb9d9dd. Policy job 122278885790 FAIL: merge c3d349c8f2b38b3e6f15b7a01db4bf58d6e0cb5b (the authorized #380 merge into this parent) imports undeclared second-parent history 97abd5c24fb8f0522eab83ce249733060b32f105. Prepare, validate and finalize SKIPPED. #379 source branch is absent from live branch search; pinned RWF engine requires an extant declared remote dependency ref. No force rewrite, history deletion, policy bypass or invented branch was used. Exact request to original #379/policy owner: issue comment 6446053454.

### Open exact assembly requirements

- Integrate accepted modules and their current released-main hooks into an executable source/manifest/generated artifact without overwriting unrelated 1.11.15 main functionality.
- Reconcile durable #317 COMM first-header/boundary and recovered hasCycle/drain, coupled GEN segment and committed cycles with final independently accepted #318 UI/control source.
- Resolve everything-mode browser-accessible text streaming sanitization without leaking credentials or silently discarding selected data.
- Obtain an authorized provenance-preserving policy correction, run the complete hosted suite against the actual assembled SHA, validate physical installed browser disk readback/replay and hand exact accepted candidate to independent #232 performance and #319 certification owners.

Classification: PASS standing source import authority and staged-file provenance; PASS focused V8 tests with simulated ports; FAIL hosted policy ancestry and not-yet-compatible real Worker/GEN/COMM interface; INCOMPLETE executable assembly, full CI, installed physical proof and #318 prerequisite; DEFERRED PRELIM/main/production promotion. No exact-source candidate handoff issued.


## 15. 2026-10-27 current-window source-test expansion (non-release, NOT accepted assembly)

The #359 parent-owner continued without taking any child claim. The currently tested parent includes 101 unique declared source modules (85 pre-existing + 16 accepted CSC leaf imports); #318 remains unimported and OPEN. A dedicated Node test source file tests/issue359-parent-worker-contract.test.mjs and a separate tests/issue359-writer-boundary.test.mjs are registered in scripts/ci-environment.mjs, so top-level CI inventory does not omit them.

Both test files were fetched from the exact current parent branch, converted from ESM imports only for V8 isolate execution with simulated Node module interfaces, and exercised against the **actual parent file bytes** for #311 processor and #317 writer. This mode is NOT genuine Node --test, hosted provider matrix, actual Worker/OPFS/Tampermonkey, authenticated browser or real archive readback.

- Current Worker contract suite: **4/4 PASS** (correlated configuration schema/request_id, canonical key_restart cycle framing, six invalid cycle rejections, admitted JSON capture and non-durable status).
- Current Writer boundary suite: **3/3 PASS** (persisted-version/key_restart header readback across initial and rotated boundaries; corrupt-header refusal/poison and durable:false; correlated Worker boundary ready and cycle-history query).
- The new parent-owned #317 method beginKeyBoundary commits a first fragment header, verifies physical bytes through the Writer handle before returning durable:true, and poisons on corruption. hasCycle reads the existing recovered/durable knownCycles index. Commands csc-writer-begin-key-boundary / csc-writer-has-cycle reply with request_id correlations. The fixture simulates file bytes; no real physical durability claim is implied.
- Source-owner #306 request comment 6446781555 documents the nontrivial released-main merge conflict in src/userscript/03-agent-lifecycle/09-network-install-api-transition.js. Older accepted whole-file overwrite was not applied.
- Actual current-parent hosted CI run 40535175533 at 57f4dea327856dd1f8a03450ffcacf2cd012fcdc failed branch policy only: historical PR #380 merge c3d349c8 imports undeclared second-parent 97abd5c2. Its prepare/validate/finalize are SKIPPED. This is not a behavioural test of new Writer source. The policy owner #379 has been contacted; no bypass or owner takeover.

Outstanding: resolve source-owner interface reviews, finish full main callsite integration and build/generated artifact parity; real Worker queue-to-Writer-to-GEN HMAC key and cycle boundary parity; current independently accepted #318 revision (its last fully green .33 was superseded by new owner-local fixes), installed Chrome/Tampermonkey physical output, 10/23/40/>100 MiB sustained #232 tests, independent #319 certification. The original parent marker, main and child PRs remain unchanged. The live branch HEAD and acceptance ledger must be rechecked after each new commit.


## 16. October 27 12:21–12:43 EDT: source assembly continuation, independent RED evidence

Owner: original exclusive #359 claim 6364342545; existing non-release branch issue-359-csc-integration. Main, child source branches and production unchanged. Direct completion prerequisite #318 remains OPEN and is not imported. Do not call this DONE or send an accepted candidate to #232/#319.

### Additional exact-source parent changes

- Imported unchanged accepted #306 generic browser navigation module blob 4e6e96f9, bound its early A-B-A navigation observer before #310 queue and merged its provider-host attach/rebind/dispose into the existing parent bridge. The pagehide/pageshow cleanup paths are installed, and the module is registered in the manifest.
- Imported the accepted #309 canonical fetch/XHR/WS interception calls while preserving released recording behavior. The parent 09-network-install-api-transition.js now matches accepted blob 6e1a3a29faece0fa4c02a67677c15fdac0e4582b. 01-stock-network-identities and 02-stock-network-responses preserve the earliest cscCaptureNow() stamp in original stock diagnostics. 08-generation-request contains the reviewed canonical fetch fan-out and no-worker legacy recording guard. No child branch was edited.
- Parent manifest has 102 unique declared modules. Accepted immutable #309 and #306 integration tests were imported intact as tests/issue309-csc-canonical-ingress.test.mjs (blob e1b7de88) and tests/issue306-csc-queue-host-integration.test.mjs (blob 8bdd8704). All parent-specific tests and both upstream suites are included in scripts/ci-environment.mjs.
- Tests/issue359-early-navigation-integration.test.mjs verifies initial A-B-A, listener disposal, cache-only return and rebind; issue359-provider-host-integration.test.mjs verifies singleton queue attach/dispose and missing/invalid provider host. issue359-current-network-interception.test.mjs exercises original fetch response identity, canonical stamps and single legacy COMM ownership. issue359-xhr-websocket-interception.test.mjs exercises native XHR send and incoming/outgoing WS identity. All these focused actual-source tests passed under simulated browser/Node primitives (not authenticated Chrome or full Node).
- Latest revised Writer regression includes recovered cycle readback after a simulated restart, 5/5 PASS against exact parent source. Source compilation of 11 CSC modules and six Writer modules PASSED in their intended composition. Static integrated acceptance checks for canonical ingress, fetch/XHR/WS, navigation and host wiring 12/12 PASS. CI inventory: 116 of 116 top-level Node test filenames found in repository-owned CI when checked before the latest new RED test; new RED suite was subsequently registered.

### Current registered-realm RED gate

Current released main is 1.11.15 and uses @sandbox raw / @grant none plus Core recognizeAgentPlugin() / createAgent() public registration. Existing #359 parent still declares 1.11.13, GM_* grants and GM_xmlhttpRequest / GM_getValue / GM_setValue with the older Core loadAgent() path and dynamic module private host. These are **not compatible contracts**. Parent-only tests/issue359-registered-realm-contract.test.mjs was committed and registered in CI with 2/2 intentionally RED checks on current parent (header/raw/grants and registered Core acquisition). Source-owner #306 was notified with exact mismatching source blobs and current-main callsite facts, issue #306 comment 6447758725. The fix must be a reviewed public Core/CGP2 host acquisition integration; do not add fallback semantics or silently switch header without replacing GM-dependent loader.

### Prerequisite and provider evidence

- #318 current .34 hosted run 40541032630 failed PREPARE because requested version 1.11.15-issue.318.34 does not match repository version .33; policy PASS, validate/finalize SKIPPED. Original #318 owner was notified at issue comment 6447788511. Neither provisional .33 nor unaccepted .34 was imported.
- #359 ordinary hosted CI continues to fail pinned RWF ancestry rule at merge c3d349c8 (PR #380), second parent 97abd5c2; prepare/validate/finalize SKIPPED. #379 owner notified previously at 6446053454. Historical merge is preserved; no policy bypass.
- Genuine installed Chrome/Tampermonkey, durable end-to-end GEN/COMM physical readback, HMAC rotation/replay, 10/23/40/>100 MiB #232 performance and independent #319 certification remain INCOMPLETE. Generated artifact is not certified against this parent SHA.

Independent testing modalities must not be conflated: focused V8 execution with simulated primitives and isolated leaf provider CI pass do NOT certify the full assembled artifact. Do not hand off to #232/#319 until exact non-release assembled candidate passes required acceptance and #318 independently finishes.

### Current-window work ledger

PASS: retained original claim/authority, accepted source provenance, no duplicated child deltas, startup/manifest uniqueness, focused navigation and host tests, focused fetch/XHR/WS tests, focused Worker ACK/key_restart tests, focused Writer boundary/recovery tests, accepted leaf-source compilation, CI test inventory registration. FAIL: registered-realm raw/GM and Core API contract (2 new RED test cases), historical #380 CI ancestry policy, incomplete end-to-end durable pipeline contract. INCOMPLETE: final #318 acceptance, public provider runtime glue, GEN/COMM physical integration, generated artifact and full hosted CI, installed browser, performance #232, independent certification #319. DEFERRED: main/PRELIM/production promotion. All final PASS/FAIL/INCOMPLETE/DEFERRED acceptance counts must be recalculated after exact assembled candidate tests; this is not a substitute for final acceptance.



## 17. 2026-10-27 parent two-stage drain and AICC registration evidence

Original DC #359 exclusive owner claim #6364342545 and non-release parent branch are preserved. No original #311/#317/#318/AICC/CGP2 branch, main or production mutation.

**Independent parent source RED fixed:** The new issue359-durable-port.test.mjs revealed the original cscCommDurablePort.drain() queried only Writer, not the live processor, and the processor drain() returned immediately if already working. Parent revisions 76ba57f5, d0e742a1 and 0353306d track the active processor drain, add correlated csc-comm-drain/csc-comm-drained non-durable acknowledgements, then query durable Writer drain. The physical ACK is returned only after both stages. The processor failure/timeout is not silently promoted to Writer durability. The existing source owner's #311 review request is comment 6449099704.

Focused actual parent-source V8 fixture executions (not genuine Node or installed browser): processor 6/6 PASS, durable port 6/6 PASS, writer boundary 9/9 PASS and control correlation negatives 2/2 PASS. Included blocked-I/O, processor-first/Writer-second, false durable rejection, recovered cycle and correlated failure. One earlier simulated capture assertion failed but passed on isolated reproducer and full rerun without code changes; treat it as an unexplained intermittent fixture result, not verified production behavior. The original new queue-ordering RED was fixed and rerun GREEN.

**Additional exact source conflict:** Parent pinned AICC commit 9e18441a1f68a1cac5ebb6e20dead945dd36d7dd exposes legacy loadAgent in src/index.js and has no registration.js; current AICC main exposes recognizeAgentPlugin/createAgent, and current DC main uses that registered API with raw/no-GM grants. CGP2 main's src/index.js does not yet export connectChatGPTSubjectHost; that export exists on CGP2 #11 owner branches that remain unaccepted. The existing #359 parent legacy GM loader/header and Core pin therefore fail current registered-host contract. Keep the RED tests and request owner-reviewed exact compatible pins; no fallback or silent replacement.

Physical GEN/COMM readback/recovery, two-tab HMAC, installed authenticated provider, current generated userscript parity, actual hosted 4-job CI, #318 acceptance, #232 sustained performance and #319 independent certification remain INCOMPLETE. Parent hosted policy still FAILS PR #380 merge ancestry before prepare/validate/finalize. Source staging and simulated tests cannot certify the executable parent or authorize release.

## 18. 2026-10-27 13:21 EDT current-window #359 continuation

Original exclusive #359 claim #6364342545 and issue-359-csc-integration branch preserved. No child owner or main changes, no accepted #318 source imported, no release.

**Two-stage COMM durability:** original parent port drained only Writer, not processor. #311 parent Worker now tracks active asynchronous drain and replies correlated csc-comm-drained durable:false only after processor writes. Parent port then requires separately correlated csc-writer-drained durable:true. Wrong IDs, false durability, Worker failure and missing ACKs are rejected. Commits 76ba57f5, d0e742a1, 0353306d. #311 owner notified at comment 6449099704.

**Exact source tests with simulated hosts:** Worker 6/6 PASS (including in-flight write and full processor-to-port-to-Writer ordering), control port 6/6 PASS, separate control correlation 2/2 PASS, Writer 9/9 PASS, Worker-to-Writer cycle 1/1 PASS, combined generated COMM Worker source syntax 1/1 PASS (86,463 bytes; synthetic compressor functions). Tests registered in CI; 121/121 test files declared, 103/103 manifest modules unique. An earlier isolated capture assertion failed intermittently and passed isolated and full reruns; cause not established. This is neither actual installed Chrome/OPFS/WASM evidence nor canonical hosted full CI.

**GEN gap:** current branch tree and manifest have no CSC GEN physical sink or accepted #318 control-plane source. Existing GEN version/provenance tests concern diagnostic-log storage, not physical GEN beginSegment/writeCycle/hasCycle. Parent #359 must integrate a real approved GEN sink after exact owner contract and #318 acceptance. No fallback shim was created.

**Other RED:** Parent pinned AICC 9e18441a supplies loadAgent, not released registered recognizeAgentPlugin/createAgent; old GM header contrasts with current raw/no-grant runtime. CGP2 #11 registered subject-host export remains separately owned and not accepted main. Exact host/Core coordination remains required. Hosted #359 CI still FAILS RWF historical PR #380 undeclared second-parent ancestry before prepare/validate/finalize; #379 owner coordination pending. Genuine full artifact, physical GEN/COMM, HMAC rotation, #232 performance and #319 independent certification INCOMPLETE.

## 19. 2026-10-27 speculative early-metadata ingress, P/H/A/L

Problem: #360's producer-to-Core heartbeat path remains absent, and the existing #310 plugin queue plus COMM Worker are body-owning/filtering consumers; network HTTP errors, unmatched poll responses and inbound WebSocket metadata must not disappear because those queues filter. #360 source owner independently suggested an early metadata-only fanout in DC #359 issue comment 6449054537.

Hypothesis: a separate bindable metadata-only observer at the beginning of cscFanOut can deliver original capture clock, identity and metadata before native body cloning or queuing without creating a second interceptor or page-thread body queue.

Action: In the existing non-release #359 parent only, commits 0854718d and c4247258 add cscBindMetadataIngress(listener|null), frozen capture-time metadata delivery before COMM/plugin, omit headers/body/value and isolate listener exceptions. tests/issue359-metadata-fanout.test.mjs committed 46cee247 and registered under scripts/ci-environment.mjs at 80932820.

Learning: Focused source-execution 3/3 PASS: original HTTP 503 response time/identity before clones, metadata survives both clone failures, listener exception cannot suppress COMM or plugin. This is speculative interface evidence, not a real installed provider, #360 Core heartbeat path, or #299 certification. No #360 branch or main modified. Original #360 owner review requested in comment 6449837405. Do not bind to an unaccepted #360 implementation or assert producer integration until exact approved owner handoff.

Other outstanding RED/INCOMPLETE: parent legacy AICC pin and GM registered-host conflict, #318 independently unaccepted and GEN physical sink absent, historical #380 branch policy failure, no full artifact/installed physical validation/#232 performance/#319 certification. Parent integrated acceptance ledger remains 10 PASS, 4 FAIL, 6 INCOMPLETE, 1 DEFERRED; isolated test pass does not change whole-criterion completion.

## 20. 2026-10-27 approved #318.40 non-release source assembly

**P:** #318 remained an incomplete source prerequisite and the parent lacked its physical control plane. Earlier tactic of repeatedly checking provisional .33–.39 could not produce valid integration.

**H:** A new exact reviewed #318.40 handoff authorizes standing-parent import without completing the six separately required physical/installed tests.

**A:** Original #318 owner issue comment 6449823483 reports canonical four-job hosted CI PASS run 40555787751, exact materialized SHA c83d948c82c98114c5543e2af0e78ab8b46873bf, tag v1.11.15-issue.318.40 matched, validator artifact 12756409497 PASS, 52/52 focused source tests, generated classic userscript blob 29297fb37280fffb2b6aed0226fc2f3029355a85. Comment 6449894025 explicitly hands reviewed source to #359 parent for non-release assembly, while six installed physical tests remain INCOMPLETE.

Using only the original #359 parent branch, imported 5 new source files from exact .40 source byte-for-byte: 03-csc-shared-settings.js (blob 0184215cc7d4f1d58d22873ea70ca17328bfa76b), 03-csc-schema.js (ec652a8ceae7fa4ed7ae31afe73fe3814df19226), 03-csc-control-plane.js (83de3e11d33170645e8e4e4c8de52af5d88d5344), 03-csc-singleton.js (f115b8b06e7f3a46c2a8ea09c6489f4f9980fb35), 03-csc-capture-popup.js (bcfc37445efd3896773a174359487722a2d1e9f7). Source blobs verified equal in parent via immutable Git trees; no double import or child branch mutations.

Inserted five modules into panel-launcher manifest in the exact source-approved order before diagnostics. Applied only two reviewed launcher hooks from overlapping files: bindCscCapturePopup(panel) after existing diagnostic binding, and controller init after disk recorder initialization; preserved #359 pageshow/pagehide lifecycle differences. Imported all 11 issue318-csc-*.test.mjs test files unchanged with 11/11 exact Git blob equality to c83d948c and registered in scripts/ci-environment.mjs.

**Separate parent adapter:** Existing accepted #313 communicationPersistentHmacCurrentTabService factory registered via cscControlsRegisterHmacFactory before cscControlsCurrent().init() at commit 7dda2c. Focused test issue359-control-factory-integration.test.mjs PASS under simulated Node function execution; registered CI at b82ddc6. No extra HMAC service, fallback or production activation created.

**L:** Source-level #318.40 integration provenance established, not full accepted assembled behavior. Remaining: actual GEN physical sink beginSegment/writeCycle/hasCycle; real Worker setting ACK and COMM queue/Writer runtime; installed authenticated Chrome/Tampermonkey + CGP2/AICC registered host; two-tab HMAC and GEN/COMM physical replay/readback; complete built artifact and parent four-job hosted CI (RWF PR380 ancestry still FAIL); #232 performance and #319 certification. Parent header and Core registration remain older GM/loadAgent path and are RED. Do not mark #359 DONE, treat the six #318 physical items as PASS or hand accepted source to #232/#319.

## 21. 2026-10-29 — parent physical GEN/COMM assembly P/H/A/L, NON-RELEASE

**P:** Earlier #359 source staging lacked a physical GEN key_restart port and a page-to-Worker bridge for accepted #318. Previous attempts to infer GEN physical correctness from version-only diagnostic segments were invalid. Hosted parent CI remains stopped at historical RWF branch-policy ancestry before tests.

**H:** Parent-owned physically read-back GEN append journal and lazy Writer opening with current producer key_restart can satisfy the approved #318 `gen.beginSegment/writeCycle/hasCycle`, `comm.drain/beginKeyBoundary/writeCycle/hasCycle`, and Worker configure/awaitKey ports without altering accepted #313/#317/#318 source.

**A — source:** Added src/userscript/02-network-communication/04-csc-gen-durable-port.js, 04-csc-assembly-bridge.js and src/userscript/07-panel-launcher/03-csc-parent-assembly.js to existing non-release parent. GEN uses a separate directory under the user's already granted root, first physical header `{version:{gen,comm},key_restart}`, exact-byte close/readback and cycle journal, monotonic key segments, startup disk recovery, refused corrupt/stale history and poison on failed write/readback. Worker bridge composes existing #311/#317 source into one dedicated Worker, lazily opens Writer using the current HMAC key and approved root, correlates setup and key-ready ACKs, binds #318 ports and gates interception on resume. Parent attachment binds on successful directory authorization and reattaches after BFCache; failures leave CSC stopped and stock recorder unaffected. Original #313 HMAC factory remains registered before #318 singleton. No child code modified.

**A — independent RED/GREEN:** GEN fixture 9/9 PASS. A stale-key physical recovery case was RED (older key reopened after newer header); monotonic restart and recovered-history guards fixed it. Parent assembly bridge 5/5 PASS; historical hasCycle query after current key initially mishandled as key regression, corrected to read-only lookup without reopening Writer. Page attachment lifecycle 3/3 PASS. Combined exact accepted #318 controller + parent adapters 4/4 PASS: durable GEN/COMM cycle, Worker HMAC admission ACK, COMM-only and GEN-only history mismatch refused. Latest tests are committed and registered; 138/138 top-level Node test files and 111/111 unique source modules at parent HEAD f082903fa91a0af2883aba024f67948ea0df5e89.

**L / proof limit:** All these checks executed actual parent JavaScript in V8 with simulated Worker, filesystem, Browser and HMAC service. This does NOT prove real Chromium/Tampermonkey File System Access, actual WASM Zstd, signed-in registered CGP2/AICC, physical GEN/COMM durability on user-selected disk, authenticated two-tab navigation, generated full userscript parity or canonical hosted provider CI. Current hosted run 40819771483 on exact source remains policy FAIL, prepare/validate/finalize SKIPPED. Historical PR #380 merged ancestry rule remains with #379 owner; no bypass. Current parent old GM/Core registration remains RED; CGP2 #11 accepted host wiring still outstanding. Independent #318 installed six, #232 performance and #319 certification have not been passed or handed off.

**Next different tactic:** Obtain source-owner reviewed compatible registered CGP2/AICC public host and correction of RWF PR #380 ancestry, then execute exact generated-parent Node/full hosted and real Chromium authenticated folder/WASM two-tab tests. If these prerequisites remain incomplete, continue only independently productive exact-parent checks, not repeated unchanged V8/CI-policy retries. Acceptance counts remain 10 PASS, 4 FAIL, 6 INCOMPLETE, 1 DEFERRED at combined criterion granularity; no DONE.
