# DC #313 persistent HMAC service — consumer handoff

This documents the V2 producer/key-service interface without claiming #311
Worker queue/serializer integration, #318 UI controls, #319 convergence
certification or RWF #691 decoder ownership.

## Production entry point

`communicationPersistentHmacCurrentTabService()` constructs a lazy service
using the current `https://chatgpt.com` origin's exclusive Web Locks and
Tampermonkey GM script storage. It has no side effects until an API call.
On another origin, unavailable browser locks, unavailable GM APIs or failed
CSPRNG, sensitive COMM processing must fail closed, not use an ephemeral key.

`communicationPersistentHmacService({storage, authority, crypto})` is the
same implementation with independently injectable test dependencies.
`communicationPersistentHmacChatgptAuthority(navigator, location)` acquires
one named exclusive same-origin lock and retains it across asynchronous GM
storage transactions. Do not use notifications as a lock. The key is stored
only in Tampermonkey script storage; do not copy it into page IndexedDB.

## Per-capture state protocol

1. Timestamp at earliest interception and preserve its original value.
2. Await `service.admit()` BEFORE admitting one logical record to the COMM
   Worker. It returns a random private `token` and immutable, nonsecret
   marker metadata: `redaction_format`, `redaction_scope`,
   `redaction_key_generation`, `redaction_key_epoch`,
   `redaction_key_storage`. Never infer a scope from timestamps or URL.
3. Send this metadata with the record to the Worker. Call
   `service.provision(token, worker)` to transfer a fresh 32-byte
   `Uint8Array` using `postMessage({type:'dc-hmac-key-v2',token,key_bytes},
   [key_bytes.buffer])`. The private key bytes do NOT belong in exported
   recordings, console diagnostics, URLs or test artifacts. `postMessage`
   success is not a Worker acknowledgement or durable disk evidence.
4. Retain the original immutable generation for that record and segment.
   Only call `await service.complete(token)` after the Worker acknowledges
   completion or explicitly records terminal failure/incomplete provenance.
   This release removes just that token and may finish a previously
   draining rotation.
5. `service.dispose()` zeroes local private snapshots. It intentionally
   does NOT assume outstanding Worker records completed. An orphaned active
   token is an explicit fail-closed recovery condition requiring a verified
   Worker terminal outcome or an approved recovery workflow.

## Rotation

`service.randomize(true)` is the confirmed user action, owned by UI #318.
It serializes through the SAME named Web Lock as admission. If active old
records remain, it returns `{state:'DRAINING',generation,epoch}` and fences
all NEW admissions. The new generation commits only after pending tokens
are conclusively released. `{state:'COMMITTED',generation,epoch}` means
the storage readback completed. `randomize(false)` must reject. Do not
show a draining response as successful rotation.

`service.status()` and `service.recover()` return nonsecret state; they
must never expose K. An ambiguous/failed storage write is reconciled
under the lock or fails closed. A stale/disconnected tab must never reset
the key or discard unknown pending records based solely on timeout.

## Required acceptance, and current limits

Frozen DC #300/#301 legacy marker vectors must still pass. Synthetic
multitab/first-use/rotation/Unicode/corruption and recovery tests run in
`tests/persistent-hmac-key-service.test.mjs`. The production factory is
exercised in `tests/persistent-hmac-factory.test.mjs`. Native Chromium
Web Locks and transferred Worker key bytes are exercised in
`tests/persistent-hmac-chromium-web-locks.test.mjs`, but its HTTP test origin
and simulated GM storage cannot certify an installed Tampermonkey userscript.

An actual signed-in Chrome/Tampermonkey two-tab, restart, and rotation
witness is a distinct required acceptance gate. The Worker serializer and
disk writer are separately owned by #311 and #317, with independent
end-to-end convergence under #319. Neither tests nor this handoff imply
production integration, full-fidelity capture or release authority.

## Installed Chrome/Tampermonkey witness — OPEN failure

On 2026-10-18 the v0.4.0 two-tab probe detected a real failure:
`peers=1`, `expected=48`, `observed=24`, `responses=1`,
`errors=[]`. Two script instances participated, but the initiating
tab did not observe all 48 protected updates. No browser acceptance PASS
can be claimed from the native Chromium synthetic-storage fixtures.

Tampermonkey's synchronous `GM_setValue` returns no promise, so
`await GM_setValue(...)` did not acknowledge a durable write. The
production factory now explicitly requires `GM.getValue` and
`GM.setValue` async APIs, with corresponding userscript grants,
and fails closed if they are unavailable. This fixes the unsupported
assumption; whether the installed extension's cross-tab storage is
actually coherent remains unproven.

The synthetic-only test userscript at
`tests/manual/dc313-production-key-browser-probe-v13.user.js`
(version 0.6.0) compares synchronous and asynchronous GM APIs in
the SAME two chatgpt.com tabs. Invoke its
`DC #313: diagnose GM cross-tab storage` menu item ONCE in the
initiating tab; the peer tab participates automatically. Do not
proceed to producer rotation or restart acceptance until the async
phase reports 48/48, with no errors, in the installed environment.
The probe stores synthetic counters and keys in its own Tampermonkey
script-installation namespace; it does not access the normal recorder's
private key or conversation/network payloads.

## Follow-up signed-in cross-tab witness — still FAIL

The operator ran the probe v0.6.1 in two actual Chrome/Tampermonkey
tabs. The screenshots show `synchronousGM` **FAIL** (expected 48,
observed 24, observedAfter500ms 24), and `asynchronousGM`
**FAIL** (expected 48, observed 24, observedAfter500ms 24).
Both diagnostic phases received the peer's completion with no errors.
The detailed records show each tab started from counter 0 and advanced
independently to around 24. Hence changing to the promise-based GM
API alone has NOT certified cross-tab persistence or locking.

The next manual probe, version 0.7.1, uses a selectable JSON panel
with **Copy JSON**, **Download JSON**, and **Close**. It adds a
sequential two-tab GM write/read visibility handshake to distinguish
a stale/isolated GM storage view from concurrent read/modify/write
interleavings. The operator should update the SAME Tampermonkey probe
and refresh both tabs before rerunning the diagnostic ONCE in Tab 1.
Never present a CI synthetic result as replacing the real FAIL.

The real recorder key remains isolated from the probe's synthetic
storage. The production HMAC adapter still requires independent
acceptance of actual two-tab coherence, restart persistence, and
safe rotation before this issue can close.

## Signed-in counter failure and Web Locks isolation witness

The operator's real v0.7.1 diagnostic at 2026-10-18T18:37:30.400Z
confirmed two live tabs. Both synchronous and promise-based asynchronous
GM counter updates returned 24/48 after 500 ms, with no thrown errors.
Both tabs independently reported 24 increments. In contrast, the
sequential visibility exchange showed leader->peer->leader readback
PASS in both directions. Therefore mere GM visibility across tabs is
not enough to establish linearizable read/modify/write operations.

The next manual probe version 0.8.0 (still at
`tests/manual/dc313-production-key-browser-probe-v13.user.js`) adds
`exclusiveWebLock` to its same copyable JSON diagnostic. Tab 1 acquires
the named exclusive lock, starts Tab 2 attempting to acquire the same
lock, and checks whether Tab 2 acquires it before release. A true
same-origin exclusive lock requires
`peersAttemptedWhileHeld=1`,
`peersAcquiredWhileHeld=0`, and
`peersAcquiredEventually=1` with exactly two responsive tabs.
A positive lock result **does not** by itself establish GM atomicity;
a negative lock result makes the producer's cross-tab authority
inadequate for production and requires an owner-scoped fix.

Synthetic regression test `tests/persistent-hmac-browser-probe.test.mjs`
includes both: a single shared lock positive test and a separate
per-tab-lock negative test. Frozen exact-source CI
`v1.11.7-issue.313.21` / `a208bdcd42ad1dede23c5bc2c9f4ddec5f729c43`
has hosted 4-stage PASS. Neither synthetic case resolves the actual
installed Chrome/Tampermonkey FAIL. Operator should update the existing
probe to 0.8.0, refresh exactly two tabs, run the GM diagnostic in
Tab 1 only, and paste the copied JSON with the new `exclusiveWebLock`
field. No screenshots necessary.
