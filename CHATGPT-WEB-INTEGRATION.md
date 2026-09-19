# ChatGPT Web Integration — DownloadConversation

This document records provider/browser integration facts learned from live ChatGPT evidence so future DownloadConversation work does not have to rediscover the same behaviour.

These are integration contracts and evidence, not permission to add fallback paths. When ChatGPT changes, update this document together with the regression that proves the new behaviour.

## Agent lifecycle watcher pattern

Agent lifecycle evidence is **observed once, normalized once, then projected to consumers**.

The lifecycle watcher is the authority. Presentation and side-effect features such as:

- terminal sound (#135),
- stopwatch (#136), and
- favicon state (#148)

must consume the shared observation/normalized event instead of installing their own duplicate network interception, terminal classifier, exchange-identity reconstruction, or reload-status request.

A new feature that needs Agent state should first ask whether the shared watcher already exposes the needed fact. If it does, attach another consumer. If it does not, extend the watcher at the authoritative structured evidence boundary and then fan that new normalized fact out to all consumers that need it.

Rendered ChatGPT text, DOM labels, timing guesses, and duplicated polling are not alternate authorities unless a separately evidenced and approved design explicitly says otherwise.

## Current-page generation start

A normal User generation is submitted through:

`POST /backend-api/f/conversation`

DownloadConversation observes that stock request at the existing page-realm network boundary. The local monotonic timestamp immediately before transmission is the authoritative local submission time for stopwatch timing, and the same observed generation start is projected to the favicon processing consumer.

The request body does not reliably contain all enriched working-exchange metadata, so generation identity must not be inferred solely from the initial POST body.

## Same-working-turn User follow-up

Live ChatGPT evidence shows that a User follow-up submitted while the current working exchange remains active uses:

`POST /backend-api/f/steer_turn`

It is **not** another `/backend-api/f/conversation` generation stream.

For stopwatch semantics, the steer-turn POST is the immediate follow-up submission/lap boundary. The original `/f/conversation` streamed generation remains authoritative for the working exchange and terminal completion. Later streamed copies of the same User follow-up must not create a second lap.

## Streamed working-exchange identity

The top-level streamed User `input_message` can carry:

- `turn_exchange_id`, and/or
- `working_turn_id`

while omitting `message_type`.

A later hidden/system record in the same provider turn may carry `message_type: next`. Therefore `message_type` is not a reliable primary classifier for live User submission identity.

DownloadConversation retains the working exchange learned from the structured User stream record and uses that structured identity across lifecycle consumers.

## Successful terminal state

The evidenced successful Assistant terminal state is a structured Assistant message with:

- `channel: "final"`
- `status: "finished_successfully"`
- `end_turn: true`

Terminal state is normalized centrally before consumers act on it.

## Terminal errors can follow a successful final

ChatGPT can emit a successful final Assistant state and then emit a separate structured terminal error for the **same exchange**.

The captured max-length sequence is one example:

1. successful final Assistant / `last_token`;
2. later event with top-level `error_code: "conversation_too_large"`.

The max-length event does not need `type: "error"` and may contain a top-level human-readable `error` string plus top-level `error_code`.

Consequences for consumers:

- sound may legitimately emit one success ding and then one error buzz for the same exchange;
- favicon may transition green and then red for the same exchange;
- terminal de-duplication must distinguish terminal **kind** as well as stable exchange identity when a consumer needs both observations.

Do not scan rendered error text to discover this condition.

## Structured polling-timeout terminal evidence

A stock message-delivery polling timeout is evidenced by the structured `/ces/statsc/flush` counter:

- metric `chatgpt_web_message_delivery_failure_shown`
- source `completion_stream_polling_fallback`
- `error_code=network_error`
- `failure_reason=polling_timeout`

That exact structured observation is normalized into the shared terminal-error path. The visible Retry/error UI is not the authority.

## Generation Response ownership

For `POST /backend-api/f/conversation`, a passive response clone must be acquired **synchronously in the fetch response handler before the original Response is returned to ChatGPT**.

ChatGPT may lock or disturb its original response body immediately after `fetch()` resolves. Request-body parsing may complete later; the already-owned response clone can wait for request capture and then feed the existing SSE path.

Do not delay clone acquisition until after unrelated async work.

## Reload and stream status

Reload restoration uses the stock Conversation API history plus:

`GET /backend-api/conversation/<conversation-id>/stream_status`

The same structured stream-status result is shared by consumers.

`IS_STREAMING` is positive evidence that the existing response is still active. It can restore/continue the stopwatch and project favicon processing state.

A non-streaming result is **not** proof that the current loaded page observed a successful completion. In particular, `NOT_STREAMING` after reload must not be converted into a green favicon merely by inference.

Do not issue duplicate stream-status requests for individual consumers.

## History can lag the live stream

Conversation API history can be stale relative to a just-completed live streamed turn. A complete successful final Assistant response may be present in the captured live stream while absent from the persisted Conversation API snapshot after reload/export.

The streamed-tail reconciliation path is therefore evidence-constrained and identity/suffix based. It is not permission to replace history wholesale or to use rendered DOM text as transcript truth.

## ChatGPT DOM is virtualized

Mounted conversation DOM is viewport state, not durable conversation chronology. ChatGPT can unmount/remount historical turns as the user scrolls or navigates.

Provider message IDs and structured metadata are preferred over visual position. DOM observation is allowed only for explicitly documented UI/diagnostic purposes and is not a silent transcript fallback.

## Browser favicon selection

A page may expose multiple `link[rel~="icon"]` candidates. Browsers can select among them using `media`, `type`, and `sizes`; appending one generic `rel="icon"` does not guarantee that it becomes the tab icon.

Live #148 evidence showed:

- the lifecycle watcher requested `processing`;
- the renderer successfully recolored 1,409 pixels in a 48×48 source and logged `agent-favicon-state-rendered`;
- Chrome still displayed ChatGPT's stock white favicon.

Therefore favicon state must be projected onto the existing stock icon candidates that the browser may select. Each candidate's generated state must be derived from that candidate's captured original source, never from a previously recolored state. Preserve original candidate state so an explicit stock/original state can be restored.

This is a browser presentation rule. It does **not** change the shared Agent lifecycle watcher.

## Page realm and passive interception

DownloadConversation installs page-realm fetch/XHR observation at document start. Passive diagnostics and capture must leave ChatGPT's original request/response objects usable by the stock page. Inspection uses clones or separately captured metadata; observer failure must not become a reason to alter ChatGPT networking.

## Maintenance rule

When live evidence teaches us something new about ChatGPT's API, stream shape, working-exchange identity, UI virtualization, browser integration, or terminal-state ordering:

1. establish the evidence and regression;
2. update the relevant issue;
3. update this document and `DESIGN.md` when the lesson is architectural;
4. then make the production correction.

The goal is that future work can start from documented contracts rather than reverse-engineering the same system again.