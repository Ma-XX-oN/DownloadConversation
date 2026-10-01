# Private agent-plugin loading

## Purpose

DownloadConversation depends on AIConversationCore (AICC), while an AICC-selected
provider implementation may live in a private repository. DownloadConversation must
not own or persist provider-plugin repository/ref/version/hash/path configuration.
It receives an AICC-owned artifact descriptor only when Core asks the host to load
an agent implementation.

A public DC build therefore contains the pinned AICC browser bundle plus generic
artifact-transport code. It never embeds private provider source bytes or a
provider-specific descriptor table.

## Browser-owned authentication boundary

Private GitHub authentication remains owned by Chrome/GitHub. DownloadConversation
must not request, store, or expose a GitHub password, passkey, session cookie,
personal access token, OAuth access token, or GitHub App private credential merely
to retrieve an AICC-selected artifact.

The browser/Tampermonkey path is:

```text
ChatGPT tab / DownloadConversation
    |
    | core.loadAgent("chatgpt-web", { loadModule })
    v
AIConversationCore
    |
    | AICC-owned artifact descriptor
    v
DC generic loadModule(artifact)
    |
    | shared userscript request metadata only
    v
GM_setValue / GM_addValueChangeListener
    |
    v
GitHub tab/window running the same trusted userscript
    |
    | resolve request against AICC's catalogue
    | browser's existing authenticated GitHub session
    v
selected provider artifact bytes
    |
    | shared userscript response/cache
    v
ChatGPT tab
    |
    | verify against AICC-supplied byte length + Git blob identity
    v
Blob -> URL.createObjectURL() -> import(blobUrl)
    |
    v
module namespace returned to AIConversationCore
    |
    v
AICC registration + agent creation + canonical session
```

The GitHub-side broker may open a normal repository file page. GitHub/Chrome
performs authentication exactly as for ordinary browser navigation. The broker does
not copy GitHub authentication material into Tampermonkey storage; only the
requested artifact source and non-secret verification metadata cross the userscript
storage boundary.

All GitHub transport is HTTPS/TLS. After receipt, the authorized browser necessarily
has the artifact bytes in memory and may retain a verified userscript cache; that
local copy is not equivalent to publishing the private artifact in DC.

## Shared cache and realm lifetime

The verified artifact source may be cached in Tampermonkey storage so other tabs
using the same userscript do not repeat authorization/download. A live imported
module object is never serialized or shared between tabs. Each page creates its own
Blob URL/module instance and its own Core/provider agent instance.

Cache identity is derived entirely from the AICC-supplied descriptor and includes
the fields needed to distinguish and verify the selected artifact. Cached source is
reverified before execution. A symbolic ref that resolves to different bytes is not
silently accepted.

## Failure behaviour

Private artifact loading is explicit rather than a fallback. Authentication/access
denial, missing artifacts, network failure, integrity failure, wrong plugin identity,
or incompatible plugin API leave the AICC agent unavailable and surface the failure.
They must not silently route production canonicalization back through a legacy
provider adapter.

## DC / AICC responsibility boundary

DownloadConversation owns generic browser transport and shared userscript cache
mechanics. AIConversationCore owns provider-plugin selection, artifact identity,
registration, agent creation, canonical-session association, canonical turn
derivation, projections, and rendering. The provider implementation remains hidden
behind the AICC Agent PI.

Production flow is:

```text
DC Conversation API/provider records
  -> AICC loadAgent("chatgpt-web")
  -> provider agent commTraffic()
  -> Core-owned canonical session
  -> shared Core projection/rendering
  -> DC export
```

The legacy direct ChatGPT adapter remains only an independent regression oracle
while migration is being verified.
