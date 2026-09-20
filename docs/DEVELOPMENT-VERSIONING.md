# Development versioning

DownloadConversation issue-owned development branches use:

```text
x.y.z-issue.<issue>.<iteration>
```

The issue number identifies the branch that owns the work. The iteration starts at 1 and advances for subsequent revisions of that issue. Parallel issue branches are provenance identities; their development versions do not need to be globally monotonic.

## Version first

For a newly established issue branch, the correct issue-qualified version is the first branch change before feature, production, test, documentation, or integration work.

After integrating a dependency branch whose version belongs to another issue, restore or advance the receiving branch's own issue-qualified version immediately, before any further work.

Do not defer version correction until cleanup, CI completion, live testing, or release preparation.

## Read-only guard

Run:

```bash
node scripts/check-development-version.mjs
```

The guard derives the current branch when possible. An explicit branch may be supplied:

```bash
node scripts/check-development-version.mjs \
  --branch issue-135-agent-completion-sounds
```

On an `issue-<number>-...` branch the userscript must contain exactly one `@version`, it must use the issue-qualified development form, its issue must match the branch owner, and its iteration must be positive. The guard never edits files.

Ordinary CI runs this guard before feature-specific verification.

## Explicit setter

When an issue branch must establish or restore its owning version, run the explicit setter with the intended iteration:

```bash
node scripts/set-development-version.mjs \
  --branch issue-135-agent-completion-sounds \
  --iteration 3
```

The setter:

- requires an issue-owned branch;
- requires an explicit positive iteration rather than guessing one;
- preserves the current `x.y.z` release target by default;
- changes only the single userscript `@version` token;
- preserves every other byte in the file, including existing LF or CRLF line endings;
- runs the read-only guard after mutation and fails if the resulting identity is invalid.

To intentionally change the release target at the same time, supply it explicitly:

```bash
node scripts/set-development-version.mjs \
  --branch issue-149-version-identity-guard \
  --iteration 2 \
  --release 1.6.0
```

A different userscript path may be supplied with `--file` for tests or tooling.

The setter is an explicit mutation tool. CI does not silently repair a mismatch, and the setter does not infer an iteration from unrelated branch history.

## Stable release and tag contract

Stable DownloadConversation releases use a plain `x.y.z` userscript version and an annotated Git tag named `vX.Y.Z`. The authoritative release version is the single `@version` in `src/userscript-header.js`.

`chatgpt-conversation-markdown-export.user.js` is generated deterministic build output and is intentionally ignored by Git. It is not a committed release input. A release tag identifies the exact authoritative source, manifest, scripts, tests, and pinned AIConversationCore input from which the installable userscript is regenerated. The generated artifact must contain the same stable version as the authoritative header and must pass the deterministic build check before publication.

The established release order is mandatory:

1. finish and verify the issue-owned development branch;
2. close the owning issue;
3. merge the accepted change to `main`, including promotion from the issue-qualified development version to the intended plain stable version in `src/userscript-header.js`;
4. let the `push` to `main` run the ordinary CI and cross-consumer verification jobs;
5. after both verification jobs pass, the workflow automatically invokes the stable release publisher on that exact `main` commit;
6. after publication, a separate guard verifies that the required stable tag points to that `main` HEAD.

Do not create the stable tag on an issue branch. A `main` push whose authoritative source still contains an issue-qualified development version fails release publication because the automated path accepts only a plain stable semantic version.

### Automatic `main` publication

The normal release path is repository-driven. On a successful `push` to `main`, the `publish-release` job checks out full `main` history, configures the GitHub Actions bot identity needed for an annotated tag, and runs:

```bash
node scripts/release.mjs --from-source
```

`--from-source` reads the authoritative `src/userscript-header.js` version and requires it to be a plain stable semantic version. No person or AI agent has to remember a version argument or a separate tag command.

The release script then verifies all of the following before creating a tag:

- the current branch is exactly `main`;
- the working tree and index are clean;
- local `HEAD` exactly equals fetched `origin/main`;
- the requested stable tag does not already exist on `origin`;
- the ignored production userscript is generated from the current authoritative source and pinned dependency;
- `src/userscript-header.js` contains exactly one `@version` and it equals the requested plain stable version;
- the newly generated `chatgpt-conversation-markdown-export.user.js` contains exactly one matching `@version`;
- `node scripts/build-userscript.mjs --check` proves the generated artifact is exactly the deterministic build output;
- `node scripts/run-ci.mjs` passes the complete local CI gate;
- the working tree remains clean because generated build output is ignored rather than committed.

The script creates an annotated `vX.Y.Z` tag on the exact verified `main` commit. If a previous atomic-push attempt created the same local tag but failed before reaching the remote, the script may reuse that local tag only when it already points to the same verified `main` commit.

Publication uses the equivalent of:

```bash
git push --atomic origin HEAD:main refs/tags/vX.Y.Z
```

The atomic push is a release invariant: the verified `main` ref and stable tag are published together rather than as two remembered/manual pushes.

### Manual recovery path

For deliberate local recovery or diagnosis, the same publisher can still be run with an explicit stable version after updating the local checkout so `HEAD` exactly equals `origin/main`:

```bash
node scripts/release.mjs <version>
```

where `<version>` is the plain stable semantic version already present in the authoritative source, for example `1.6.0`. This is not the normal release trigger and does not replace the automatic `main` workflow.

### Post-publication tag guard

The missing/mismatched-tag guard runs after the automatic publisher, not before it. The `verify-release-tag` job fetches tags and runs:

```bash
node scripts/check-release-tag.mjs --branch main
```

It fails if the authoritative stable userscript version does not have the exact `vX.Y.Z` tag pointing to the same `main` HEAD. This is an independent verification layer after publication; it does not block the publisher merely because the tag has not been created yet.

Do not manually publish a stable userscript tag, do not tag an issue branch, and do not substitute separate `git push` and remembered tag-push commands for `scripts/release.mjs`.