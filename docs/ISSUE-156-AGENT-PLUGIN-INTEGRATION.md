# Issue #156 — ChatGPT agent plugin integration

## Scope

This document records the DownloadConversation side of the AIConversationCore
(AICC) agent-plugin integration. The architectural dependency is deliberately:

```text
DownloadConversation -> AIConversationCore -> provider plugin
```

For ChatGPT Web, AICC currently selects a provider implementation behind the
`chatgpt-web` agent ID. DownloadConversation does not know which repository or
artifact implements that agent.

The required causal chain is:

```text
Conversation API/provider records
        |
        v
DownloadConversation host acquisition
        |
        v
AICC agent loading/registration
        |
        v
provider agent behind the AICC PI
        |
        v
AICC Core-owned canonical session
        |
        v
AICC projection/rendering
        |
        v
DownloadConversation resource recovery/export
```

## Ownership and lifetime

### DownloadConversation

DownloadConversation owns browser/host responsibilities:

- authenticated Conversation API acquisition and streamed-tail reconciliation;
- deterministic packaging of the selected AICC browser bundle;
- generic authenticated browser transport when AICC requests a private artifact;
- browser Blob creation/import for artifact bytes selected by AICC;
- page-realm lifetime of the imported module/agent returned through AICC;
- resource-byte retrieval when Core supplies browser transport metadata;
- export UI, diagnostics, filesystem/download operations, and output selection.

DownloadConversation does **not** own provider-plugin repository/ref/version/hash
metadata. It does not select a provider implementation, register a provider module,
or construct an `AgentPluginRegistry`. Its generic transport receives an opaque
AICC-owned artifact descriptor and returns the imported module namespace.

DownloadConversation does not normalize ChatGPT records into canonical semantic
records itself and does not own canonical rendering.

### Provider plugin

The provider plugin behind AICC's `chatgpt-web` agent ID owns ChatGPT-specific
provider interpretation:

- provider recognition;
- persisted ChatGPT record normalization;
- provider-native lifecycle/reconciliation state;
- ChatGPT message/tool/reasoning/resource provenance;
- the public agent PI implementation.

A `persisted_records` observation is the complete source inventory supplied by the
host for that observation. The provider replaces its corresponding canonical event
inventory and publishes that complete replacement through Core-owned services.

### AIConversationCore

AICC owns both provider-neutral canonical semantics and the provider-plugin loading
boundary:

- the configured agent/plugin catalogue and artifact identity;
- plugin descriptor/API validation;
- module registration and provider-agent creation;
- loaded plugin identity verification;
- the canonical session associated with the created agent;
- complete canonical event retention/replacement;
- canonical turn derivation;
- structured projection and Markdown/HTML rendering.

DownloadConversation asks Core to load `chatgpt-web` and consumes the returned
agent/session; it does not recreate provider selection or semantics downstream.

## Dependency identity

DownloadConversation records only its AICC dependency. The readable symbolic AICC
ref is `main`; the resolved AICC commit, Git blob SHA-1, and byte length make the
deterministic userscript build reproducible and independently verifiable.

Provider-plugin identity belongs to AICC. AICC may retain its own symbolic provider
ref plus exact resolved integrity metadata, but those details do not appear in the
DownloadConversation manifest or generated provider-descriptor tables.

AICC is packaged as its verified classic browser bundle before the
DownloadConversation IIFE. At runtime AICC's `loadAgent()` supplies its selected
artifact descriptor to DownloadConversation's generic `loadModule(artifact)` host
callback. The host obtains the authenticated artifact bytes, verifies them against
the AICC-supplied integrity identity, imports them with `import(blobUrl)`, and
returns the module namespace to AICC.

## Runtime initialization

The imported module Promise, agent, and Core session are page-realm singletons for
one userscript execution. AICC owns registration and session association. Mutable
provider state remains owned by the created agent; canonical events remain owned
by the associated Core session.

On GitHub pages the same userscript acts only as a generic authenticated artifact
broker. The broker resolves the request against `AIConversationCore`'s catalogue;
it contains no provider-specific repository allow-list of its own. Browser session
cookies remain owned by GitHub/Chrome and are never copied into userscript storage.

Export and browser built-in tests await provider initialization before invoking
synchronous canonical rendering or canonical image-resource lookup. Initialization
failure is explicit. There is no implicit legacy-adapter fallback.

## Legacy adapter as independent oracle

The AICC compatibility ChatGPT adapter may remain temporarily as an independent
test oracle while migration completes across consumers:

```text
same provider fixture
  -> legacy AICC adapter
  -> expected canonical events/projection

same provider fixture
  -> AICC loadAgent("chatgpt-web")
  -> provider agent
  -> AICC canonical session
  -> actual canonical events/projection
```

The oracle is test-only. Production DownloadConversation canonicalization must not
choose between the legacy adapter and the agent path at runtime. A mismatch is a
failing integration contract to diagnose, not a reason to fall back silently.

## Verification requirements

The integration is not complete until verification demonstrates all of the
following:

- DC manifest/build metadata contains only the AICC dependency and no direct
  provider-plugin repository/ref/version/hash/path identity;
- AICC owns the selected `chatgpt-web` artifact and passes it to DC only through a
  generic host transport callback;
- DC production bridge calls `core.loadAgent()` and does not instantiate/register
  the provider plugin itself;
- the GitHub broker validates requests against AICC's catalogue rather than a DC
  provider-descriptor table;
- provider-agent creation returns a Core-owned canonical session;
- `persisted_records` reaches the provider and publishes into that Core session;
- complete persisted inventories replace earlier session inventories exactly;
- canonical events match the independent legacy oracle for fixed fixtures;
- Core structured projection and Markdown rendering match the established oracle;
- image-resource provenance/transport, including `sediment://` source identity,
  remains equivalent through the registered-agent path;
- production DC canonical message and image-resource lookups route through the
  agent/Core session and contain no direct-adapter fallback;
- generic private-artifact broker success publishes source before closing its
  GitHub window, while failure pages remain open for inspection;
- one-source-snapshot export invariants remain unchanged;
- ordinary DC regression, artifact verification, and cross-consumer gates remain
  green.

After those requirements pass on the exact dependency heads, the issue branch is
merged into `main`. Downstream work should then use the resulting default-branch
head rather than an issue branch.
