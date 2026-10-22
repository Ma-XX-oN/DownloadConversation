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
