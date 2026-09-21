# Agent terminal lifecycle

DownloadConversation observes Agent terminal state once, normalizes it once, and fans the normalized event out to sound, stopwatch, and favicon consumers. Consumers must not install independent terminal detectors or infer terminal state from rendered ChatGPT text.

## Structured terminal sources

The shared watcher currently recognizes these evidenced terminal sources:

- successful Assistant final record: `author.role == "assistant"`, `channel == "final"`, `status == "finished_successfully"`, `end_turn == true`;
- structured `conversation_too_large` terminal error;
- structured polling-timeout telemetry from `/ces/statsc/flush` identifying `completion_stream_polling_fallback` / `network_error` / `polling_timeout`;
- exact ChatGPT WebSocket `conversation-turn-complete` notification on the global `conversations` topic, but only under the corroboration and correlation rules below.

`finished_successfully` commentary/tool records with `end_turn != true` are not terminal on their own.

## Provider `conversation-turn-complete` evidence

A live failure on conversation `6ab06eba-88e8-83ea-855a-d7a22259bd77` established a successful lifecycle shape in which no Assistant `channel:"final"`, `end_turn:true` record was observed by DownloadConversation. The observed `/backend-api/f/conversation/resume` clone remained incomplete and the next resume attempt returned 404, but ChatGPT later emitted this structured WebSocket notification:

```json
{
  "type": "message",
  "topic_id": "conversations",
  "payload": {
    "type": "conversation-turn-complete",
    "payload": {
      "conversation_id": "6ab06eba-88e8-83ea-855a-d7a22259bd77"
    },
    "metadata": null
  }
}
```

The provider notification is therefore valid terminal corroboration, but the captured shape contains only conversation identity. It is not sufficient by itself to identify a working exchange.

DownloadConversation accepts it as successful terminal evidence only when all of the following are true:

1. the frame exactly matches the structured `conversation-turn-complete` shape above;
2. exactly one unresolved lifecycle capture exists for that `conversation_id`;
3. that capture contains a structured Assistant record with `status:"finished_successfully"`;
4. no successful/error terminal has already been normalized for that capture.

The successful Assistant record is corroborating evidence only. It does not become terminal merely because it is commentary or because `status` is `finished_successfully`.

## Fail-closed exchange correlation

The WebSocket notification contains no `turn_exchange_id`, `working_turn_id`, request id, or message id. Therefore conversation identity cannot safely distinguish two simultaneously unresolved exchanges in the same conversation.

If more than one unresolved lifecycle capture exists for the same conversation, `conversation-turn-complete` is deliberately ignored. The watcher must not pick the newest capture, the oldest capture, or use a timing heuristic. This prevents a delayed completion for an older exchange from terminating a newer one.

Generation and resume captures are registered separately from the streamed-tail export capture. The resume parser remains lifecycle-only and does not replace the authoritative generation capture used for export reconciliation.

When a provider completion is unambiguous, the normalized exchange identity is derived from structured message metadata already present in the selected capture. In the commentary-only observed shape, the newest streamed Assistant metadata can carry `turn_exchange_id` / `working_turn_id` even though no final Assistant record exists.

## Shared fan-out

After normalization, one immutable terminal object is delivered to the shared handlers in order:

1. completion/error sound;
2. Agent stopwatch;
3. favicon state.

The provider-completion path must not bypass that fan-out. A successful corroborated provider completion therefore has the same downstream semantics as a normal successful final: one success sound subject to sound readiness/volume policy, stopwatch completion for the matching exchange, and completed favicon projection when processing was observed.

## Negative invariants

The watcher must not:

- infer completion from `NOT_STREAMING` alone;
- infer completion from commentary text, DOM text, button labels, or visible Retry UI;
- treat arbitrary `finished_successfully` commentary/tool records as terminal;
- use conversation-only provider completion to select among multiple unresolved exchanges;
- convert a capture with an already-normalized structured terminal error into success;
- create consumer-specific terminal observers.

These invariants are covered by `tests/agent-terminal-conversation-turn-complete.test.mjs` together with the existing shared-terminal, sound, stopwatch, favicon, polling-timeout, and stream integration regressions.
