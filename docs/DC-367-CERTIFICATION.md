# DC #367 staged integration certification

This is an incomplete integration certificate.  Controlled execution and hosted
repository regressions do not establish installed Tampermonkey or signed-in
ChatGPT acceptance.  No merge or production activation is authorised.

## Exact upstream candidate

| Component | Commit | Version | Draft PR |
| --- | --- | --- | --- |
| AICC | 4d8a596bf53de8e92c221a34bdbe9c6cb47b5db4 | 1.1.0-issue.134.1 | AICC #136 |
| CGP2 (private) | 1280cd48f62c96b5d5e7800e85edb05d923b2e4f | 0.1.0-issue.38.1 | CGP2 #39 |
| DC loading implementation | 56f97dc24776e80a719b2a74c981367595876a02 | 1.11.14-issue.366.1 | DC #371 |

DC #367's branch is based on that DC commit and changes certification tooling,
documentation, branch ancestry and version/request metadata only.  The generated
installer changes its version.  Production modules and Core bytes remain equal
to the upstream candidate.  Final certification HEAD and hosted result belong
in the issue ledger rather than a self-referential committed hash.

Core bundle SHA256:
`90cfc1de504ee56ab68469264e3bfb26e502e76d5c8b28d81c419cefe8014716`.
Private provider classic SHA256:
`5cfa178a0a2e8a977e578485b9d4b3cb7d0654d6b267308eaefba42a64f25b9b`.
The provider remains an external private input, absent from this repository.

## Independent controlled execution

Run `node scripts/certify-registration.mjs <local-private-classic> <sha256>`.
The command rejects a hash mismatch before executing the provider.  It extracts
the verified Core bytes from the committed DC installer and runs the production
DC bridge with the real private provider.  Private source is never logged.

Assertions cover both startup orders, stopped polling, duplicate/invalid atomic
rejection, exactly 15000ms diagnostic and recovery, retained identity, canonical
source inventory replacement, observers/unsubscribe/isolation, image-part
identity, late DC retry, and an independent alternate provider with CGP2 absent.
The alternate provider is explicitly a fixture.  VM scheduling/realm proof is
not browser MAIN_WORLD/extension-installation or network-delivery proof.

## Upstream hosted evidence to inspect independently

- AICC: https://github.com/Ma-XX-oN/AIConversationCore/actions/runs/40140294173
- CGP2: https://github.com/Ma-XX-oN/Chat-Gpt-Plugin-2/actions/runs/40141056178
- DC: https://github.com/Ma-XX-oN/DownloadConversation/actions/runs/40141107821

Use executed validation/finalizer records and exact SHAs.  Skipped PR events
and action-required states are not behavioural PASS results.

## Private installer and signed-in handoff

The provider installer is supplied privately to the repository owner.  It adds
only Tampermonkey metadata to the exact classic bytes: document-start,
`@sandbox raw`, `@grant none`, ChatGPT match patterns.  Its payload is byte-equal
to the private upstream artifact.  Installer SHA256:
`532c8fcf78a4fbba0db1015652d7f803d9a379a449b6a81e1d222d8265a0998f`.
Do not upload this installer or its source into a public repository or log.

1. Disable earlier DC/provider experiment scripts in Tampermonkey.  Install
   the exact DC #367 installer linked in the issue ledger and private provider
   installer supplied with the handoff.  Both must be enabled for ChatGPT.
2. Reload a signed-in ChatGPT conversation.  Open DC's Test menu and run the
   CGP2 installed-interface, AICC registration/retained-identity, canonical
   fixture/repeat, exchange-ordering, lifecycle/observer, wrong-API and
   missing-provider checks.  Return the test results, including failure text.
3. Extract JSONL and Markdown together from a conversation containing an image.
   Confirm identical source IDs/order and image position.  Select zstd, extract,
   decompress with the zstd CLI and compare against the uncompressed outputs.
   Verify the existing COMM recorder still records and exports source traffic.

The agent must finish every independent executable gate before asking for these
steps.  Passing this initial handoff does not complete the whole browser matrix:
installed execution realm, both installed startup orders, alternate provider,
duplicate/invalid errors and empty-start/late-recovery still require recorded
browser evidence.  Keep each missing row INCOMPLETE until actually exercised.

## Acceptance ownership

DC #367 retains the integration claim until browser evidence and all required
hosted results are verified.  DC #364 stays incomplete.  Shared logger/selector
work remains DC #365.  Upstream branches remain unmodified and unmerged.
