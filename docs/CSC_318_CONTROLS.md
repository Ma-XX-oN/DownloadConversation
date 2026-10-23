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

**Existing #311 implementation is NOT compatible as-is:** its uncorrelated
`csc-comm-configured` response lacks schema and request ID.  Its
`redaction_scope/redaction_key_generation` legacy fields conflict with
the accepted #313 `key_restart` producer.  #359 owns the source-assembly
adapter and explicit schema reconciliation; #318 does not edit #311.

### Producer and durable GEN/COMM sinks

The accepted producer is #313
`communicationPersistentHmacCurrentTabService()`.  Its public
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
| Physical GEN/COMM headers, events, durable cycle | INCOMPLETE | #359 source assembly then #319 independent readback |
| Real Chrome popup, keyboard/screenshot, worker restart | INCOMPLETE | Built exact integrated userscript and installed Chrome |
| Exact built artifact + executable CI | INCOMPLETE | PR #362 policy job FAIL; prepare/validate skipped |
| Main and production untouched | PASS | Draft child PR; no source imported to parent |

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
