# DC #313 persistent HMAC service — current contract

This document replaces the obsolete compatibility-first handoff.
The operator retired V1 secret-marker recordings on 2026-10-22 and
will discard old experimental log files.  No legacy V1 decoder,
migration or replay adapter is required.  Historical issue evidence
is retained in issue comments, not as executable backward compatibility.

## Production entry point

`communicationPersistentHmacCurrentTabService()` selects the
`https://chatgpt.com`-origin IndexedDB record adapter and same-origin
exclusive Web Lock.  The factory schedules best-effort expiry polling.
Every admission/status independently checks expiry under the lock;
closed/suspended Chrome cannot execute timers.

`communicationPersistentHmacService({storage, authority, crypto, now})`
implements a testable core lifecycle.  It persists a single current
version `dc-secret-key-record/3` in
`downloadconversation-persistent-hmac-v3`.  The complete record has
a random 256-bit HMAC key, a single activation timestamp
`issued_at_ms`, current epoch, pending admission tokens, due time
and committed cycle-event journal.  It intentionally has NO random
generation identifier and accepts NO previous generation-ID record.
The operator explicitly accepts same-origin page access to stored K.

## One authoritative public key boundary

`key_restart` is the UTC ISO timestamp
`new Date(issued_at_ms).toISOString()`.  It is derived from the
persisted key activation time; neither GEN nor COMM creates its own
timestamp.  First use, due/overdue rotation and confirmed Randomize
change key material and `key_restart` together.  Identifying timestamps
must be strictly increasing even if two consecutive rotations occur
within the same wall-clock millisecond.  Ordinary reloads do NOT change
the key or timestamp.

A logical capture is admitted under exactly one key and one timestamp.
`service.admit()` yields only a private random admission token and
nonsecret metadata: `redaction_format`, `key_restart`,
`redaction_key_epoch` and `redaction_key_storage`.
Do not reinterpret `redaction_key_epoch` as a second random identity:
it is strictly an internal ordering/replay index.

`service.provision(token, worker)` transfers a fresh 32-byte key
snapshot to the dedicated COMM Worker, never to the log.  Successful
`postMessage` is NOT a Worker or disk acknowledgement.
`service.complete(token)` may be called only after the Worker has
independently proved terminal success or explicit failure/incomplete
provenance for that record.  `dispose()` zeroes local key copies but
does not discard unknown outstanding admissions.

## Rotation, safe draining and interrupted operations

`randomize(true)` requires explicit user confirmation.
Scheduled/overdue rotation requires no confirmation.
Each key draws its own cryptographic due time from 23 to 25 hours
after activation.  When old work is pending, a requested next key
remains uncommitted, new admissions fail closed and old work stays on
the original key and timestamp.  The next key can activate only once
pending work is conclusively released.  On an interrupted write, the
service read-verifies inside the same authority or fails closed.
It must never assume a crashed tab's pending token has finished.

The service exposes `status()`, `recover()` and
`cycleEvents(afterEpoch)`.  A committed event is
`{type:'hmac-key-cycle',id:'hmac-key-cycle:<key_restart>',key_restart,
epoch,occurred_at_ms,reason}`.  One event is created per committed
activation, never for an uncommitted draining proposal.
The event ID is stable for idempotent GEN and COMM consumption.

## Recording format obligations

- Every COMM fragment's metadata header MUST have `version` and
  `key_restart` before any COMM record from that fragment.
- Every GEN segment MUST have a `key_restart` entry alongside the
  initial `version`, before any GEN content under that key.
- Both streams MUST use exactly the same persisted activation
  timestamp.  A late-opened fragment within the same key cycle
  repeats the same `key_restart`.
- Every committed key rotation creates a new recording boundary.
  Writers must seal the old fragment, preserve its key association
  for outstanding work, and begin a new fragment under the new key.
- The raw HMAC key MUST NOT be present in either recording, a
  diagnostic, a URL, a manifest or a marker metadata header.
- If a file was only queued, never falsely report durable write.
  Idempotent replay and incomplete records remain mandatory.

DC #313 owns the producer and event-source contract.
DC #317 owns COMM Worker disk writing and receipt handling.
DC #318 owns control-plane binding and Randomize confirmation.
DC #319 independently certifies actual assembled GEN+COMM file
contents, startup headers, sequence boundaries, repair/replay and
record identity under one exact tested candidate.  No merge without
explicit user authorization.

## Acceptance evidence and limits

Synthetic fixture tests use only public dummy data and the actual
service source.  Real Chromium tests use native IndexedDB/Web Locks,
synthetic key bytes and a retained on-disk Chrome profile, but the
localhost test origin is not the installed Tampermonkey sandbox.

The operator's old installed v0.1.4 lifecycle PASS verified the
earlier *random generation ID* implementation.  It cannot be reused
as proof that the newly changed `key_restart` metadata and physical
GEN/COMM header integration are correct.  Historical Chrome/GM
counter failures and recovery investigations are recorded on DC #313
and remain useful engineering evidence without V1 replay support.
