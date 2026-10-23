# DC #318 CSC controls — isolated leaf integration contract

Issue: #318.  Parent: #359.  Independent system certification: #319.
Branch: `issue-318-csc-controls`, based on `issue-359-csc-integration`.
Draft PR: #362.  No merge or production activation authorized.

## Accepted interface surface (LEGO contracts)

The control-plane module exposes `cscControlsCurrent()`, returning a
single `cscCaptureControlPlane` instance.  The UI exposes
`bindCscCapturePopup(panel)`, placing a gear directly after the existing
recording-group `1` checkbox without replacing or changing its handler.

### Settings and Worker adapter

- `init()`: load schema-1 settings from Tampermonkey GM shared storage.
- `setOptions(options, confirmed)`: validate the exact selector keys,
  require explicit confirmation before expanded capture and persist.
- `bindWorker(worker)`: bind the actual #359 Worker adapter.
- `onChange(listener)`: observe nonsecret `snapshot()` state.
- `worker.pause()`: block newly admitted COMM work before transitions.
- `worker.configure(request)`: send `{type:"csc-comm-configure",
  schema:1, request_id, options:{schema:1, mode, origin, binary,
  cross_origin, auth_headers, all}}`.  Return a correlated positive
  `{type:"csc-comm-configured", schema:1, request_id}`, **only after**
  Worker application.  Uncorrelated or missing ack MUST NOT mean applied.
- `worker.resume()`: enable admissions after verified settings receipt.
- `worker.provisionTarget.postMessage(payload)` and
  `worker.awaitKey(token)`: send #313 key bytes via its own factory and
  await `{type:"csc-comm-key-ready", token}` without public key exposure.

**Selector fidelity mismatch identified in exact #311 source:** the default currently
selects same-origin JSON and SSE bodies, not arbitrary text.  In
`everything` mode the Worker returns `unsupported` for other text
formats, so the broad-mode claim MUST NOT be certified until #359
reconciles that gap with #311 owner.  Do not silently drop selected
browser-accessible content or invent replacement body bytes.

**Existing #311 implementation is NOT compatible as-is:** its uncorrelated
`csc-comm-configured` response lacks schema and request ID.  Its
`redaction_scope/redaction_key_generation` legacy fields conflict with
the accepted #313 `key_restart` producer.  #359 owns the source-assembly
adapter and explicit schema reconciliation; #318 does not edit #311.

### Producer and durable GEN/COMM sinks

The accepted producer is #313
`communicationPersistentHmacCurrentTabService()`.  The source assembler MUST
call `cscControlsRegisterHmacFactory(communicationPersistentHmacCurrentTabService)`
**before** the first `cscControlsCurrent().init()` on the real userscript.
This explicit late-bound LEGO registration avoids a compile-time reference
to unassembled #313 code.  Late or invalid registrations fail closed.
The producer's public
`key_restart` is an authoritative UTC timestamp, unchanged on reload.
Use its exact `admit/provision/complete/status/randomize/cycleEvents`
methods.  Its `key_restart` is never invented from a local clock.

Call `bindSinks({gen,comm})` with these explicit durability ports:

| GEN port | COMM port | Expected behaviour |
| --- | --- | --- |
| `hasCycle(id)` | `hasCycle(id)` | Query durable event history; unknown or disagreement fails closed |
| `beginSegment({version,key_restart})` | `beginKeyBoundary({version,key_restart})` | Begin a new matching metadata boundary, return `{durable:true,key_restart}` |
| `writeCycle(event)` | `writeCycle(event)` | Persist nonsecret exact event ID, return `{durable:true,id}` |
| — | `drain()` | Ensure old-scope records are durable before starting a new scope |

All outgoing nonsecret cycle events are compared to the producer's journal;
only complete matching two-sink acknowledgements qualify.  A partial GEN
or COMM cycle is a recovery requirement, **not** permission to replay that
event into an inappropriate newer fragment.  #359 must supply genuine
durable `hasCycle` readback/reconciliation.  #317's standalone Worker
has a durable-cycle acknowledgement but not this entire adapter API.

Manual Randomize requires explicit user confirmation, durably drains COMM,
requests producer rotation, waits if `DRAINING`, then performs GEN and
COMM cycle/boundary reconciliation before resumed admission.  Automatic
expiry must remain enforced by the #313 producer itself.

## Privacy and behaviour

- Default mode is `replay-essentials`, with binary, cross-origin,
  authentication headers and the master flag all false.
- Expanded `everything` or any sensitive category requires confirmation.
- Selectors run ONLY in the COMM Worker, not the plugin/AICC queue.
- Opaque inaccessible cross-origin bodies remain reported unavailable.
- Never show or log 256-bit HMAC key material.
- Do not invent any 10 MiB plugin-queue spill control: #320 is deferred.
- Preserve existing `1`, Gen/Comm/Con, Test, sound and jump controls.

## Acceptance ledger / actual evidence

| Criterion | Status | Evidence or remaining action |
| --- | --- | --- |
| Owner and true child Git parent | PASS | #318 claim 6364205193; first child commit with RWF parent trailers |
| Isolated UI and public ports authored | IMPLEMENTED; unverified | #362; no real assembled Worker |
| Safe default / confirmed opt-in | TEST WRITTEN; unexecuted | `tests/issue318-csc-control-plane.test.mjs` |
| Storage reload and duplicate-tab | TEST WRITTEN; unexecuted | Synthetic GM adapter only; actual duplicate Chrome not tested |
| Versioned Worker settings ack | INCOMPLETE | Existing #311 ack uncorrelated; #359 must reconcile |
| Full-fidelity everything-mode selector | INCOMPLETE | #311 rejects other text formats as unsupported; #359 owns reconciliation |
| Physical GEN/COMM headers, events, durable cycle | INCOMPLETE | #359 source assembly then #319 independent readback |
| Real Chrome popup, keyboard/screenshot, worker restart | INCOMPLETE | Built exact integrated userscript and installed Chrome |
| Exact built isolated artifact + executable targeted CI | PASS | DC #318 focused GitHub workflow after final test run; not #359 assembled code |
| Ordinary PR CI / policy | FAIL | PR #362 policy rejects parent target; prepare/validate skipped |
| Main and production untouched | PASS | Draft child PR; no source imported to parent |

## Exact isolated regression checkpoint — October 23, 2026

A standalone #318-specific push workflow executes genuine GitHub-hosted
Node 22 tests, headless Chromium popup interactions in light/dark modes,
existing recorder and category regressions, manifest/JSDoc checks, source
version check, TypeScript no-unresolved-reference check, and exact
userscript build/byte verification with a retained non-production artifact.

Earlier verified source commit `ae2fa64f0bfebcc4efb182cd14d323b639e43262`
passed 18/18 control tests, 3/3 real headless Chromium popup tests,
34/34 adjacent recorder tests and a byte-verified assembled-source
userscript.  Later checks run on changing #318 source; DO NOT reuse
older PASS evidence without exact HEAD reruns.

The #318 standalone workflow does not modify repository CI policy,
the parent branch, or main.  Its PASS does NOT imply functional
#359 integration, live user-signed-in browser proof, #232 stress,
or #319 physical dual-logger readback.

## Hosted CI boundary

Run `39950479289` for PR #362 fails in **Enforce branch policy**:
`pull request base issue-359-csc-integration does not match integration
target main`.  Its prepare/validate/finalize jobs are **skipped**.

Push run `39950444070` reports success for policy only.  Its
prepare/validate/finalize jobs are **also skipped**.  Neither establishes
a compiled artifact, executable tests or production correctness.

The existing `.ci/branch-policy.json` has a generic `issue-*`
parent `main`; `.ci/repoworkflow.json` declares integration branch
`main`.  These are the previously documented #359 enforcement gaps.
Do not retarget #362 directly to `main`, ignore the failed policy,
or claim full CI acceptance.  Coordinate an authorised parent-branch
policy migration with #359, then rerun genuine CI on the exact candidate.

## Handoff

Source files remain owned by #318 until reviewed.  #359 owns reviewed
source import, Worker/GEN/COMM concrete adapters, old-schema correction,
and newly assembled tests.  #319 owns physical readback and independent
system certification.  #232 owns sustained performance/backpressure.
No issue or PR is merged by this checkpoint.
