# DC #313: ChatGPT-only persistent HMAC coordination

Operator decision: the supported recording origin is **https://chatgpt.com**
only. The userscript header must not match the historical secondary hostname.
This deployment decision supersedes the two-origin coordination assumption in
DC #312, without rewriting that frozen design artifact or its marker vectors.

## Coordination and storage

The operator approved origin-scoped IndexedDB despite page visibility of the
stored HMAC secret. All participating tabs use the same named exclusive
`navigator.locks` lock and commit complete versioned records through
IndexedDB `readwrite` transactions. This replaces the prior GM-based primary
key store, which failed the real two-tab 24/48 consistency test. No GM value,
local readback, fixed delay or event listener serves as transaction authority.

Each complete record contains the random 256-bit key, generation, epoch,
pending admissions, issued timestamp, randomized expiry and nonsecret cycle
event journal. The key is readable to scripts executing in the ChatGPT origin;
the operator explicitly accepts this confidentiality tradeoff. No key bytes
enter GEN/COMM records, exported logs or status metadata.

Randomized expiry is inclusive 23–25 hours from the last committed cycle.
An active tab checks near the deadline; browser startup/status/admission
checks catch overdue keys. An inactive browser cannot run scheduled work.
No new capture may use an expired generation. Existing pending captures
must drain (or fail closed) before the next generation is committed.

Manual Randomize remains confirmation-gated. Automatic scheduled/overdue
rotation requires no additional user approval and creates one committed
cycle event. Both GEN and COMM writers must persist an identical stable
event ID, generation, epoch, timestamp and reason with idempotent replay.
Producer exposes `cycleEvents(afterEpoch)`; actual dual disk writing is
owned by the downstream GEN/COMM recording integrations.

## Failure and recovery

An unexpected acknowledgement failure after a pending admission write is
resolved by re-reading under the lock and removing only the unpublished token.
An admission aborted because its service was disposed before provisioning
uses the same reconciliation path. A failed reconciliation suspends capture;
it does not claim that a pending record was safely cleared.

An already provisioned capture must finish under its original generation,
or be explicitly marked incomplete by its owning Worker before releasing
its token. Stale tokens must never be assumed complete solely because a tab
has disappeared. No implicit key regeneration follows storage corruption.

## Evidence levels

Synthetic Node tests check the lifecycle, randomized expiry boundaries,
corruption, races and nonsecret event IDs. The Chromium localhost fixture
runs actual IndexedDB transactions and actual Web Locks but deliberately
supplies a synthetic `chatgpt.com` location to the origin adapter; this
does not certify the installed Tampermonkey execution sandbox.
A signed-in, installed Chrome/Tampermonkey test remains required.
Actual COMM Worker key usage and redacted segment provenance require the
separately owned CSC Worker pipeline and independent #319 convergence gate.

Do not mark #313 complete from synthetic tests or policy-only hosted CI.
Merge and production activation still require the operator's authorization.
