# DESIGN — DownloadConversation

## What the project is

`DownloadConversation` is a ChatGPT conversation recorder/exporter whose goal is to produce a durable, faithful Markdown representation of a conversation together with the metadata and attachments needed to preserve it reliably.

The recorder must work despite ChatGPT's virtualized conversation UI, partial DOM mounting, delayed content such as citations/images, browser file-handle failures, and changes in ChatGPT's internal representation.

The architecture is moving toward an API-first design while retaining a production DOM fallback for cases where API/index materialization is unavailable or incomplete.

## Project terminology

### User–Assistant Pair (UAP)

**UAP** is project-specific shorthand, not a general ChatGPT term. A User–Assistant Pair is the logical conversation unit that begins with one User turn and includes the following ChatGPT/Assistant turn or turns associated with that User turn, ending immediately before the next User turn.

The acronym may be used after this definition in internal design, implementation, logging, and TODO material. User-facing documentation should prefer the full term unless the abbreviation has already been introduced in context.

## Design principles

### Preserve conversation fidelity

The exported result should reflect the conversation the user actually sees and expects to preserve, including User and ChatGPT content, citations, images, attachments, and other supported rendered content.

When two available representations disagree or one is incomplete, the recorder should not silently discard information merely to force a single interpretation.

**Why:** the purpose of the project is archival fidelity, not merely obtaining a convenient approximation of the conversation.

### Stable identity over visual position

Conversation turns and User–Assistant Pairs (UAPs) should be tracked through stable identifiers and metadata where available. Viewport position and currently mounted DOM nodes are transient observations, not durable identity.

**Why:** ChatGPT virtualizes the conversation DOM, so visible position is not a reliable indication of completeness or identity.

### API-first, DOM fallback

The intended long-term default is to reconstruct conversation content from conversation/API data when that representation is complete enough.

The DOM implementation remains a real production fallback, not a test-only or second-class path. It must be capable of extracting the visible conversation when API/index materialization is unavailable or incomplete.

**Why:** API data is generally more stable and complete than repeatedly forcing a virtualized UI to mount historical turns, but the API path cannot be assumed to represent every visible feature yet.

### Shared production behaviour

Fallback paths should reuse established recorder behaviour instead of inventing parallel semantics for progress, lifecycle, Stop handling, wake lock, notifications, recovery, validation, or finalization.

**Why:** duplicated implementations drift. Reusing the same production machinery reduces regressions where one path silently loses previously verified behaviour.

### Shared canonical normalization and rendering

Provider-record interpretation and shared transcript rendering move incrementally into `AIConversationCore`; browser acquisition, authenticated resource resolution, recorder lifecycle, storage, recovery, and other host responsibilities remain in `DownloadConversation`.

The Tampermonkey userscript consumes the deterministic classic-script browser bundle generated from the core's ESM source. Production must pin that bundle to an exact `AIConversationCore` commit rather than a moving branch, and must not copy core source manually into the userscript.

Canonical identity is additional identity. Normalization must preserve the original JSONL provenance needed by later projections, including source record index/number, raw timestamp fields, provider/source record or turn identity, and all contributing records when several source records form one canonical turn. Visible Turn IDs continue to refer to provider/source identity; they are not silently replaced by canonical derived turn IDs. AIConversationCore owns their heading serialization.

The initial production migration covers ordinary visible text records and plain Assistant segments composed of public `thoughts` records followed by an otherwise plain visible Assistant text record. These migrated Assistant segments are rendered by `AIConversationCore` as one canonical ChatGPT section while Core preserves the final provider/source Assistant record ID as the optional visible Turn ID. Provider-specific rich handling such as citations, images, inline ChatGPT tokens, `sandbox:` resources, hidden records, and other host-enriched cases remains on the established DownloadConversation renderer until each behaviour is migrated with its own regression evidence.

Moving rendering into the shared core does not authorize chronology, UAP grouping, User/Assistant association, or ordering changes. Those change only in response to separately established production evidence and separately tracked work.

**Why:** the migration exists to remove duplicated semantic interpretation without changing already-correct recorder behaviour or losing the original database provenance required by other transcript projections.

### Recovery is granular and non-destructive

Missing User and ChatGPT turn halves are recoverable independently. Incomplete material is preserved rather than discarded.

Recovery scanning should not repeatedly rewrite `conversation.md`. Recovered pieces are staged and later consolidated through the validated rebuild path.

**Why:** half-visible or temporarily missing turns are normal consequences of virtualization. Throwing away the visible half or rewriting the main file continuously increases the chance of data loss and corruption.

### Final output is rebuilt and validated atomically

When recovery or replacement is required, the recorder builds a complete temporary result, validates layout, hashes, offsets, and expected content, and only then replaces the canonical `conversation.md`.

Staged recovery material is removed only after replacement and associated metadata updates succeed.

**Why:** a partially rewritten archive is worse than an explicitly incomplete staged archive. Validation before replacement keeps the canonical file recoverable.

### Virtualized DOM traversal must prove coverage

DOM traversal should be based on successive mounted-window overlap and explicit convergence evidence. Merely seeing a top or bottom anchor is not sufficient if virtualization could have skipped intermediate content.

Backward discovery establishes the oldest reachable boundary. Forward recovery must then genuinely sweep newer mounted windows and recover known holes before completion is accepted.

**Why:** a virtualized UI can jump or remount content in ways that make visual arrival at an endpoint look complete even when intermediate turns were never visited.

### Progress reports what is actually known

Progress and missing counts must not imply knowledge the recorder does not have.

Known missing User and ChatGPT halves are counted independently. Recovery is represented by reducing those counts rather than by a separate recovered-count display.

The active capture status uses the established shared layout and timing semantics rather than a fallback-specific presentation.

**Why:** misleading progress is operationally dangerous. A PASS or 100% display must mean the recorder has actually satisfied the documented completion conditions.

### File operations are treated as fallible external state

Browser file handles and filesystem operations can become stale or fail after a write has actually committed. File writes therefore use bounded reacquisition, verification, and idempotence checks rather than assuming an exception always means the write did not occur.

**Why:** observed Chromium file-system behaviour includes stale-handle errors and ambiguous write outcomes. The recorder must detect the real resulting file state rather than infer it from the exception alone.

### Tests exercise production implementations

Review/test commands should invoke the same production extraction and assembly implementations they are intended to verify. A parallel test-only implementation should not substitute for the real path.

A PASS must represent semantic completion, not merely successful function return or successful materialization of the subset that happened to be captured.

**Why:** parallel test implementations can hide exactly the regressions the tests are supposed to detect.

## Current architecture direction

The current roadmap is:

1. Build and validate the API conversation spine.
2. Group API records into User–Assistant Pairs (UAPs).
3. Materialize visible User/ChatGPT content from API records where supported.
4. Extend API materialization to file metadata.
5. Archive local attachments.
6. Support images/multimodal content.
7. Support citations.
8. Support public Thoughts/rendered reasoning where applicable.
9. Make normal recording API-first.
10. Integrate API-first behaviour with Resume/rebuild.
11. Retire obsolete primary dependencies while preserving required fallbacks.

Until those later phases are complete, the DOM recorder remains part of the production architecture.

## Optional Markdown heading metadata

DownloadConversation exposes three independent persistent Markdown-heading controls:

- **Timestamp**: Core derives the source create/update timestamp and renders local
  `YYYY-MM-DD HH:MM:SS` presentation. Default: off.
- **Record #**: Core derives the one-based JSONL record number from canonical
  source provenance. DownloadConversation prepends conversation metadata as JSONL
  record 1, so the first visible ChatGPT source message is record 2. Default: off.
- **Turn ID**: Core derives the ChatGPT native source/message ID and renders the
  bare native ID value as visible heading metadata, without a `turn_id=` prefix.
  Default: off.

The visible order is speaker, timestamp, record number, then Turn ID. Ordinary
Markdown does not encode Turn ID as an HTML comment. DownloadConversation supplies
only these presentation visibility switches to AIConversationCore; it does not
format timestamps, compute record numbers, or inject semantic turn IDs itself.
Canonical and host fallback bodies therefore use the same Core-owned heading
serialization. These controls do not change chronology, grouping, UAP association,
API pagination, recovery, or canonical normalization.

## Image recovery and export performance diagnostics

Image-heavy Markdown exports keep the established serial recovery order and
fallback semantics, but expose enough timing evidence to locate otherwise silent
waits. With diagnostics set to **Debug**, each image recovery logs a compact start
record before its awaited operation and a completion/failure record containing
fetch/header, response-body, data-URL encoding, byte/character, and total elapsed
measurements. The log deliberately omits image URLs, Base64 payloads, and other
image data. The whole image phase also records aggregate counts, sizes, and
elapsed time.

The live status display advances per image rather than only after an entire
source message finishes. While an image is pending it shows the current global
image ordinal, recovery path (`dom` or `pointer`), current-image elapsed time,
completed count, and whole-export elapsed time. This is observability only: no
parallel fetching, timeout, retry policy, or new fallback path is introduced by
this instrumentation.

After image recovery, Debug diagnostics bracket synchronous Markdown rendering,
full-Markdown diagnostic calculation, Blob construction, and the browser download
trigger. Expensive full-Markdown fingerprints/inventories are evaluated only when
Debug diagnostics are actually enabled, and the export-tail fingerprint is reused
instead of recalculated for the Blob boundary.

Issue #119 raises the same-page diagnostic history from 500 to 10,000 entries so
an image-heavy live run is unlikely to evict its early timing evidence. The
session-storage mirror retains the newest 5,000 entries. High-volume logging is
debounced to at most one persistence write per second, and a collapsed diagnostic
panel does not rebuild hidden log-row DOM on every event. A page-hide event flushes
the pending persisted tail. For live investigation, copy the diagnostic log before
reloading the page so the full in-memory history is preserved.

## Issue #119 live-evidence performance correction

A real Debug export established that image recovery itself was not the observed stall: the supplied run completed image recovery in 24 ms, while repeated diagnostic scans over large rendered Markdown consumed tens of seconds after image recovery.  The instrumentation is therefore retained, but the diagnostic work is constrained so observability does not dominate export time.

- Canonical rendered segments are no longer hashed or regex-inventoried merely to populate per-segment/per-block Debug events.  Those events retain structural IDs, route information, and lengths without rescanning the full rendered segment.
- The `conversation-markdown-block-appended` Debug event is guarded before its argument object is built, so disabled Debug logging cannot evaluate expensive or high-volume diagnostic arguments.
- `conversation-markdown-assembled` no longer performs a full-document hash or turn-ID regex inventory.  The final export-tail Debug boundary remains the single deliberate full-Markdown fingerprint/inventory point used for correlation.
- Conversation API pagination requests 20 records per page instead of 100.  This does not change record ordering or completeness; it creates more fetch boundaries so the existing progress UI can report progress more frequently during long history retrieval.
- No image timeout, concurrency, retry, or fallback policy is changed by this correction.

## Issue #119 superseding live evidence: page size and UI heartbeat

The later 0.6.168 live run supersedes the earlier decision to request 20 turns per
Conversation API page.  On the same conversation, a single `num_turns=100`
request fetched all 4392 source records in 15.133 seconds, while four
`num_turns=20` cursor-chained requests required 41.016 seconds in total.  The
pagination API exposes the next backward cursor only in the preceding response,
so those requests are structurally sequential; they are not parallelized without
separate evidence for an independent range API.

Production therefore returns to `PAGE_TURNS = 100`.  User feedback no longer
depends on small pages: progress marks a page as in-flight before awaiting it and
the existing one-second status timer displays the current API page, completed
page/record counts, current-page elapsed time, and whole-export elapsed time.

The same run showed why the UI could remain visibly stuck on an old image count.
All seven image-pointer operations completed in 24 ms, but the one remaining
full-document Debug hash/turn-ID inventory then blocked the main thread for
17.768 seconds while scanning roughly 24.2 million Markdown characters.  That
whole-document scan and its hash/inventory helpers are removed.  The
`conversation-export-markdown-ready` boundary retains compact source-tail and
length metadata without rescanning the document, and the Blob boundary no longer
reports a Markdown hash.

After image recovery the export also yields one browser task before synchronous
Markdown rendering.  This does not change image recovery behavior; it gives the
completed image state and rendering transition a chance to paint so a prior
`5/7` display cannot remain on screen while later CPU work is running.

No image concurrency, timeout, retry, or fallback policy is introduced by this
correction.

## Issue #77 canonical sediment image resolution

Conversation image recovery is API-first. For a ChatGPT `image_asset_pointer`,
DownloadConversation adapts the source record through the pinned AIConversationCore
and consumes the canonical `conversation_image` resource for the original provider
part position. It does not independently translate `sediment://` provider pointers.

For an evidenced `sediment://file_*` pointer, AIConversationCore preserves the
original `source_pointer` and supplies the deterministic authenticated
`download_url` under `/backend-api/files/download/<file_id>`. DownloadConversation
owns the browser-authenticated retrieval step: it requests that Core-supplied URL,
reads the returned transient `download_url`, fetches the image bytes, converts them
to a data URL, and enriches the existing recovered-image map at the original source
position. The transient signed URL is neither canonical identity nor diagnostic
output.

A Core-supplied `data_url` is used directly. DOM image recovery remains only for
image forms for which Core supplies neither canonical image data nor a deterministic
transport URL; `sediment://file_*` recovery does not depend on mounting or scrolling
a historical turn. HTTP 404/410 during resolver/content retrieval is rendered as
missing; other retrieval failures remain unavailable while preserving the original
source pointer.

DownloadConversation passes the exact ordered Conversation API message set to
AIConversationCore once for image recovery, then indexes the returned resources by
source record identity and original source part index. The Core-supplied
`download_url` is authoritative for `sediment://file_*` image recovery. DownloadConversation does not reinterpret the raw sediment pointer and
does not fall through to DOM recovery when that Core contract is missing; the
missing canonical transport is an invariant failure reported explicitly. The first
transport request uses the same captured authenticated page/API request context as
Conversation API retrieval. Image-recovery Debug diagnostics include the loaded
userscript version so a stale document runtime can be distinguished from the
installed Tampermonkey version.
