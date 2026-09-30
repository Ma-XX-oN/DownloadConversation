# Issue #156 — ChatGPT agent plugin integration

## Scope

This document records the concrete DownloadConversation ownership boundary for the
Chat-Gpt-Plugin-2 (CGP2) / AIConversationCore (AICC) integration slice owned by
issue #156.  It supplements `DESIGN.md`; canonical semantics remain owned by AICC
and provider interpretation remains owned by CGP2.

The required causal chain is:

```text
Conversation API/provider records
        |
        v
DownloadConversation host acquisition
        |
        v
CGP2 registered ChatGPT agent
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
- deterministic userscript packaging of the selected issue-qualified dependencies;
- page-realm lifetime for the imported provider module/agent instance;
- browser Blob creation/import of the already-verified self-contained CGP2 ESM;
- resource-byte retrieval when Core supplies browser transport metadata;
- export UI, diagnostics, filesystem/download operations, and output selection.

DownloadConversation does not normalize ChatGPT records into canonical semantic
records itself and does not own canonical rendering.

### Chat-Gpt-Plugin-2

CGP2 owns ChatGPT-specific provider interpretation:

- the `chatgpt-web` descriptor and provider recognition;
- persisted ChatGPT record normalization;
- provider-native lifecycle/reconciliation state;
- ChatGPT message/tool/reasoning/resource provenance;
- the public agent PI implementation.

A `persisted_records` observation is the complete source inventory supplied by the
host for that observation.  The plugin replaces its corresponding canonical event
inventory and publishes that complete replacement to Core.

### AIConversationCore

AICC owns provider-neutral canonical state and semantics:

- plugin descriptor validation and registry lookup;
- creation of the provider agent with Core-owned services;
- the canonical session associated with that created agent;
- complete canonical event retention/replacement;
- canonical turn derivation;
- structured projection and Markdown/HTML rendering.

DownloadConversation consumes the Core session/projections; it does not recreate
provider semantics downstream.

## Dependency identity

The issue branch records both a readable symbolic provider ref and exact resolved
artifact bytes.  The symbolic ref identifies the selected development line; the
resolved commit, Git blob SHA-1, and byte length make the deterministic userscript
build reproducible and independently verifiable.

The current integration target is intentionally issue-qualified.  It is not a
reason to publish or merge an unfinished stable release.

AICC is packaged as its verified classic browser bundle before the DownloadConversation
IIFE.  CGP2 remains the repository's self-contained ESM artifact; its exact bytes
are Base64-encoded into a build-owned table inside the DownloadConversation IIFE.
At runtime those exact bytes are decoded into a Blob and imported with
`import(blobUrl)`.  The source is not inserted into the DOM and DownloadConversation
does not rewrite provider module code.

## Runtime initialization

The provider module Promise, registry, agent, and Core session are page-realm
singletons for one userscript execution.  Mutable provider state remains owned by
the created agent; canonical events remain owned by the associated Core session.

Export and browser built-in tests await provider initialization before invoking
synchronous canonical rendering or canonical image-resource lookup.  Initialization
failure is explicit.  There is no implicit legacy adapter fallback.

## Legacy adapter as independent oracle

The AICC compatibility ChatGPT adapter remains available temporarily because the
migration is not yet complete across every consumer.  DownloadConversation tests
may use that path as an independent differential oracle:

```text
same provider fixture
  -> legacy AICC adapter
  -> expected canonical events/projection

same provider fixture
  -> CGP2 agent
  -> AICC canonical session
  -> actual canonical events/projection
```

The oracle is test-only for this integration.  Production DownloadConversation
canonicalization must not choose between the legacy adapter and CGP2 at runtime.
A mismatch is a failing integration contract to diagnose, not a reason to fall
back silently.

## Verification requirements

The integration is not complete until verification demonstrates all of the
following on the exact issue-qualified artifacts:

- descriptor registration and provider-agent creation;
- plugin identity/version/ref match the packaged artifact metadata;
- `persisted_records` reaches CGP2 and publishes into the Core-owned session;
- complete persisted inventories replace earlier session inventories exactly;
- canonical events match the independent legacy oracle for fixed fixtures;
- Core structured projection and Markdown rendering match the established oracle;
- image-resource provenance/transport, including `sediment://` source identity,
  remains equivalent through the registered-agent path;
- production DC canonical message and image-resource lookups route through the
  agent/Core session and contain no direct-adapter fallback;
- one-source-snapshot export invariants remain unchanged;
- ordinary DC regression, artifact verification, and cross-consumer gates remain
  green.

Only after the owning issues satisfy their acceptance criteria should their issue
branches be merged to their declared parents.  A green sub-slice is not by itself
completion of the owning issue.
