# CI request and result contract

DownloadConversation uses RepoWorkflow as the authoritative issue-development workflow engine. GitHub Actions is a thin adapter around the same repository contract that can run locally.

## Development cycle

1. Work on an issue branch using `x.y.z-issue.<issue>.<iteration>`.
2. Make ordinary source/documentation commits without requesting expensive CI.
3. Run focused checks while developing.
4. Keep `chatgpt-conversation-markdown-export.user.js` synchronized with the authoritative userscript sources and verify it independently.
5. When the exact candidate is ready, set `.ci/run-ci-request` to the authoritative development version and commit that request.
6. Run RepoWorkflow locally or push the request so the canonical GitHub adapter validates the exact candidate.

Authoritative development version source: `src/userscript-header.js`.

Repository-specific workflow facts are declared in `.ci/repoworkflow.json`; GitHub runner projection is declared in `.ci/github.json`; branch ancestry is declared in `.ci/branch-policy.json`.

## Generated userscript artifact

`chatgpt-conversation-markdown-export.user.js` is a tracked deterministic generated artifact. Its generator and verifier are separate repository-owned commands:

```text
node scripts/build-userscript.mjs
node scripts/verify-userscript-artifact.mjs
```

RepoWorkflow independently enforces the declared generated-output boundary from `.ci/repoworkflow.json`. During authoritative preparation it may materialize only declared committed generated outputs; unrelated repository mutation is rejected. There is no standalone artifact-publisher workflow after RepoWorkflow adoption.

## Local authoritative validation

The full shared lifecycle is locally runnable:

```text
python RepoWorkflow/repo_workflow.py verify
```

This enforces repository and branch policy, the universal request/version/candidate guard, declared artifact generation plus independent verification, every locally addressable required environment, clean-checkout invariants, and PASS/FAIL/INCOMPLETE aggregation.

For lower-level inspection or distributed execution, RepoWorkflow also exposes:

```text
python RepoWorkflow/repo_workflow.py preflight
python RepoWorkflow/repo_workflow.py matrix
python RepoWorkflow/repo_workflow.py run \
  --environment <environment-id> \
  --result <outside-repo-result.json>
python RepoWorkflow/repo_workflow.py finalize \
  --results-dir <results-directory>
```

The required DownloadConversation environment is `ubuntu-node22-python313`: Linux with Node 22 and Python 3.13. The environment and capability contract lives in `.ci/repoworkflow.json`; `.ci/github.json` maps it to `ubuntu-latest` for GitHub Actions.

The repository-owned validation entry point is `scripts/repoworkflow-validate.py`. It runs DownloadConversation's validation engine in `scripts/ci-environment.mjs` plus wrapper-specific regression coverage. RepoWorkflow owns request guards, matrix lifecycle, result classification, exact-candidate mutation checks, aggregation, and terminal-tag rules.

## Result semantics

- **PASS**: every required environment reported and all required validation passed. With tagging enabled, create `v<version>`.
- **FAIL**: every required environment reported, at least one genuine executed validation gate failed, and no required gate was incomplete. With tagging enabled, create `v<version>-CI-FAIL`.
- **INCOMPLETE**: a required environment/result is absent or infrastructure, credentials, network/package availability, runner/platform/runtime availability, or another prerequisite prevented valid execution. Create no terminal result tag.

PASS and CI-FAIL tags are immutable result landmarks. Once either result tag exists for an issue iteration, the opposite result tag cannot be created and source changes require the next issue iteration.

A GitHub runner/service failure is not a source CI failure. Retry the same commit rather than consuming a new issue iteration merely for infrastructure failure.

## GitHub adapter

`.github/workflows/ci.yml` must remain byte-for-byte equal to the pinned RepoWorkflow canonical GitHub adapter. Ordinary pushes run only the cheap policy/request-detection phase. Updating `.ci/run-ci-request` to the current development version explicitly enables preparation, required environment validation, result collection, and finalization.

Validation jobs are read-only. Finalization alone has tag-write permission. The only repository-content write boundary is explicitly declared committed generated artifacts during preparation; RepoWorkflow rejects unrelated changes.

## Result tagging

The canonical finalizer aggregates structured result records for the exact tested commit/version. `--tag` authorizes terminal-tag creation only after completeness is established, and `--push` additionally publishes that tag.

```text
PASS          -> v<version>
FAIL          -> v<version>-CI-FAIL
INCOMPLETE    -> no tag
```

## Stable releases

Stable release publication remains separate from issue-development RepoWorkflow adoption. `node scripts/run-ci.mjs` is the local stable-release-oriented wrapper. It prepares the test-cycle artifact and runs repository validation without publication by default; `node scripts/run-ci.mjs --tag` explicitly authorizes stable test-cycle publication. `scripts/release.mjs` invokes that stable path only after stable-main release eligibility has been verified.
