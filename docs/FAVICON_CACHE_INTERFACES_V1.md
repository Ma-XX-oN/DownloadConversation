# DC favicon cache — frozen provider/consumer interfaces V1

Owner: DC #332.  Asset producer: DC #333.  Cache provider: DC #334.
Runtime consumer: DC #335.  Final verification: DC #336.
Precedent: DC #328, plus inherited DC #148, #174, #288 and #295.

**Status: FROZEN V1.**  An interface change requires a new numbered contract
revision and explicit rebinding of affected speculative consumers.  This
document is a design/implementation contract, not a claim that its runtime
has been implemented or certified.  Never close dependent tickets while their
predecessors are unfinished; never merge without explicit authorization.

## A. Asset pack and catalogue — #333 provides, #334 consumes

### A1. Dataset selection

The DC repository serves a UTF-8 JSON catalogue at a documented stable URL.
The catalogue has exactly this V1 model (field ordering is not significant):

~~~json
{
  "schema": "dc-favicon-catalogue-v1",
  "datasets": [
    {
      "version": "1.11.7",
      "update_every_ms": 250,
      "favicons": {
        "commit": "<40-hex-character-immutable-Git-commit>",
        "path": "assets/favicons/v1/<name>.dcfav",
        "bytes": 12345,
        "sha256": "<64-lowercase-hex-characters>"
      }
    }
  ]
}
~~~

Placeholder values above illustrate types, not actual generated assets.

- Each `version` is a minimum compatible **major.minor.patch** boundary.
  Parse three nonnegative decimal integer components; reject malformed or
  unsafe values.  Never compare, sort or otherwise use an `-issue.*` suffix
  (or any suffix) for dataset selection.  `1.11.7-issue.9.90` and
  `1.11.7-issue.123.1` both select exactly as `1.11.7`.
- Choose the greatest dataset boundary `<=` the running DC triplet.
  No boundary at or below the running version means no matching dataset.
  Reject duplicate normalized boundaries, even if their suffixes differ.
  Catalogue changes must not silently alter an already published boundary:
  incompatible images require a higher minimum compatible version.
- `update_every_ms` is a positive integer that limits normal **scheduled**
  updates.  It is not a dataset identity field or a PNG lookup key.
  Immediate lifecycle changes (completion, error, acknowledgment) still
  request an update without waiting for the next scheduled pulse.
- `favicons` describes binary assets external to the userscript.  No
  Base64 PNG table, pixel bytes or `pulse_period_ms` field is permitted.
  `commit` pins the raw GitHub asset URL; verify the declared byte count
  and SHA-256 before importing any image.  The userscript may contain only
  the catalogue URL, schema identifier and loader code, not the images.
- A failure to download/parse a catalogue yields an unavailable dataset,
  not a guessed version or an alternative image.

### A2. Binary `.dcfav` pack

One pack is downloaded per selected dataset (not 588 HTTP requests).
The packed byte sequence is:

~~~text
8 bytes   ASCII "DCFC0001"
4 bytes   unsigned little-endian JSON header length H
H bytes   canonical UTF-8 JSON pack manifest
N bytes   concatenated PNG blobs (binary payload)
~~~

Manifest JSON is UTF-8, no insignificant whitespace, object keys sorted
recursively, and indexes use zero-based offsets relative to the first
payload byte after the JSON header.  The exact V1 manifest shape is:

~~~json
{
  "schema": "dc-favicon-pack-v1",
  "variants": [
    {
      "id": "0",
      "source_sha256": "<64-lowercase-hex-characters>",
      "width": 32,
      "height": 32,
      "images": [
        [
          [
            { "offset": 0, "bytes": 1234 }
          ]
        ]
      ]
    }
  ]
}
~~~

The small `images` example abbreviates the dimensions.  The **actual**
`images` shape is exactly [4 base colours][7 pie steps][21 pulse frames].
Each leaf has integer `offset` and `bytes`; these index distinct PNG
byte spans within the payload.  Offsets and lengths must be in bounds,
nonoverlapping and cover the payload exactly.  PNG signatures and decoded
dimensions must match the manifest.  Manifest sizes, counts and total pack
bytes must have explicit bounded validation before allocating memory.

- Base colour indexes: **0 yellow (processing), 1 green (completed),
  2 red (error), 3 white (acknowledged)**.  The untouched stock icon is
  not a recoloured state; DC restores its original href.
- Pie indexes: integers **0..6**, representing completed 5-minute steps,
  saturated at a full, red 30-minute circle.  Zero has no pie or ring.
- Pulse indexes: integers **0..20**.  Each frame captures the complete
  coloured logo + pie + ring, with composite cosine opacity ranging
  between **0.5 and 1.0**.  V1 pulse period is ten seconds and its
  samples occur every 250 ms; that waveform is part of the image contract,
  not a catalogue field.  Frame 20 is the minimum.
- The generator must reproduce existing source pixel semantics:
  recolour visible near-white pixels from the pinned original;
  draw the pie behind the logo, ring above it; then multiply *all*
  composite pixel alpha, preserving non-white original RGB.
  Unchanged original icon is never generated by recolouring a frame.
- `variants` correspond to distinct, pinned original favicon resource
  **byte digests**, not just browser link URLs.  `source_sha256`
  identifies original fetched resource bytes, not generated output.
  The variant id is internal; it is not a parameter of `get_favicon`.
  A different original icon must never silently reuse another image.
- Real pinned source bytes, actual dimensions, asset hashes and the
  catalogue's published version boundary are deliverables of #333.
  A speculative consumer may use synthetic fixtures implementing this
  shape, but must later validate against the genuine #333 pack.

### A3. Transport and validation

- Fetch the repository catalogue and immutable binary pack using the
  existing authorised Tampermonkey/network mechanism with binary
  `ArrayBuffer` support.  Source and assets are HTTPS GitHub URLs.
- Validate complete pack hash, byte length, magic, manifest schema,
  dimensions/indexes and every indexed PNG before marking the dataset
  ready.  Reject malformed, truncated, tampered or mismatched packs.
- Store PNG bytes as native `Blob` values with type `image/png`.
  No Base64 and no image decoding/re-encoding at read time.
- #333 owns generator and format conformance.  #334 must not revise
  this shape silently; changed format means V2 and rebinding.

## B. Shared cache — #334 provides, #335 consumes

The public, promised version-resolution API is:

~~~ts
get_compatible_version_key(version: string): Promise<string | null>
~~~

A resolved string is the selected dataset's exact normalized
`major.minor.patch` minimum-version key.  `null` means no matching
validated dataset is available.  On catalogue/network failure, fail
closed and diagnose; do not choose a guessed version.  Successful
resolutions are memoized per tab by numeric triplet.  A cached version
key is not proof that its PNGs still exist in IndexedDB.

The exact **internal** cache-provider boundary to #335 is:

~~~ts
open_favicon_dataset(version_key: string): Promise<FaviconDatasetSession | null>

interface FaviconDatasetSession {
  readonly version: string;             // normalized minimum boundary
  readonly update_every_ms: number;     // scheduled pulse interval, ms
  find_variant(source_sha256: string): string | null;
  read_png(
    variant_id: string, base_type: 0 | 1 | 2 | 3,
    completion_time: 0 | 1 | 2 | 3 | 4 | 5 | 6,
    pulse_index: number                // integer in [0,20]
  ): Promise<Blob | null>;
  close(): Promise<void>;
}
~~~

`null` indicates a missing, invalid, unmatched or temporarily
unavailable dataset/variant/frame.  Errors are reported through bounded
diagnostics, not silently substituted with a different state's image.
`find_variant` is an **internal** operation; no caller-facing
`source_favicon_key` exists.  #335 obtains resource-body digests when
original favicon links are initially observed/changed, never on each
250 ms pulse.  Unknown or inaccessible source bytes remain untouched.

### B1. Storage and concurrency

- One origin-scoped IndexedDB database with schema-versioned stores:
  collection metadata keyed by dataset `version`, and PNG `Blob`
  entries keyed by (`version`, `variant_id`, `base_type`,
  `completion_time`, `pulse_index`).  The update interval is **not**
  included in these keys.  The catalogue and original resource identity
  live outside the public `get_favicon` call.
- Initial cold-load uses an exclusive dataset-specific Web Lock,
  rechecks IndexedDB under the lock, downloads/validates once and
  atomically commits PNG records and a ready metadata marker in a
  single readwrite transaction.  Any failed/aborted write cannot
  publish readiness or half a collection.  Another tab waits and
  rechecks rather than downloading a second copy.
- A live `FaviconDatasetSession` holds a **shared** lock with the same
  dataset-specific name until `close()`.  Expiration/import need the
  exclusive lock.  Acquire/recheck under the shared lock after initial
  loading to avoid a gap where a cleanup can remove the dataset.
  Never hold a lock across network fetch while *also* holding an
  IndexedDB transaction; prepare/verify the pack before the transaction.
- `read_png` retrieves one selected Blob only on a local cache miss;
  #335 may maintain per-tab object URLs for frames actually requested.
  No full-table per-tab preload.  Reusing a previously displayed frame
  requires no IndexedDB read.
- Metadata `last_used` is epoch milliseconds.  Update it at initial
  successful dataset use and thereafter **no more frequently than
  once per 600,000 ms** per dataset.  Each cleanup pass removes a
  dataset only when `now - last_used > 600000` and only while holding
  the exclusive dataset lock and rechecking timestamps.  An active
  shared session prevents eviction, including when its touch was
  throttled.  Run cleanup on startup and periodically; a cached
  version key can trigger redownload after eviction.
- `close()` waits for outstanding reads, releases the shared lock and
  does not break currently displayed Blob URLs; the runtime revokes
  object URLs when they are replaced/retired.  If Web Locks or durable
  storage is unavailable, fail closed to the stock favicon; never
  introduce a race-prone alternate storage path.
- #334 provides offline fixtures and negative tests for interrupted
  writes, two tabs, mixed DC versions, stale data, hash failures and
  lock ordering.  Synthetic tests do not certify real #333 integration.

## C. Favicon presentation API — #335 owns and exposes

~~~ts
get_favicon(
  compatible_version_key: string,
  base_type: 0 | 1 | 2 | 3,
  completion_time: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  time_offset: number                   // monotonic milliseconds
): Promise<ReadonlyArray<{ link: HTMLLinkElement, href: string }> | null>
~~~

It returns the selected native PNG object URL for each recognized
original `link[rel~="icon"]` candidate, paired with that exact link.
Multiple candidates are handled internally so Chrome may choose by
`media`/`type`/`sizes`; unrecognized candidates are **not**
modified.  `null` means no compatible image was safely resolved.
The runtime restores original hrefs rather than displaying guessed
images.  It never appends a generic replacement icon link.

Frame selection is internal to this function:

~~~text
phase_ms = ((time_offset % 10000) + 10000) % 10000
slot = floor(phase_ms / 250)                  // 0..39
pulse_index = min(slot, 40 - slot)            // 0..20..1
~~~

Only finite time offsets are valid.  The caller passes the actual
monotonic offset (as existing `performance.now()`-based pulse did);
it never selects a pulse index itself.  `completion_time` is an
already-derived **5-minute progress index**, not a timestamp.  The
lifecycle adapter derives/saturates it from the authoritative stopwatch,
not a separate timer or lifecycle observer.

- #335 starts/stops periodic calls using `update_every_ms`, skips
  unchanged `href` values and performs immediate updates for state
  changes.  No 250-ms canvas work, pixel access or PNG encoding.
- A monotonic render generation token rejects late async responses
  that would undo a newer colour, error, focused acknowledgment or
  processing state.  The adapter must preserve the shared existing
  Agent lifecycle consumer rules and source favicon provenance.
- A successful normalized terminal after observed processing becomes
  green.  Focused completed tab becomes white.  An error becomes red
  even after a successful final.  `NOT_STREAMING` on reload does not
  infer completion.  A new processing event becomes yellow.  Explicit
  original restoration reuses captured stock hrefs.
- #335 may keep a bounded, per-tab URL cache of previously requested
  Blob URLs and dispose it on navigation/replacement; its cache is
  **not** a separate copy of all 588 PNG byte records.

## D. Speculative bindings and convergence

- DC #333 owns A.  It is ordinary leaf work; it cannot claim that
  consumer tests certify its real asset pack.
- DC #334 may build/test against **A V1** speculatively before #333
  finishes.  It remains canonically blocked by #333.  It must rerun
  genuine pack download/integrity/import tests at #333's exact source
  and asset revisions before DONE.
- DC #335 may build/test against **B V1** speculatively before #334
  finishes.  It remains canonically blocked by #333 and #334.  It must
  rerun real shared-cache and lifecycle tests with those exact upstream
  artifacts before DONE.
- DC #336 prepares acceptance tests in parallel; final certification
  requires real integrated builds, exact packaged userscript bytes,
  hosted CI and a real ChatGPT/Chrome performance comparison.
- Any change in A or B must be captured in a new numbered contract,
  invalidate affected speculative consumer claims and require explicit
  revalidation.  No guessed semantic compatibility, automatic
  dependency retirement, issue closure or merge.
