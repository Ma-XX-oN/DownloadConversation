from pathlib import Path

path = Path('DESIGN.md')
text = path.read_text(encoding='utf-8')
marker = '## Optional Markdown heading metadata\n'
if marker not in text:
  raise SystemExit('optional heading metadata marker not found')
_, tail = text.split(marker, 1)

prefix = '''# DESIGN — DownloadConversation

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

## Historical architecture note

Pre-1.0 development used a DOM-first recorder with historical scrolling, split-half recovery, staged rebuild files, Resume-specific lifecycle state, and later an incremental migration toward API-first extraction.  Those mechanisms explain many legacy issues and old diagnostics but are not the current production transcript architecture.

The current 1.1.0 line completed the transition to one-shot Conversation API export with AIConversationCore canonical rendering.  Legacy recorder/UI issues that describe retired Resume, recovery, or DOM-transcript behaviour should be treated as historical/superseded unless a current issue explicitly reintroduces that requirement.  Issue #112 is the future home for API-based continuous recording/Resume.

'''

text = prefix + marker + tail
text = text.replace(
  'Canonical and\nhost fallback bodies therefore use the same Core-owned heading serialization.',
  'All Markdown bodies therefore use the same Core-owned heading serialization.'
)
path.write_text(text, encoding='utf-8')
