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
  --branch issue-165-repoworkflow-adoption \
  --iteration 4
```

The setter requires an issue-owned branch and an explicit positive iteration, preserves the current release target unless `--release` is supplied, changes only the header version token, regenerates the tracked userscript artifact, and restores the previous state if regeneration or validation fails.

## Generated userscript artifact

`src/userscript-header.js`, `src/userscript-manifest.json`, and the ordered files under `src/userscript/` are authoritative source. `chatgpt-conversation-markdown-export.user.js` is the deterministic generated Tampermonkey distribution artifact.

The generated userscript is tracked and committed. It is generated-only and must never be hand-edited. The generator and independent verifier are:

```bash
node scripts/build-userscript.mjs
node scripts/verify-userscript-artifact.mjs
```

RepoWorkflow declares that artifact in `.ci/repoworkflow.json`. Its artifact lifecycle snapshots repository state, allows only declared generated outputs to change, and runs the independent verifier before accepting the result. The canonical GitHub adapter may publish only those explicitly declared committed generated outputs during preparation; general source/documentation editing is forbidden.

`scripts/test-cycle-artifact.mjs` remains for the separate stable-release/test-cycle path. It is no longer the issue-development workflow engine.

## Explicit issue-development CI request

Expensive issue-development CI is not run on ordinary source/documentation pushes.

When the candidate is ready for authoritative verification, set:

```text
.ci/run-ci-request
```

to the exact authoritative development version, for example:

```text
1.5.0-issue.165.3
```

The request value must exactly match `src/userscript-header.js`. A terminal PASS or CI-FAIL tag consumes that iteration; any subsequent source/test/documentation change requires the next iteration.

## RepoWorkflow authoritative path

RepoWorkflow is pinned as the `RepoWorkflow` Git submodule. Repository-specific environment, capability, artifact, branch, and runner facts live under `.ci/`.

The full local authoritative lifecycle is:

```bash
python RepoWorkflow/repo_workflow.py verify
```

Lower-level commands are available when individual lifecycle stages must be inspected or distributed across machines:

```bash
python RepoWorkflow/repo_workflow.py preflight
python RepoWorkflow/repo_workflow.py matrix
python RepoWorkflow/repo_workflow.py run \
  --environment <environment-id> \
  --result <outside-repo-result.json>
python RepoWorkflow/repo_workflow.py finalize \
  --results-dir <results-directory>
```

The working tree/candidate must be exact and clean at validation boundaries. GitHub Actions uses the byte-identical canonical adapter in `.github/workflows/ci.yml`; it does not reimplement request, matrix, result, artifact, or tagging semantics.

## Complete-matrix result tagging

Required platforms/capabilities are declared in `.ci/repoworkflow.json`. `.ci/github.json` maps each environment to its GitHub runner and provisions declared runtimes. Every required environment must report for the same exact commit and version before tagging is allowed.

The result identities are:

```text
PASS          -> v<version>
FAIL          -> v<version>-CI-FAIL
INCOMPLETE    -> no tag
```

A genuine `FAIL` means required validation actually executed and found incorrect source/build/test behaviour. `INCOMPLETE` means a required result could not be established because of infrastructure, credentials, network/package availability, runner/platform/runtime availability, or another prerequisite failure.

Both PASS and CI-FAIL tags are immutable landmarks. Once either exists for an issue iteration, the opposite result tag cannot be created and a changed candidate must advance to the next issue iteration.

A GitHub Actions infrastructure failure is not a source CI failure. Retry the same commit rather than creating another source commit or consuming another issue iteration.

## Gate behaviour

Independent validation gates continue after another independent validation gate fails so the initial RED surface is not hidden by the first failure. A prerequisite failure skips only dependent work and makes the required environment INCOMPLETE.

DownloadConversation's ordinary regression list and cross-consumer parity list live in `scripts/ci-environment.mjs`. RepoWorkflow invokes the repository-owned `scripts/repoworkflow-validate.py` environment entry point locally and in hosted CI.

## Local stable publication

Stable release publication remains a separate repository-specific path. `scripts/run-ci.mjs` remains the local stable-release-oriented wrapper:

```bash
node scripts/run-ci.mjs
```

It prepares the committed test-cycle artifact and runs the repository-owned validation engine, but it does not publish a stable tag by default.

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
