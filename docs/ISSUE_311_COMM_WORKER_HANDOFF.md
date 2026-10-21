# DC #311 — Worker COMM processing integration handoff

Scope: Worker-local COMM queue, selector, transport-aware sanitizing
serializer, privacy/omission provenance and staged HMAC keys. This is
not an end-to-end CSC archive or a replacement for DC #317's writer.

## Upstream and ownership boundaries

- DC #309 certified ingress source:
  `22a889e9872a1eb21fb750de9cf8619c2b3fb0c7`.
- The page's stock Request/Response remains unmodified.
- Plugin owns one native clone when it needs body bytes.
- COMM owns one distinct native clone when it needs body bytes.
- COMM transfers that clone's `ReadableStream` to a dedicated Worker.
- No page-owned COMM queue, body read, selector, sanitizer or compressor.
- DC #311 does not own DC #310 plugin delivery, DC #313 key producer,
  DC #317 writer/segment/rotation or DC #232 performance certification.

Current implementation lives in the three concatenated production
`04-csc-comm-worker-processing*.js` modules and exports
`cscCommProcessingWorkerSource()` to an eventual Worker bootstrap.

## Production bootstrap handoff (not activated in this branch)

1. DC #317 must define `self.cscCommWriteChunk(bytes)` INSIDE the
   dedicated Worker as an asynchronous writer interface. It must
   acknowledge ordered writes, handle backpressure and report
   corruption, rotation and durability independently.
2. The bootstrap must append the result of
   `cscCommProcessingWorkerSource()` after the writer implementation
   and start the Worker under an allowed userscript/browser CSP.
3. DC #313's admission service binds the record to an immutable
   generation and sends the private bytes only in
   `postMessage({type:'dc-hmac-key-v2',token,key_bytes},[key_bytes.buffer])`.
4. The Worker responds with `csc-comm-key-ready` for the private token.
   The event envelope must include `hmac_token`,
   `redaction_format: dc-secret-marker/2`, 32-hex identical scope and
   generation, a positive integer epoch and the declared storage scope.
5. The page sends an already-structured-cloneable
   `csc-comm-capture` envelope and, for Request/Response, transfers
   the COMM native clone's existing `body` stream. It does not read
   the body or add a third clone. The first COMM queue is in the Worker.
6. The Worker emits a nonsecret `csc-comm-status` acknowledgement.
   All current processor statuses advertise `durable: false`.
   DC #317 must separately certify durable bytes and section integrity;
   neither enqueue nor this acknowledgement is durable-file evidence.
7. Integrate `communicationPersistentHmacCurrentTabService().complete`
   only after a generation-bound terminal acknowledgement, retaining
   old generations until they drain. Never record the private token,
   raw HMAC key, original credentials or private network fixtures.

This #311 PR intentionally does NOT call `cscBindCommWorker` for live
traffic. Enabling it without #317's sink and #313's proven multi-tab
key consistency would replace the legacy recorder with incomplete logs.

## Worker message and record schemas

Control messages:
- `csc-comm-configure`: options = {mode, origin, binary,
  cross_origin, auth_headers, all}. `all` enables the three options.
- `dc-hmac-key-v2`: private admission token and transferred key bytes.
- `csc-comm-capture`: immutable ingress event and available body.
- `csc-comm-status`: capture ID, original sequence, status,
  reason, nonsecret source/emitted counts and `durable: false`.

The synthetic test-only `csc-comm-provision` message is retained for
isolated fixtures; production must use the fenced #313 token path.

The sanitizing serializer emits JSONL frames, not intermediate
unsanitized archive files:
- `csc-comm-start` declares marker version/scope/generation/epoch,
  capture identity, original timestamps, sanitized URL and headers,
  omission metadata and binary framing type.
- `csc-comm-body` contains a bounded safe text fragment or an exact
  per-fragment Base64 representation of accessible binary bytes.
- `csc-comm-end` carries source counts or explicit incomplete/failure
  provenance, separate from already emitted archive bytes.
- `csc-comm-selection` records an unavailable, excluded, unsupported or
  rejected body WITHOUT writing source values or credential headers.

The selector uses `selected`, `unselected`, `unsupported`,
`inaccessible`, `rejected`, `failed`, and `completed` as distinct
outcomes. The full-mode label must never imply that unsupported or
inaccessible bytes were recorded. Unsupported secrets fail closed.

## Provenance and limits

- Source capture timestamps are inherited, never replaced with
  Worker enqueue/read times.
- Stream byte counts are from observed binary chunks before
  sanitization. Serialized JSONL frame counts measure emitted bytes.
- Browser-parsed XHR JSON has NO original wire-byte count. The
  serializer walks parsed values and feeds the SAME incremental JSON
  sanitizer, with `source_bytes: null`, an explicit provenance label
  and a separately measured derived UTF-8 byte count.
- A browser-provided text string has a derived UTF-8 byte count, not
  a claimed original network-wire byte total.
- Binary ArrayBuffer, typed-array and Blob classes are selected by
  value as well as content type. No page-owned ArrayBuffer is
  transferred or detached.
- The JSON candidate limit is 1 MiB and nesting depth is capped.
  Malformed JSON/SSE and unsupported sensitive spans fail closed.
- JSON/SSE/WS text and HTTP query/header contexts are distinct.
  Unsupported text/plain and multiline SSE are explicitly labelled,
  not silently stored with a false "complete" status.
- Descriptor queue admission currently has a finite upper bound.
  Rejection reports `csc-worker-queue-full`, but queue saturation is
  not a substitute for the #317/#232 measured backpressure gates.
- Opaque cross-origin responses are unavailable even with cross-origin
  options. No user credentials or original private captures belong
  in source control or diagnostics.
- Existing frozen V1 marker grammar is retained under separately
  versioned V2 persisted-key metadata. Old legacy `[redacted]`
  remains opaque.

## Evidence levels and outstanding acceptance

Hosted Node tests exercise streaming JSON/Unicode, SSE, binary
fidelity, WebSocket ArrayBuffer/Blob, XHR parsed JSON, selected/
unselected options, HMAC checks, negative redaction and a sink that
actually rejects writes. Their result is source/commit specific.

The built-in `CSC COMM Worker processor` row is an OPT-IN,
synthetic-only Chrome/Tampermonkey capability probe. It verifies a
real Worker, transferred native cloned stream, V2 token provision,
524299 deterministic bytes and untouched stock response. It does
NOT test a real directory handle, Zstd durable writer, installed
multi-tab GM consistency or live private network recording.

Required independently owned downstream evidence:
- DC #313: installed two-tab and cross-reload/rotation key coherence.
- DC #317: Worker file handle, compressor, durable byte verification,
  rotation, errors, 10/23/40 and repeated >100 MiB streaming.
- DC #232: measured responsiveness, tee/backpressure and stalls.
- DC #319: exact end-to-end assembly, live browser and final parity.
- DC #311: installed exact-candidate browser synthetic probe witness.

No PR merge, production activation, successor takeover or completed
end-to-end CSC claim is permitted by this handoff.

## Committed HMAC key-cycle event handoff (DC #313)

The Worker receives `{type:'csc-comm-key-cycle',event}` where `event`
is a committed nonsecret `service.cycleEvents(afterEpoch)` entry:
`{type:'hmac-key-cycle',id,generation,epoch,occurred_at_ms,reason}`.
The ID is `hmac-key-cycle:<epoch>:<generation>`; reasons are initial,
scheduled, overdue and manual. Pending rotations must not be sent.

This Worker validates exact nonsecret fields, queues events alongside COMM
descriptors and writes an `hmac-key-cycle` JSONL record through the same
Worker sink. Unknown and private fields fail closed; same-Worker duplicates
are suppressed. Every `csc-comm-cycle-status` ack is `durable:false`,
including successful sink acceptance, because no disk flush/readback occurs
in this leaf. DC #317 must guarantee persistent cross-restart/tab
deduplication, file verification and durable acknowledgement. The GEN
writer separately persists the same event; DC #319 must verify matching
IDs/timestamps and no missing or premature events on actual file readback.
