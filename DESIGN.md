# DESIGN — DownloadConversation

## What the project is

`DownloadConversation` is a one-shot ChatGPT conversation exporter with a separate passive communication recorder for diagnostics.  A normal Extract operation acquires the current conversation from ChatGPT's Conversation API, builds one authoritative in-memory source spine, and serializes the selected JSONL and/or Markdown outputs from that same snapshot.

The production transcript path is API-only.  The virtualized ChatGPT DOM is not a fallback transcript source.  DOM observation is still used where it has a separate, explicit purpose—for example live-tail diagnostics, Jump/navigation materialization, and narrowly scoped resource recovery—but it must not silently become an alternate source of conversation chronology or text.

The disk-backed communication recorder introduced by issue #123 is observability infrastructure, not a second export path.  It records page/network/lifecycle evidence so rare tail and hydration failures can be diagnosed without changing the Conversation API source used by Extract.

## Project terminology

### User–Assistant Pair (UAP)

**UAP** is project-specific shorthand, not a general ChatGPT term.  A User–Assistant Pair is the logical conversation unit that begins with one User turn and includes the following ChatGPT/Assistant output associated with that User turn, ending immediately before the next User turn.

The term remains useful in tests, Jump/navigation, diagnostics, and historical issue material.  It does not imply that DownloadConversation discovers production transcript chronology from mounted DOM pairs.

## Current production architecture

### One Conversation API acquisition per Extract

One Extract operation acquires the current conversation through the Conversation API exactly once.  Pagination, stable source identity, deduplication, and oldest-to-newest source ordering produce one authoritative in-memory spine.  Every selected output format consumes that same spine.

The newest-turn streamed-tail reconciliation from issue #123 is an evidence-constrained repair of that in-memory spine, not a second history acquisition and not a DOM fallback.  History remains authoritative through the verified parent/overlap anchor; only a contiguous completed captured suffix may replace/extend stale history under the documented identity checks.

### AIConversationCore owns canonical semantics and rendering

Provider/source records are adapted to `AIConversationCore`, which owns canonical normalization and the shared Markdown/HTML semantic rendering boundary.  DownloadConversation must not independently reinterpret canonical transcript semantics downstream.

DownloadConversation owns host responsibilities: authenticated Conversation API acquisition, page-context transport, browser-specific resource retrieval, export UI, diagnostic/communication logging, filesystem interaction, and other browser integration that is not canonical transcript meaning.

Production pins the deterministic classic-script Core bundle to an exact commit.  The loaded Core reports its own semantic version through `AIConversationCore.getVersion()`; DownloadConversation reports its caller version separately.

Canonical normalization preserves original source provenance.  Visible Turn IDs remain provider/source message identity rather than being silently replaced by a derived canonical identity.  Chronology, User/Assistant association, and source ordering are not rewritten merely to make rendering convenient.

### DOM is observational or auxiliary, not a transcript fallback

Current production does not scroll the virtualized conversation to reconstruct missing transcript text.  A mounted DOM turn can still supply bounded observational evidence for live/API consistency and can be used by UI features such as Jump.  Resource-specific code may inspect mounted DOM only where that behaviour is explicitly part of the resource contract and covered by tests.

A failure of the Conversation API/canonical path is therefore surfaced as a failure or consistency warning unless a separately approved, documented recovery mechanism applies.  Do not introduce a new source fallback without explicit approval.

### Single-snapshot outputs

JSONL serialization and Markdown rendering are separate projections over the same acquired spine.  Selecting both formats cannot trigger a second conversation fetch.  A live conversation may continue changing while serialization is in progress; both outputs from one Extract click nevertheless describe the same captured source state.

### Communication recorder is passive evidence

The communication recorder begins at document-start, observes stock page networking plus DownloadConversation's own API traffic, and writes its JSONL trace to the authorized directory.  It is designed to preserve evidence across reloads and rare failures.  It does not alter ChatGPT requests, does not become the source of normal exports, and does not change the Core rendering boundary.

### Communication-log active-file lifecycle

The general status panel exposes the exact active communication-log filename and serializes rename, duplicate, reset, append, and checkpoint operations through the same write chain. Duplicate creates an exact committed sibling snapshot while recording remains attached to the original file. Rename commits the writer before moving identity to the verified replacement file.

Periodic and document-lifecycle checkpoints close dirty long-lived writers so committed bytes are available on disk. Hard document departure starts the same checkpoint path at `beforeunload` and again at `pagehide`; these browser lifecycle calls are best-effort because unload events do not guarantee awaiting arbitrary asynchronous work. Any full-document reload or navigation initiated by DownloadConversation must explicitly await that checkpoint before changing location. Same-document/SPA route changes are not treated as unload events.

### Continuous recording and Resume are deferred

Durable continuous recording and Resume/rebuild are not current production behaviour.  Future API-based continuous recording is tracked by issue #112 and must reuse the same Conversation API/Core ownership model rather than reviving the retired DOM-first recorder architecture.

## Design principles

### Preserve source fidelity

Exports should preserve the conversation and supported resources without inventing chronology, silently dropping conflicting source evidence, or treating transient viewport state as durable identity.

### Stable identity over visual position

Provider/source message IDs and explicit metadata are authoritative identity where available.  Viewport position, mounted node order, and current `scrollHeight` are transient UI observations.

### One canonical semantic boundary

AIConversationCore owns canonical transcript semantics.  DownloadConversation supplies host data and presentation options but must not maintain a parallel parser/renderer for the same canonical meaning.

### No unapproved fallbacks

A fallback is an architectural decision, not a convenience.  Production uses the documented path until evidence establishes that another path is required and that path is explicitly approved.  Failure should remain explicit rather than being hidden behind an unverified alternate interpretation.

### File operations are fallible external state

Browser file handles and filesystem operations can become stale or fail after bytes have actually committed.  File code therefore reacquires state, verifies ambiguous outcomes, and keeps recovery idempotent rather than assuming an exception proves nothing was written.

### Tests exercise production behaviour

Regression tests should exercise the same production implementations and invariants they claim to verify.  A PASS means the documented semantic contract held, not merely that a helper returned successfully.

## Shared modal keyboard focus

Recorder modal dialogs keep keyboard focus anchored to the most recently focused
modal control when the user clicks ordinary non-interactive content inside the
dialog. Interactive controls retain normal browser focus/activation behaviour,
and clicking the backdrop remains a separate dismissal action where the dialog
already supports it. This keeps Tab/Shift+Tab, Enter/Space activation, and Escape
handling available after incidental clicks without changing the established modal
keyboard contract.

## Historical architecture note

Pre-1.0 development used a DOM-first recorder with historical scrolling, split-half recovery, staged rebuild files, Resume-specific lifecycle state, and later an incremental migration toward API-first extraction.  Those mechanisms explain many legacy issues and old diagnostics but are not the current production transcript architecture.

The current 1.2.0 line retains the one-shot Conversation API export with AIConversationCore canonical rendering.  Legacy recorder/UI issues that describe retired Resume, recovery, or DOM-transcript behaviour should be treated as historical/superseded unless a current issue explicitly reintroduces that requirement.  Issue #112 is the future home for API-based continuous recording/Resume.

## Optional Markdown heading metadata

DownloadConversation exposes four independent persistent Markdown-heading controls:

- **Timestamp**: Core derives the source create/update timestamp and renders local
  `YYYY-MM-DD HH:MM:SS` presentation. Default: off.
- **Record #**: Core derives the one-based JSONL record number from canonical
  source provenance. DownloadConversation prepends conversation metadata as JSONL
  record 1, so the first visible ChatGPT source message is record 2. Default: off.
- **Turn ID**: Core derives the ChatGPT native source/message ID and renders the
  bare native ID value as visible heading metadata, without a `turn_id=` prefix.
  Default: off.
- **provenance**: Core derives source debug provenance and appends the canonical
  `record_id=... record_index=...` HTML comment to the heading. One checkbox controls
  the provenance channel as a unit; DownloadConversation does not construct either
  field. Default: off.

The visible order is speaker, timestamp, record number, then Turn ID; when provenance
is enabled, the Core-owned provenance comment follows that heading metadata. Ordinary
Markdown does not encode Turn ID as an HTML comment. DownloadConversation supplies
only these presentation visibility switches to AIConversationCore; it does not
format timestamps, compute record numbers, inject semantic turn IDs, or construct
debug provenance itself. The provenance export checkbox is independent of the recorder
diagnostic-log level (`errors` / `warnings` / `debug` / `verbose`). All Markdown bodies therefore use the same Core-owned heading serialization. These
controls do not change chronology, grouping, UAP association, API pagination,
recovery, or canonical normalization.

## Single-snapshot multi-format export

One Extract operation acquires the Conversation API exactly once, regardless of
whether JSONL, Markdown, or both formats are selected. The existing pagination,
deduplication, and oldest-to-newest ordering logic produces one authoritative
in-memory conversation spine. Every selected serializer then consumes that same
spine; selecting both formats does not trigger a second API acquisition.

JSONL serialization and Markdown rendering remain independent after acquisition,
including Markdown image recovery and Core rendering. Sharing the source snapshot
ensures both files from one Extract click describe the same Conversation API state
even if the live conversation changes while output generation is still running.

## Version identity and dependency provenance

DownloadConversation owns exactly one writable semantic version: the userscript
`@version` metadata value. Runtime code reads that same value from
`GM_info.script.version`; it does not maintain a second caller-version literal.
The defined semantic-version baseline is `1.0.0`. Development builds use the
issue-qualified `x.y.z-issue.<issue>.<iteration>` form.  When an accepted development
line is promoted, the release increments the minor component `y` from the current
release, resets `z` to zero, and drops the issue qualifier; accepted releases therefore
use the plain `x.y.0` form for that promotion.

The AIConversationCore browser dependency remains pinned to an exact commit. Its
semantic version is derived from the actually loaded bundle through
`AIConversationCore.getVersion()` and is never duplicated as a DownloadConversation
production literal. The exact commit identifies dependency provenance/integrity;
the Core semantic version identifies the Core release. Neither replaces the other.

Startup/recorder diagnostics report both `script_version` and `core_version` so a
log identifies the caller and the shared Core independently. Changing the Core pin
is also a DownloadConversation change and therefore advances DownloadConversation's
own version under the normal release process.

## Startup and saved console diagnostics

Recorder diagnostics mirror to DevTools automatically from document startup until
the general status panel is first shown. Creating that panel while it is hidden
does not end startup logging. Once shown, console output depends only on the
persistent checkbox labelled **console** on the panel; its default is unchecked.
Closing, hiding, reopening, or recreating the panel does not restart automatic
startup output. Reloading the page starts a new startup interval, even when the
saved checkbox is off.

The console gate covers both ordinary recorder diagnostics and existing direct
launcher/lifecycle messages. Console mirroring occurs before the panel diagnostic
severity filter, so it remains available at every selected panel verbosity during
startup or while console is checked. Signed-token redaction still occurs before
console output. Panel retention, persistence and filtering keep their existing
behaviour. The checkbox does not enable invasive launcher instrumentation.

The MD headings checkbox is labelled **provenance** to distinguish it from
diagnostic verbosity **Debug**. Its existing storage key and AIConversationCore
`debugProvenance` option are preserved, including the saved selection. This label
change does not alter exported provenance or any other rendering semantics.

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

## Live/API/JSONL tail consistency

DownloadConversation retains a bounded monotonic history of the ten newest User/Assistant turns that the stock ChatGPT UI has legitimately exposed through forward conversation progression. The retained high-water history distinguishes the nested `data-message-id` API-correlation identity, mounted `section[data-turn-id]` identity, and section `data-testid` virtual-window identity rather than assuming those values are interchangeable.

Historical navigation is not forward evidence. Scrolling upward, using ChatGPT's prompt index, invoking DownloadConversation Jump, or virtualized remounting must not advance the retained newest turn. After historical navigation, ordinary DOM discovery becomes eligible to advance the high-water mark only after the previous high-water turn is re-encountered at the current bottom boundary. An explicit new User prompt independently authorizes the following User/Assistant progression.

At the start of Extract, the current ten-marker history is frozen for that operation. The existing single-snapshot invariant remains unchanged: DownloadConversation acquires the Conversation API once and all selected formats consume that same authoritative spine. The frozen live markers are compared with that spine, and generated JSONL is then compared with the exact source records from the same spine. Missing newest suffixes, same-ID materially shorter API content, identity/role disagreement, or JSONL loss/mutation are reported as consistency warnings with bounded identity/count evidence.

These checks are observational. A mismatch does not reload ChatGPT, merge DOM content into the export, issue a second acquisition, or select a fallback source. Source-selection changes require separate evidence and approval. The consistency classifications are intended both to expose stale API snapshots and to help localize final-response loss such as issue #116 to live UI → API acquisition versus API → serialization.

## Issue #123 streamed-tail recovery

The newest generated turn has a second first-class source in addition to the
history pagination API: the stock page's own /backend-api/f/conversation
transport. DownloadConversation observes that request and a cloned response at
document-start without delaying or consuming the page's response. When the
bootstrap SSE emits a stream_handoff, DownloadConversation also passively
observes the page's existing WebSocket connection and consumes only the
advertised conversation-turn topic's encoded_item SSE payloads; it does not
open a second generation request or a second history acquisition.

The submitted request messages, parent_message_id, and exact provider message
objects reconstructed from the completed stream are retained for only the
newest turn and mirrored to session storage so a same-tab hard reload does not
discard a completed streamed response while history is still stale. The capture
is bounded and an overflowed or incomplete capture is never merged.

Reconciliation is identity- and suffix-constrained. History remains authoritative
through the captured parent anchor. The records after that anchor must be an
exact message-ID prefix of the captured turn. A request-body record fills only a
missing submitted suffix record; if history already contains that request-only ID,
the server history copy remains authoritative. Matching same-ID records actually
observed in the completed response stream are replaced by the streamed copies,
which repairs stale partial Assistant/tool history records; only the remaining
contiguous captured suffix is appended. Any gap,
reordering, missing anchor, incomplete handoff, or conflicting identity rejects
the streamed merge rather than inventing chronology. JSONL and Markdown then
consume that same reconciled in-memory spine, preserving the single-snapshot
multi-format export contract and the AIConversationCore rendering boundary.


## Issue #123 stock network hydration diagnostics

Live evidence showed that a newest Assistant turn can disappear after a hard reload,
remain absent from the flattened Conversation API snapshot, and then materialize in
the stock ChatGPT UI later.  The supplying request could not be identified from the
older diagnostics because page networking was observed only for narrow correlation
purposes.  Issue #123 therefore adds passive stock-network observability without
changing acquisition or rendering semantics.

From `document-start`, the userscript observes page-realm `fetch` and XHR traffic.
It leaves the page's original response object untouched and inspects only a cloned,
bounded response stream where the content type/path is useful for identity tracing.
Diagnostics retain method, sanitized URL, request cache mode when exposed, safe
request header names/selected routing-cache values, HTTP status, elapsed time,
explicitly whitelisted cache/correlation response headers, and bounded message-ID /
status summaries.  Raw response bodies, authorization values, cookies, tokens and
other secret header values are not retained.  Non-JSON text is represented only by
bounded candidate UUIDs and structural message-term presence.

The stock-network trace is evidence gathering only.  It does not add another export
acquisition, alter the single-snapshot invariant, change API/DOM source precedence,
or introduce a fallback.  Existing `/f/conversation` streamed-tail capture remains
the production tail-recovery mechanism while these diagnostics identify which stock
request hydrates delayed/reloaded turns.

Click-correlation diagnostics also record `Event.isTrusted`, pointer type and button
metadata.  A captured/synthetic click event must not be described as deliberate user
input without trusted-event evidence.

Finally, same-ID stale-prefix comparison is not inferred from User DOM text because
ChatGPT may append Retry/error/control chrome inside the mounted User-turn section.
Stable message identity still participates in presence/role checks; this change only
removes an unreliable User-content freshness signal.

## Issue #123 disk-backed communication recorder

Rare delayed-tail failures can disappear or change across a hard reload, so bounded
in-memory diagnostics are not sufficient evidence for the next occurrence.  The
userscript therefore maintains a persistent, append-only communication trace in the
user-authorized directory.  The per-conversation filename is
`DownloadConversation_<conversation-name>.jsonl`, using the same filename sanitation
as exported conversation files.

The selected `FileSystemDirectoryHandle` is stored in IndexedDB.  A later reload
reuses it automatically when read/write permission remains granted.  If no usable
handle exists, the page presents a user-gesture **Choose Log Folder** control because
Chromium does not permit the directory picker to be opened autonomously at
document-start.  The most recently resolved conversation title is also retained by
conversation ID so an already-authorized reload can begin logging before the visible
heading rematerializes.

Communication JSONL is intentionally disk-backed rather than accumulated as another
large diagnostic array.  Stock page fetch/XHR and WebSocket traffic receives
session/transaction/timing/cache metadata; same-origin textual/API/SSE request and
response bodies are written in bounded chunks.  Binary or cross-origin bodies are
metadata-only.  Authorization, Cookie/Set-Cookie, bearer/session/token/API-key and
signed-secret values are redacted before persistence.  Session/reload metadata and
newest-Assistant placeholder, Thinking, Retry/error, timeout and hydrated state
transitions are written to the same file so one rare failure provides both a time
bound and the supplying network transaction.

Normal communication recording keeps one `FileSystemWritableFileStream` open rather
than committing every JSONL record separately.  Opening the writer reacquires the real
file, observes a fresh committed EOF, seeks there once, and subsequent records are
serialized through the existing write chain.  A dirty writer is checkpointed by
`close()` every 30 seconds, when the page becomes hidden or enters `pagehide`, and after
a completed `/backend-api/f/conversation` response has been captured.  A clean writer
is not checkpointed merely because a timer fired; after a checkpoint the next record
lazily opens a new writer at the then-current committed EOF.

Before normal recording starts, the recorder inspects Chromium sibling swap files named
`<log>.crswap` and `<log>.<n>.crswap`.  Recovery treats the committed real JSONL as the
authoritative baseline.  It ignores only an incomplete final JSONL line, byte-verifies
that each recoverable candidate is compatible with the committed prefix, and chooses a
longer candidate by complete recoverable length and then modification time.  Only the
missing suffix is appended to the real file, using the existing Issue 44 one-shot
stale-handle-safe append path.  Compatible recovered or stale swaps are removed; a
divergent swap is retained and reported rather than concatenated or deleted.  Recovery
and cleanup finish before the long-lived writer can open.

The Issue 44 `InvalidStateError` verification remains the safe one-shot mechanism used
for recovery appends: after an ambiguous failure the real file is reacquired and bytes
are checked before any retry, and unexpected external modification is rejected rather
than overwritten.  Checkpoint failures remain isolated from ChatGPT networking; an
uncertain writer is not silently treated as a successful committed append.

The communication recorder is passive observability.  Its failures are isolated from
ChatGPT networking and reported through ordinary recorder diagnostics.  It does not
add an export acquisition, change the #102 single-snapshot contract, change source
precedence/recovery semantics, or cross the AIConversationCore rendering boundary.

## Issue #123 stateful communication-body redaction correction

The first disk-recorder implementation redacted each output chunk independently.  A
credential whose prefix/value crossed that arbitrary boundary could therefore expose a
partial value before the following chunk made the complete pattern visible.  The
corrected recorder treats redaction as streaming protocol state rather than a property
of storage chunking.

Possible sensitive prefixes are retained briefly instead of being committed at a
source-chunk boundary.  Once a query token, signed URL value, Bearer credential, or
quoted sensitive JSON-style field is recognized, its value remains suppressed until
its actual delimiter arrives, even when that value spans arbitrarily many input and
output chunks.  Fetch/SSE streams and already-materialized XHR/WebSocket text use the
same state machine; disk chunk size no longer defines the privacy boundary.

## Issue #123 communication-recorder source-completeness correction

The disk recorder must distinguish stock ChatGPT traffic from DownloadConversation's
own authenticated Conversation API acquisition.  The latter intentionally uses the
pre-interception page `fetch` implementation, so it is now traced explicitly with
`origin: "downloadconversation"` while ordinary intercepted page fetches retain
`origin: "stock-chatgpt"`.  Logging still consumes only cloned Request/Response data
and does not alter the request used by the exporter.

Body persistence is now content-type conservative.  Explicitly textual MIME types
remain eligible for body capture; any explicit non-text MIME type is metadata-only,
even beneath `/backend-api/`.  A missing content type may still be inspected for a
same-origin backend API because current ChatGPT endpoints occasionally omit a useful
MIME declaration.  This preserves diagnostic coverage without decoding known binary
assets into the JSONL trace.

Directory selection uses the page realm (`unsafeWindow` when available) from the
existing user-gesture prompt, matching the realm used for the intercepted networking
objects and avoiding a sandbox-only File System Access lookup.

## Issue #123 direct native directory-chooser gesture

The File System Access directory picker cannot be opened autonomously during a page
reload because Chromium requires transient user activation.  When a persisted
directory handle still has read/write permission the recorder therefore reuses it
without showing any authorization UI.  Otherwise the userscript blocks page
interaction and reserves the next trusted click or key press solely for directory
authorization.

That trusted event handler invokes the page-realm `showDirectoryPicker()` synchronously,
before any awaited work can consume transient activation.  There is no intermediate
"Choose Log Folder" button.  The same event is prevented and stopped so it cannot also
activate an underlying ChatGPT control.  Cancelling the native chooser leaves the
trusted-gesture capture armed for the next interaction; successful selection persists
the directory handle, removes the blocker/listeners, and resumes the disk-backed
communication recorder.

This changes only the authorization UX for the diagnostic communication recorder.  It
does not change the single-snapshot export contract, source precedence/recovery rules,
or the AIConversationCore rendering boundary.


## Agent-turn stopwatch

Issue #136 adds a display-only stopwatch for one working agent exchange.  The clock
starts from a monotonic local timestamp captured immediately before the stock
`POST /backend-api/f/conversation` request is transmitted.  Request bodies do not
reliably contain the enriched working-exchange metadata, so the response stream's
structured User `input_message` is the authority for classifying the submission.

An initial User input binds the active stopwatch to its `turn_exchange_id` (falling
back only to `working_turn_id`).  A later User input records a lap only when provider
metadata explicitly marks `message_type: "next"` and the working-exchange identity
matches.  The lap boundary remains the earlier local submission timestamp, not the
time at which the enriched stream record arrives.  Returning composer control to the
User, whether normally, because input is required, after interruption, or after an
error, is not a terminal stopwatch event by itself.

The stopwatch stops only when the captured structured stream contains an Assistant
message for the same exchange with `channel: "final"`,
`status: "finished_successfully"`, and `end_turn: true`.  At that boundary the final
lap and total elapsed time are frozen.  A later independent User exchange replaces
the completed session with a new stopwatch.

The UI is a fixed, pointer-transparent top-right viewport control below the ChatGPT
header controls.  It is not part of transcript chronology, does not move with the
conversation scroll, and does not alter requests, exports, communication recording,
streamed-tail reconciliation, or AIConversationCore semantics.  Elapsed time uses
`performance.now()`; wall-clock timestamps are not used for duration measurement.


## Agent-turn stopwatch live-stream identity

The stopwatch classifies User submissions from the production SSE stream by working-exchange identity, not by `message_type`. Captured provider evidence shows that the top-level User `input_message` carries `turn_exchange_id` / `working_turn_id` but may omit `message_type`, while a later hidden system record in the same turn may carry `message_type: next`. The stopwatch therefore treats a pending User submission with the same working exchange as a lap boundary and a different working exchange as a new timing session.

Each streamed generation capture retains the working exchange learned from its User `input_message`. Terminal stopwatch validation uses that capture-level identity together with the completed final Assistant record. This avoids depending on later message-metadata patch representation while keeping exchange matching explicit and single-path.


## Agent-turn stopwatch steer-turn boundary

Live browser diagnostics establish that a User follow-up submitted while the current working turn remains active is sent through `POST /backend-api/f/steer_turn`, not through the `/backend-api/f/conversation` generation endpoint. The stopwatch treats that exact same-origin POST as the follow-up submission boundary and records the lap immediately using the local monotonic pre-transmission timestamp.

`/backend-api/f/steer_turn` is not treated as another generation stream. The existing `/backend-api/f/conversation` capture remains authoritative for streamed turn identity and terminal completion. Because a steer-turn lap is recorded directly at the steering POST boundary, later streamed User metadata has no pending stopwatch submission and therefore cannot double-count the same follow-up.


## Agent-turn stopwatch live total

The floating stopwatch always renders a `Total` line. While the stopwatch is active, Total is the live monotonic elapsed duration from the initial prompt submission (`now - started_at_ms`) and refreshes on the same interval as the current lap. On successful terminal completion, the same line switches to the frozen `total_ms` value. Follow-up lap boundaries do not reset Total.


## Agent-turn stopwatch single-lap display

The floating stopwatch always renders `Total`. When the current stopwatch session contains only one represented lap, the redundant `Lap 1` line is suppressed and only `Total` is shown. Once a follow-up creates a second lap, all lap lines are shown together with the continuously running Total. The same rule applies after completion: a one-lap completed session shows only the frozen Total, while multi-lap sessions preserve their individual lap lines plus Total.


## Agent terminal sound volume and reliable playback

The general status panel exposes one **Sound** control rather than a boolean sound checkbox. Activating it opens a compact popup containing a vertical integer slider from 0 through 10 and a numeric value. Volume 0 is the single disabled state; nonzero values enable the same structured terminal-state cues. The integer volume is persisted under `tm-conversation-recorder-agent-sound-volume`. A legacy saved boolean `tm-conversation-recorder-agent-sounds` migrates deterministically to 10 when true or 0 when false when no integer value exists.

Terminal sound identity remains structured-stream-only. Successful completion is still the exact final successful Assistant state, and errors remain established structured terminal error events; rendered text is not inspected as a fallback. The stable terminal identity is de-duplicated only after oscillator scheduling succeeds. A missing or suspended AudioContext therefore cannot permanently consume a terminal key before a sound has actually started.

Trusted pointer/keyboard gestures and nonzero volume interaction create or resume the single Web Audio context. Playback diagnostics record terminal classification, duplicate or volume-zero suppression, AudioContext unlock state, playback attempt, successful oscillator scheduling, and playback failure. These diagnostics are observability only and do not introduce an alternate trigger or playback path.

Cue amplitude scales linearly with the selected slider level, with level 10 using a peak gain of 1.0. Success and error retain their distinct oscillator waveforms, pitch envelopes, and durations. The volume control does not alter streamed-tail reconciliation, stopwatch timing, exports, or ChatGPT request semantics.

## Issue #139 structured polling-timeout terminal state

A stock ChatGPT message-delivery polling timeout is terminal evidence only when the
page emits the exact structured `/ces/statsc/flush` counter observed in production:
`chatgpt_web_message_delivery_failure_shown` with source
`completion_stream_polling_fallback`, `error_code=network_error`, and
`failure_reason=polling_timeout`. DownloadConversation observes a clone of that
stock request and normalizes the counter to one internal terminal-error event.

That normalized event is correlated with the current structured generation capture.
When its exchange identity matches the active stopwatch exchange, the stopwatch
freezes its final lap and Total. The same event is passed through the existing
terminal-sound de-duplication path and emits one error cue when volume is nonzero.
Repeated observations cannot stop the stopwatch twice or replay the sound for the
same generation identity.

Rendered error text, DOM lifecycle labels, elapsed-time thresholds, and retry counts
are not terminal-state authorities. The recorder does not infer this state from the
visible `Retry` UI and does not add an alternate/fallback terminal-detection path.

## Generation response clone ownership

For `POST /backend-api/f/conversation`, DownloadConversation must acquire its passive generation-response clone synchronously in the fetch response handler, before returning the original `Response` to ChatGPT. Request-body parsing may finish later; the already-owned response clone waits for that request capture and is then consumed by the existing structured SSE path. This prevents ChatGPT from locking or disturbing the original response body before DownloadConversation acquires its clone. Clone acquisition failure is diagnostic-only and does not add a rendered-text or DOM terminal fallback.

## Agent-turn stopwatch reload restoration

A full page reload clears the stopwatch's page-lifetime monotonic state, but the
stock Conversation API history retains provider `create_time` values and working
exchange identities. DownloadConversation restores the floating stopwatch from
that structured history rather than establishing a new local start time.

The synchronously cloned stock `GET /backend-api/conversations/<id>` response is
the restoration trigger. The newest User-started working exchange is identified
from the de-duplicated chronological API spine. If the initial history window
starts inside that exchange, DownloadConversation follows `start_cursor` backward
until an older different exchange proves the true starting User prompt or the
beginning of conversation is reached. Every same-exchange User `create_time`
becomes a historical lap boundary.

The provider `/backend-api/conversation/<id>/stream_status` response controls only
whether the recovered stopwatch continues to advance. `IS_STREAMING` bridges the
persisted wall-clock boundaries into the new page's `performance.now()` domain;
completed lap durations remain fixed while the current lap and Total advance.
When the stream is not active, the recovered successful final Assistant timestamp
freezes the final lap and Total. In both states the recovered stopwatch remains
visible. Repeated streamed copies of recovered User messages do not create laps
because restoration leaves no pending local submission boundary.

Reload restoration does not add a second terminal classifier. Subsequent live
terminal state continues through the existing shared structured terminal dispatcher.
No rendered-text or DOM transcript fallback is introduced.

## Shared agent terminal dispatch

Structured terminal state is normalized exactly once before any terminal side effect. The normalizer determines terminal kind, conversation identity, exchange identity, terminal de-duplication key, and one monotonic completion timestamp. Successful-final exchange identity prefers the final Assistant message metadata; structured capture/request identity is used only by the same shared normalizer when needed. The normalized immutable terminal object is then dispatched to the sound and stopwatch handlers. Neither consumer independently classifies terminal state or reconstructs terminal identity. The stopwatch still rejects a normalized terminal whose exchange identity does not match the active stopwatch session. Rendered text and DOM error strings are not terminal detectors.
