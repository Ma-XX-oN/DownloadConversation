# DC #359 — released 1.11.15 rebase and CI failure diagnosis

Status: SOURCE/PROVIDER DIAGNOSTICS; not a completed rebase or a
working assembled candidate.  Original DC #359 owner and claim:
dc-csc-359-v3-20261023T115716Z / comment 6364342545.
Candidate branch: issue-359-csc-integration.  Do not modify main.

## Immutable revisions

- DC released main: e6a083cd883e99e9d30e7ba440062bea6060b9be
  (1.11.15; hosted full main CI 40155176513, four jobs PASS).
- AICC released main: 629c86284b7db5fb412bb083178eaee8c06f796c
  (1.1.1; hosted full main CI 40152202794, four jobs PASS).
- CGP2 released main: 03594249c48d6b8dcba8ac6f7a2e1fcead9a640b
  (0.1.1; prior 40154740170 green at a different SHA).
- Original #359 parent BEFORE this diagnostic:
  2f90ebb68834cc43286b6bbcf4405aea14884d3b.
  Its prior merge base is 094b6994b0f3435d8040c81be4e6321eb91f1dd2.
- Original #318 controls: bde7e9ef137281ae914803b56c5104ad7f38f3ec,
  draft PR #362, base issue-359-csc-integration, no merge.
- Previous #359 verification-only hosted HEAD:
  2e7dc1261b45f9e80f81db5eacb2535f0217445a.
- Previous #318 verification-only hosted HEAD:
  9da329248300034c5471a16cec16fd128813ea4b.
- All experimental isolated SHA/job evidence remains NON-CERTIFYING.

## Genuine hosted negative logs — analyzed, not waived

#359 verification workflow run 40158990384:
- PASS 4 jobs: matrix-build, matrix-plugin, matrix-inventory,
  matrix-typescript.
- FAIL 1 job: matrix-full 121066347058.
- Within that job, Actions-policy regression test 12/12 fails
  because verification branch adds an unauthorized permanent path:
  .github/workflows/verify-rebase-dc359.yml.
  Eleven other Actions-policy assertions PASS.
- Source and browser functionality stages in that job run; the
  full-validation job is still FAIL, not silently reclassified PASS.
- Root cause is exact repository workflow inventory enforcement.
  This is NOT evidence that the assembled #359 recorder functions,
  because no #359 source integration exists on its parent.

#318 verification workflow run 40158993166:
- PASS 6 jobs: matrix-controls, matrix-typescript, matrix-bundle,
  matrix-chromium, matrix-adjacent, matrix-jsdoc.
- FAIL 1 job: matrix-full 121066355360.
- Failure 1: tests/modular-userscript-build.test.mjs line 85 asserts
  sourcePaths.length === 86, but the provisional composed source
  manifest has 88 entries (88 !== 86).
- Failure 2: Actions policy current-repository assertion rejects
  two additional workflow files:
  .github/workflows/issue318-csc-focused.yml
  .github/workflows/verify-rebase-dc318.yml.
- The unauthorized workflow-file failure is a genuine expected
  automation-policy rejection, not proof of functional source failure.
- The 88-entry count is a genuine obsolete test expectation when
  the two controls modules are intentionally added to main's 86.
  Update tests only in an approved, source-owner-reviewed candidate.
- Do NOT change the assertion without verifying that source paths
  are unique, ordered, present, less than 16 KiB and compiled.
  Do NOT weaken the policy checker to permit ad-hoc workflows.

## Fresh exact-source diagnostic assertions

Re-fetched from GitHub on 2026-10-25 at the immutable SHAs above.
21/21 STRUCTURAL source/policy assertions PASS. These assert the
presence of known contracts/conflicts, not integrated green tests.

Verified source facts:
- DC main has 86 ordered userscript modules, #318 old manifest 87.
- A non-committed in-memory composition that adds exactly the two
  #318 controls modules after 01-recording-group.js has 88.
- Those 88 paths are unique and include every new-main module,
  including 03-cgp2-integration-tests.js, and both #318 modules.
- Current AICC pin remains 629c86284b7db5fb412bb083178eaee8c06f796c,
  Git blob 2279b31f7760222a1486f641636eaab74702de1f,
  byte count 291372.
- Current main modular-build test still hardcodes 86, so it
  cannot PASS for the 88-entry proposal without reviewed revision.
- Released DC header is @sandbox raw + @grant none.
- Old #318 header grants GM shared-storage APIs and its controls
  use GM_getValue, GM_setValue and GM change listeners.
- Neither header can simply replace the other: the old header
  changes execution realm semantics needed by newly registered
  AICC/CGP2, and the new header omits #318's required GM APIs.
- The old #318 source module is NOT in released main.
- Current main branch-policy still has generic issue-* -> main and
  no exact #318 override; it also has new authorized special rules
  for issued #366/#367 release work that must be retained.

Checked source blob identities:
- main manifest: a63258363438bb537abea006fd38e6682b60585e
- old #318 manifest: 1bdcf22f1cd0e270780f25c02918c4c697b321b0
- main header: 391b84ce2e554b51ae0ee770860428e4fc5fc73e
- old #318 header: c33ab19898f13fee86e23694e0ad0d0f380e527f
- main modular-build test: c098c36e7d5353944b1c96b14bd95e6611d90d40
- main Actions-policy test: 90b5f9985abd9477259c0f586e4513582de28858
- main branch policy: 4e57e51cc1ca67cf672def1785265e47121b9af9
- old #318 controller: 651a466a4f52bce4cf3cec22f60f939e6d6b2a23

## Next owner-reviewed repair gates

1. Preserve #359 original RWF-Parent and branch provenance.
   Reconcile documentation-only parent with new stable main under
   the approved branch operation without rewriting its identity.
2. Obtain explicit operator non-release staging authorization A
   and per-source owner review BEFORE importing application leaves.
3. Resolve shared-settings transport in the raw/no-grant
   registered-plugin realm; genuine concurrent-tab persistence,
   authority ordering and provider self-registration must pass.
   Do not fake GM APIs, change registered-agent semantics, or
   silently swap in localStorage.
4. Combine the accepted #306/#309/#310, #311/#313/#317 producer,
   writer and controls sources without duplicated native clones.
5. Resolve key_restart and old scope mismatch, correlated configure
   ACK, physically proven first key-boundary, durable cycle query,
   GEN/COMM header parity, old-key draining and text sanitization.
6. Obtain operator policy authorization B and #318 source-owner
   approval before changing exact child-branch rule. Keep current
   special rules #366/#367, generic issue-* -> main, all ancestry
   and undeclared-history checks intact. Do not retarget PR #362.
7. On an approved exact combined candidate only: update 86 to the
   actual validated source count (88 IF unchanged), run real
   normal CI WITHOUT unapproved extra GitHub Actions workflows,
   check independent jobs, then genuine Chrome/Worker disk readback.
8. Hand source SHA and results to #232 for measured sustained
   10/23/40/>100 MiB tests and independent #319 GEN/COMM/decoder
   certification. No historical isolated run certifies either.

## Authority / acceptance

- Original coordinator claim: 6364342545, unchanged.
- Operator A and B approval: NOT VERIFIED.
  Request recorded at DC #359 comment 6378798756.
- Original #318 owner review: NOT VERIFIED.
  Request recorded at DC #318 comment 6378799137.
- Other source-owner reviews: requests recorded previously,
  no acceptance inferred from silence.
- Authoritative CSC dependency graph is DC #308 (October 22).
- #359 real assembled source, ordinary normal PR CI, actual disk,
  registered-agent Chrome, #232 and #319: INCOMPLETE.
- This diagnostic changes documentation ONLY. No source/PR/main
  merge, original leaf rewrite, production or ownership transfer.
