# GitHub Actions Policy

GitHub Actions in DownloadConversation exist to verify, package, and publish
repository state.  They are not a remote source-code or documentation editor.

## Permanent workflows

Only these workflow paths are permitted on active repository lines:

- `.github/workflows/ci.yml` — the permanent test-cycle workflow.  Repository
  write permission is limited to deterministic generated-artifact preparation
  through the declared `RepoWorkflow materialize-artifacts --commit` pipeline
  and the existing userscript `scripts/test-cycle-artifact.mjs`, plus immutable
  version-tag publication owned by the approved finalization mechanism.
- `.github/workflows/build-userscript-artifact.yml` — the dedicated generated
  userscript materialization workflow introduced by the CI-gating work.  This
  workflow is optional until that work is integrated, but if present it may
  write only the deterministic generated userscript through
  `scripts/test-cycle-artifact.mjs`.

Issue-specific, temporary, migration, instrumentation, repair, patch, apply,
or other one-shot workflows are prohibited.  Development changes must be made
through the GitHub repository API/connector or a normal checked-out working
tree, not by a workflow that edits and commits source or documentation.

## Repository-write exception

`contents: write` is allowed only where a permanent workflow needs the tested
artifact publication mechanism.  A write-capable job must:

1. use only the approved checkout/setup actions;
2. invoke only the approved deterministic artifact commands: 
   `RepoWorkflow materialize-artifacts --commit`, or
   `scripts/test-cycle-artifact.mjs prepare ... --push` / `publish`;
3. use the existing approved prepare/push and finalize boundary; and
4. never contain direct `git add`, `git commit`, or `git push`, or direct
   mutating GitHub/cURL API commands.

The only allowlisted committed generated output in `.ci/repoworkflow.json`
is `chatgpt-conversation-markdown-export.user.js`.  DC #333's historical
V1 `.dcfav` pack is **not** a production output: current V2 requirements
generate requested 21-frame sequences locally in the browser, never in CI.
RepoWorkflow must commit only reviewed deterministic outputs, never arbitrary
source, configuration, or documentation.  Adding an output requires a reviewed
policy change and negative regression tests.  No issue-specific write workflow
or general mutation mechanism is permitted.

## Enforcement

`scripts/check-actions-policy.mjs` enforces the active-workflow allow-list and
write-capable-job restrictions.  `tests/actions-policy.test.mjs` provides
positive and negative regression coverage, including the current repository
state.  Permanent CI must run that test before any CI job with repository-write
permission is allowed to proceed.

When the permanent workflow set or publication mechanism legitimately changes,
update this policy, its checker, and its regression tests together.  Do not
weaken the checker merely to permit a one-off editing workflow.

Historical workflow runs may remain in GitHub's Actions registry after workflow
files are deleted.  When obsolete history clutters the Actions UI, purge those
obsolete workflow runs separately; deleting Actions run history does not rewrite
Git history or change commit SHAs.
