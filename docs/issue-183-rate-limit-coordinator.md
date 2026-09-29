# Issue #183 Conversation API rate-limit coordinator

DownloadConversation's direct Conversation API traffic is coordinated below individual consumers.  This prevents independent features from multiplying request pressure when ChatGPT starts returning HTTP 429.

The coordinator owns these invariants:

- exact-URL requests already in flight are coalesced and each waiter receives an independent cloned `Response`;
- physical Conversation API requests are serialized across consumers;
- one HTTP 429 establishes a shared cooldown for subsequent Conversation API traffic;
- a valid `Retry-After` value is treated as a minimum delay;
- absent or shorter server guidance is supplemented by bounded exponential backoff with jitter;
- successful responses reset consecutive-429 state;
- a queued or retrying request is cancelled when SPA navigation changes the active conversation;
- non-429 responses retain the existing downstream status/error handling;
- each received 429 emits one bounded diagnostic decision rather than generating caller-level retry storms.

This layer changes request scheduling only.  It does not change Conversation API page size, pagination ordering, source identity, source completeness, canonical rendering, or the single-snapshot export contract.
