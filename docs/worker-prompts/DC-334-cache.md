# Worker prompt — DC #334 — Shared IndexedDB favicon cache

Repo: Ma-XX-oN/DownloadConversation
Issue: https://github.com/Ma-XX-oN/DownloadConversation/issues/334
Parent: DC #332
Role: speculative consumer of Interface A V1; provider of Interface B V1.
Canonical blocker while #333 incomplete: DC #333.

Implement and contract-test DC #334 speculatively without waiting
for DC #333's complete asset generator.  First read AI_AGENT_RULES.md,
DESIGN.md, the issue, this PMD, and the frozen V1 interface at commit
a1aef7a3b1222eb4c62abf7c729021c1a481ac42, blob SHA
e2460ba2bf1c1852579782ecbb05139de32e505e.

1. Recover current main and any existing #334 worker claim/branch.
   Respect exclusive ownership: do not edit #333's pack/generator,
   #335's live DOM consumer, or the frozen contract.
2. Write failing contract tests for the A V1 `.dcfav` fixture:
   exact magic/header/offsets, validated PNG Blobs and hashes,
   version lower-bound selection by numeric major/minor/patch alone,
   with `-issue.*` suffixes ignored (never sorted), malformed input,
   and multiple simultaneous DC dataset versions.
3. Implement `get_compatible_version_key(version)` and
   `open_favicon_dataset(version_key)` exactly as frozen in B V1;
   provide `FaviconDatasetSession.find_variant()`, `read_png()`,
   `update_every_ms`, `version` and `close()` with matching return/
   error semantics.  Do not substitute a different API.
4. Implement binary GitHub fetch, integrity validation, shared-origin
   IndexedDB atomic population, per-dataset Web Lock serialization,
   shared reader session protection, on-demand single-Blob reads,
   one-time version lookup/memoization and no full-set tab preload.
5. Persist `last_used` at first successful use and no more than once
   every ten minutes thereafter; safely sweep only datasets older
   than ten minutes, recheck under an exclusive lock, and protect
   an active shared session from deletion.  Test interrupted imports,
   races, re-fetch after eviction, unavailable IndexedDB/Web Locks,
   and clean release of resources.
6. Run Chromium cross-tab integration against **synthetic V1 fixtures**
   first.  Use the existing DC #328 benchmark harness where useful.
   Run RED/GREEN, regression, exact-source hosted CI and record results.
   Stage a distinct #334 PR, **unmerged**.

Speculative handoff: state `SPECULATIVE IMPLEMENTATION COMPLETE;
BLOCKED by DC #333`, with assumed A V1 SHA and which tests used only
fixtures.  Do not call the ticket DONE or retire #333.  When #333
publishes a real certified pack, verify its exact revision using
the real cache/provider integration, rerun necessary tests and only
then consider ordinary completion.

Apply AUTONOMOUS_EXECUTION_WINDOW_RULE, 25-minute measured execution
windows, elapsed-time progress updates and precise final handoff.
Continue actionable work without waiting for status acknowledgment.

@FAVICON_CACHE_WORKERS.pmd