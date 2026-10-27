# DC #359 — source interface RED matrix and guarded assembly design

Status: DIAGNOSTIC/REVIEW ONLY, not imported or integrated application code.
Owner: DC #359 session dc-csc-359-v3-20261023T115716Z.
Parent: issue-359-csc-integration.  User source-import approval: PENDING.
#318 separate owner retains claim 6364205193; #319 stays independent.
No PR merge, main edit, private-provider import or release is authorized.

## Exact inputs re-read (2026-10-23)

| Leaf | Exact source HEAD | Interface |
| --- | --- | --- |
| #306 | bff52f9996365e996e3dbe1a56b0c5fcb7a231b2 | host/nav |
| #309 | 22a889e9872a1eb21fb750de9cf8619c2b3fb0c7 | ingress |
| #310 | 68515bfd38afad6d7eba389a7bc39e51d35d3584 | plugin queue |
| #311 | a0b06f94033d321970b7781ccfb0b47b663433ef | processor |
| #313 | 6020d4bd9e811a46efe9a14074002cfa16862f05 | key |
| #317 | 197b346b505b2318e3155bf2557df416dd1702e3 | disk |
| #318 | bde7e9ef137281ae914803b56c5104ad7f38f3ec | controls |

#318 isolated push workflow #39971645269 on the exact #318 HEAD:
one hosted focused-controls job SUCCESS, owner reports 65/65 executable
tests (27 control/GM, four native headless Chromium, 34 adjacent).
Built isolated artifact #12509870623, SHA-256
c043a9dda9a524d5ec44bde0d231dc21e24d1a4d8ff8acfbdbdc7cb3726ef0b5.
This is NOT a passed ordinary PR matrix or assembled source test.

Original #359 parent branch's RWF identity marker is unchanged.
#318's own first child marker identifies this exact #359 parent.
The live #359 parent is documentation-only until reviewed source import.

## Concrete current RED evidence (not inferred acceptance)

### A. Producer admission metadata (#311 versus #313)

#313 publishes:
- redaction_format = dc-secret-marker/2
- key_restart = ISO UTC of committed persisted issued_at_ms
- redaction_key_epoch = the producer epoch
- redaction_key_storage = chatgpt-origin-indexeddb

#311 instead checks redaction_scope == redaction_key_generation
and redaction_key_storage == tampermonkey-script-installation.
It writes these old fields in csc-comm-start.  Exact #313 metadata
is rejected with csc-key-scope-mismatch.

Guarded target:
- Accept the exact producer's public fields and canonical key_restart.
- Transfer only the 32-byte private HMAC key directly to the Worker;
  keep private key bytes out of DOM, GEN, disks, diagnostics and Git.
- Match each admission's token, key_restart and epoch to its own
  active capture; allow an old in-flight capture to finish before
  sealing its old segment, never stamp it with a newer restart.
- Include key_restart on csc-comm-start and preserve original
  capture/monotonic/network timestamps; no independent key clock.
- Delete the retired random scope/generation from active V2 records.
- Do NOT weaken fail-closed mismatched token/format/storage checks.

### B. Canonical committed cycle event (#311 versus #313/#317)

#313's exact nonsecret event:
{type,id,key_restart,epoch,occurred_at_ms,reason}
with id = `hmac-key-cycle:<key_restart>` and UTC timestamp identity.
#311 validCycle() requires generation 32-hex and the retired
`hmac-key-cycle:<epoch>:<generation>` ID.  Its positive Worker status
explicitly says durable:false.  This is NOT disk persistence.

Guarded target:
- Validate six canonical fields, exact ID, positive safe epoch,
  permitted reason and Date.parse(key_restart)==occurred_at_ms.
- Write the current event shape with no public random generation.
- Make a cycle idempotent against RECOVERED durable disk history;
  a transient in-memory set is not sufficient proof of durability.
- Missing one-sink historical cycles remain recoverable/fail closed;
  never replay an old cycle into a newer file/header.

### C. Settings correlation (#311 versus #318)

#318 sends {type:csc-comm-configure,schema:1,request_id,options}
and accepts ONLY a Worker-applied
{type:csc-comm-configured,schema:1,request_id}.
#311 responds with type alone.  Its present acknowledgement cannot
satisfy #318 even if the options were applied.

Guarded target:
- Validate request schema + request_id first; pause admissions.
- Apply options in the SINGLE Worker selector and return the same
  schema/request_id only on successful application.
- Negative response must correlate to the failed request, never
  report an option as applied after rejection/restart/stale ack.
- Resume only after the exact #318 awaiter verifies the response.

### D. Writer + GEN durability (#317 versus #318)

#317 setRestart() seals previous fragments then updates an in-memory
keyRestart variable.  The csc-writer-key-restart command sends NO
positive correlated acknowledgement.  Importantly, setRestart()
does not itself create/read back a new fragment first-header;
its mere completion must NOT be promoted to durable:true.

#317 already confirms durable-cycle AFTER append/readback, with the
canonical event ID and idempotent known-cycle tracking.  It does NOT
expose a hasCycle query across the new control-port interface.

Guarded target #359 adapters:
- Worker pause/configure/resume/provisionTarget/awaitKey.
- COMM drain/beginKeyBoundary/writeCycle/hasCycle.
- GEN beginSegment/writeCycle/hasCycle.
- Make beginKeyBoundary verify a physical version+key_restart
  header/manifest checkpoint before its {durable:true,key_restart}.
- Query recovered committed cycle IDs for hasCycle, not queue status.
- GEN's first version+key_restart header must be physically durable
  and match COMM.  No new key starts until old admitted captures
  and pending Worker writes are durable.
- Continue fail-closed on permission loss, abort, partial write,
  DRAINING cross-tab rotation or conflicting recovered history.

The #318 singleton must register
cscControlsRegisterHmacFactory(communicationPersistentHmacCurrentTabService)
BEFORE any cscControlsCurrent() construction/init.  Its current
05-bootstrap-part2.js calls cscControlsCurrent().init(); ordering is a
real assembly requirement, not an isolated #318 defect.

### E. Record-everything text fidelity and privacy (#311 selector)

#311 selected() returns
{status:unsupported,reason:csc-unsupported-text-format}
for non-JSON/non-SSE accessible text even in mode everything.
It is a truthful omission today, NOT successful full-fidelity capture.

Acceptance requires a reviewed context-aware streaming sanitizer
for text/plain, HTML, XML, CSV, form-encoded, JS and unknown text
as appropriate; it must not write raw arbitrary credentials or
claim completeness without processing.  URL, header, JSON/SSE,
WebSocket and binary policy matrices also require negative tests.
If safe classification is impossible, preserve explicit failed/
incomplete provenance, and request operator policy resolution.
Never silently implement an unsafe raw fallback or size cutoff.

## Branch policy — exact pinned engine, no CI bypass

DC gitlink RepoWorkflow revision:
85991b2f129c88ca71c410b5e5103b39d6342731.
Pinned repo_workflow/branch_policy.py blob:
c01984115e153bbbce35749aba6c7ec0797b4e6e.

The engine first looks up an EXACT branches[name] rule; it then
falls back to the issue-* pattern. It defaults integrationTarget
to the declared parent and checks PR base, remote parent ancestry
and undeclared merge-parent history. A narrowly scoped config rule:

  branches.issue-318-csc-controls.parent =
    issue-359-csc-integration
  branches.issue-318-csc-controls.allowedDependencies = []

would permit the correct #362 PR base while retaining global main
as the default integration branch and unrelated issue-* rule.
This is an uncommitted REVIEW PROPOSAL, not installed policy.

CRITICAL: ordinary PR CI checks out PR HEAD and reads .ci policy from
that source, so a rule added ONLY to the #359 parent would NOT fix
#318's existing PR-head job. Coordinate an #318-owner-approved
policy-only change on its own branch and independent policy tests.
Do not retarget #362 to main. The old PR run #39950479289 failed
policy and skipped prepare/validate/finalize.

Policy negative cases: unexpected PR target main, nonexistent parent,
undeclared merge-history, false ancestry, unknown branch and unrelated
issue branch must still fail as prescribed by the pinned engine.

## Independent diagnostic execution

28 of 28 exact-blob STRUCTURAL assertions passed, confirming the
above source contracts and discrepancies. These are SOURCE INSPECTION,
not executable integrated-application acceptance.

16 of 16 isolated Node 22 contract-fixture tests passed, covering
known old-schema rejection, canonical timestamp/ID guards, stale
settings ack, missing durable boundaries and old-scope replay.
The Node file manually mirrors #311 validCycle and proposed contract
predicates; it is not an exact imported producer->Worker->disk binary.
Probe SHA-256: fd06badbd7db389f97bdfbee5c15f74cada3864df28ccdd0469e698412d3d478.
Output SHA-256:
921fe5b5135244e34c8c9f520411c3004daa367d77e5f83efd3cb062e129dfaa.
The fixture does NOT certify any of the RED application interfaces.

## Authorization and outstanding acceptance

- Exact source-owner review of each incoming source: PENDING.
- Explicit operator non-release source staging/import: PENDING.
- Scoped #318 branch-policy change approval: PENDING.
- Genuine #318 installed Chrome/manual plus updated ordinary CI:
  INCOMPLETE, retained by its exclusive owner.
- #359 assembled source, private-key safe negative tests, real
  GEN/COMM first headers, recovery, full normal hosted CI: INCOMPLETE.
- #232 sustained 10/23/40/>100 MiB controlled performance: INCOMPLETE.
- Independent #319 physical dual-stream and decoder: INCOMPLETE.
- PRELIM/INT-ATTEMPT/main merge or production activation: DEFERRED.

No leaf branch, git marker, parent source, main or production state
is changed by this document.

## Additional policy-rule fixture verification

Python 3.13 standalone policy-rule fixture: 10/10 PASS.
Tests covered baseline PR #362 mismatch; exact #318 override; wrong
PR target main rejection; generic unrelated issue-to-main fallback;
unrelated issue-to-parent rejection; #359 original main parent;
global integrationBranch unchanged; exact rule precedence;
unknown branch rejection; historical explicit-rule preservation.
Fixture script SHA-256:
76b910a1c0c2a82792fac2f47623f54a819e3180e568cd7d4f12e2bde14931f9.
Output SHA-256:
1fd2670b71a30820b64e205330b4115797d42d0f790082dff01cc7f382d61e0f.
This exercised a manually transcribed pinned-RWF rule/PR-target
subset, NOT the exact engine against a live Git checkout.
Remote ancestry, ordinary PR hosted CI and rule ownership remain
INCOMPLETE; no policy change was committed.

## Review requests posted (all PENDING)

- Operator: #359 comment 6378798756, asks source staging and
  scoped policy approval separately.
- #306: comment 6378804446.
- #309: comment 6378804918.
- #310: comment 6378805367.
- #311: comment 6378799448.
- #313: comment 6378805795.
- #317: comment 6378799788.
- #318: comment 6378799137.
None of these requests is approval.  No source has been imported.


## 2026-10-27 V1 speculative-parent revalidation

Execution resumed under the existing #359 owner claim.  This section is
READ/REVIEW preparation only; it imports no application source and grants no
merge, release or production authority.

### Live exact identities

- DC main: `e6a083cd883e99e9d30e7ba440062bea6060b9be`.
- #359 parent before this documentation-only update:
  `5ebebc47c57788e816c20c60e44748792c5e5ef0`.
- Accepted #306: `bff52f9996365e996e3dbe1a56b0c5fcb7a231b2`.
- Accepted #309: `22a889e9872a1eb21fb750de9cf8619c2b3fb0c7`.
- Accepted #310: `68515bfd38afad6d7eba389a7bc39e51d35d3584`.
- Accepted #311: `a0b06f94033d321970b7781ccfb0b47b663433ef`.
- Accepted #313: `6020d4bd9e811a46efe9a14074002cfa16862f05`.
- Accepted #317: `197b346b505b2318e3155bf2557df416dd1702e3`.
- Current #318 verification candidate:
  `882c6322be425a07b4259a9764e1ba668d68e6cf`,
  tag `v1.11.15-issue.318.33`, canonical run 40410069001,
  47/47 focused tests PASS.  #318 remains NOT DONE and its handoff is
  READ/REVIEW-only.
- RWF scheduling source inspected from main:
  `WORK_GRAPH_SCHEDULING.md` blob `9603ee910880fed303c9b4db336e65ea7b6366ce`.

### Scheduling/speculation gate

The authoritative #308 graph retains `#318 -> #359`; accepted #306/#310/
#311/#313/#317 are additional direct #359 inputs.  Because #318 is unfinished,
#359 remains speculative/blocked for final completion.  Per current RWF
scheduling rules, speculative preparation cannot advance #359, #232 or #319
to DONE, and all affected checks must be revalidated against #318's final
accepted revision.

### Final-.318.33 interface readback

Exact source inspection confirms the previously recorded RED seams still apply
to the current #318 candidate:

- #318 requires `csc-comm-configured` with matching `schema:1` and
  `request_id`; accepted #311 still acknowledges only the message type.
- #318 requires COMM `drain/beginKeyBoundary/writeCycle/hasCycle` and GEN
  `beginSegment/writeCycle/hasCycle`.
- Accepted #317 still exposes `setRestart`; it does not expose the required
  durable `beginKeyBoundary`/recovered `hasCycle` control-port contract.
  Its durable-cycle acknowledgement remains valid evidence only after its own
  append/readback path.
- #318 validates canonical `hmac-key-cycle:<key_restart>` events and
  `key_restart`; accepted #311 still validates the retired
  generation/scope event shape.

These are parent-assembly corrections, not reasons to reopen the independently
accepted leaves.

### Import gate and current ledger

Operator non-release source-import authorization is still NOT VERIFIED.
The latest #318 owner handoff explicitly states NO import/merge authority, and
the existing #306/#309/#310/#311/#313/#317 review requests have no recorded
positive source-import approval.  Therefore this execution performed no
application-source import.

Current #359 preparation status:
- PASS: exclusive owner/branch identity; authoritative graph; live source
  identities; accepted-leaf inventory; current #318 candidate identity;
  exact source-contract mismatch reproduction; RWF speculation-rule readback.
- FAIL: executable cross-leaf #311/#313/#317/#318 interface remains
  unreconciled on any assembled candidate.
- INCOMPLETE: operator import gate; source-owner approvals; final #318
  acceptance; exact #359 assembled source and full hosted/browser/GEN+COMM
  verification; downstream #232 performance and #319 certification.
- DEFERRED: PRELIM/INT-ATTEMPT/main promotion and any production activation.

Revalidate this entire section after #318 reaches independent DONE or any
listed source revision changes.
