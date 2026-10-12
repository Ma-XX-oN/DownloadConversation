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

## 2026-10-12 independent recovery verification

Ownership: operator explicitly reassigned unfinished #251 after prior worker checkpoint; auditable transfer comment 6131117806. Original claim 6130595096 and PR #259 are preserved.

An isolated local fixture was built using the **verbatim extracted function bodies** (bootstrap restore, diagnostics append, persistence writer and enable predicate) fetched through GitHub from #237 commit `8be04b6200449de12ae78e9405e697d9093701bb`. The baseline fixture uses corresponding fetched `main` append and persistence bodies, omitting restore (absent from the baseline). These fixtures are *not* complete repository checkouts; the benchmark script was copied verbatim from the PR's GitHub source and executed against the isolated fixture source tree with Node.js v22.16.0.

Commands: `node --check tests/gen-persistence-performance.bench.mjs`; `node tests/gen-persistence-performance.bench.mjs`. Both completed with exit status 0 for the candidate fixture; baseline benchmark completed with exit status 0. 12 trials for each implementation; `performance.now()` timings in Node VM, not native browser storage I/O.

| Operation (median of 12) | Baseline fixture | Candidate fixture |
|---|---:|---:|
| 11,000 append operations | 17.789 ms | 22.596 ms |
| 80 persistence serialisations and stub writes | 114.736 ms | 154.875 ms |
| 80 restores | N/A (baseline lacks restore) | 336.778 ms |
| Serialized snapshot bytes | 556,001 | 556,045 |
| Retained records | 10,000 | 10,000 |
| Persisted records | 5,000 | 5,000 |

These readings are environment-specific and do not establish a browser-performance PASS or regression threshold. This run's candidate persistence serialisation median was 40.140 ms per 80-write batch slower than the isolated baseline (about 0.502 ms/write); repeated benchmarking is required before interpreting the difference as a stable change. Tests use synchronous **in-memory** storage, not actual Chrome sessionStorage.

Additional browser probe in this run: Debian Chromium 144 invoked headlessly on minimal `file:` and `data:` documents returned no DOM output within timeout. A second launch with `--single-process --no-zygote` also timed out after 8 seconds, reporting DBus connection errors. Previous worker observed `ERR_BLOCKED_BY_ADMINISTRATOR` for test origins. There is still **no actual browser-origin sessionStorage or end-to-end startup timing**. Do not mark those acceptance gates passed.

Remaining exact requirements: (1) execute the script on the actual checkout at candidate/base refs, rather than reconstructed fixtures; (2) capture Chromium/Chrome origin-backed storage-read/write timing, event-loop blocking, 5,000-record restore/startup distributions, and compare to baseline; (3) post an acceptance verdict tied to exact candidate and browser environment. The prior canonical CI run validated policy only, not the benchmark. Issue remains OPEN; no merge.

## Reproducer and acceptance ledger (2026-10-12)

Browser microbenchmark source: `tests/gen-browser-storage.bench.html` added at commit `205a784e4df917d2f130a9e8b9a66b7239308e71`. JavaScript content syntax was locally checked with Node.js `--check` before publication. Serve the repository directory with `python -m http.server 8765`, then open `http://127.0.0.1:8765/tests/gen-browser-storage.bench.html` in Chrome and select **Run 12 trials**. Save the JSON output with Chrome build, machine specifications, and navigation origin. This tests **native browser storage write and read+parse throughput**, not a real ChatGPT userscript startup; do not substitute these microbenchmark results for end-to-end acceptance.

A concrete CDP retry launched Chromium 144 with `--remote-debugging-port=9333`, successfully queried `/json/version`, and used `Page.navigate` for `http://127.0.0.1:8765/gen-browser-storage.bench.html`. Navigation returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Browser runtime reported URL `chrome-error://chromewebdata/`, origin `null`, page text "Your organization doesn’t allow you to view this site", and `sessionStorage` raised `SecurityError`. This independently confirms policy denial rather than merely a Chrome startup timeout. No attempt was made to bypass the configured administrative block.

Latest existing canonical CI after adding browser benchmark: run `38298591433`, commit `205a784e4df917d2f130a9e8b9a66b7239308e71`. **Policy job PASS only**. Jobs `prepare`, `validate`, and `finalize` were SKIPPED; the benchmark and browser harness were **not executed by CI**.

| Acceptance requirement | Evidence | Status |
|---|---|---|
| Frozen prerequisite #237 and source provenance | Closed #237, SHA `8be04b6200449de12ae78e9405e697d9093701bb` | PASS |
| GEN 10,000-memory / 5,000-persisted bounds | 12-trial candidate isolated Node VM fixture, assertions PASS | PASS (fixture only) |
| Node benchmark executes with exact extracted GEN functions | Copied benchmark ran Node.js 22.16.0 on reconstructed source-function fixture, 12 trials | PASS (fixture only); exact checkout INCOMPLETE |
| Candidate vs baseline isolated serialization overhead | 12-trial comparison and separate timings above | PASS (measurement only; no browser verdict) |
| Chrome origin-backed `sessionStorage` I/O | CDP navigation explicitly blocked by administrator | INCOMPLETE |
| Real ChatGPT userscript startup responsiveness | No accessible browser origin / no actual ChatGPT runtime | INCOMPLETE |
| Repository CI sanity | run `38298591433` policy PASS, all validation jobs skipped | PASS (policy only) |
| Final overall #251 performance acceptance | Native browser and exact-checkout gates outstanding | INCOMPLETE |

No production source changed, no merge, no DONE marker, and no claim that a simulated fixture proves whole-repository performance.

## Authoritative hosted GitHub Actions results (2026-10-12)

The old container administrator restriction is not an acceptance blocker: real Chrome execution succeeded on **GitHub Actions ubuntu-24.04**, Node **22.23.3**, headless **Chrome 154**, using temporary localhost HTTP origins and the **actual Chrome sessionStorage API**.

The canonical RepoWorkflow invocation was activated by changing `.ci/run-ci-request`. All benchmarks run in `scripts/repoworkflow-validate.py`, without adding a noncanonical GitHub workflow. Final test run: **38300819106**, actual prepared/tested SHA **91ec125355fdcf0de9e8b20b7421ab1874153eb9**, branch `issue-251-gen-performance-benchmark`, iteration `1.11.4-issue.251.4`. This revision includes CI-materialized generated userscript, and was checked out at its exact SHA before validation. GitHub result artifact `repoworkflow-result-ubuntu-node22-python313` contains the stdout/raw benchmark JSON and authoritative `status: FAIL` due to two independent source-owned regressions listed below.

### Chrome 154 native storage cost, final run (12 trials, 80 operations/trial)

| Work | Baseline array snapshot | Candidate versioned-object snapshot |
|---|---:|---:|
| 80 real `sessionStorage.setItem` writes | 376.35 ms median | 396.20 ms median |
| 80 real `sessionStorage.getItem` + `JSON.parse` operations | 59.70 ms median | 59.40 ms median |
| Stored records | 5,000 | 5,000 |
| Serialized JSON | 553,908 bytes | 553,952 bytes |

Final-run candidate write delta: **+19.85 ms per 80 writes**, or **about +0.248 ms/write (+5.27%)**. Read+parse delta: **-0.30 ms per 80 operations**. In earlier hosted runs, the direction and magnitude of the baseline/candidate difference varied, so no stable regression or improvement claim is made. The 44-byte metadata-wrapper difference is measured exactly. Neither a maximum latency budget nor a percentage regression acceptance limit was specified by #251.

### Chrome 154 exact-source GEN function cost (12 trials)

`tests/gen-browser-gen-startup-ci.mjs` extracts the exact `logDiagnostic`, `persistDiagnosticLog`, `restoreDiagnosticLog`, and `diagnosticEnabled` function bodies from the **checked-out #237 GEN source** and evaluates them in a real Chrome page, with actual `sessionStorage` calls. It asserts the retained 10,000-record memory window, 5,000-record persisted tail, effective `v1` baseline, and restoration to 5,000 records.

| Work | Final hosted result |
|---|---:|
| 11,000 lifecycle diagnostic appends | 32.0 ms |
| 80 candidate persistence calls, 12-trial median | 429.80 ms (5.373 ms/call) |
| 80 candidate restore calls, 12-trial median | 62.70 ms (0.784 ms/call) |
| Chrome source-harness correctness assertions | PASS |

This establishes the performance of the **actual extracted GEN persistence/startup-restore functions in Chrome**, not a complete authenticated ChatGPT page startup. Full application UI/browser acceptance belongs to #243, and is not claimed here.

### Node 22 exact-checkout comparison (12 trials)

`node tests/gen-persistence-performance.bench.mjs HEAD` and `node tests/gen-persistence-performance.bench.mjs origin/main` both ran in GitHub Actions against the actual fetched repository revision, not reconstructed local fixtures. Their final-run medians were:

| Operation | Baseline origin/main | Candidate |
|---|---:|---:|
| 11,000 appends | 12.900 ms | 14.714 ms |
| 80 persistence serialisations + in-memory stub writes | 66.745 ms | 133.116 ms |
| 80 restores | N/A | 212.582 ms |

Node VM uses a synchronous in-memory stub, so its raw costs are distinct from browser storage I/O. Large cross-run variations were observed; use full archived per-trial distributions, not one run, to interpret overhead.

### Verification and independent failure ownership

- **PASS:** exact candidate checkout in RepoWorkflow validation; Node baseline/candidate benchmark execution; Chrome native storage benchmark; Chrome extracted-GEN append/persist/restore benchmark; 10,000-memory / 5,000-persisted correctness; 24/24 GEN version/persistence convergence regression cases; updated canonical CI test inventory; versioned generated userscript prepared by hosted CI.
- **FAIL — external to #251 benchmark-source ownership:** `tests/modular-userscript-build.test.mjs` rejects existing `src/userscript/01-runtime/01-bootstrap.js` (>16 KiB); `scripts/check-jsdoc.mjs` rejects missing typed/described `@returns` on existing `restoreDiagnosticLog`. Both existed in inherited #237 production source and were not introduced by #251. Evidence handed to source owner on #237 comment **6131610584** and to final integration owner on #243 comment **6131612847**. **Full canonical CI remains FAIL**. No checks were suppressed or marked green.
- **NOT CLAIMED:** complete authenticated ChatGPT startup/render performance, final #243 system/browser acceptance, overall CI green, production rollout/merge.

**#251's independent benchmarking deliverable is complete and reproducible** with provider-backed evidence. It makes no assertion of a performance SLA PASS because the issue has no specified latency threshold. The unresolved source regressions remain explicit obligations for their owning ticket/integration lane, not evidence that the hosted benchmarks failed.

Hosted run: https://github.com/Ma-XX-oN/DownloadConversation/actions/runs/38300819106 . Full raw measurements and provider status: the run's `repoworkflow-result-ubuntu-node22-python313` artifact.
