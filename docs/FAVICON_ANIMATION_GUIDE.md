# Favicon animation extension guide

Issue: DC #349. This document describes how future favicon animations change
without modifying the surrounding DC lifecycle, persistence, and cross-tab
protocol. It supersedes the animation-specific portions of frozen V2.0
`docs/FAVICON_CACHE_INTERFACES_V2.md` for *new* animation versions. The
frozen V2.0 document remains historical evidence and must not be rewritten.

## Separate identities

- `@version` / `VERSION` identify the DC userscript build, **not** the
  favicon animation. An `-issue.*` suffix has no animation semantics.
- `FAVICON_ANIMATION_VERSION` is a separate numeric triplet, currently
  `2.1.0`. Change it when frame bytes or frame-index semantics change.
  Per-title heartbeat cadence is a presentation scheduling policy and does
  **not** alter cached frames, the frame-index API or animation identity.
- Old animation `1.11.8` (21-frame cosine) already exists in the shared
  IndexedDB database and belongs to old running tabs. Do not migrate it.
  New tabs select `2.1.0` explicitly. Old tabs continue independently.
  Existing `2.0.0` two-frame disk/pie datasets also remain intact.
- A dataset key includes the animation version, the **source favicon URL**,
  the active light/dark theme, the colour state and progress step. A frame
  index is a lookup *within* that tuple, never part of generation-lock key.
- `get_compatible_version_key(FAVICON_ANIMATION_VERSION)` resolves the
  locally registered animation version. Never pass DC's `VERSION` here.

## Responsibilities (the intended extension boundary)

1. **Renderer** `src/favicon/browser-sequence.mjs`: create exactly the
   complete sequence required by this animation for one cache tuple.
   The renderer provides PNG Blobs and no DOM writes or IndexedDB access.
2. **Frame selector** `get_favicon(version_key,base_type,completion_time,
   time_offset)` in `02-favicon-cached-lookup.js`: select an index from
   the supplied time offset. It chooses the source/theme internally and
   maps one returned Blob URL to the favicon links; caller API unchanged.
3. **Cadence** `update_every_ms` registered with `faviconCacheV2Configure`
   in `02-favicon-v2-adapter.js`: schedule refreshes; it is NOT a
   separate cache-identity field.
4. **Shared storage** `03-favicon-cache-v2*.js`: validate 1..256 complete,
   bounded PNG frames, atomically store `frames.length` entries with
   `count:frames.length` readiness metadata, then return only requested
   indexes. It MUST NOT know the animation's waveform or exact frame count.
5. **Lifecycle**: retain yellow processing, bright-green DONE, red error,
   white acknowledgement, 0..6 five-minute **ring-only** progression,
   focus acknowledgement, theme handling, stopwatch and terminal observer.

For another animation (for example `3.0.0`), update the renderer, the
time-to-index function in `get_favicon`, `update_every_ms`, and the
independent animation version constant. Update animation-specific tests and
the generated userscript. Do **not** change shared cache/store shape,
Web Locks, lifecycle, network observers, or DC build-version parsing.

## Animation 2.1.0: ring-only strong whole-icon blink

DC #354 removes the historical filled background pie/disk from every
progress step and colour state; the untouched original artwork and its
transparent background remain behind the unchanged outer progress arc.
At step zero no arc is drawn.  Steps 1–6 use the same six five-minute
arc angles, `0.12 * size` stroke width, `0.43 * size` radius and colours
as 2.0.0.  Completed/DONE is `#00FF00` (previously `#90EE90`), distinct
from the first ring green `#00CC00`.  Other base and ring colours and
error ring suppression are unchanged.  Both 2.0.0 disk-backed and
1.11.8 21-frame cached datasets stay version-isolated for older tabs.

- Two **complete** PNG frames per on-demand tuple: index 0 uses full opacity
  and index 1 multiplies existing composite alpha by 0.20.
- A cycle lasts 2000 ms: floor((time_offset modulo 2000) / 1000) picks
  0 for the first second and 1 for the second. Negative offsets normalize.
- `update_every_ms=1000`: no 250 ms redraw or 21-frame generation.
- Generate an entire pair only when requested, once per version/source/
  theme/base/progress tuple. Cached warm playback needs no canvas, pixel
  modification, or PNG encoding.
- Preserve the **white-knot SVG original artwork**: prefer a matching
  theme SVG source over ChatGPT's black-knot/white-disc stock PNG; apply
  the same generated PNG to all media-eligible icon links. Chrome's
  selection of one eligible link must not change the displayed knot style.
  Store the selected SVG source URL and theme in the tuple; never silently
  reuse a different source/theme's frames.

## Meaning of the blink

The animation is a local page-timer responsiveness indicator, not proof that
ChatGPT is delivering responses. Browser background-tab timer throttling can
suspend or slow it; this is not a network-liveness measurement. A distinct
server-receipt `Last:` indicator is deferred to a separate ticket.

## Storage, concurrency, and failure

- IndexedDB remains `dc-favicon-sequences-v2` with existing datasets,
  sequences, and pngs stores. Each version has independent keys.
- First tab obtaining the sequence Web Lock generates; other tabs wait
  with their **original** icons until the full pair is atomically ready.
  Failed/interrupted writes never publish a ready marker. Crashed tab's
  lock can be taken over by another requester.
- Cache reads validate integer `count` and that index is within count;
  generation/publishing validates actual `frames.length`. The explicit
  upper bound of 256 is a storage safety limit, NOT an animation format.
- Old tabs using legacy `1.11.8` can keep reading their existing
  21-frame dataset. New `2.1.0` sessions read only their own dataset; the prior
  `2.0.0` dataset is neither rewritten nor shared with 2.1.0.
  There is no conversion or cross-animation backward compatibility.
- The existing 600000 ms dataset `last_used` touch and collection policy
  is unchanged in DC #349: at most one timestamp update per ten minutes,
  sweeps every ten minutes, expires only when strictly older than ten
  minutes and no active dataset reader lock exists. This work does NOT
  introduce additional liveness-status frames or network checks.
- Fail closed to the stock icon, retain theme/epoch checks, and release
  object URLs and reader locks on navigation/close.

## Verification checklist for future revisions

- Test exact frame count and alpha differences, index selection across
  cycle boundaries, positive/negative offsets, and registered cadence.
- Test SVG-vs-PNG source choice and light/dark theme changes.
- Test four base colours, seven progress steps, late async reads,
  acknowledgement, lifecycle transitions and original-link restoration.
- Test cold generation exactly once per tuple, atomic readiness, two-tab
  election/reuse, generator crash/abort and dataset expiry.
- Check that 10+ seconds of warm updates cause zero canvas encodes and
  only the expected frame changes.
- Run `node --test tests/issue349-animation-v2.test.mjs` and the
  affected favicon regression/Chromium tests.
- Run `node scripts/build-userscript.mjs --check`; regenerate and commit
  `chatgpt-conversation-markdown-export.user.js` when source changes.
- Require exact-source hosted CI and real Chrome acceptance before
  merging. No merge without explicit user authorization.

## Title-controlled heartbeat cadence (DC #352)

The only per-conversation blink policy is the milliseconds dictionary in
`src/userscript/03-agent-lifecycle/02-favicon-title-policy.js`:

```js
const AGENT_FAVICON_TITLE_CADENCES = Object.freeze({
  '- ACTIVE': 1000,
  '- USER ACTION REQUIRED': 2000
});
```

Use the canonical active-sidebar-first `conversationTitle()` resolver;
find its **last hyphen**, take everything from that hyphen, trim trailing
whitespace and look up the resulting suffix in the dictionary. Prefixes
and ticket numbers do not matter. Suffix matching is case-sensitive.
A missing dictionary entry means a static, fully opaque frame 0 without
a recurring timer. To add a new rate, insert one dictionary entry.

`agentFaviconHeartbeatCadence()` produces milliseconds, or null;
`agentFaviconFrameTimeOffset()` converts that cadence into the existing
two-frame selector's time offset. The renderer, cache and
`get_favicon(version_key, base_type, completion_time, time_offset)`
are unchanged; DC #354 advances independent animation version to `2.1.0`.
Both existing cached frames are reused at either rate.

The title observer is event-driven, bound to the document title and
current sidebar, not the transcript. Route changes, focus and BFCache
restore also re-evaluate. Switching rates stops the previous interval,
invalidates pending asynchronous presentations, repaints once and starts
a new interval if the dictionary matches. Recording, diagnostics,
network capture, lifecycle colours and progress-ring changes are not gated.
