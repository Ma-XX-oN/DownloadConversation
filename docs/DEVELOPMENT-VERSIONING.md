# Development versioning

DownloadConversation issue-owned development branches use:

```text
x.y.z-issue.<issue>.<iteration>
```

The issue number identifies the branch that owns the work. The iteration starts at 1 and advances for subsequent revisions of that issue. Parallel issue branches are provenance identities; their development versions do not need to be globally monotonic.

## Version first

For a newly established issue branch, establish the correct issue-qualified version before feature, production, test, documentation, or integration work. After integrating a dependency branch whose version belongs to another issue, restore or advance the receiving branch's own issue-qualified version before further work.

The authoritative production version is the single `@version` in `src/userscript-header.js`.

Use the read-only guard:

```bash
node scripts/check-development-version.mjs
```

When an issue branch needs an explicit version change, use:

```bash
node scripts/set-development-version.mjs \
  --branch issue-162-ci-request-gating \
  --iteration 2
```

The setter requires an issue-owned branch and an explicit positive iteration, preserves the current release target unless `--release` is supplied, changes only the header version token, regenerates the tracked userscript artifact, and restores the previous state if regeneration or validation fails.

## Generated userscript artifact

`src/userscript-header.js`, `src/userscript-manifest.json`, and the ordered files under `src/userscript/` are authoritative source. `chatgpt-conversation-markdown-export.user.js` is the deterministic generated Tampermonkey distribution artifact.

The generated userscript is tracked and committed. It is generated-only and must never be hand-edited. The repository-owned artifact tool is:

```bash
node scripts/test-cycle-artifact.mjs <prepare|verify|publish>
```

For issue development, GitHub Actions may write repository content only through `.github/workflows/build-userscript-artifact.yml`. That workflow may commit only `chatgpt-conversation-markdown-export.user.js`. It is deliberately separate from validation/tagging CI.

The artifact workflow runs when authoritative userscript/build inputs change. It materializes the generated artifact and pushes an artifact-only commit when bytes changed. CI must not be requested until that artifact commit is present.

## Explicit issue-development CI request

Expensive issue-development CI is not run on ordinary source/documentation pushes.

When the candidate is ready for full verification, set:

```text
.ci/run-ci-request
```

to the exact authoritative development version, for example:

```text
1.5.0-issue.162.1
```

and push that request change. The request value must exactly match `src/userscript-header.js`.

The full contract is documented in `CI.md`. The repository-owned entry point is:

```bash
python scripts/ci_contract.py preflight
python scripts/ci_contract.py matrix
python scripts/ci_contract.py run \
  --environment <environment-id> \
  --result <outside-repo-result.json>
```

A valid CI run requires a clean checkout of the exact candidate commit. GitHub Actions orchestrates these same repository scripts; test semantics are not duplicated in workflow YAML.

## Complete-matrix result tagging

Required operating systems/runtimes are declared in `.ci/test-matrix.json`. Every required environment must report for the same commit and version before tagging is allowed.

Aggregate result records with:

```bash
python scripts/ci_contract.py finalize \
  --results-dir <results-directory>
```

`--tag` authorizes result-tag creation only after matrix completeness is established. It does not bypass missing required environments. `--push` publishes the result tag and requires `--tag`.

The result identities are:

```text
PASS          -> v<version>
FAIL          -> v<version>-CI-FAIL
INCOMPLETE    -> no tag
```

A genuine `FAIL` means required validation actually executed and found incorrect source/build/test behaviour. `INCOMPLETE` means a required result could not be established because of infrastructure, credentials, network/package availability, runner/platform/runtime availability, or another prerequisite failure.

Both PASS and CI-FAIL tags are immutable landmarks. Once either exists for an issue iteration, the opposite result tag cannot be created and a changed candidate must advance to the next issue iteration.

A GitHub Actions infrastructure failure is not a source CI failure. Re-run the existing workflow/jobs against the same commit rather than creating another source commit or consuming another issue iteration.

## Gate behaviour

Independent validation gates continue after another independent validation gate fails so the initial RED surface is not hidden by the first failure. A prerequisite failure skips only dependent work and makes the required environment INCOMPLETE.

DownloadConversation's ordinary regression list and cross-consumer parity list live in `scripts/ci-environment.mjs`. Both local and hosted issue-development validation invoke that same engine.

## Local validation and explicit stable publication

For issue-development candidates, use `scripts/ci_contract.py` so local and hosted validation share the same matrix/result semantics.

`scripts/run-ci.mjs` remains the local stable-release-oriented wrapper:

```bash
node scripts/run-ci.mjs
```

It prepares the committed generated artifact and runs the repository-owned validation engine, but it does not publish a tag by default.

Stable publication requires explicit authorization:

```bash
node scripts/run-ci.mjs --tag
```

Only a complete validation PASS reaches `test-cycle-artifact.mjs publish`. INCOMPLETE or FAIL creates no stable tag.

## Stable release contract

Stable DownloadConversation releases use a plain `x.y.z` userscript version. Stable publication remains main-only. The recovery/release wrapper is:

```bash
node scripts/release.mjs --from-source
```

or:

```bash
node scripts/release.mjs <version>
```

The wrapper requires `main` and a plain stable source version, invokes `scripts/run-ci.mjs --tag`, then independently verifies the published `vX.Y.Z` tag with:

```bash
node scripts/check-release-tag.mjs --branch main
```

Do not manually create or move CI/release result tags, hand-edit the generated userscript, or substitute remembered Git commands for the repository-enforced artifact/CI paths.
