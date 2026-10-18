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
