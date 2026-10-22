# DC #317 — isolated Worker COMM disk format and acceptance

This is an unmerged, versioned CSC Worker storage design. It does NOT
silently migrate the existing main-thread segment store, nor treat the
experimental V1 secret-marker format as supported. The 2026-10-22 operator
decision retires V1 experimental recordings; no user files are deleted
without an explicit, confirmed Reset.

## Directory and physical records

An expressly authorized directory provides a private logical child:
`dc-comm-<namespace>`. The Worker holds one exclusive same-origin Web Lock
named `dc-csc-writer:<namespace>` throughout its active writer lifetime.

The child contains `manifest.json` plus a sequence of
`fragment-00000001.jsonl` (live raw) and
`fragment-00000001.jsonl.zst` (closed compressed), indexed numerically.
This is a new `dc-csc-comm-segments/2` manifest schema, separate from the
existing main-thread `active-a.jsonl`/`active-b.jsonl` layout. It is
intentionally a new private namespace; old incompatible recordings are not
automatically converted, overwritten or purged.

Every new physical JSONL fragment begins with precisely one metadata row
before any other content:
`{"version":{"comm":"<build>","gen":"<build>"},"key_restart":"<UTC>"}`.
The exact canonical ISO timestamp comes from DC #313's persisted producer
key activation; the writer does not create a timestamp or random generation
identifier. A late-opened fragment repeats the same timestamp. Rotation
closes and independently verifies the previous physical fragment.

A raw append is acknowledged only after the File System Access writable
has closed and exact appended bytes were read from disk. A closed fragment
is Zstd-compressed in the dedicated Worker using the pinned DC compressor,
read back and decompressed, and compared with its raw source before raw
retirement. The manifest stores SHA-256 for each sealed compressed archive
and is independently read-back-verified after each update. Historical
archive digest mismatches fail closed.

The serialized Worker queue tracks real pending count/bytes. Queue
acceptance, serializer status and durable on-disk status are separate
events; a missing or failed write cannot be marked durable. Terminal
capture IDs and committed cycle event IDs are reconstructed from
physical fragments after restart.

## Failure and recovery

A crash after successful Zstd archive creation but before raw deletion
can leave both variants of one numbered fragment. Recovery independently
compares the raw physical bytes with the decompressed archive, then removes
the redundant raw source. A mismatch preserves both files and rejects
startup. Duplicate completed capture IDs and HMAC cycle IDs are rejected
or idempotently acknowledged. A torn or unterminated capture fails closed;
the source is retained for explicit recovery, never silently discarded.

A malformed/missing manifest alongside existing fragments fails closed.
A truly empty new child directory receives a new manifest. A confirmed
Reset first persists `reset_pending:true`; any interrupted deletion can
resume under the same authority after restart. Reset is refused without
the explicit confirmation flag and does not change the producer key.

Snapshot seals the current complete capture boundary and returns an
immutable sorted archive name/SHA-256 inventory. Rename changes only
`logical_name` in the durable manifest, never physical fragments.
Duplicate copies the complete sealed COMM fragment set and manifest into
a distinct authorized `dc-comm-duplicate-<id>` child, using bounded file
chunks and byte-by-byte disk readback. It will not overwrite a collision;
partial copies are cleaned up. This Worker-level directory duplicate is
NOT a single-file combined GEN+COMM export.

## Ownership, testing and limitations

DC #317 owns this Worker filesystem leaf, draft PR #358. DC #311 owns the
serializer; DC #313 owns the exact shared `key_restart` producer. The
historical #311 Worker schemas still expect pre-revision random generation
and Tampermonkey storage metadata; #359 owns cross-leaf assembly and
reviewed contract reconciliation. #319 certifies actual installed,
assembled production GEN+COMM readback. The separate GEN exporter,
control-plane popup and combined duplicate packaging are not implemented
by this isolated Worker leaf.

Synthetic Node tests prove exact framed data, 10MiB segmentation, repeated
101MiB sources, corruption/restart, Web Lock contention, dual raw/archive
crash recovery, manifest digest checking, durable snapshots, rename,
copy and confirmed reset. Synthetic tests do not prove installed
Tampermonkey/CSP/FileSystemDirectoryHandle behaviour. The opt-in Test-menu
`CSC Worker disk writer` test asks the user to choose a directory, writes
only synthetic data through the native Worker Zstd and filesystem path,
checks its exact physical readback, then deletes its uniquely generated
test directory. Never run it automatically without a user gesture.

Still pending: signed-in Chrome/Tampermonkey operator witness, production
#359 assembly, independent #232 performance and tee-backpressure
measurements, and #319 end-to-end certification. Neither hosted
synthetic PASS nor an open draft PR authorizes merge or activation.
