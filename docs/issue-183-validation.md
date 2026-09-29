# Issue #183 validation notes

The first authoritative candidate (`1.8.0-issue.183.1`) reached validation and failed two repository bookkeeping gates rather than the rate-limit implementation itself:

- the modular-source inventory still expected 59 source modules after the coordinator became the 60th source file;
- the new top-level regression was not yet listed in `scripts/ci-environment.mjs`.

Both gates are corrected in the subsequent candidate so the rate-limit regression is part of repository-owned CI.

The second request (`1.8.0-issue.183.2`) was invalidated during artifact materialization because the branch advanced after the test-cycle request.  The generated-artifact push was correctly rejected as non-fast-forward.  No validation result was claimed from that request.
