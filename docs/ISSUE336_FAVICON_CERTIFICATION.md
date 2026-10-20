# DC #336 — favicon cache integration certification ledger

**Status:** PREPARATION ONLY; NOT CERTIFIED (2026-10-20).

**Pinned contract:** FAVICON-CACHE-INTERFACES-V1 at Git blob
e2460ba2bf1c1852579782ecbb05139de32e505e.
Pinned commit: a1aef7a3b1222eb4c62abf7c729021c1a481ac42.
Contract owner: DC #332, draft unmerged PR #337.

## Evidence classifications

- FIXTURE: synthetic contract model and browser fixture; never proof of #333/#334/#335.
- PROVIDER: real #333 image bytes and #334 cache tested at exact commits.
- CONSUMER: #335 actual live favicon adapter at exact commit.
- HOSTED: complete CI at a unique prepared userscript SHA.
- BROWSER: actual integrated userscript in controlled Chromium.
- LIVE: exact userscript installed in authenticated ChatGPT Chrome session.

Required for DONE: authoritative #333/#334/#335 plus PROVIDER, CONSUMER,
HOSTED, BROWSER and LIVE results. Never substitute FIXTURE for a real
integration. No merge without explicit authorization.

## Acceptance matrix — A, versioned binary assets

| ID | Coverage | Required outcome | Status |
| --- | --- | --- | --- |
| A01 | real original resources and variants | exact source bytes/digests; media, type and sizes preserved | INCOMPLETE |
| A02 | all colours 0..3, steps 0..6, frames 0..20 | 588 distinct nonoverlapping PNG payload spans per source variant | FIXTURE only |
| A03 | original stock image, unknown variant | preserve original href, never substitute mismatched image | INCOMPLETE |
| A04 | signature, IHDR and actual Chromium decode | dimensions and transparency match original | Synthetic Chromium 1176 PNG decode/pixel checks PASS; genuine source fidelity INCOMPLETE |
| A05 | pack magic, LE header length, canonical JSON, offsets | exact V1 representation with full contiguous payload | FIXTURE only |
| A06 | truncated, corrupted, wrong length/hash or invalid manifest | reject entire dataset; safe fallback and retry | FIXTURE negative only |
| A07 | earlier than first boundary, exact and later versions | greatest compatible minimum numeric triplet | FIXTURE only |
| A08 | all issue suffix variations | identical major.minor.patch resolves identically | FIXTURE only |
| A09 | duplicate boundaries / invalid version | reject unsafe catalogue; never guess | FIXTURE only |
| A10 | update_every_ms changes | scheduling only; not image identity/key | INCOMPLETE |
| A11 | GitHub catalogue/pack unavailable then recovered | bounded diagnostics, stock href, successful later retry | INCOMPLETE |

Executable preparation: tests/issue336-favicon-pack.test.mjs.
Run: node --test tests/issue336-favicon-pack.test.mjs.
After #333, download exact pack and catalogue and run:
node tests/issue336-favicon-pack.test.mjs --real-pack CATALOGUE PACK DC_VERSION.
This real-pack mode validates byte length, SHA, magic, manifest, offsets
and PNG signatures/IHDR; **not** actual browser decoding, pixels or live
lifecycle. Test fixture is deterministic 1x1 PNG data, not a genuine pack.

## Acceptance matrix — B, IndexedDB, Web Locks, cross-tab

| ID | Scenario | Required outcome | Status |
| --- | --- | --- | --- |
| B01 | two tabs cold-open simultaneously | exactly one download/import; second waits/rechecks | INCOMPLETE |
| B02 | additional warm same-origin tab | no pack re-download | INCOMPLETE |
| B03 | previously unseen PNG frame | one selected Blob read, no full-frame preload | INCOMPLETE |
| B04 | repeated previously selected frame | zero new IndexedDB reads; same URL reused | INCOMPLETE |
| B05 | interrupted import / aborted transaction | no partial ready marker or collection | INCOMPLETE |
| B06 | corruption and restart | no bad icon, recover on retry | INCOMPLETE |
| B07 | now-last_used exactly 600000ms | retained | INCOMPLETE |
| B08 | now-last_used greater than 600000ms | deleted exclusively after recheck | INCOMPLETE |
| B09 | repeated activity within 600000ms | no repeated last_used write | INCOMPLETE |
| B10 | shared live session plus exclusive cleanup | active reader cannot be evicted | INCOMPLETE |
| B11 | close with in-flight reads | waits, releases lock, displayed URL remains valid | INCOMPLETE |
| B12 | concurrent different DC version triplets | both datasets coexist without collisions | INCOMPLETE |
| B13 | Web Locks/storage denied | safe original fallback without unsafe alternate | INCOMPLETE |
| B14 | tab reload / navigation / close | release lock and URLs at correct lifecycle boundaries | INCOMPLETE |

Reuse benchmark source from **DC #328, draft PR #329**, not a duplicate.
Its existing synthetic result checks primitive IDB Blob sharing, warm reads,
lock waiting, and cutoff only; those checks are NOT B01-B14 production passes.

## Acceptance matrix — C, state and presentation

| ID | Input | Required output | Status |
| --- | --- | --- | --- |
| C01 | initial untouched | original favicon | INCOMPLETE |
| C02 | observed processing | yellow immediately | INCOMPLETE |
| C03 | successful terminal after observed processing | light green | INCOMPLETE |
| C04 | focused completion acknowledgement | white | INCOMPLETE |
| C05 | error terminal | red | INCOMPLETE |
| C06 | final then later error, same exchange | yellow -> green -> red | INCOMPLETE |
| C07 | next processing after completion | yellow | INCOMPLETE |
| C08 | reload IS_STREAMING | yellow; no independent watcher | INCOMPLETE |
| C09 | reload NOT_STREAMING | original; no inferred green | INCOMPLETE |
| C10 | favicon media/type/sizes and different original digests | correct matching per-link variant or untouched | Synthetic two-candidate Chromium PASS; production INCOMPLETE |
| C11 | times 0,5,10,15,20,25,30,31 minutes | steps 0..6, saturated ring/pie, correct layering | INCOMPLETE |
| C12 | 40 slots, 21 frames, 10s, 250ms, negative offset | correct symmetric index, full-composite cosine alpha | Synthetic 40-slot/21-frame Chromium and Node selection PASS; real alpha INCOMPLETE |
| C13 | late asynchronous result after newer state | generation token rejects stale result | INCOMPLETE |
| C14 | identical frame and href | no redundant DOM assignment | INCOMPLETE |
| C15 | navigation, reload, tab switch | original recovery and safe Blob URL disposal | INCOMPLETE |
| C16 | heartbeat profile | no canvas/getImageData/putImageData/toDataURL per tick | INCOMPLETE |
| C17 | existing stopwatch, sound, terminal, focus semantics | unchanged existing watcher consumer behaviour | INCOMPLETE |

Repeat existing tests including tests/agent-favicon-state.test.mjs,
tests/agent-favicon-browser-selection.test.mjs,
tests/agent-favicon-thirty-minute-ring.test.mjs,
tests/agent-favicon-heartbeat.test.mjs,
tests/agent-terminal-dispatch.test.mjs and
tests/agent-turn-stopwatch-reload.test.mjs. Canvas-specific source-shape
tests must be updated by #335 to check the new real implementation while
retaining the accepted behaviour assertions.

## Independent fixture execution (2026-10-20)

Node.js 22.16.0, Debian Chromium 144.0.7559.96, synthetic pack
with 2 variants, 4 colours, 7 steps and 21 unique phase images.
Executed: `node --test tests/issue336-favicon-*.test.mjs`.
**5/5 tests PASS**, including **1 genuine Chromium browser-runtime fixture**.
The browser decoded and pixel-verified all **1,176** generated 1x1 PNGs,
retained an unmatched favicon link and source `media/type/sizes`,
restored source hrefs, and made zero extra on-demand Blob URL allocations
when replaying 40 warm frames. Object URLs used: 1,176.
Synthetic href assignments: 2,320, with **zero** redundant writes when
the same state/frame was requested twice.

Earlier Chromium `--dump-dom` and direct local/data navigations hung or
were blocked by administrator restrictions. The fixture was repaired to
use Chromium DevTools Protocol against `about:blank` instead of
navigating to a local test server. That exercises Chromium PNG
decoding, canvas pixel sampling, original candidate DOM behaviour
and Blob URLs; it is **not** a ChatGPT/browser extension session,
does **not** access IndexedDB or Web Locks, and does **not** exercise
the real #333 pack or #335 runtime. Fixture source blob:
`c619cdc743071fea491731d86ade904e9883e0a0`; exact candidate commit:
`ef6b398fbc7e80d0e5956b5c7294ffc65f5ef827`.

The A/B/C production and integrated acceptance statuses above remain
INCOMPLETE. This evidence closes only the independent synthetic-browser
**preparation** check.

## Performance: original vs synthetic vs integrated

Real October 20 baseline: 23.98s session, 91 image.onload callbacks,
20,090.134ms aggregate callback JavaScript time. The original profile
file and host configuration are not attached to this issue.

Existing PR #329 synthetic Chromium 155 / 256x256 test-icon result:
paced 250ms JS work legacy 76.7ms vs cached 2.3ms; task CPU legacy
172.078ms vs cached 44.998ms; warm IndexedDB extra reads 0.
Prepared PR #329 commit 00801b05384e1069b30327d597599859369a099e;
hosted historical run 39445952678. NOT production measurements.

For each actual integrated run, capture: tested userscript SHA/version,
asset/dataset hashes, browser/OS/CPU, 24s duration, number of foreground and
background tabs, cold/warm state, TaskDuration and ScriptDuration deltas,
image.onload callback count/time, Image decoding, href mutations,
IndexedDB get/put counts, memory heap and main-thread flame graph.
Compare measurements only under documented matching conditions. Do not
invent absent timings, percentage improvement, or decode overhead.

Manual Chrome sequence after authoritative provider readiness:
1. Install direct immutable userscript artifact corresponding to hosted
   verified SHA, record exact URL, SHA and script version.
2. In ChatGPT Chrome, open DevTools Performance and record at least 24
   seconds during an ongoing generation with 250ms favicon updates.
3. Save the trace. Inspect image.onload, main-thread long tasks,
   scripts, raster/decode work, favicon href changes and memory.
4. Repeat warm same tab; add second and third same-origin tabs.
5. In Application/IndexedDB, inspect versioned Blob keys, last_used
   timestamps, lock-protected cleanup and re-download after expiry.
6. Exercise C01-C17 with deterministic clock where possible; run real
   streaming/reload/focus/error tests without asserting synthetic states.
7. Preserve original and new traces, record all exact environment settings
   and CPU/event-count comparisons on DC #336 and DC #332.

## Completion gates

- [ ] #333, #334, #335 authoritative ready and exact SHAs pinned.
- [ ] #333 binary pack actual origin digests and immutable SHA verified.
- [ ] #334 actual provider and #335 consumer integrated without V1 changes.
- [ ] All A/B/C runtime checks evidenced, including real ChatGPT session.
- [ ] Source, tests, documentation and built userscript artifact committed.
- [ ] Complete RepoWorkflow exact-source CI and required hosted jobs PASS.
- [ ] Direct immutable tested userscript download and manual test handoff.
- [ ] Original vs integrated CPU, JS, decode, IDB and memory reported.
- [ ] Results posted to DC #336 and DC #332; reviewed PR left UNMERGED.

**No acceptance completion or issue closure until every gate passes.**
