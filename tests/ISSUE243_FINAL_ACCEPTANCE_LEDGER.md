# DownloadConversation #243 — V3 final acceptance ledger

Status: **AUTOMATED GATES PASS; USER TAMPERMONKEY ACCEPTANCE PENDING**
Owner claim: 6131747306, session `dc-v3-243-followon-20261012T1607EDT`.
No main merge, production release or stable tag authorized or performed.

## Exact candidate and provenance

- Repository: `Ma-XX-oN/DownloadConversation`.
- Branch: `issue-243-final-version-integration-v3`; draft PR #268.
- Exact source and build candidate independently exercised on GitHub Actions checkout:
  `8d96bbea5bad36f2343f5f958df502a63d9f1c86`.
- Generated browser userscript Git blob:
  `c5946695fc5e40588d0bc127a467c2f980c13f76`.
- Artifact: `chatgpt-conversation-markdown-export.user.js` (1,152,601 bytes;
  `1.11.4-issue.243.1`).
- Direct browser-test file:
  https://github.com/Ma-XX-oN/DownloadConversation/raw/refs/heads/issue-243-final-version-integration-v3/chatgpt-conversation-markdown-export.user.js
- Hosted exact branch verification: https://github.com/Ma-XX-oN/DownloadConversation/actions/runs/38305704291
- Preceding equivalent full verification: https://github.com/Ma-XX-oN/DownloadConversation/actions/runs/38305294970

## Independent acceptance evidence

| Criterion | Evidence and exact method | Verdict |
| --- | --- | --- |
| #239 immutable COMM fragment storage, snapshot/recovery and integration | `tests/issue-239-comm-integration.test.cjs` run against combined branch; unchanged verified #239 source retained | PASS |
| #240 GEN selected-boundary resolver | `tests/gen-boundary-version.test.mjs`, imported #240 resolver; inclusive boundary, legacy semantics | PASS |
| #241 COMM selected-boundary resolver | `tests/issue-241-comm-boundary.test.cjs`, including real session-start upgrades, torn JSONL, future fragments and clock rollback | PASS |
| #242 GEN/COMM version join | `tests/issue-242-combined-version-export.test.cjs`; provenance-first JSONL, null historical values, no invented future GEN version | PASS |
| #237 GEN startup, persistence, 10,000-memory/5,000-persisted bounds and version convergence | Four focused GEN convergence suites; split bootstrap, typed return documentation | PASS |
| #220 merged event source order, log-range selection, archive, grouping, legacy and failure cases | Merged-log extraction, save, storage, dialog and nonmonotonic clock suites on integrated production source | PASS |
| Combined focused regression inventory | 70 passing Node tests, 0 failures, hosted run 38305704291 | PASS |
| Tab identity, duplicate-tab ownership, Chrome reload and restored session, panel layout, controls, persisted export settings | 24 passing tests in Chrome 154 and Node fixtures, hosted run 38305704291 | PASS |
| Source order, pinned dependencies, historic #150 migration snapshot | 9 modular tests; exact historical Git commit `62571e15af8f7f3e4472258e7a18bb2f2d48cef5` fetched and verified | PASS |
| Generated artifact integrity | `node scripts/build-userscript.mjs`, `node --check chatgpt-conversation-markdown-export.user.js`, `node scripts/build-userscript.mjs --check`; generated file published and Git blob fetched back | PASS |
| JSDoc and source-size invariants | `node scripts/check-jsdoc.mjs`; all manifest source segments <16 KiB | PASS |
| Per-leaf performance and browser storage | Existing #251 independent hosted evidence, run 38300819106; no newly invented latency SLA | PASS (leaf handoff) |
| Live personal Tampermonkey use and user-visible export review | User has not yet tested this exact #243 artifact in the ChatGPT browser UI | PENDING USER TEST |
| Canonical repository CI at exact final handoff | Remove temporary issue workflow, then re-run canonical policy CI. Evidence to be appended to #243 after host completion | INCOMPLETE until cleanup |
| Production deployment / protected-main merge | Explicitly not authorized | DEFERRED |

## Integration boundaries and unresolved matters

- #220's grouped writer, per-tab recording identity and source-order capture
  modules are physically assembled into the #243 userscript. Version
  provenance is emitted as a single timestamp-free `{version:{gen,comm}}`
  JSONL record before the grouped export header. Physical COMM fragment
  headers are not treated as ordinary events.
- A source-order clock rollback does not prematurely stop COMM version
  resolution or selected event scanning. Missing legacy information is `null`,
  never inferred from the current version.
- Browser-only manual interaction with Tampermonkey has not been claimed.
  The ticket expressly permits that acceptance to remain pending user testing.
- Final source/behavior changes after hosted run must trigger fresh relevant
  verification; documentation-only changes and removal of the temporary
  workflow are distinct from the tested code/artifact bytes.
