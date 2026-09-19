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