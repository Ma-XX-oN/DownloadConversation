# Persistent HMAC scope amendment — DC #312 (V2)

Status: frozen design candidate, pending independent hosted acceptance.
Base: DC #300 `docs/REDACTION_MARKER_V1.md` at
`4cd39bded9cc85ddce32617a6d5338237c6bafb1`.
This amendment does NOT change V1 marker grammar, checksums, ID derivation,
type recognition, synthetic reconstruction or historical certification.

## Version negotiation and metadata

V2 records declare `redaction_format: "dc-secret-marker/2"`,
`redaction_scope: "<32 lowercase hex>"`,
`redaction_key_generation: "<32 lowercase hex>"`,
`redaction_key_epoch: <positive safe integer>`, and
`redaction_key_storage: "tampermonkey-script-installation"` at every
immutable segment boundary, before any marker. The scope and generation
are the SAME cryptographically random, nonsecret 128-bit generation ID.
The epoch starts at 1 and increments on successful explicit Randomize.
All fields are mandatory and must be checked together; scope must equal
generation. The generation ID is never derived from K, a credential, user
ID, account ID, timestamp, or page URL. The marker body remains
`[CHECK/TYPE/ID/PARAMS]` (optional PARAMS) with the exact V1 algorithm,
including V1 domain separators. No new marker grammar is implied by V2.
The envelope's format and scope determine the decoder cache namespace.
A format mismatch, invalid scope/epoch or missing metadata fails closed.
Future format versions are not guessed. V1 keeps its exact old
`dc-secret-marker/1` metadata and per-document ephemeral key contract.
Legacy `[redacted]` is opaque, without inferred equality or length.

V2's 256-bit HMAC key K is sampled from a cryptographically secure
random source ONCE per Tampermonkey script-installation storage domain,
then reused across pages, reloads, conversations and tabs sharing that
domain. It is never stored in any recording, export, diagnostic, Git
fixture, worker message log or URL. Tampermonkey's script storage is
not a hardware security boundary: anyone with sufficient access to
the browser profile/extension storage can obtain K. Different browser
profiles, installations and incognito storage domains are not assumed
to share keys. A reinstall or cleared storage begins a new generation.

The V1 HMAC ID and CHECK algorithms remain byte-for-byte identical.
Consequently identical original secret bytes under one V2 generation
produce identical TYPE/ID/PARAMS markers across reloads; differing
TYPE/PARAMS remain separate synthetic cache entries. The cache key is
the V1 length-prefixed tuple (formatVersion, scope, TYPE, ID,
PARAMS-or-absent). V2 decoder synthetic bytes use the same V1
`DC-SECRET-SYNTH-V1\0` tuple-seeded deterministic algorithm.
No decoder receives K or original credentials. A new generation creates
a new cache namespace: equality across generations is UNKNOWN, even
when synthetic outputs happen to match by coincidence. Do not correlate
by comparing ID alone without the generation metadata.

## Atomicity, concurrency, and rotation protocol

Tampermonkey storage has no assumed cross-tab compare-and-swap or
transactional multi-key commit. Implementations MUST use a verified
cross-tab exclusive lock (for example Web Locks when actually available
to every participating script context) plus a SINGLE versioned storage
record containing K, generation and epoch. Do not claim GM_setValue
alone implements atomic compare-and-swap. Every participating tab MUST
honour the same lock and re-read the record inside it. If cross-tab
exclusivity cannot be established, fail closed: never independently
initialize competing persistent keys and label them one installation.
An implementation must verify actual Tampermonkey storage/lock
semantics in target Chrome and cover tabs racing first use.

First use: acquire lock; read+validate single record; if absent, sample
fresh K and generation, epoch=1; write one record; read it back and
compare exact bytes; only then release lock and provision the worker.
Existing valid record: use without writing. A corrupt/partial record
is an explicit error, NOT an implicit key reset. A storage exception,
unavailable lock, failed readback or crypto failure suspends affected
COMM redaction/writing, emits only nonsecret failure provenance, and
never falls back to unredacted logging.

Randomize: acquire the same lock, validate current record, sample
fresh K+generation, increment epoch (reject overflow), atomically
replace the one record, verify readback, publish a generation-change
notification. A failed write/readback must not advertise success;
if commit outcome is ambiguous, re-read under lock and reconcile before
new capture. Never roll back by overwriting a newer committed epoch.
Concurrent Randomize requests serialize; each accepted action advances
one epoch. All tabs must observe changes before assigning a generation
to newly started capture. A stale tab must not write a new segment
under old metadata after observing rotation.

In-flight safety: every captured record binds immutably to its
generation/key snapshot at capture admission. An old generation may
finish only in its own segment; no segment contains two generations.
Rotation closes the admission gate, drains or explicitly marks
incomplete all in-flight records of the old generation, seals the
old segment, and starts the new generation segment only after the
new storage record is confirmed. Key snapshots remain only in
transient worker memory until their admitted records finish; zero
references at completion/disposal. On crash/restart, do not silently
resume an unsealed old segment under the new generation. An old tab
that cannot coordinate rotation must stop sensitive COMM recording
until it has synchronized. The main-thread plugin queue remains
independent and unaffected.

## Privacy, transport, and adversarial limits

Persistent pseudonymous IDs increase cross-tab, cross-conversation
and cross-reload linkability. Warn explicitly before enabling recording
and beside Randomize: rotation ends future marker linkage but cannot
remove previously saved archives or undo correlations already made.
Randomize is not credential revocation. Keys never enter RWF; synthetic
replay is NOT authentication. HMAC protects ID guessing only while K
is secret; CHECK is an unkeyed accidental-corruption check, not a MAC.
Attacker-crafted valid markers can be forged and must never be trusted
for authorization. Keep V1 bounded candidate handling, unsupported
contexts, Unicode/framing guarantees, incomplete-body provenance and
strict fail-closed behaviour unchanged.

## Compatibility / acceptance matrix

| Input | Decode mode | Equality semantics |
| --- | --- | --- |
| V1 valid marker and V1 scope | V1 unchanged | Same instance only |
| V2 valid marker, valid V2 metadata | V2 | Same generation across reload/tab |
| V2 rotated generation | V2 | No cross-generation inference |
| V1 marker with V2 envelope | V2 only if bytes validate | No V1-scope inference |
| V2 metadata missing/invalid | Reject | None |
| Unknown format | Reject | None |
| Legacy [redacted] | Literal opaque | None |
| Malformed/forged CHECK | Reject marker | None |

Fixture `tests/fixtures/redaction-marker-v2.json` uses a PUBLIC synthetic
test key ONLY. It must never be used as a real recorder key. The
independent verifier `tests/redaction-marker-v2-contract.test.mjs`
checks HMAC/CHECK against the frozen V1 formulas, reload equivalence,
rotation separation, Unicode and every marker split, plus negatives.
Real cross-tab Tampermonkey storage and live rotation acceptance belong
to #313; decoder implementation belongs to RWF #691; end-to-end
producer/consumer acceptance belongs to DC #319.
