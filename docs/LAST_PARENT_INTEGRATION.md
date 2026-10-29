# Last Timer — Parent Integration and Work Graph

Status: **scaffolding, not accepted implementation** (2026-10-22).
Outcome DC #175; assembly DC #360; independent verification DC #299.
Sibling programme: CSC #308 / source parent #359 / independent gate #319.

## 1. Verified branch origin

- Branch: `issue-360-last-integration`
- Creation parent: `main` at
  `9e52016e8271845873ab32914a79f18252391b17`
- Parent tree: `c9b1cf7cf26a4ddd460ef5e064316e89b838ba47`
- First branch-specific identity commit:
  `0119c5a36bdba76c1a9f7d1695158c882d778d37`
- This first commit has the **same tree** as its parent; its message
  includes `RWF-Branch: issue-360-last-integration` and
  `RWF-Parent: main`.

The branch is a durable source-assembly parent, not a PRELIM or main release.
Do not move/rewrite its identity marker. Do not infer any issue dependency
from its ancestry. RWF `PARENT_BRANCH_WORKFLOW.md` governs identity.

## 2. Executable dependency graph, leaf -> destination

```text
Chat-Gpt-Plugin-2 #9 -----------+
                                +--> Chat-Gpt-Plugin-2 #10 --+
AICC #132 ----------------------+                          |
  |                                                        |
  +--------------------------------------------------------+
                                                           |
                                                           v
DC #298 (Last UI consumer; external #10 and AICC #132)
  |
  v
DC #360 (parent source assembly, exact tested tree)
  |
  v
DC #299 (independent installed-browser integration verification)
  |
  v
DC #175 (human-facing umbrella acceptance and closure)

Independent sibling, NOT a Last prerequisite:
  DC #308 -> CSC #359 source assembly -> CSC #319 certification
```

The DC **in-repository** direct edges are recorded in the scoped
`.repoworkflow/tickets.csv`. Its four rows have provider-verbatim titles.
Cross-repository requirements remain explicit qualified issue links above;
a numeric DC dependency record must never misrepresent another repository's
issue number. This is a known *subset* of DC's backlog, not an assertion
that all project tickets have been synchronized or all GitHub-native
relationships installed. The DC RWF submodule/config is historical and
does NOT mechanically enforce these records.

Links:
- https://github.com/Ma-XX-oN/DownloadConversation/issues/175
- https://github.com/Ma-XX-oN/DownloadConversation/issues/298
- https://github.com/Ma-XX-oN/DownloadConversation/issues/299
- https://github.com/Ma-XX-oN/DownloadConversation/issues/360
- https://github.com/Ma-XX-oN/Chat-Gpt-Plugin-2/issues/9
- https://github.com/Ma-XX-oN/Chat-Gpt-Plugin-2/issues/10
- https://github.com/Ma-XX-oN/AIConversationCore/issues/132

## 3. Parallel readiness and source ownership

- Parallel ready: producer receipt leaf plugin #9, provider-neutral
  retained observer contract AICC #132; separate repositories/surfaces.
- Blocked by both: plugin #10 reducer/bridge.
- Blocked by plugin #10 AND AICC #132: DC #298 UI (mock-only work is
  explicitly speculative until real prerequisite artifacts certify).
- Blocked by accepted #298: DC #360 exact-source assembly.
- Blocked by accepted #360 and pinned producer/Core: DC #299 live
  independently executed acceptance.
- Blocked by #299: closure of outcome umbrella DC #175.

Assign exactly one owner per issue branch. Do not edit a sibling owner's
branch. A new #298 branch starts at then-current #360 parent and its
first branch-specific **empty** commit records:
```text
RWF-Branch: issue-298-last-aicc-render
RWF-Parent: issue-360-last-integration
```
After acceptance, #298 integrates only into that parent, with explicit
user merge permission. Existing branches with a different true Git parent
need owner-reviewed import, not a rewritten PR base.

## 4. Exact semantic and negative-path contract

Provider captures actual incoming server evidence without a new interceptor.
For each inbound datum:
- Prefer a valid authoritative supplied message/activity timestamp.
- If none is usable, use local `now` at **receipt observation**.
- Aggregate newest valid received activity with JSON-entry activity;
  stale or out-of-order records never move the retained time backwards.
- Outgoing-only actions never update it.
- Delayed callback, late plugin attach, COMM Worker enqueue/read/write,
  disk completion and UI render time never replace receipt time.
- When no incoming activity is known, Last remains unresolved.
- DC UI renders Last / Total / Waiting using existing cadence; no
  extra network parsing, DOM observer, polling, or body copy.

Negative tests: missing/future/unparseable timestamp; delayed queued
delivery; duplicates, out-of-order source timestamps, JSON vs receive
clock normalization, idle, reconnect, reload, unsubscribe, fast stream,
concurrent exchanges, logged-out/no-hook and outgoing-only activity.

## 5. Leaf acceptance and release staging

1. For each ready producer/Core issue, inspect exact main, owner claim,
   branch history, source tests and targeted contract before editing.
   Certify each independent interface on its exact SHA and artifact.
2. Once plugin #9 and AICC #132 finish, integrate those contracts in
   plugin #10 (its own authentic branch parent in plugin repository).
   Publish an exact tested interface handoff.
3. Start DC #298 from #360 parent. Test its isolated UI contract,
   no extra acquisition, retained activity/rebinding and stopwatch
   regression; produce exact built userscript and hosted evidence.
4. With authorization, bring accepted #298 into #360 parent. Resolve
   any conflict with its source owner and rerun tests if assembled bytes
   change. Keep immutable candidate/source and evidence identity.
5. Pass an exact accepted #360 SHA and exact provider/Core revisions to
   independent #299. Verify live signed-in Chrome/Tampermonkey partial
   chunks, no timestamp fallback delay, no outgoing reset, no duplicate
   intercept, CPU rate, and Last/Total/Waiting.
6. If CSC later combines Last into #359, its separate owner must test
   the *new* combined source and #319 must independently certify it.
   Neither track's historical PASS validates another composed tree.

Failure leaves accepted source unchanged and records the rejected
candidate, evidence, owner and next action. Unavailable real Chrome
evidence remains INCOMPLETE, not a synthetic PASS. No dependent DONE
handoff from speculative/mocked work.

## 6. Current RWF integration policy (manual until implemented)

RWF #108/#109 October 17 contract supersedes old
`prelim-main-<GUID>` guidance: accepted source, after explicit operator
authorization, is submitted as one immutable
`PRELIM-360/main-<GUID>` branch. Only a destination coordinator can
construct a separate mutable `INT-ATTEMPT-360/main-<GUID>` from current
authoritative `main`, read allow-tickets from that current destination,
recheck exact candidate tests, and perform destination-tip CAS.
Published PRELIM SHA cannot change; a changed submission gets a new GUID.

A PR, branch, branch-name suffix, unit test PASS or graph declaration does
NOT authorize merging. Release version is derived at integration against
current main, not copied from a task branch; no stable tag precedes
actual verified server-main landing. User explicitly approves DC merges.
No claim is made that RWF #109/#677, server branch protection or current
nested parent branch policies already enforce these requirements.

## 7. Scaffold evidence / remaining gates

- PASS: dedicated #360 issue created and exact original parent verified.
- PASS: empty Git-history identity commit, read back structurally.
- PASS: four in-repository dependency rows staged on this parent.
- INCOMPLETE: GitHub-native dependencies and whole-repo RWF sync.
- INCOMPLETE: plugin #9, AICC #132, plugin #10, DC #298, #360
  integration, #299 exact browser certification.
- INCOMPLETE: source candidate, emitted userscript, hosted test evidence.
- NOT AUTHORIZED: any leaf-to-main merge or PRELIM/main publication.

This document is **a manual RWF ledger**, not a substitute for automated
workflow-policy enforcement or native provider dependency synchronization.

## 8. Verified upstream handoff checkpoint (2026-10-22, 21:59 EDT)

**AICC #132 independently certifiable Core leaf: PASS, unmerged.**
- Verified branch `issue-132-retained-activity` at
  `c3f9cbdcffe35ce1e8568faf4e9d518072c34fdd`.
- First identity commit `18b8e4bf1b7f012edf79dc43fd4a8906dee683de`
  has `RWF-Parent: main`, correct first-parent SHA and identical tree.
- Draft AICC PR #133 remains OPEN and UNMERGED.
- Hosted workflow run 39857275380 concluded success. That workflow's
  request HEAD is not the source candidate HEAD; preserve the exact
  reported source/result-tag provenance rather than conflating them.
- Annotated `v1.1.0-issue.132.2` dereferences to exact source
  `c3f9cbd...`.
- AICC acceptance: 14 scoped PASS; 0 scoped FAIL/INCOMPLETE;
  three excluded downstream/provider/merge obligations. Native network
  ingress and final UI/browser conformance are **not certified**.
- Frozen interface: `context.core.publishActivityTimestamp(timestampMs)`
  and `registry.activityState(agent)` /
  `registry.observeActivity(agent, callback)`; retained frozen snapshot
  `{apiVersion:1,clockDomain:'unix-epoch-ms',latestIncomingAtMs:null|number}`.
  See AICC #132 issue comments 6351775454 and 6351820013.

**Plugin #9: source/hosted tests PASS, native browser evidence INCOMPLETE.**
- Draft PR #36, branch `issue-9-server-receipt`, observed HEAD
  `58c5ee1a1a3a8ef0bd1eb7857cca228d4cebe022`.
- Hosted run 39857477668 concluded success at that exact HEAD.
- Issue comment 6351831154 explicitly reports INCOMPLETE live Chrome
  native transport and CSC queue connectivity. #9 issue stays OPEN.
- Existing CSC #309/#310 are responsible for actual first-receipt
  capture/queue invocation. No independent provider-origin browser PASS
  may be inferred from the metadata-only isolated producer tests.

**Readiness classification:** AICC #132 has its independent certified
development contract; its PR is not merged. Plugin #9 still has required
live integration evidence incomplete. Plugin #10 may prepare bounded
speculative reducer implementation against pinned #9/AICC interfaces
under RWF speculation rules, but is **not dependency-complete READY/DONE**
and must revalidate against the final approved integrated artifacts.
DC #298, #360 source assembly and #299 live certification remain
unready. Resolve the concrete CSC first-receipt integration dependency
with the #309/#310/#359 owners before claiming final #9/#299 acceptance.
Do not silently add speculative PASS or merge any branch.

Authoritative evidence:
- https://github.com/Ma-XX-oN/AIConversationCore/issues/132#issuecomment-6351820013
- https://github.com/Ma-XX-oN/Chat-Gpt-Plugin-2/issues/9#issuecomment-6351831154
- https://github.com/Ma-XX-oN/Chat-Gpt-Plugin-2/issues/10#issuecomment-6351787848

## 12. Registration-enabled main rebase (2026-10-25)

- This separate rebase staging branch starts from DC main
  `e6a083cd883e99e9d30e7ba440062bea6060b9be`, version `1.11.15`.
- The original physical parent `issue-360-last-integration` and its
  RWF identity marker remain unchanged.  Historical provenance above
  describes that ORIGINAL parent, not this new staging branch.
- This new physical branch identity is `issue-360-last-main-rebase-20261025`.
- The child Last UI rebase must preserve AICC's NEW public registration
  and createAgent boundary; legacy `loadAgent` must not return.
- The accepted CGP2 0.1.1 base, Core 1.1.1 base, and DC 1.11.15 base
  are the starting inputs.  Branches holding Last changes remain separate.
- Exact composed CI and authenticated browser certification are still
  required; parent documentation is NOT evidence of runtime integration.
- Do not merge to main without a separate explicit approval.

## 13. Reviewed Last source assembly (2026-10-27)

- RWF standing non-release child-to-parent import authority: WORK_GRAPH_SCHEDULING.md §13.5, merged PR #750 (9cadfeef19cd7d074f993a798b9a6e457ac7d155). This is NOT main/promotion approval.
- Direct prerequisite DC #298 independently accepted: https://github.com/Ma-XX-oN/DownloadConversation/issues/298#issuecomment-6428443607; formal handoff https://github.com/Ma-XX-oN/DownloadConversation/issues/360#issuecomment-6428458798 (13 PASS, 0 FAIL/INCOMPLETE/DEFERRED).
- Parent branch `issue-360-last-main-rebase-20261025` at original reviewed `ccdca378170af19af4520f31b1246284c973fb71` (PR #376); exact accepted child `issue-298-registration-rebase-20261025` at `5e3eb3ccfcb60dcb2a97f828b91b8852ddff25af` (PR #377), which physically descends from parent. The child branch remains unchanged.
- Source import is a two-parent integration merge, first parent previous #360 HEAD and second parent exact #298 accepted HEAD. The resulting source tree starts with the exact accepted child tree `6255998ee4fe145201a79ce6972ef086d19d6d9f` and adds only this parent-owned documentation entry. This is a NON-RELEASE assembly, not a direct child-to-main merge.
- Selected CGP2 #9/#10 PR #46: `190e9ddeb42786abb7f200272fd4bfa7991a5543` (producer bundle blob `56d5256b35d3ad7aa7c638e87f06327566534a85`). Selected AICC #132 PR #138: `2f9b916835f82668ed26d87b07840787b17f5b6c` (Core classic blob `5fadf486d044c1a396aad10f435b862eed93db9a`). DC manifest pins exact AICC source; CGP2 remains its independently installed producer artifact.
- Source overlap: accepted child diff is 18 files; #360 parent diff to main is only this document and `.repoworkflow/tickets.csv`. No path collision; no source-owner conflict to resolve.
- Accepted leaf PUSH CI: DC run 40255566995 / 710 tests, Core run 40255175837 / 258 PASS 2 expected SKIP, producer run 40157478428 / 77 tests. These are leaf evidence ONLY. New exact assembled-source CI, generated-user-script parity and genuine signed-in Chrome are required; independent DC #299 owns final browser certification.
- CSC #359 source, branches and claims are untouched; no duplicate native interception is authorized.

### Parent branch-policy registration repair

Initial assembled merge `962c5a622e45bf8ce95bc8818d250172a4b53e7b` failed hosted branch policy because the parent omitted an explicit allowedDependencies declaration for its accepted physical child. The failed policy job is 122276312194 in Actions run 40529001403; prepare/validate/finalize were skipped and are not behavioral failures. The parent now registers `issue-298-registration-rebase-20261025` as its *sole allowed Git history dependency* under `.ci/branch-policy.json`. The original source merge is retained without rewriting history; rerun exact host CI at the repaired candidate before acceptance.

### RWF source-pin provenance (2026-10-27)

The source import automatically marked PR #377 merged into parent PR #376 at merge SHA `962c5a622e45bf8ce95bc8818d250172a4b53e7b` and GitHub deleted the accepted child branch ref. As a result the policy could no longer resolve the accepted child by branch name even though the exact SHA was preserved in the merge's second parent. Parent-owned source provenance pin `issue-360-accepted-298-source-pin-20261027` references the SAME immutable accepted child commit `5e3eb3ccfcb60dcb2a97f828b91b8852ddff25af` without modifying its source tree. The parent branch's explicit `allowedDependencies` lists that pin. This remains solely non-release assembly; no main merge.

### Exact parent CI iteration

Set parent-owned development iteration `1.11.16-issue.360.1` for branch `issue-360-last-main-rebase-20261025`. The `.ci/run-ci-request` matches the authoritative `src/userscript-header.js` version. RepoWorkflow hosted artifact preparation is responsible for regenerating and committing the built userscript on the parent (if changed); the parent must verify the resulting source SHA and generated blob and run full tests. Historic #298.3 tests do not satisfy this new parent CI requirement.

### CI failure and corrective regression expectation

At assembled candidate `fd40dde47fc5cd536ac3a1ad9a22d00bb31aedef`, full hosted run 40530131160 executed validation; RepoWorkflow adoption contract failed because `tests/repoworkflow-adoption.test.mjs` still expected the historical branch-policy table without the new #360 allowed dependency. Structured artifact 12746026723 records returncode 1 and exact failed stage. Parent #360 owns the added branch-policy entry; this correction adds its explicit expected rule to the repository policy regression and preserves all existing expected entries. New validation request: `1.11.16-issue.360.2`. Historical FAIL result `v1.11.16-issue.360.1-CI-FAIL` is retained, not relabeled.

### Preflight iteration collision

The `.360.2` request failed preflight in run 40531225190 because historical annotated `v1.11.16-issue.360.2-CI-FAIL` already exists and points to old commit `6bd687516f330854ba3967979ceb882fd8f73688` from October 25. That tag was not created by the assembled candidate; the .2 validation stage did not run. Both success and failure tags for `.360.3` were checked absent before establishing the new request.

### Exact-source full regression re-execution, iteration .360.4

The original .360.3 run 40531630332 failed the unrelated #333 Chromium dark-theme first-sequence fixture. Attempt-2 re-run of validation job 122286026187 did NOT rerun the assertion: preflight returned exit 2 because `v1.11.16-issue.360.3-CI-FAIL` already existed. Therefore the second job failure is preflight, not independent reproduction of the #333 issue. A fresh unused .360.4 version is requested to perform another full, immutable exact-source regression. The generated artifact will be rematerialized by hosted CI. Source changes are confined to version, CI request and this ledger; the test implementation is unchanged.

### RED proof request .360.5 — unresolved native producer wiring

Independent DC #299 exact-source audit found that parent source has no real receipt or JSON activity fanout. The owner added `tests/issue360-native-receipt-feed.test.mjs` on this same branch. This is a required native fetch response integration RED test using the production wrapper and stock response observer, fake unrelated HTTP 503 and original response identity, with independent oracle requiring a dispatched CGP2 `server_receipt`. The current candidate is expected to FAIL; do not call it a completed regression. Full hosted validation of this exact changed source is requested to establish RED before source-owner approved repair. No provider/CSC #359 branch modified. This candidate is development-only, not a #299 handoff.

### RED iteration .360.5 CI discovery and .360.6 correction

The first .360.5 hosted run 40556916912 validated a new top-level native ingress test but test inventory rejected it as omitted from scripts/ci-environment.mjs. The structured validator artifact 12757897366 recorded ONLY `CI test inventory regression: FAILED`; no native test assertion ran. New .360.6 registers test in the explicit CI stage under the #360 parent and requests validation on an unused iteration. The production native-to-CGP2 callback remains missing by independent #299 source audit; this is test-first RED evidence, not release acceptance. No CSC #359 or CGP2 owners' source has been modified.

### .360.7 CI RED verification for distinct native JSON-entry source contract

The .360.6 hosted native fetch-response receipt test RED is confirmed by run 40558114685. Added a second independent JSON-entry RED assertion to tests/issue360-native-receipt-feed.test.mjs, exercising the actual existing stock response JSON inspection function and demanding a downstream CGP2 received_json_entry publication, independently of persisted_records. This checks separate acceptance requirement. New unused iteration .360.7 runs full canonical CI against exactly this test-first source without production changes; no fake GREEN claim or provider/CSC branch modification. CSC #359 source metadata API has been reviewed as shape-compatible, not yet imported/accepted; CGP2 installed registered receipt-ingest ABI remains outstanding.
