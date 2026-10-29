// Provider-owned receipt contract V1. Called synchronously at CSC capture,
// never when a queued envelope is consumed by an agent or Worker.
export const RECEIPT_OBSERVATION_VERSION = 1;
const TRANSPORTS = new Set(['fetch', 'xhr', 'websocket', 'sse', 'polling', 'keepalive', 'other']);
const PHASES = new Set([
  'response_headers', 'body_chunk', 'frame', 'message',
  'server_keepalive', 'server_error'
]);
const MAX_IDENTITIES = 2048;
const ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const CAPTURE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function safeId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

function safeCaptureId(value) {
  return typeof value === 'string' && CAPTURE_ID_PATTERN.test(value)
    ? value : null;
}

function phaseOf(event) {
  if (event.direction === 'response' &&
      (event.transport === 'fetch' || event.transport === 'xhr')) {
    if (PHASES.has(event.phase)) return event.phase;
    if (Number.isInteger(event.status) && event.status >= 400) {
      return 'server_error';
    }
    return event.transport === 'fetch' ? 'response_headers' : 'message';
  }
  if (event.direction === 'incoming') {
    if (event.transport === 'websocket' && event.phase == null) {
      return 'frame';
    }
    return PHASES.has(event.phase) ? event.phase : null;
  }
  return null;
}

function validEpochMs(value, observedAt) {
  let parsed = value;
  if (typeof value === 'string' && ISO_WITH_ZONE.test(value)) {
    parsed = Date.parse(value);
  }
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= observedAt
    ? parsed : null;
}

function sourceTimestamp(event, observedAt) {
  for (const key of ['received_at_epoch_ms', 'captured_at_epoch_ms']) {
    const value = validEpochMs(event[key], observedAt);
    if (value !== null) return value;
  }
  if (event.timestamp_clock_domain === 'unix_epoch_ms') {
    return validEpochMs(event.timestamp, observedAt);
  }
  return null;
}

// Whitelisting prevents arbitrary network content from traversing the
// provider heartbeat metadata boundary, including with a forged envelope.
export function sanitizeChatGPTReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' ||
      receipt.type !== 'server_receipt' ||
      receipt.version !== RECEIPT_OBSERVATION_VERSION ||
      !TRANSPORTS.has(receipt.transport) || !PHASES.has(receipt.phase) ||
      !Number.isSafeInteger(receipt.timestamp_ms) || receipt.timestamp_ms <= 0 ||
      !['source', 'local_observation'].includes(receipt.timestamp_origin) ||
      receipt.clock_domain !== 'unix_epoch_ms') {
    throw new TypeError('Invalid V1 incoming receipt metadata');
  }
  const result = {
    type: 'server_receipt',
    version: RECEIPT_OBSERVATION_VERSION,
    timestamp_ms: receipt.timestamp_ms,
    timestamp_origin: receipt.timestamp_origin,
    clock_domain: 'unix_epoch_ms',
    transport: receipt.transport,
    phase: receipt.phase
  };
  for (const key of ['page_instance_id', 'connection_id', 'correlation_id']) {
    const id = safeId(receipt[key]);
    if (id !== null) result[key] = id;
  }
  for (const key of ['capture_id', 'request_capture_id']) {
    const id = safeCaptureId(receipt[key]);
    if (id !== null) result[key] = id;
  }
  if (Number.isSafeInteger(receipt.capture_order) && receipt.capture_order > 0) {
    result.capture_order = receipt.capture_order;
  }
  if (Number.isSafeInteger(receipt.network_sequence) && receipt.network_sequence >= 0) {
    result.network_sequence = receipt.network_sequence;
  }
  if (Number.isFinite(receipt.captured_at_mono_ms) && receipt.captured_at_mono_ms >= 0) {
    result.captured_at_mono_ms = receipt.captured_at_mono_ms;
  }
  const clockId = safeId(receipt.clock_id);
  if (clockId !== null) result.clock_id = clockId;
  return Object.freeze(result);
}

export function createChatGPTReceiptIngress({ now = Date.now } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const seen = new Set();
  return Object.freeze({
    capture(event) {
      // This is the first synchronous observation step. No queue, await,
      // parsing, body clone, response read or deferred callback precedes it.
      const observedAt = now();
      if (!Number.isSafeInteger(observedAt) || observedAt <= 0) {
        throw new TypeError('Observation clock must return epoch milliseconds');
      }
      if (!event || typeof event !== 'object') {
        throw new TypeError('Canonical CSC envelope is required');
      }
      // CSC #309 sends { envelope, source } through its plugin fanout.
      // Fetch/XHR 'response' and WebSocket 'incoming' are actual native
      // directions; 'request', 'outgoing', 'error' and 'event' are not receipts.
      const canonical = event.envelope ?? event;
      if (!canonical || typeof canonical !== 'object') {
        throw new TypeError('Canonical CSC envelope is required');
      }
      const phase = phaseOf(canonical);
      if (!TRANSPORTS.has(canonical.transport) || phase === null) return null;
      const page = safeId(canonical.page_instance_id);
      const sequence = Number.isSafeInteger(canonical.network_sequence) &&
        canonical.network_sequence >= 0 ? canonical.network_sequence : null;
      const identity = page !== null && sequence !== null
        ? page + ':' + sequence : null;
      if (identity !== null && seen.has(identity)) return null;
      const supplied = sourceTimestamp(canonical, observedAt);
      const receipt = sanitizeChatGPTReceipt({
        type: 'server_receipt',
        version: RECEIPT_OBSERVATION_VERSION,
        timestamp_ms: supplied ?? observedAt,
        timestamp_origin: supplied === null ? 'local_observation' : 'source',
        clock_domain: 'unix_epoch_ms',
        transport: canonical.transport,
        phase,
        page_instance_id: page,
        connection_id: canonical.connection_id,
        correlation_id: canonical.correlation_id,
        capture_id: canonical.capture_id,
        request_capture_id: canonical.request_capture_id,
        capture_order: canonical.capture_order,
        network_sequence: sequence,
        captured_at_mono_ms: canonical.captured_at_mono_ms,
        clock_id: canonical.clock_id ?? canonical.clock_domain
      });
      if (identity !== null) {
        seen.add(identity);
        if (seen.size > MAX_IDENTITIES) seen.delete(seen.values().next().value);
      }
      return receipt;
    }
  });
}
