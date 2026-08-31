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

Canonical identity is additional identity. Normalization must preserve the original JSONL provenance needed by later projections, including source record index/number, raw timestamp fields, provider/source record or turn identity, and all contributing records when several source records form one canonical turn. Existing DownloadConversation `turn_id` heading comments continue to refer to provider/source identity; they are not silently replaced by canonical derived turn IDs.

The initial production migration covers ordinary visible text records and plain Assistant segments composed of public `thoughts` records followed by an otherwise plain visible Assistant text record. These migrated Assistant segments are rendered by `AIConversationCore` as one canonical ChatGPT section while DownloadConversation preserves the final provider/source Assistant record ID in its existing `turn_id` heading comment. Provider-specific rich handling such as citations, images, inline ChatGPT tokens, `sandbox:` resources, hidden records, and other host-enriched cases remains on the established DownloadConversation renderer until each behaviour is migrated with its own regression evidence.

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

The recorder exposes independent **Timestamp** and **Record #** controls for
Markdown exports.  Both are presentation-only.  Timestamp formatting matches
`AI-transcript.py -d` (`YYYY-MM-DD HH:MM:SS` in local time), while record
numbers are the one-based JSONL line numbers from the paired export.  Because
DownloadConversation prepends a conversation-metadata record, the first
Conversation API message is JSONL record 2.  Existing source `turn_id` comments
remain unchanged.  Canonical records pass this metadata through
AIConversationCore; the legacy fallback path preserves the same visible format.

## Optional Markdown heading metadata

DownloadConversation exposes three independent persistent Markdown-heading controls:

- **Timestamp**: source create/update time rendered in local `YYYY-MM-DD HH:MM:SS`
  form.  Default: off.
- **Record #**: the one-based JSONL record number.  Because JSONL record 1 is
  conversation metadata, the first visible source message is record 2.  Default:
  off.
- **Turn ID**: the ChatGPT source message ID rendered using the established
  `<!-- turn_id=... -->` heading comment.  Default: on so existing Markdown output
  remains unchanged unless the user disables it.

These are presentation-only controls.  They do not change chronology, grouping,
UAP association, API pagination, recovery, or canonical normalization.

