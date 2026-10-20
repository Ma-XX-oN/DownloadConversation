# Favicon browser-generated sequence interfaces — frozen V2.0

Status: **FROZEN V2.0**, DC #332, 2026-10-20.
V1 at Git blob `e2460ba2bf1c1852579782ecbb05139de32e505e`
is immutable **historical evidence only**. This V2 contract replaces the
GitHub-hosted PNG packs, binary asset catalogue, and asset download design.
Any change to these interfaces requires a separately numbered successor.

## Authorities and exact owned interfaces

- DC #333 owns `src/favicon/browser-sequence.mjs`. Its canonical interface
  is `renderFaviconPulseSequence({originalUrl,theme,base,progressStep,signal})`
  returning a Promise of
  `{originalUrl,theme,base,progressStep,width,height,frames}`.
  `frames` is exactly 21 ordered native `image/png` Blobs, indices 0..20.
  `theme` is `light | dark`; `base` is one of
  `processing | completed | error | acknowledged`; `progressStep` is
  an integer 0..6; `signal` is an optional real AbortSignal.
  The renderer performs no Web Locks, IndexedDB, DOM-icon writes or prefetch.
- DC #334 owns `src/userscript/03-agent-lifecycle/03-favicon-cache-v2.js`.
  `get_compatible_version_key(version): Promise<string|null>` selects the
  greatest registered numeric minimum boundary not exceeding the running
  `major.minor.patch`. Suffixes including `-issue.*` never affect ordering
  or lookup. `open_favicon_dataset(version_key, render_sequence)`
  returns `Promise<FaviconDatasetSession|null>`; the renderer callback is
  injected explicitly by DC #332 integration glue at DC #335's session-open
  call site. No implicit global renderer injection into the cache.
- `render_sequence(request, signal)` takes the frozen cache request
  `{version,original_favicon_url,theme,base_type,progress_step}` and an
  AbortSignal, and returns `Promise<Blob[21]>`. DC #332's sole adapter
  converts that request to the DC #333 request, awaits the actual renderer,
  asserts descriptor identity and exact 21-frame output, then returns
  `descriptor.frames`. `version` is cache identity only, not renderer input.
  No second asset source or duplicate implementation is permitted.
- Numeric `base_type` is **0=processing/yellow,
  1=completed/light-green, 2=error/red, 3=acknowledged/white**.
  The adapter maps these explicitly to the semantic renderer bases.
  This mapping is not inferred from enum/array iteration order.
- Session fields: `version: string` is normalized numeric lower bound,
  `update_every_ms: positive integer` is scheduling metadata, and
  `read_png(original_favicon_url,theme,base_type,progress_step,pulse_index):
  Promise<Blob|null>` selects only a ready frame. `pulse_index` is 0..20
  and NEVER participates in the generation lock key.
  `close(): Promise<void>` cancels pending generation and releases leases.
- DC #335 owns public
  `get_favicon(version_key,base_type,completion_time,time_offset):
  Promise<Array<{link,href}>|null>`; it snapshots the actual stock
  candidates and theme internally and opens the cache session with the
  integrated renderer adapter as the **second** argument.
  `completion_time` is integer progress step 0..6, not a timestamp;
  `time_offset` is monotonic milliseconds within the 10-second pulse.

## Local registry and delivery

- DC #332 integration owns the **local constant** registry and initializes
  the cache exactly once during startup:
  `faviconCacheV2Configure([{version:'1.11.8',update_every_ms:250}])`.
  `1.11.8` is the first V2-compatible lower bound; installed running
  `1.11.8`, `1.11.9`, `1.11.10` resolve to that same dataset.
  Additional lower bounds require an explicit source change and test.
  No remote catalogue, pack manifest or asset download determines version
  or cadence. A pre-existing other application heartbeat is not replaced.
- The canonical ES-module renderer is bundled into the deterministic
  userscript as executable same-IIFE classic-script code via a **build-time
  controlled transform**; imports/dynamic imports and runtime @require
  are forbidden. The builder must check/strip only the known named exports
  and fail on unknown import/export syntax. Never copy a second independent
  renderer or load remote runtime source. #332 owns this build glue.
- The cache provider and consumer are ordered source-manifest segments;
  provider initialization, renderer adapter and consumer binding are
  executed before any favicon lifecycle consumer call. The root userscript
  is generated and committed by the ordinary repository test cycle, never
  hand-edited. All source files remain fewer than 500 lines.

## Identity, readiness and failure

- A sequence key is collision-safe serialization of exactly
  `[selectedVersion,originalUnmodifiedFaviconUrl,activeTheme,baseType,step]`.
  The browser original URL is captured **before** any href mutation.
  Distinct original candidate URLs and distinct light/dark themes never
  share a sequence, including where one SVG URL resolves to different
  scheme-dependent pixels. No `invariant` collapse without a separate
  evidenced, explicitly versioned decision.
- The first tab granted the per-sequence **exclusive Web Lock** owns
  generation. Under the lock it rechecks cache readiness, invokes DC #333
  once on a true miss, validates all 21 Blobs, and writes 21 PNG rows and
  the complete-sequence ready marker in **one IndexedDB readwrite
  transaction**. Readiness is published only on successful commit. A
  transaction abort leaves no ready sequence; a crashed/closed tab releases
  its Web Lock so a later requester can generate.
- A missing sequence causes `read_png` to **wait asynchronously** for the
  winner/lock, then resolve its requested Blob when fully ready.
  All competing tabs keep the **untouched stock icon** until the ready
  sequence is returned and its current request is still relevant.
  Failures, aborts, missing APIs and unsupported sources resolve null
  from the cache/session with bounded diagnostics; no partial images,
  unbounded busy retry, or alternate fallback. DC #335 coalesces
  equivalent 250ms heartbeat requests while waiting; subsequent
  heartbeats retry after failure. No separate ready event is required.
- A renderer cancellation or actual matchMedia theme flip is an AbortError
  to its caller. Closing session aborts pending generation and suppresses
  stale publish; consumer rejects late results across theme/state/step,
  original link, page navigation and epoch changes.
- Exactly one *requested* missing tuple generates 21 unique half-cycle
  PNG frames. No unused tuple/theme/colour/step/version/source is rendered.
  Every 250ms scheduling slot 0..39 selects
  `min(slot,40-slot)` -> frame 0..20; 10-second cosine composite opacity
  is `0.75+0.25*cos(2*pi*frame/40)`, i.e. 50%-100%.
  Warm playback uses Blob/object URLs, not canvas/recolour/PNG encoding.

## Storage lifespan and presentation

- IndexedDB `dc-favicon-sequences-v2` v1 contains `datasets` keyed
  by version, `sequences` keyed by the five-field serialized tuple,
  and `pngs` keyed by `[sequence,pulse_index]`, with `by_version`
  indexes on the latter two stores. The 21 rows and ready marker share
  the atomic transaction. These are independent records, not one map.
- `last_used` is grouped by **selected version dataset**, persisted no
  more than once every 600000ms. A version's collection is eligible for
  eviction only when `now-last_used > 600000`; equality does not expire.
  Active sessions hold a shared dataset Web Lock; cleanup uses a
  nonblocking exclusive lock, rechecks last_used under its transaction,
  then deletes that dataset's sequences and images together.
  Other version datasets are unaffected. Session-local warm Blob cache
  and tab-local object URLs are bounded and released on close/pagehide.
- Keep every original favicon link, unmodified `media/type/sizes`
  attributes, original href restoration and actual media matching.
  Preserve existing lifecycle transitions: yellow processing, green
  completed only following page-observed processing, red normalized
  error (including after green), white focus acknowledgement, stock on
  NOT_STREAMING reload, yellow on IS_STREAMING reload. Keep progress
  ring above/logo and pie beneath for steps 0..6, legacy near-white
  recolouring and error ring suppression. No new lifecycle, network,
  stopwatch, sound or terminal observer.
- Candidate PR source evidence at freeze: #341
  `1515317c608bdcf5cd21f2cd162292237013894b`;
  #344 `3c414e72b9a959e72b4ffe98d60f4742e7846284`;
  #339 `72753078745af14943551b1c9b23bdf87944beb1`;
  #345 `4ff1241b730b86869251861950cc6f1e7c7fd5ca`.
  Standalone CI success is **not** real combined PASS.

## Certification and change control

RED/GREEN, same-origin multi-tab Chromium, actual upstream components,
theme sensitive original SVG, transaction-abort/crash takeover,
stale-async and lifecycle regressions, deterministic userscript packaging,
full hosted CI, cold/warm performance and authenticated ChatGPT acceptance
must bind exact integrated commits. No simulated fixture is a real-provider
PASS. V2 interface conformance alone does not close #333–#336 or #332.
Do not merge any PR without explicit user authorization.
