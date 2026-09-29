# Issue #183 validation notes

The first authoritative candidate (`1.8.0-issue.183.1`) reached validation and failed two repository bookkeeping gates rather than the rate-limit implementation itself:

- the modular-source inventory still expected 59 source modules after the coordinator became the 60th source file;
- the new top-level regression was not yet listed in `scripts/ci-environment.mjs`.

Both gates are corrected in the subsequent candidate so the rate-limit regression is part of repository-owned CI.

The second request (`1.8.0-issue.183.2`) was invalidated during artifact materialization because the branch advanced after the test-cycle request. The generated-artifact push was correctly rejected as non-fast-forward. No validation result was claimed from that request.

The third candidate (`1.8.0-issue.183.3`) completed the repository validation entry point except for the modular-userscript build regression. Inspection of the structured result showed that an earlier bookkeeping edit had accidentally replaced the current modular-build test with an obsolete variant that imported removed `userscript-build-lib.mjs` exports. The production coordinator and the new rate-limit regression were not the source of that failure. The obsolete test replacement is removed in `1.8.0-issue.183.4`: the current mainline modular-build regression is restored unchanged except for its source-file count increasing from 59 to 60.

`1.8.0-issue.183.4` passed authoritative CI, but review of the generated userscript then exposed an assembly-boundary defect: the new source module had been inserted between two legacy source segments that split `fetchOneConversationPage()` at `if (!response.ok) {`. That placed coordinator initialization inside the failure branch instead of at IIFE top level. `1.8.0-issue.183.5` splits the existing network-transition segment at an actual top-level boundary, assembles the coordinator there, and adds an assembled-source regression that rejects placement inside the HTTP failure branch.
