# #251 GEN persistence performance — preliminary measurements

- Candidate source: `8be04b6200449de12ae78e9405e697d9093701bb` (#237).
- Baseline: `main` source as fetched 2026-10-12, before GEN provenance integration.
- Measurement: independent V8 isolated execution of the **fetched** GEN append/persist function bodies; simulated synchronous `sessionStorage.setItem` stores the serialized string in memory. No actual browser storage I/O.
- Repetitions: 8 per source; each populated 11,000 appends (10,000 retained) and executed 80 consecutive persistence writes.
- Median wall-clock across repetitions (Date.now clock granularity 1 ms):

| Operation | Baseline | Candidate | Interpretation |
|---|---:|---:|---|
| 11,000 appends | 16 ms | 14 ms | Differences within benchmark noise; no slowdown established |
| 80 synchronous persist operations | 65 ms | 80 ms | Candidate 15 ms slower per batch, +23.1%, approximately 0.19 ms/write additional JS cost |
| Snapshot size | 556,001 bytes | 556,045 bytes | +44 bytes metadata wrapper |
| In-memory records | 10,000 | 10,000 | Limit respected |

The candidate's persistence work checks up to 5,000 older retained entries for the effective baseline only at the persistence boundary, not every append. Benchmark samples are NOT a performance acceptance gate for browser `sessionStorage` I/O, GC scheduling or page responsiveness.

Browser measurement attempt: headless local Chromium and Playwright are present, but navigation to local HTTP and file origins was rejected with `net::ERR_BLOCKED_BY_ADMINISTRATOR`; `about:blank` denies `sessionStorage` with `SecurityError`. Thus, no valid browser storage measurement exists here; browser responsiveness gate remains INCOMPLETE.

Reproduction test source: `tests/gen-persistence-performance.bench.mjs` on PR #259. Its JS syntax was validated; the independent V8 measurement above exercised extracted source blocks but does not certify this Node benchmark script's execution. Normal canonical repository CI succeeded for revision `91935254721b5ea73865c29a49bc8955aaf5ff0e` (run 38294411915). No production source was changed. No merge.

Outstanding: run the committed Node benchmark script on its exact candidate and baseline; measure real Chromium/Chrome `sessionStorage` on an accessible origin, under actual persisted-volume and startup conditions; record distributions, main-thread pauses and an acceptance verdict. Do not mark #251 DONE until these pass.
