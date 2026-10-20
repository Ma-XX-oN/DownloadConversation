# DC #313: ChatGPT-only persistent HMAC coordination

Operator decision: the supported recording origin is **https://chatgpt.com**
only. The userscript header must not match the historical secondary hostname.
This deployment decision supersedes the two-origin coordination assumption in
DC #312, without rewriting that frozen design artifact or its marker vectors.

## Coordination and storage

All cooperating tabs on the supported origin acquire the same named
`navigator.locks` exclusive Web Lock before doing a Tampermonkey HMAC storage
read, creation, admission, release, recovery or user-confirmed rotation.
The lock is held through GM storage write and readback. Unavailable locks and
storage failures suspend capture rather than falling back to an ephemeral key.

A single versioned Tampermonkey record stores the private random 256-bit key,
128-bit generation identifier, epoch, drain phase and pending admissions.
Do not store the secret key in page-origin IndexedDB: ordinary page scripts
have access to origin storage. IndexedDB can atomically update its own records,
but cannot make separate asynchronous GM storage writes part of the same IDB
transaction. Web Locks therefore coordinate the protected GM operations.

Every admitted capture retains its own generation snapshot and metadata.
Explicit Randomize stops new admissions while the old generation drains.
Never use an old admission token for a new record after the epoch transition.

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

Synthetic Node tests check lifecycle algorithms, corruption, race injection,
unacknowledged writes and key non-disclosure. Real Chromium tests validate
same-origin browser Web Locks with synthetic storage, not actual Tampermonkey.
Only an installed Chrome/Tampermonkey witness can certify cross-tab GM storage,
browser restart persistence and the source's userscript sandbox access.
Actual COMM Worker key usage and redacted segment provenance require the
separately owned CSC Worker pipeline and independent #319 convergence gate.

Do not mark #313 complete from synthetic tests or policy-only hosted CI.
Merge and production activation still require the operator's authorization.
