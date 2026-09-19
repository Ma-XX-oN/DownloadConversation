from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
  text = path.read_text(encoding='utf-8')
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{path}: expected exactly one documentation anchor, found {count}.')
  path.write_text(text.replace(old, new, 1), encoding='utf-8')


design = Path('DESIGN.md')
replace_once(
  design,
  """### Observe once, normalize once, fan out

Cross-cutting ChatGPT lifecycle state follows a watcher/consumer design pattern. Authoritative structured evidence is observed once at the provider/browser boundary, normalized once into stable project state, and then fanned out to independent consumers. Sound, stopwatch, favicon, and future Agent-state features must attach to that shared watcher rather than duplicating network interception, terminal classification, exchange identity, or reload polling.

If a consumer needs a fact the watcher does not yet expose, extend the shared watcher at the evidenced structured boundary first. Do not solve the gap by creating a consumer-specific detector. The current provider/browser contracts and the evidence behind them are maintained in `CHATGPT-WEB-INTEGRATION.md`.""",
  """### Observe once, normalize once, fan out

Cross-cutting ChatGPT lifecycle state follows a watcher/consumer design pattern. Authoritative structured evidence is observed once at the provider/browser boundary, normalized once into stable project state, and then fanned out to independent consumers. Sound, stopwatch, favicon, and future Agent-state features must attach to that shared watcher rather than duplicating network interception, terminal classification, exchange identity, or reload polling.

The watcher can have more than one authoritative provider input when ChatGPT itself exposes the same lifecycle through different stock transports. Current-page generation observes `POST /backend-api/f/conversation`; after a hard reload of an active turn, ChatGPT continues that turn through `POST /backend-api/f/conversation/resume`. Both SSE sources feed the same stream parser and terminal normalizer. The reload-resume observation is lifecycle evidence; it does not replace the separately persisted generation capture used for streamed-tail export reconciliation.

If a consumer needs a fact the watcher does not yet expose, extend the shared watcher at the evidenced structured boundary first. Do not solve the gap by creating a consumer-specific detector. The current provider/browser contracts and the evidence behind them are maintained in `CHATGPT-WEB-INTEGRATION.md`."""
)

integration = Path('CHATGPT-WEB-INTEGRATION.md')
replace_once(
  integration,
  """Do not issue duplicate stream-status requests for individual consumers.

## History can lag the live stream""",
  """Do not issue duplicate stream-status requests for individual consumers.

## Reload continuation stream

When a hard reload occurs while `stream_status` reports `IS_STREAMING`, ChatGPT can continue the active turn through:

`POST /backend-api/f/conversation/resume`

Live evidence from conversation `6aae0d5c-7cbc-83e9-ac16-fbf6c7d5e82d` established that the resume response is `text/event-stream` and contains the authoritative final lifecycle evidence for the already-running exchange. The captured sequence included the active User `input_message`, the final Assistant message, patches to `status: \"finished_successfully\"` and `end_turn: true`, `last_token`, `message_stream_complete`, and `[DONE]`. ChatGPT subsequently emitted a WebSocket `conversation-turn-complete` notification and telemetry identifying the reload source as `resume_stream` with result `success`.

Therefore `/f/conversation/resume` is an authoritative input to the **same** lifecycle watcher. DownloadConversation passively clones its request and response before returning the stock objects to ChatGPT and feeds the cloned SSE through the existing conversation-stream parser and terminal normalizer. It must not install a second terminal classifier, infer completion from the DOM, or poll for a substitute terminal signal.

The resume observation is deliberately lifecycle-only. It uses fresh parser state and does not overwrite the persisted original-generation capture used by streamed-tail export reconciliation.

As with the normal generation response, the resume Response clone must be acquired synchronously in the fetch response handler before the original Response is returned to ChatGPT. The resume Request is also cloned before transmission so its `conversation_id` remains available to the passive observer without consuming the page-owned body.

## Provider v1 patch semantics

In the observed reload SSE, the final Assistant message initially carried `request_id`, `turn_exchange_id`, `working_turn_id`, and `turn_id` in `message.metadata`. A later provider patch used `o: \"append\"` at `/message/metadata` to add completion fields such as `is_complete`, `can_save`, and `finish_details`.

For an existing object receiving an object-valued v1 `append`, DownloadConversation must **merge the appended fields into the existing object**. Replacing the object erases the exchange identity immediately before terminal normalization. String append and array append retain their distinct existing semantics; object merge applies only when both existing and appended values are non-array objects.

This rule is covered by a fixed regression derived from the captured reload stream. Do not reinterpret provider patch operators ad hoc in consumers.

## History can lag the live stream"""
)
