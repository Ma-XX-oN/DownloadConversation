# Private secret-marker contract — V1 (DC #300)

This document is the shared **specification**, not an encoder or decoder.
Fixture schema and values live in `tests/fixtures/redaction-marker-v1.json`.
Version identifier: `dc-secret-marker/1`. Breaking changes require V2.
Source scope: DC communication recordings only; never transcript exports.

## Record and scope

Each V1 communication-recording segment declares
`redaction_format: "dc-secret-marker/1"` and
`redaction_scope: "<32 lowercase hex digits>"` in segment-level metadata,
which is available to the decoder before any marker. This is a random
128-bit public *identity label*, not a hash of the key. A recorder instance
is a single document-start execution. Each instance obtains independently
random 256-bit `K` and the public scope through a cryptographically secure
random source. Never persist, log, export or reuse `K` across reloads.
A reload rotates both values. A single instance retains its scope while
capturing multiple requests, responses and chunks. A new recording segment
within the same instance retains the scope. Unknown/missing/mismatched
format or scope is a hard failure for V1 decoding; no default to V1.
Legacy `[redacted]` remains literal opaque legacy data: its length and
equality cannot be recovered.

## Marker grammar and canonical bytes

A marker is the literal ASCII text `[CHECK/TYPE/ID]` or
`[CHECK/TYPE/ID/PARAMS]`. Brackets, slashes and lowercase characters
are literal, not URL-encoded. The grammar is:

- `CHECK`: exactly 32 lowercase ASCII hexadecimal digits.
- `TYPE`: exactly one uppercase ASCII letter in the registered V1 set
  `U,H,B,P,J,O`.
- `ID`: exactly 48 lowercase ASCII hexadecimal digits.
- `PARAMS`: nonempty ASCII characters `[a-z0-9,]`, length at most 256,
  with an exact type-specific canonical validator. `PARAMS` MUST be absent
  for the two fixed types, never an empty final slash.
- No whitespace or extra characters; the entire candidate must match.
  Maximum marker length is 1+32+1+1+1+48+1+256+1 = 342 ASCII chars;
  implementations reject any candidate longer than this bound.
- `BODY` is exactly `TYPE + "/" + ID` with `"/" + PARAMS` appended
  only when present. Use ASCII/UTF-8 bytes (equivalent for this grammar).
- `CHECK = lowerhex(first 16 bytes of SHA-256(
   UTF8("DC-SECRET-MARKER-V1\\0") || ASCII(BODY)))`.
  The notation `\\0` in that displayed string denotes **one 0x00
  byte**, not backslash and digit zero.
- `ID = lowerhex(first 24 bytes of HMAC-SHA-256(K,
   UTF8("DC-SECRET-ID-V1\\0") || uint32be(byteLength(value)) ||
   UTF8(value)))`. Length is an unsigned four-byte big-endian integer;
   accept at most 1 MiB of candidate bytes and reject larger input.
   No NFC/NFD conversion, case folding, whitespace trim or re-encoding:
   `value` is the complete logical unescaped secret string.

`CHECK` detects accidental marker-shaped text corruption, NOT a malicious
forgery or authenticity; the checksum is public and unkeyed. Never infer
a secret, its equality or origin merely from an apparent marker unless
the record format/scope is declared and the entire marker validates.

Parser: scan left to right, accumulate at most 342 characters after a `[`.
A `[` not starting the exact grammar remains ordinary literal text,
including `[[`. A string shaped like a marker but with invalid checksum,
unknown type, noncanonical parameters or unsupported V1 version is
**not decoded**; preserve ordinary literals only where the container is
declared nonsecret, otherwise flag the containing captured value invalid
and fail closed. Never silently treat a checksum mismatch as verified data.
A valid checked marker inside V1 enabled text is reserved syntax and is
decoded; there is intentionally no bracket escaping. Producers must reject
literal text accidentally matching a valid marker (collision), rather
than silently changing it. Decoder cannot distinguish a deliberately
forged valid marker; it must not use markers for authentication.

## Registry, contexts and order

Each registered type has `contexts: { "context.id": true }`,
`identify(text,context)`, `reconstruct(params,randomSource)` and strict
validate/length routines. The dispatcher uses the actual transport and
parsed medium, not assumed JSON. The context IDs in V1 are:
`http.header.value`, `http.query.value`, `json.string`,
`sse.data.json.string`, `sse.data.text`,
`ws.text.json.string`, `ws.text.plain`, `text.plain`.
Headers are parsed into individual complete value spans; URL query
values are percent-decoded before detection and re-encoded after
substitution. Parsed JSON strings are unescaped before detection;
serialize the replacement through a proper JSON string encoder.
SSE framing (`data:`, newlines, event boundaries) is never a candidate
value; parse the complete logical `data` field before dispatch.
WebSocket binary and other unknown media are unsupported/no body capture.
No V1 type is automatically enabled in every context: an application
registry must explicitly opt types into named contexts. The base
shared fixture registry enables U/H/B/P/J/O only in `json.string`,
`sse.data.json.string`, `http.header.value`,
`http.query.value`, `ws.text.json.string` for synthetic testing;
`O` is disallowed in free text and uses explicit secret-bearing
span metadata rather than guessing. Uninspected fields are NOT
automatically sanitised.

Candidate detection is full-value anchored within a typed value span,
not a substring search for arbitrary identifiers. Only matching formats
within registered contexts are candidates. Multiple valid matching
types: if types yield different valid interpretations, mark AMBIGUOUS
and fail closed; never silently pick first. Repeated same values must
get the same `ID` within one scope even across types, but cache equality
depends on `TYPE` and `PARAMS` as well. No claim is made across scopes.
Input source bytes from a secret span never appear in stored diagnostics,
error text, metadata, preview or failed-record fallback.

## Types and deterministic shape constraints

`U` (UUID): lowercase canonical 8-4-4-4-12 hex, exactly 36 ASCII chars,
hyphens at canonical positions; no params. Decoder creates synthetic
UUIDv4 with variant 8/9/a/b and version 4; the producer identifies
only canonical UUIDv4 to preserve subtype grammar.

`P` (synthetic project ID): `g-p-` followed by exactly 32 lowercase hex
digits; no params. This is a V1 *synthetic project-ID shape*, not a
claim of exhaustive recognition of current backend identifiers.

`H` (hex): lowercase `[0-9a-f]`, 2..256 even characters; `PARAMS`
is canonical decimal character count. No leading zero. Strings that
also satisfy `B` are ambiguous unless the context restricts the type.

`B` (Base64URL): unpadded `[A-Za-z0-9_-]`, 4..256 chars, length mod 4
not 1 and strict canonical Base64URL decoding/re-encoding required.
`PARAMS` is canonical decimal character count. No padding or whitespace.

`J` (JWT): exactly 3 unpadded canonical Base64URL components separated
by two dots. The first two components must decode into valid JSON
objects. `PARAMS` is `h,p,s`, three canonical decimal segment lengths,
each 4..512, sum <= 1024. The reconstruction must retain segment
lengths, preserve three-part syntax AND produce valid JSON objects
in the first two components. A length shape for which that cannot be
satisfied is unsupported and must fail closed; never emit a structurally
fake JWT under type `J`. No signature validity is promised.

`O` (opaque Unicode): only in explicitly classified secret spans,
at most 128 Unicode scalar values. `PARAMS` is the nonempty width
profile: exactly one digit `1`, `2`, `3` or `4` per scalar,
describing each scalar's UTF-8 byte width. This reveals scalar widths
and count but no original characters. Reconstruct each scalar from a
nonsecret safe pool with the same UTF-8 width; `4` uses a supplementary
scalar and therefore two UTF-16 code units. No lone surrogate, NUL
or JSON-control scalar is accepted in `O`. Profiles longer than 128
are unsupported. The bytes and UTF-16 lengths of decoded logical
values match the originals, although stored marker size differs.

The reconstructed logical value preserves `U/P/H/B/J` format shape
and original logical UTF-8/UTF-16 length. This guarantee is **not**
about raw JSON serialization: original escaping may have used
`\\uXXXX` and the replacement is reserialized canonically. For
HTTP URL-encoded data the raw percent-encoded length also need not
match. JWT is not re-signed and cannot function as an original token.

## Stream, playback and failure contract

The encoder is exactly one forward read of the original clone.
It must carry incomplete UTF-8, UTF-16 surrogate, percent-escape,
JSON escape, candidate or marker across arbitrary incoming chunks.
It buffers a candidate only up to the configured 1 MiB maximum,
withholding all candidate bytes until safe classification. If it
exceeds the maximum, encoding fails closed; no partial secret flush.
Finite prefix lookahead and bounded output chunks are allowed. A
terminal malformed parse, incomplete candidate, unsupported sensitive
value, ambiguous type, crypto error, missing key or unavailable context
produces an explicit *nonsecret* redaction failure record and drops the
affected sensitive value/body. Do not emit source fragments as fallback.
Other independently safe records remain capturable. No new network
requests are allowed. Decoder may process arbitrary chunk splits and
out-of-order records; no reference to original key is available.

Decoder `cacheKey` is the length-prefixed tuple
`(formatVersion, scope, TYPE, ID, PARAMS-or-absent)`, NOT a concatenation
without delimiters, and is stable independent of decode order.
Use a deterministic synthetic random stream keyed by the tuple's
SHA-256 (with domain `DC-SECRET-SYNTH-V1\\0`), so independent decoders
make the same replacement without `K`. This is deterministic
pseudo-randomness, NOT secret cryptographic reconstruction. Two
different IDs must not be forced equal, though format-shaped random
outputs have a nonzero collision risk; generated synthetic values
must be unique within a scope per type by deterministic collision
resolution with tuple-keyed counters. Different scopes must not
share equality caches. Within one scope a repeated identical tuple
must reconstruct to the same synthetic value and lengths.

The `byte_count` (and raw incoming chunk count) recorded by DC
describes original clone bytes BEFORE redaction. Stored marker bytes
and reconstructed UTF-8 bytes are separate measured values; never
substitute them for original source counts. `body_incomplete` is
preserved independently from redaction failures. The 1 MiB diagnostic
preview limit remains. Private recordings never enter Git. Supported
V1 requires `redaction_format` and scope; old legacy files remain
readable without pretending they have recoverable identity or widths.

## Required fixture and evidence

`tests/fixtures/redaction-marker-v1.json` stores only synthetic,
explicitly invented values, independent expected digest/checksum
bytes, marker strings and negative cases. The reference fixture
generator below is not production code. #301/#673 must consume
these exact fixture bytes/version; #302 independently runs end-to-end
cross-repository tests. A unit-green leaf is not convergence PASS.

Reference review: `Ma-XX-oN/AI-General-Memory`
`scripts/ahk-test/sanitize-fixture-log.py` at blob
`edf2e3ab381e71d09b3127ebcdf35dff261e75f0`; its
`utf8_len` and `utf16_units` demonstrate width-preserving
substitution. Avoid confusing Python codepoint counts with JS UTF-16.
