# Per-tab recording-group identity (issue #217)

## Contract

The `1` control selects one recording group per browser tab. A group spans
all ChatGPT conversations visited in that tab, page reloads, and restored
browser sessions when the browser restores that tab's session storage.

Activation from an inactive state generates a fresh UUID using
`crypto.randomUUID()`. The active group UUID is stored in `sessionStorage`.
Deactivation preserves existing archived recordings and clears active
single-group ownership. Reactivation generates a different UUID.

A fresh page-document instance uses a separate ephemeral instance UUID.
Navigation within the tab never changes its recording-group UUID. No Chrome
window ID or timestamp is used as group identity.

## Cross-tab ownership

`BroadcastChannel` exchanges group claims only among same-origin DC
instances. Starting instances do not write to an unverified shared group.
A live incumbent keeps the group and a confirmed duplicate gets a fresh
UUID. Concurrent startup, stale/late responses and refresh overlap must be
handled explicitly; the absence of a response within a timeout is not proof
of unique ownership. Ambiguous ownership must suspend group writes and
surface a diagnostic instead of corrupting a group.

Storage and transport must not assume all tabs are active simultaneously.
Reopening a saved group after process restart retains that group's UUID
without treating a closed prior document as an active owner.

## Non-goals

Do not change log capture, in-memory buffering, diagnostic persistence,
communication-log segment rotation, zstd compression, or preexisting export
order. Do not use cross-tab negotiation as a substitute for durable
File System Access write-safety checks.

## Verification matrix

- First enable / disable / re-enable: new group UUID on each enable.
- Same document chat navigation: unchanged UUID.
- Reload and restored tab: unchanged UUID when session storage restored.
- Independent new tab: independent UUID.
- Duplicate tab with an active original: new UUID for duplicate; old owner
  retains previous UUID.
- Simultaneous duplicate startup: no double owner.
- Refreshed incumbent with overlapping old/new instances: no false duplicate.
- Suspended incumbent, delayed message, unsupported BroadcastChannel:
  no conflicting writes; clear diagnostics.
- Group membership is not derived from conversation ID; cross-conversation
  capture remains within the active tab group.
- Existing log capture/persistence, rotation and compressed output unaffected.

## Dependencies

Umbrella #216; follow-ups #218 panel, #219 extraction dialog,
#220 merged export, #221 acceptance. Existing #133 and #134 are reused.
