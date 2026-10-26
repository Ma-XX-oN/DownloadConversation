# Synthetic Last handoff: immutable external provider artifacts

These compiled files are **test-only** snapshots, not DC runtime sources.

Producer repository: `Ma-XX-oN/Chat-Gpt-Plugin-2`
Exact producer commit: `190e9ddeb42786abb7f200272fd4bfa7991a5543`
Version: `0.1.2-issue.10.1`

- `chatgpt-plugin.browser.js`: Git blob `624570704656d2b480688b1de7a213f037b616cc`
- `chatgpt-plugin.mjs`: Git blob `3dbd6861c551785b2b7d13aa7cc4e9af74827b98`

Copied byte-exactly through authenticated repository API, with blobs verified
by Git SHA-1 at submission.  The executable test independently verifies those
hashes before executing the provider with the *exact DC-pinned Core bundle*.

Reason for fixture: DC's hosted Actions token cannot fetch CGP2's otherwise
unavailable raw artifact (HTTP 404).  Avoid credentials, dynamic unpinned
dependencies, and substitution of mocks for actual built provider code.

**This does not prove live CSC ingress or authenticated installed Chrome.**
The independent #299 source branch and its test artifacts are not eligible
for the production DC userscript build or release.
