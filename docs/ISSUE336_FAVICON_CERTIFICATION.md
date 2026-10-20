# DC #336 — local on-demand favicon sequence certification

**Status: SPECULATIVE TEST PREPARATION ONLY.  NOT INTEGRATED / NOT DONE.**

Parent DC #332; prerequisites DC #333, DC #334 and DC #335.
Owned branch issue-336-favicon-integrated-certification, draft PR #345.
Do not merge, close or certify on simulated evidence.

## Current contract and obsolete evidence

The revised 2026-10-20 DC #332–#336 issue bodies and latest
21-frame clarification supersede the frozen V1 GitHub binary
pack/download/catalogue model. The historical V1 contract remains at
Git blob e2460ba2bf1c1852579782ecbb05139de32e505e, but is **NOT**
the authority for current implementation.

**Numbered V2 is not frozen.** DC #332 owns provider API, version-range
authority, transaction/notification semantics, and worker rebinding.
Our independent oracle implements only product-level acceptance
expectations, not a speculative #333/#334/#335 provider API.

Image sequence identity is the tuple (selected numeric release boundary,
unmodified original favicon URL, active light/dark theme, base colour,
completed 5-minute progress step). A miss for ANY pulse index triggers
**one complete 21-PNG Blob sequence for that tuple**. Zero other tuples
are generated. Pulse indexes 0..20 are selected from 40 update slots
at 250ms over the existing 10-second waveform. Dataset scheduling
interval never enters an image key. No GitHub assets, binary packs,
embedded raster tables, background prefetch or full 588-state
generation is permitted.

## Acceptance matrix

Rows explicitly distinguish preparation from integrated proof.

| ID | Required acceptance | Preparation status | Real integration |
|---|---|---|---|
| G01 | First cold arbitrary frame generates exactly 21 PNGs | ORACLE PASS | INCOMPLETE |
| G02 | Zero unrelated URL/theme/colour/step/version generation | ORACLE PASS | INCOMPLETE |
| G03 | 40 slots reuse 21 half-cycle frames, 10s cosine 50–100% | ORACLE PASS | INCOMPLETE |
| G04 | Each generated PNG decodes, correct dimensions/alpha | CHROMIUM FIXTURE ONLY | INCOMPLETE |
| G05 | Same SVG URL yields distinct light/dark actual raster | CHROMIUM FIXTURE PASS | INCOMPLETE |
| G06 | Light-only and dark-only requests generate only needed theme | ORACLE/CHROMIUM PASS | INCOMPLETE |
| G07 | Source/active theme flip during generation cancels stale result | WAIT FOR V2 | INCOMPLETE |
| G08 | Four colours yellow/green/red/white, seven steps 0..6 | ORACLE PASS | INCOMPLETE |
| G09 | Recolour near-white and preserve alpha/nonwhite source pixels | HISTORICAL #333 | INCOMPLETE |
| G10 | Pie behind logo, ring above, 30min full red saturation | HISTORICAL #174 | INCOMPLETE |
| G11 | No cold-generation main-thread UI stall | WAIT FOR REAL PROVIDER | INCOMPLETE |
| G12 | Missing, 404 or tainted original safely retains stock | WAIT FOR REAL PROVIDER | INCOMPLETE |
| S01 | First tab acquiring exclusive per-sequence claim wins | ORACLE PASS | INCOMPLETE |
| S02 | Contenders show unmodified original until all 21 ready | ORACLE PASS | INCOMPLETE |
| S03 | One atomic write commits 21 Blobs and ready marker | ORACLE PASS | INCOMPLETE |
| S04 | Aborted write leaves no partial ready/images | ORACLE PASS | INCOMPLETE |
| S05 | Crashed owner releases lock for another generator | ORACLE PASS | INCOMPLETE |
| S06 | Simultaneous tabs do not duplicate sequence rendering | ORACLE PASS | INCOMPLETE |
| S07 | Cold frame lookup only on first access, warm zero IDB reads | ORACLE PASS | INCOMPLETE |
| S08 | No eager preloading of unrequested tuples or frames per tab | ORACLE PASS | INCOMPLETE |
| S09 | Different versions/original URLs/themes coexist | ORACLE PASS | INCOMPLETE |
| S10 | last_used throttled to no more often than 600000ms | ORACLE PASS | INCOMPLETE |
| S11 | Exactly 600000ms retained; >600000ms evictable | ORACLE PASS | INCOMPLETE |
| S12 | Active shared reader protected during exclusive cleanup | ORACLE PASS | INCOMPLETE |
| S13 | After eviction next request re-generates precisely 21 | ORACLE PASS | INCOMPLETE |
| S14 | Lock/IDB unavailable, failure and later retry fail closed | WAIT FOR REAL PROVIDER | INCOMPLETE |
| S15 | Reload/new tab and teardown URLs remain safe and bounded | WAIT FOR REAL PROVIDER | INCOMPLETE |
| L01 | Capture original before mutation, preserve media/type/sizes | CHROMIUM FIXTURE/HISTORICAL | INCOMPLETE |
| L02 | Processing yellow, success green, focus white | HISTORICAL #148/#288 | INCOMPLETE |
| L03 | Terminal error red even after an earlier successful final | HISTORICAL #148 | INCOMPLETE |
| L04 | New processing yellow, NOT_STREAMING reload stock | HISTORICAL #148 | INCOMPLETE |
| L05 | IS_STREAMING reload yellow using shared lifecycle watcher | HISTORICAL #148 | INCOMPLETE |
| L06 | Progress 0–6 with correct timer/stopwatch | HISTORICAL #174 | INCOMPLETE |
| L07 | Same-URL SVG active theme change displays matching sequence | CHROMIUM FIXTURE | INCOMPLETE |
| L08 | Stale async reply cannot override newer theme/colour/step | WAIT FOR REAL #335 | INCOMPLETE |
| L09 | Pagehide restores stock before revoking Blob URLs | HISTORICAL #335 | INCOMPLETE |
| L10 | Unknown original candidate remains unchanged | HISTORICAL #335 | INCOMPLETE |
| L11 | 250ms warm updates: zero canvas/pixel/re-encode work | ORACLE ONLY | INCOMPLETE |
| L12 | Sound, stopwatch, focus and network watcher unchanged | WAIT FOR INTEGRATION | INCOMPLETE |
| P01 | Exact certified #333/#334/#335 production integration | BLOCKED | INCOMPLETE |
| P02 | Real 2+ tab Chromium IDB/Web Locks failure and takeover | BLOCKED | INCOMPLETE |
| P03 | Authenticated ChatGPT Chrome lifecycle and theme tests | BLOCKED | INCOMPLETE |
| P04 | Full repository CI on exact committed userscript artifact | BLOCKED | INCOMPLETE |
| P05 | Real 24-second main-thread CPU/JS/decode/heap comparison | BLOCKED | INCOMPLETE |
| P06 | IndexedDB reads/writes/metadata/memory/URL counts | BLOCKED | INCOMPLETE |
| P07 | Direct installable exact-tested userscript link | BLOCKED | INCOMPLETE |
| P08 | Verified results on #336/#332 and no unmerged-approval breach | BLOCKED | INCOMPLETE |

## Executable preparation, independent of V2 APIs

- tests/issue336-v2-sequence-contract.test.mjs: 10 Node synthetic
  model cases for 21-frame generation exclusivity, arbitrary pulse
  position, lock winner and stock waiter, generator crash/transaction
  abort/retry, per-theme and per-source identities, 4 colours x 7 steps,
  version lower boundaries, warm reads, 10-minute expiry and active
  reader. **Not** the real IndexedDB or Web Locks implementation.
- tests/issue336-v2-theme-chromium.test.mjs: real Chromium CSS
  prefers-color-scheme and PNG encode fixture; the exact same SVG data
  URL renders black in light and white in dark; each demanded theme
  generates 21 synthetic frames, never other tuples; a warm request
  generates zero. **Not** DC #333 renderer or DC #335 lifecycle.
- Prior V1-only tests are preserved in history at blobs
  eafceb51c7f37698beed58746c5b803c8d4ffc97 (binary pack) and
  c619cdc743071fea491731d86ade904e9883e0a0 (Chromium pack
  fixture). They are removed from the active PR testing surface.

Independent comparable source tests in this execution environment
(Node v22.16.0, Chromium 144.0.7559.96) passed 11/11: 10 simulation
cases plus 1 real-browser SVG colour-scheme raster case.
The independently executed local files and authored GitHub source are
not byte-identical; exact-head CI must still validate committed bytes.
Local Chrome restrictions block network navigation (ERR_BLOCKED_BY_ADMINISTRATOR)
and about:blank has no Web Locks. Real cross-tab IDB/Web Locks acceptance
remains INCOMPLETE. Do not describe this as 11 production passes.

## Baseline and benchmark separation

**Original real Chrome 2026-10-20 trace:** 23.98-second recording;
91 image-load callbacks; 20,090.134ms aggregate callback JavaScript
work. Original trace environment/decode/heap breakdown not supplied;
therefore those numbers are unknown.

Reuse existing independent DC #328 / draft PR #329 Chromium synthetic
benchmark as historical evidence: 250ms paced legacy JS 76.7ms,
cached JS 2.3ms; legacy task CPU 172.078ms, cached 44.998ms.
That benchmark does NOT measure V2 production, and no improvement
percentage can yet be claimed.

After exact V2-bound implementations are ready, record CPU
TaskDuration, ScriptDuration, image onload callback work/count,
favicon decode/raster tasks, object URL lifetime and mutations,
IDB get/put/ready/last_used, JS heap, event-loop responsiveness,
browser/OS/CPU, two-tab cold/warm, same-URL SVG theme flip and
reload/error/focus transitions, with source SHA and exact userscript
hash. Use both a 24-second warm session and separately measured cold
generation; compare matching conditions with baseline and clearly
state any missing measurement.

## User Chrome acceptance handoff (after integration)

1. Obtain direct immutable, full-CI-tested .user.js URL and verify the
   downloaded SHA/version before installation. Never supply an
   untested development or moving-main installer.
2. Install in Chrome/Tampermonkey; reload ChatGPT, capture original
   favicon link href/media/type/sizes and Chrome/OS version.
3. Open DevTools Performance; record 24 seconds during actual
   processing with 250ms updates, export trace. Repeat warm.
4. Inspect live tab favicon, CPU task/script time, image callbacks,
   decode work, memory and IDB reads. Record measured values.
5. Open a second same-origin tab on the same selected tuple; prove
   first lock winner, contender stock icon, one atomic 21-frame
   publication and no duplicate rendering. Test tab closure/abort.
6. Change active browser theme without changing the original SVG
   URL, verify new demanded theme only and correct original fallback.
7. Exercise all four states, all seven progress steps, 10s cycle,
   terminal error after success, focus acknowledgment and reload.
8. Check last_used exactly 10m, 10m+1ms, active-reader lock and
   regeneration after safe expiry. Publish exact log, environment,
   tested SHA, CI run and actual results to DC #336 and DC #332.

## Convergence gates

- [ ] DC #332 freezes numbered V2 and binds all affected workers.
- [ ] DC #333 actual renderer source/theme/PNG pixel conformance.
- [ ] DC #334 actual IndexedDB/Web Locks atomic sequence conformance.
- [ ] DC #335 actual lifecycle consumer conformance.
- [ ] Exact integrated candidate tests and full repository CI PASS.
- [ ] Real Chromium plus authenticated ChatGPT Chrome acceptance PASS.
- [ ] Original vs integrated CPU/JS/decode/DB/memory evidence recorded.
- [ ] Direct exact-tested artifact handoff; draft PR remains UNMERGED.

**Final certification BLOCKED by DC #333, DC #334, DC #335.**
