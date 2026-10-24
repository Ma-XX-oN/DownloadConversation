# Registered provider loading

## Active staged boundary: DC #366

DownloadConversation pins the public AICC #134 classic browser bundle.  A private
provider is installed independently in Tampermonkey and self-registers on that
same Core instance in MAIN_WORLD.  DC contains no private provider implementation,
provider repository pin, authenticated artifact transport, or provider catalogue.

DC calls `recognizeAgentPlugin({provider: 'chatgpt', url})`, then passes the
captured descriptor ID to `createAgent(id, {conversationId})`.  AICC returns the
validated agent, canonical session and descriptor.  DC retains the agent/session
for its existing persisted-record, source-ID and image-resource paths.  JSONL,
Markdown, COMM and zstd serialization retain their established owners.

The independently installed provider owns its private artifact/version selection
and bootstrap.  Browser/Tampermonkey authentication stays in the user's browser;
DC requests no GitHub credentials and publishes no private provider source.
Shared DC logger wiring and provider-selector UI remain deferred to DC #365.

## Startup and errors

Core starts its one-shot 15-second zero-registration diagnostic at evaluation.
The provider bootstrap waits for Core and stops after success or definitive
registration failure.  DC performs no provider polling or 30-second wait.

Extract with no recognizing registration fails immediately through the existing
visible export setup error and diagnostics.  A later Extract retries after a
provider has registered.  Invalid or duplicate registration is rejected by Core;
DC does not replace registry entries or restore the retired loader.

## Evidence and installation handoff

Exact Core: `4d8a596bf53de8e92c221a34bdbe9c6cb47b5db4`, version
`1.1.0-issue.134.1`.  Its contract is `docs/PLUGIN-REGISTRATION.md` in AICC.
DC preserves PR #363 ancestry without modifying that worker's branch.

Install the exact generated `chatgpt-conversation-markdown-export.user.js` from
the DC #366 candidate, and the independently pinned CGP2 #38 installer supplied
by its owner.  Disable earlier DC/provider test scripts to prevent duplicates.
Reload ChatGPT, open DC's Test menu, and run the CGP2 installed-interface,
AICC registration/retained identity, canonical fixture/repeat, exchange ordering,
lifecycle/observer, invalid-API and missing-provider checks.  Then extract JSONL
and Markdown from one conversation, including images, and verify zstd output.
DC #367 owns execution and recording of this exact cross-repository browser
matrix.  Local VM fixtures and hosted CI do not establish signed-in acceptance.

Historical scripts in `tests/browser/` from DC #156 remain experiment evidence;
they are not the DC #366 installer or the new registration bootstrap.  The old
catalogue, GM transport and Blob-import path are retired from active DC source.
