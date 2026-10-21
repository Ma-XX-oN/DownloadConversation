# DC #313 persistent HMAC service — consumer handoff

This documents the V2 producer/key-service interface without claiming #311
Worker queue/serializer integration, #318 UI controls, #319 convergence
certification or RWF #691 decoder ownership.

## Production entry point

`communicationPersistentHmacCurrentTabService()` now selects the
`https://chatgpt.com`-origin IndexedDB record adapter and same-origin
Web Locks. The operator explicitly accepted page-readable HMAC key storage.
The factory starts a best-effort expiry check when constructed. It checks
immediately at startup and near due time while a tab stays alive.
All service admissions independently check expiry under the same lock.
Do not claim a sleeping/closed browser executes timers.

`communicationPersistentHmacService({storage, authority, crypto, now})`
is the exact lifecycle implementation with injectable test dependencies.
`communicationPersistentHmacIndexedDbStorage(indexedDB, location)`
opens the origin's `downloadconversation-persistent-hmac-v2` database
and commits complete records in a `readwrite` transaction.
`communicationPersistentHmacIndexedDbAuthority` composes this store
with the native exclusive Web Lock. The old GM adapter and Web Locks-only
authority remain available for negative tests but no longer qualify as
the production atomic key-record authority.

A stored key is visible to other same-origin page scripts. This is an
explicitly accepted risk; key bytes never belong in recording records,
exported files, diagnostic JSON or the public HMAC marker metadata.

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

## Scientific-method evidence ledger — 2026-10-18 real browser

**Question:** Why do two Chrome/Tampermonkey tabs finish 24 operations
each under a named native Web Lock but leave the GM counter at 24
rather than 48?

**Observed facts** (operator's version 0.8.0 JSON at
`2026-10-18T19:14:05.691Z`):

- Synchronous GM: 24/48, and 24 after 500 ms, FAIL.
- Asynchronous GM: 24/48, and 24 after 500 ms, FAIL.
- Sequential bidirectional GM visibility: peer saw leader write
  FALSE; leader saw peer write TRUE even after 500 ms; FAIL.
- A separate explicit two-realm lock overlap test: one peer
  attempted while leader held; ZERO peer acquisitions while held;
  peer acquired after release; PASS.
- No thrown errors were reported. These facts do not identify
  which layer violates the expected atomic read/write behaviour.

**H1: two tabs can concurrently hold the named exclusive Web Lock.**
Prediction: an independent second realm acquires the lock while the
leader still holds it. The exact 0.8.0 overlap witness instead
observed ZERO overlap; H1 is **not supported for this tested pair and
test timing**, though it does not prove every other environment.

**H2: GM data visibility is delayed or stale even after a resolved
`GM.setValue`.** Prediction: an immediate peer read disagrees with
the written synthetic value, and later peer reads or remote
`GM_addValueChangeListener` notifications may reveal propagation.
Counterprediction: all peer reads (immediate/300 ms/1300 ms)
consistently see the committed new value and remote notifications
agree, without the counter recovering. Then simple propagation delay
is insufficient as an explanation.

**H3: the two tabs have completely isolated GM namespaces.**
Prediction: neither tab can observe the other's unique synthetic
marker at any time. The 0.8.0 witness showed leader reading the
peer's write, contradicting total isolation. Partial/intermittent
views remain a live possibility.

**Experiment 0.9.0**: Keep same two signed-in tabs, storage
installation, Web Lock name, and one-tab menu initiation as 0.8.0.
Add ONLY non-mutating observation of synthetic peer read at
0/300/1300 ms and remote change events, and repeat the existing
two-phase counter test and overlap control. Use a simulated coherent
GM store (positive), first-read-stale GM store (negative), and
isolated-Web-Lock negative controls in hosted tests. The hypothesis
ledger must be updated with real browser outcome BEFORE modifying
production HMAC or selecting a different authority/storage design.

**Safety boundary:** no real K, auth credentials, captured payloads,
or production recording bytes in diagnostic output or IndexedDB.
A synthetic IndexedDB/Web Locks comparison may be used later as
an **independent, nonsecret control** if existing evidence cannot
discriminate GM propagation from lock semantics. Never store K
in page-visible IndexedDB as a workaround.
 
## Adversarial negative control: stale GM reads under real lock semantics

A new independent test in `tests/persistent-hmac-key-service.test.mjs`
models two tabs with genuine serial exclusion, but delayed propagation
of Tampermonkey's own per-script-installation GM record. The model
deliberately withholds the remote value while allowing each tab to
read back its own completed `GM.setValue`.

**Predicted result if the service trusts local GM readback too early:**
both tabs successfully admit and provision distinct generation IDs/keys
for epoch 1, in violation of required equality, even though the Web
Lock never overlaps. This is a NEGATIVE CONTROL / demonstrated safety
risk, NOT positive proof of producer acceptance or evidence of an
actual disclosed private key. It is consistent with, but does NOT prove
the mechanism behind, the operator's 24/48 observation.

**Safe requirement:** no actual HMAC admission on a stale record. A
shared linearizable authority must reject or reconcile a tab whose GM
view is behind the committed version. Local `GM.getValue` readback or
Web Lock exclusivity alone is insufficient. Any proposed recovery
mechanism must preserve secrecy (no K in page-accessible storage),
survive reloads, and be verified in authenticated Chrome/Tampermonkey
against first-use, stale reader, rotation and crash interleavings.

This fixture must remain explicitly labelled a reproduction of
unsatisfied safety acceptance until a changed producer candidate
correctly fails closed or safely converges under the same test.

## Historical GM fail-closed gate (superseded by IndexedDB)

**Observed failure:** The installed Chrome/Tampermonkey witness showed
exclusive Web Locks PASS but async GM cross-tab counter 24/48 FAIL and
one-direction sequential visibility FAIL. An adversarial fixture also
demonstrated two distinct first-use HMAC keys when GM replicas diverge
despite a common properly exclusive lock.

**RED prediction:** The unverified `communicationPersistentHmacCurrentTabService`
previously allowed admission and GM key writes under Web Locks alone.
The added test requiring rejection was RED against that code.

**GREEN safeguard:** The service now requires an injected authority
claiming `linearizable-chatgpt-key-record-v2`. The available native
Web Lock adapter reports only `exclusive-chatgpt-web-lock-only-v1`,
never the stronger record-consistency capability. The actual
Tampermonkey factory therefore fails closed *before* writing or
provisioning K. Synthetic coherent-record fixtures explicitly provide
the stronger capability to test lifecycle semantics, and do **not**
certify actual GM coherence. A capability string in an injected mock
is not itself proof of a linearizable store.

**Unresolved feature:** Persistence/rotation in installed Chrome remains
INCOMPLETE. Do not re-enable this factory by simply renaming the
Web Lock capability or by assuming local GM readback is an atomic
cross-tab commit. A verified synchronization authority must be
designed and certified first; page-readable IndexedDB must not
contain any HMAC key, original credential, or recording payload.
The operator has now completed the v0.9.2 browser diagnostic.
Its observed result and limitations appear below.

## Real installed Chrome/Tampermonkey — v0.9.2, 2026-10-21

The operator returned the complete probe JSON at
`2026-10-21T15:29:59.712Z`. The actual signed-in two-tab run did not
time out. Both participants reported `complete`, 24 iterations each;
`peersReady=1`, `peersDone=1`, `peerErrors=0`.

- Sync GM: FAIL, expected 48, observed 24, observed 24 after 500 ms.
- Async GM: FAIL, expected 48, observed 24, observed 24 after 500 ms.
- Both participants first read 0, reached prior count 23 and finished
  at 24 in each mode, with no reported errors.
- Peer immediate read of leader's write: FALSE. At 300 and 1300 ms,
  TRUE. Leader saw peer's reply both immediately and after delays.
- Remote GM change events arrived in both directions. Their arrival
  is an observation, not an atomicity or ordering guarantee.
- Exclusive Web Lock: PASS, the peer requested while held and only
  acquired after release; 0 acquisitions while held.

This narrows the previous v0.9.1 timeout: the new failure is a completed
cross-tab storage-coherence test, not a stalled participant. A delayed
peer read provides direct evidence of *at least one* stale immediate GM
view. The experiment does not prove a particular internal Tampermonkey
cache design, a guaranteed 300-ms propagation bound or durability.

The native Web Lock correctly excludes simultaneous holders in its
independent control, but holding it across GM read-modify-write does
not establish that another tab immediately reads the published value.
Do not use a fixed delay, remote change events or a local GM readback
as a substitute for a verified atomic/linearizable key record.

An adversarial regression fixture in
`tests/persistent-hmac-browser-probe.test.mjs` now reproduces this
diagnostic signature with correctly shared exclusive Web Locks,
per-tab async GM counter replicas, independently delayed visibility,
and eventual remote notifications. It MUST return FAIL under those
conditions. Synthetic tests do not replace the installed-browser FAIL.

**Release gate:** At the time of the 0.9.2 GM witness the factory
failed closed. The new IndexedDB-backed factory is a DRAFT candidate,
not installed-browser certified. Actual first-use/restart/rotation
and cross-stream event-file readback remain INCOMPLETE. Do not merge
or activate the candidate based solely on synthetic hosted tests.

## Operator-authorized 23–25 hour cycle and dual-stream event contract

An initial key commits at epoch 1 and draws one random expiry timestamp
between 23 and 25 hours after that commit. Each subsequent committed
manual, scheduled or overdue rotation chooses a fresh expiry. A
`status()`, `recover()` or `admit()` call checks the deadline; an
active current-tab factory additionally schedules best-effort polls.
Browser startup after more than 25 hours is an overdue rotation.
A pending capture keeps its old immutable scope; new admissions are
fenced until it drains and the new generation commits.

`service.cycleEvents(afterEpoch = 0)` reads committed nonsecret events,
for example `{type:'hmac-key-cycle', id, generation, epoch,
occurred_at_ms, reason}`. Reasons are `initial`, `scheduled`,
`overdue`, and `manual`. The ID is deterministically
`hmac-key-cycle:<epoch>:<generation>` and is identical for all
consumer tabs. A pending rotation produces NO committed cycle event.

**Both GEN and COMM must independently persist each committed event**
with the same ID/timestamp/epoch/reason. GEN and COMM consumers must
deduplicate by stable ID on replay, acknowledge durable writes,
and detect incomplete/missing events. DC #313 provides the producer
event journal, and owners of #311/#317 and the GEN recording path must
provide actual log emission and disk readback. The Node test's
synthetic GEN and COMM arrays are contract evidence, not proof of
real recorder record insertion. Handoff comments are posted to the
respective existing issue owners.

A new independent manual probe at
`tests/manual/dc313-indexeddb-browser-probe.user.js` v0.1.0 tests
atomic 24+24 IndexedDB updates in TWO real installed browser tabs
using an isolated synthetic database. It does not read/write the real
HMAC key or recordings and does not itself certify dual-log persistence.
This probe and a later installed real-key lifecycle/GEN/COMM readback
remain required before merging #313.
