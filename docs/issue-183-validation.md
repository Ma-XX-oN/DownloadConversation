# Issue #183 validation notes

The first authoritative candidate (`1.8.0-issue.183.1`) reached validation and failed two repository bookkeeping gates rather than the rate-limit implementation itself:

- the modular-source inventory still expected 59 source modules after the coordinator became the 60th source file;
- the new top-level regression was not yet listed in `scripts/ci-environment.mjs`.

Both gates are corrected in the subsequent candidate so the rate-limit regression is part of repository-owned CI.

The second request (`1.8.0-issue.183.2`) was invalidated during artifact materialization because the branch advanced after the test-cycle request. The generated-artifact push was correctly rejected as non-fast-forward. No validation result was claimed from that request.

The third candidate (`1.8.0-issue.183.3`) completed the repository validation entry point except for the modular-userscript build regression. Inspection of the structured result showed that an earlier bookkeeping edit had accidentally replaced the current modular-build test with an obsolete variant that imported removed `userscript-build-lib.mjs` exports. The production coordinator and the new rate-limit regression were not the source of that failure. The obsolete test replacement is removed in `1.8.0-issue.183.4`: the current mainline modular-build regression is restored unchanged except for its source-file count increasing from 59 to 60.

`1.8.0-issue.183.4` passed authoritative CI, but review of the generated userscript then exposed an assembly-boundary defect: the new source module had been inserted between two legacy source segments that split `fetchOneConversationPage()` at `if (!response.ok) {`. That placed coordinator initialization inside the failure branch instead of at IIFE top level. `1.8.0-issue.183.5` splits the existing network-transition segment at an actual top-level boundary, assembles the coordinator there, and adds an assembled-source regression that rejects placement inside the HTTP failure branch.

`1.8.0-issue.183.5` passed authoritative CI and the coordinator was correctly assembled at IIFE top level. Generated-artifact review then found that the split source tail ended without a newline, producing `if (!response.ok) {      let bodyPreview = '';` across the next source boundary. `1.8.0-issue.183.6` restores the exact newline at that boundary and extends the assembled-source regression to require the original two-line HTTP failure branch form.

`1.8.0-issue.183.7` adds a redacted replay fixture derived from the two captured issue logs. The live failure contained 60 same-page DC HTTP 429 failures over 59,848 ms, including 25 adjacent failures less than 500 ms apart and 34 less than 1 second apart. The regression replays those 60 caller arrival offsets against the production coordinator while the simulated backend remains rate-limited for 60 seconds. The fixed coordinator must collapse all callers onto one in-flight operation and issue only the bounded retry chain at 0, 5,000, 15,000, 35,000, and 75,000 ms, with backoff delays of 5,000, 10,000, 20,000, and 40,000 ms before the successful response.
