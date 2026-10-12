# Merged recorder log export: `.mlog.zst` (schema 2)

## Scope

The combined export is a compressed, newline-delimited JSON document.
DC uses the pre-existing zstd compressor and saves with the `.mlog.zst`
extension. The separate `.log.zst` (Gen) and `.comm.zst` (Comm) formats
remain unchanged. DC's existing logging, buffering, segmented file
storage, rotation and permissions are not replaced.

## Format

The first JSONL line describes the export:

```json
{"kind":"downloadconversation-merged-log","schema":2,"ordering":"capture-sequence","start_timestamp":"2026-10-11T14:00:00.000Z","end_timestamp":"2026-10-11T15:00:00.999Z","group_uuid":null}
```

Each following JSONL line contains one consecutive run:

```json
{"source":"gen","level":"debug","records":[{"timestamp":"2026-10-11T14:01:00.000Z","message":"example"}]}
```

```json
{"source":"comm","records":[{"timestamp":"2026-10-11T14:01:05.000Z","type":"fetch_request"}]}
```

Each block has `source` (`gen` or `comm`), an optional `level`
and an ordered array of `records`. A change in source, or a change
in diagnostic level (including missing versus explicit null), starts
another block. The original `level` is omitted only from the exported
record copy when it is present in the corresponding outer block.
Original stored entries are not mutated.

Flattening these blocks in order and adding the group's `level` back
to each record reproduces the exact selected records and their source
identities. Consecutive runs may repeat source and level.

## Ordering and range semantics

Time is used solely to filter records inclusively. It is never used
to reorder them. New Gen and Comm entries share an explicit capture
position (document identity, epoch and ordinal). The merged exporter
preserves the existing order within each source. If shared capture
position evidence is missing or internally conflicts, it exports
intact source ranges and records `ordering: legacy-source-ranges` or
`ordering: source-order-conflict`; it does not falsely claim an exact
cross-source interleave.

Export Gen/Comm checkboxes are independent from the live capture settings.
The date/time UI is DC's preexisting second-resolution control. The
merged event stream is compressed, decompressed and byte-compared before
being written with the existing file/storage APIs.

## Acceptance

Issue #220 covers grouping, ordering, export serialization, integrity
and legacy behaviour. Issue #217 covers per-tab ownership; #218 the
capture mode controls; #219 the reused date/time modal; #221 final
browser and integration verification. No branch is merged without explicit
user authorization.
