# Worker prompt — DC #335 — get_favicon runtime integration

Repo: Ma-XX-oN/DownloadConversation
Issue: https://github.com/Ma-XX-oN/DownloadConversation/issues/335
Parent: DC #332
Role: speculative Interface B V1 consumer and DOM presenter.
Canonical blockers while unfinished: DC #333 and DC #334.

Implement/test DC #335 speculatively against the frozen B V1 session
interface.  Read AI_AGENT_RULES.md, DESIGN.md, this PMD, the issue,
and docs/FAVICON_CACHE_INTERFACES_V1.md at commit
a1aef7a3b1222eb4c62abf7c729021c1a481ac42.  Verify contract blob
SHA e2460ba2bf1c1852579782ecbb05139de32e505e.

1. Reconcile actual main, existing lifecycle code and current ownership
   before creating/resuming a #335 branch.  Do not edit #333 asset
   generator, #334 IndexedDB provider, or the frozen interface.
2. Write RED tests for the exact C V1
   `get_favicon(compatible_version_key, base_type, completion_time,
   time_offset)` response and late async response suppression using
   a B V1 `FaviconDatasetSession` test double.  Do not claim that a
   test double proves provider integration.
3. Map base types 0 yellow, 1 green, 2 red, 3 white; progress 0..6;
   and 10 s/250 ms time offset to 0..20 pulse frames *inside*
   `get_favicon`.  Use session-returned native PNG Blobs, object
   URLs and exact link candidates; unknown source favicon stays
   original.  Cache only previously requested local frame URLs.
4. Replace expensive per-250-ms `image.onload`/canvas/pixel/PNG
   rendering with async URL selection on the existing consumer.
   Use `update_every_ms` only for scheduled calls, skip duplicate
   href assignments, and allow immediate lifecycle state changes.
   Reject stale async results with the existing/current generation
   mechanism, and preserve cleanup/reload/navigation.
5. Preserve current shared observer semantics: processing yellow,
   success green only after observed processing, focus acknowledgment
   white, later terminal error red, reload NOT_STREAMING leaves
   original, and all 5-minute pie/ring progress rules.  Do not change
   sound, stopwatch, terminal detectors or network request ownership.
6. Test regressions for multi-link/favicon-source variants, generation
   races, focused/unfocused tabs, reload, errors and source failures.
   Verify no per-tick getImageData/putImageData/toDataURL or full
   dataset preload.  Run exact-candidate build/CI and update DESIGN.md
   *only to reflect actual implemented code*.  Publish distinct #335
   PR and test evidence; **do not merge**.

Until #333 and #334 are DONE and actual B V1 integration tests pass,
handoff as `SPECULATIVE IMPLEMENTATION COMPLETE; BLOCKED by DC #333,
DC #334`.  Never close #335 on a mocked-provider result.  Revalidate
if its V1 provider contract changes.

Follow AUTONOMOUS_EXECUTION_WINDOW_RULE, measured wall-clock windows,
elapsed-time progress updates and exact handoff.  Continue work after
status updates unless a genuine stop condition applies.

@FAVICON_CACHE_WORKERS.pmd