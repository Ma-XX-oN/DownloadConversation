# Private agent-plugin loading

## Purpose

DownloadConversation is public, while provider plugins such as
`Ma-XX-oN/Chat-Gpt-Plugin-2` may remain private.  A public DC build must therefore
contain only the plugin selector/integrity metadata needed to locate and verify the
artifact.  It must not embed private plugin source bytes in the public userscript.

## Browser-owned authentication boundary

Private GitHub authentication remains owned by Chrome/GitHub.  DownloadConversation
must not request, store, or expose a GitHub password, passkey, session cookie, personal
access token, OAuth access token, or GitHub App private credential merely to retrieve
one provider artifact.

The browser/Tampermonkey proving path is:

```text
ChatGPT tab / DownloadConversation
    |
    | shared userscript request metadata only
    v
GM_setValue / GM_addValueChangeListener
    |
    v
GitHub tab/window running the same trusted userscript
    |
    | same-origin HTTPS request using the browser's existing GitHub session
    v
private provider artifact bytes
    |
    | shared userscript response/cache
    v
ChatGPT tab
    |
    | verify selected plugin identity + byte length + Git blob integrity
    v
Blob -> URL.createObjectURL() -> import(blobUrl)
    |
    v
AIConversationCore AgentPluginRegistry
```

The GitHub-side broker may open a normal repository page when no broker tab is
already available.  GitHub/Chrome performs authentication exactly as for ordinary
browser navigation.  The broker does not copy GitHub authentication material into
Tampermonkey storage; only the requested artifact bytes and non-secret verification
metadata cross the userscript storage boundary.

All GitHub transport is HTTPS/TLS.  The artifact is therefore encrypted in transit.
After receipt, the authorized browser necessarily has the artifact bytes in memory
and may retain a verified userscript cache; that local copy is not equivalent to
publishing the private artifact in the public DC repository.

## Shared cache and realm lifetime

The verified artifact source may be cached in Tampermonkey storage so other tabs
using the same userscript do not repeat authorization/download.  A live imported
module object is never serialized or shared between tabs.  Each page creates its own
Blob URL/module instance and its own Core/provider agent instance.

Cache identity includes at least:

- plugin ID;
- repository;
- symbolic ref;
- plugin implementation version;
- required plugin API version;
- artifact path;
- byte length;
- integrity hash / Git blob identity.

Cached source is reverified before execution.  A ref that resolves to different
bytes is not silently accepted.

## Failure behaviour

Private plugin loading is explicit rather than a fallback.  Authentication/access
denial, missing artifacts, network failure, integrity failure, wrong plugin identity,
or incompatible plugin API leave the provider unavailable and surface the failure.
They must not silently route production canonicalization back through
`AIConversationCore.adaptChatGPTRecords()`.

## DC / AICC responsibility boundary

DownloadConversation owns browser transport and shared userscript cache mechanics.
The provider plugin owns ChatGPT-specific interpretation.  AIConversationCore owns
plugin registration, the canonical session, canonical turn derivation, projections,
and rendering.

Production flow after successful private loading is:

```text
DC Conversation API/provider records
  -> CGP2 agent commTraffic()
  -> Core-owned canonical session
  -> shared Core projection/rendering
  -> DC export
```

The legacy direct ChatGPT adapter remains only an independent regression oracle while
the issue-qualified migration is being verified.
