# DC #332 — V2 convergence acceptance ledger (2026-10-20)

Status: **integration candidate certified on controlled Chromium; authenticated
ChatGPT baseline comparison incomplete.** PR #346 is DRAFT and UNMERGED.
Convergence authority: DC #332; contributing issues #333→#334→#335→#336.
No issue is closed merely because isolated provider tests passed.

## Immutable authorities

- Original frozen V1: historical only, blob
  `e2460ba2bf1c1852579782ecbb05139de32e505e`.
- Frozen V2.0: `docs/FAVICON_CACHE_INTERFACES_V2.md`, blob
  `1361fdd928d1a456485cf4ec4559dd1492945598`,
  commit `bc2035c40cd63f0d5f245e4a07f56184849ffd04`.
  Do not edit V2 in place.
- Exact integrated tested candidate: version `1.11.10-issue.332.6`,
  source parent `fafff0cf9bde162519c48642a730cab8e7d601b8`,
  prepared/tag target `5fd7e872ac6b6ccfcafa8a3779de040ff3dd79cf`.
  Git annotated tag `v1.11.10-issue.332.6`; generated userscript
  blob `bc0b2e724571bb30868e8155ecd4c6c538b89424`,
  size 1,214,883 bytes. GitHub Actions full push run
  https://github.com/Ma-XX-oN/DownloadConversation/actions/runs/39509209872
  policy/prepare/structured validation/finalize PASS. Structured artifact
  12304853157: status PASS, returncode 0, exact commit, all named
  repository-owned stages PASS. PR-only policy runs are not counted as
  functional validation.
- Separate real provider+consumer hosted candidate: version `.332.5`,
  prepared commit `0604a71625cc7dcde69b5b377f903aea70335fbe`,
  full pass run 39507848611; source worker revisions are listed in
  the frozen V2.0 spec. Later integration commits preserve source lineage.
- New V2 real theme-flip check added after the .332.6 certified candidate
  to `tests/issue332-v2-warm-performance.test.mjs`; NOT certified in
  this ledger until its own exact candidate CI passes.

## Acceptance (source authority / method / observed result / status)

| Requirement | Method and actual evidence | Status |
|---|---|---|
| Frozen V2, numeric-to-semantic adapter, local registry | V2 blob, source/manifest and exact artifact verifier on .332.6 | PASS |
| On first missing tuple generate exactly 21 PNG Blobs, no unrelated tuples | Actual #333→#334 two-tab Chromium, 21 Blob encodes, .332.6 | PASS |
| First-winner exclusive Web Lock, other tab stock until ready | Real two-tab Chromium #332 and #334 tests | PASS |
| Transaction abort, crash/navigation takeover, atomic ready marker | Actual IndexedDB/Web Locks Chromium #334 plus #332 real renderer | PASS |
| Actual #335 consumer creates cached URL and restores untouched stock URL | Real three-provider integration .332.5/.332.6 | PASS |
| 250ms warm cycle has no canvas encode, bitmap decode or DB reads | Actual #333/#334/#335 controlled-origin Chrome 155, 24s .332.6 | PASS |
| Version suffix ignored, multiple compatible versions and source URLs | #334 Node + Chromium and #335 source/consumer tests, .332.6 | PASS |
| Light/dark distinct key and raster for same URL | Real #333 source pixel and #334 cache suites; .332.7 will test all three together | PARTIAL |
| Ten-minute touch throttle and strictly >10-minute inactive expiry | Actual #334 Chromium, shared reader lock, .332.6 | PASS |
| Original link media/type/sizes, error/acknowledged/progress and lifecycle | #335 contracts, #333 pixel parity, DC lifecycle/stopwatch/sound hosted regression | PASS |
| No stale async overwrite, pagehide cleanup and restored URL | #335 consumer stale-result regressions, page navigation takeover and real consumer restore | PASS |
| Build deterministic, all sources <500 lines and 16KiB, full hosted CI | Source manifest, artifact verifier, repository-owned policy and CI .332.6 | PASS |
| Authenticated ChatGPT 24s CPU/callback count, decoding, memory and responsiveness vs Oct 20 baseline | Requires browser with active ChatGPT session, Tampermonkey and Chrome DevTools | INCOMPLETE |
| Convergence issues final acceptance and approval-to-merge | Child issues open; draft PR #346 unmerged; user permission mandatory | INCOMPLETE |

**Historical RED:** #334 recorded 4/4 source-contract negatives on pre-V2,
#335 recorded 3/3 negatives against its V1 parent; V2 functional and Chromium
GREEN suites passed at prepared commits. Source predicate RED is **not** an
executed end-to-end functional RED and must not be represented as such.
Old V1 pack tests are obsolete; synthetic/provider fixtures are separate
from real renderer+cache+consumer evidence.

## DC #336 controlled Chromium performance — .332.6

Actual headless Chromium 155, origin-controlled page serving immutable
ChatGPT SVG; 24,003 ms real warm window (96 scheduled 250ms callbacks).
One run, **not** authenticated chatgpt.com and not a matched baseline
comparison. Values taken from exact structured validation artifact:

| Metric | Cold acquisition and first 21-frame prewarm | 24s warm period |
|---|---:|---:|
| PNG toBlob encodes | 21 | 0 |
| createImageBitmap calls | 21 | 0 |
| Aggregate bitmap decode wall time | 11.1ms | 0ms |
| IndexedDB transactions | 26 | 0 |
| IndexedDB get requests | 45 | 0 |
| Instrumented favicon link load callbacks | 0 | 0 |
| Periodic scheduled heartbeat callbacks | Not sampled in cold | 96 |
| Aggregate synchronous heartbeat JS time | Not sampled in cold | 8.6ms |
| Cold first 21-frame acquisition time | 107.1ms | Not applicable |

Warm browser observation: 24,003ms elapsed; 2,411 UI sampling callbacks
at 10ms nominal cadence; maximum observed gap 13.2ms; zero observed long
tasks; 5,092,308 reported JS heap bytes at end, 21 tab-local object URLs.
Stock media/type/sizes unchanged; stock href restored after cleanup.

**Original authenticated Oct 20 baseline:** 23.98s duration, 91 favicon
image-load callbacks, 20,090.134ms aggregate callback JavaScript time.
The controlled fixture's 0 favicon link-load callbacks and 8.6ms
synchronous heartbeat JS time are **different instrumentation and page
workloads**; do not claim a measured production improvement percentage
until an authenticated before/after comparable trace is captured.

## Required handoff before any completion/merge

1. Verify the latest exact candidate's structured CI, immutable tag and
   packaged blob identity; update this ledger if it differs from .332.6.
2. Install the **tested** userscript from the commit-pinned GitHub source
   page (click Raw when authenticated), after backing up current
   Tampermonkey configuration. Confirm its installed @version.
3. In ordinary authenticated chatgpt.com Chrome tabs, collect one cold
   (new version/source/theme/base/step) and one warm >=24s performance
   profile, with saved trace/Har or DevTools metrics: favicon image-load
   callback count, aggregate JS time, PNG encode/decode work, IDB reads/
   writes, memory, long tasks and event-loop/UI responsiveness. Test
   competing open tabs, focus acknowledgement, theme flip using the
   same source URL, stock attributes and reload/navigation restoration.
   Do not include private ChatGPT message bodies or tokens in evidence.
4. DC #332 reviews the submitted trace against 23.98s/91/20,090.134ms,
   records actual device/browser/version provenance, reconciles failures
   with original child issue owners and reruns affected CI.
5. Only after independent acceptance GREEN, arrange issue ownership
   handoff and closure using the authoritative RWF process. Do not
   mistake issue comments for an atomic claim transfer. Do not merge
   #346 or any child PR before the user's explicit authorization.

## Added negative-cache RED regression (DC #334)

Current provider source at `b8d62af2a0e9799cc164ecfd1ec58414aa9fbe40`
clears in-flight work on rendering failure without enforcing a cooldown.
A 250ms heartbeat repeats the exact unsupported tuple, recreating expensive
renderer work and diagnostics. This is an identified defect, not an
accepted no-op. New test
`tests/issue332-v2-failure-backoff.test.mjs` uses the true #333 renderer,
#334 IndexedDB, #335 consumer, a 48×48 fully opaque SVG known to yield
`FaviconRenderError`, and 2450ms of actual heartbeat callbacks. The
acceptance expects no more than two failed render attempts in that interval,
no ready markers, and preservation of the stock icon. Independent GREEN
verification remains blocked until DC #334's source owner fixes the
per-sequence failure backoff and provider tests prove a later retry.
The new regression is a RED witness, never a production PASS.

## DC #332 .332.10 CI harness boundedness

The source-owned provider remains unchanged while DC #334 owns failure
backoff. Version .332.9 introduced the failure-case real Chromium regression;
its hosted run 39512026636 did not finish within the previous execution
window, and no structured RED/FAIL artifact was available. Candidate .332.10
adds a strict 90-second CI-stage timeout for this regression (timeouts FAIL;
not skipped) and explicitly closes Chrome stdout/stderr on browser timeout to
prevent child processes retaining pipes indefinitely. Functional assertion
remains no more than two failed renders over 2450 ms, zero ready sequences,
and original favicon unchanged. This is an observable gate, not a relaxation.
