# Worker prompt — DC #336 — Favicon cache convergence certification

Repo: Ma-XX-oN/DownloadConversation
Issue: https://github.com/Ma-XX-oN/DownloadConversation/issues/336
Parent: DC #332
Role: acceptance/test worker.  Preparation may overlap; final
certification requires the exact implemented #333/#334/#335 sequence.

Read AI_AGENT_RULES.md, DESIGN.md, this PMD, DC #328 benchmark and
PR #329, and the frozen interface revision:
a1aef7a3b1222eb4c62abf7c729021c1a481ac42,
blob SHA e2460ba2bf1c1852579782ecbb05139de32e505e.

1. Recover current main, existing #336 claim/PR and upstream PRs.
   Respect ownership: no edits to another worker's source, assets,
   storage implementation or lifecycle code.  Do not merge.
2. While prerequisites are unfinished, independently prepare fixed
   Chromium fixtures, deterministic time and favicon pixel tests,
   same-origin multi-tab and storage-partition checks, pack integrity/
   corruption, cold/warm cache read counts, concurrent first load,
   eviction >10 minutes, shared session lock and version-boundary
   test matrices.  Only preparation may be claimed complete.
3. Plan exact comparisons against the 2026-10-20 pre-change Chrome
   trace (~24s, 91 favicon image.onload callbacks, ~20.09s callback
   time), with CPU task/script samples, PNG decode and memory/storage
   measures.  Reuse evidence from DC #328 but do not equate its
   synthetic headless PNG benchmark with production performance.
4. When real upstream implementations are ready, take their exact
   verified revisions, integrate on an issue-owned candidate,
   certify pack bytes/catalogue, real IndexedDB and get_favicon,
   all visual/lifecycle semantics and full existing tests.  Record
   any contract mismatch/staleness and direct the owning upstream
   worker to correct it; do not silently amend A/B V1.
5. Run repository-authorized exact built-userscript CI and actual
   Chrome/ChatGPT acceptance.  If real browser evidence needs user
   execution, supply direct tested script URL, commands, expected
   results and files/logs required.  Do not invent a PASS.
6. Publish final evidence as issue/PR comments with exact commits,
   measurements, known regressions, and parent #332 status.  Keep
   every PR unmerged without explicit authorization.

Do not call DC #336 DONE or retire DC #332 while DC #333, DC #334
or DC #335 remains incomplete or unverified.  Clearly distinguish
test-preparation PASS from authoritative integration PASS.  Do not
stop when other independent test preparation remains actionable.

Apply AUTONOMOUS_EXECUTION_WINDOW_RULE: actual start time, 25-minute
window, wall-clock elapsed in progress updates, continuous execution
and precise handoff if a genuine stop condition occurs.

@FAVICON_CACHE_WORKERS.pmd