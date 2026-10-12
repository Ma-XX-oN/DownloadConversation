# Version provenance contract (#234)

This is a source-neutral handoff for #235–#243. The paired executable
fixtures are normative. Source owners must not silently change these shapes.

## GEN

Authority: `GM_info.script.version`. Unknown historical provenance is
`null`, never the installed version substituted retroactively.

The **exact** GEN version-transition diagnostic is an ordinary record:

```json
{"timestamp":"2026-10-12T10:00:00.000Z","level":"lifecycle","message":"dc-version-transition","data":{"version":"1.11.4"}}
```

The predicate requires `level === "lifecycle"`,
`message === "dc-version-transition"`, and an own `data.version` key
whose value is a string or `null`. The startup record is timestamped and
unconditionally appended through the shared diagnostic append machinery,
irrespective of verbosity. GEN has no separate header. A transition event
remains an ordinary diagnostic event, subject to regular order and counts.

In-memory retention is the last **10,000** records, with a separately held
`version_before_memory` describing the version effective immediately before
the oldest retained record. Persistence saves only the last **5,000** records,
alongside `version_before_persisted` describing the version immediately before
its first record. The baselines are nullable metadata and are not synthetic
diagnostic events. Updates must preserve in-window transitions and avoid
scanning all retained records on every append.

## COMM

Every new physical fragment begins with exactly one immutable, untimestamped
JSONL metadata line:

```json
{"version":{"gen":"1.11.4","comm":"1.11.4"}}
```

Either value is `null` if unknown. The header is written once when that
physical fragment is created, is unchanged after upgrade, recovery, sealing,
compression and duplication, and is excluded from ordinary event ordering,
counts and timestamp ranges. Subsequent true version changes within the
fragment are timestamped events. A later fragment carries its own creation
version. Core version is optional in existing diagnostics and not required in
version provenance records.

## Selection and export

For each stream, start with its applicable rolling baseline or fragment
header, then apply the last chronological version transition **at or before**
the selected range boundary. Preserve later transitions inside the selected
range. A transition exactly on the boundary participates. Missing historical
provenance remains `null`. The combined export starts with exactly one
untimestamped record `{"version":{"gen":...,"comm":...}}`, with no Core field.
This is metadata, not a merged event. Export does not reorder or discard
ordinary events or change their counts and timestamp range.

Fixture cases independently cover startup, upgrades, eviction, persisted
reload, in-fragment selection, historical unknowns, in-range transitions,
negative discriminator cases and header immutability. Each implementation
worker must validate its own source against these fixtures before joining.
