# CI request and result contract

This repository uses an explicit CI request instead of running expensive validation on every development push.

## Development cycle

1. Work on an issue branch using `x.y.z-issue.<issue>.<iteration>`.
2. Make ordinary source/documentation commits without requesting CI.
3. Run focused/local checks while developing.
4. Allow the deterministic userscript-artifact workflow to materialize and commit the generated userscript when authoritative userscript inputs change.
5. When the exact candidate is ready, set `.ci/run-ci-request` to the authoritative development version and push that request commit.
6. GitHub Actions validates that exact requested commit.

Authoritative development version source: `src/userscript-header.js`.

The CI request must be made only after `chatgpt-conversation-markdown-export.user.js` is current and committed. The generated-artifact workflow is the only Actions workflow allowed to write repository source-tree content, and it may change only the generated userscript artifact.

## Local validation

The same repository-owned contract used by Actions is available locally:

```text
python scripts/ci_contract.py preflight
python scripts/ci_contract.py matrix
python scripts/ci_contract.py run --environment <environment-id> --result <outside-repo-result.json>
```

The working tree must be a clean checkout before validation starts. Store result JSON outside the repository so finalization can also assert a clean checkout. Results record the exact commit/version plus actual OS/runtime probes.

Required environment: `ubuntu-node22-python313` (Ubuntu, Node 22, Python 3.13). The committed declaration is `.ci/test-matrix.json`; every required entry must report for the same commit/version before any result tag is permitted.

The validation engine is `scripts/ci-environment.mjs`. It owns the existing ordinary DownloadConversation regressions plus the pinned cross-consumer final-render parity checks. GitHub Actions invokes it through `scripts/ci_contract.py`; it is not reimplemented in workflow YAML.

To aggregate result files collected from required machines/VMs/runners:

```text
python scripts/ci_contract.py finalize --results-dir <results-directory>
```

Adding `--tag` authorizes tag creation only after matrix completeness is proven. It never bypasses a missing required environment. `--push` additionally publishes that tag and requires `--tag`.

## Result semantics

- **PASS**: every required environment reported and all required validation passed. With `--tag`, create `v<version>`.
- **FAIL**: every required environment reported, at least one genuine validation gate failed, and no required gate was incomplete. With `--tag`, create `v<version>-CI-FAIL`.
- **INCOMPLETE**: a required environment/result is absent or a prerequisite such as network, credentials, package availability, or platform/runtime availability prevented valid execution. Emit warnings and create no tag.

PASS and CI-FAIL tags are immutable result landmarks. Once either result tag exists for an issue iteration, the opposite result tag cannot be created and source changes require the next issue iteration.

A GitHub runner/service failure is not a source CI failure. Re-run the existing workflow/jobs against the same commit; do not bump the issue iteration merely to retry infrastructure.

## Gate behaviour

Independent validation gates continue after another independent gate fails, so one RED does not hide the remaining initial failure surface. Cross-consumer network/runtime setup that cannot execute is INCOMPLETE and skips only gates that depend on that setup.

GitHub workflows are orchestration only: checkout, runtime setup, invoking repository scripts, collecting result artifacts, and final result tagging. Validation jobs have read-only repository permission; only finalization may write tags. The deterministic generated userscript publisher is the narrowly allow-listed repository-write exception.

## Stable releases

Stable release publication remains separate from issue-development CI. `node scripts/run-ci.mjs` validates locally without publication. `node scripts/run-ci.mjs --tag` explicitly authorizes stable test-cycle publication, and `scripts/release.mjs` passes that flag only after stable-main release eligibility has been verified.
