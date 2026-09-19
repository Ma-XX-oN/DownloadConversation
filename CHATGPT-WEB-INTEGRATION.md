# ChatGPT Web Integration — DownloadConversation

This document records provider/browser integration facts learned from live ChatGPT evidence so future DownloadConversation work does not have to rediscover the same behaviour.

These are **observed provider/browser contracts and established constraints**, not permission to add fallback paths and not a source-reconciliation policy. When ChatGPT changes, update this document together with the regression/evidence that establishes the new behaviour.

## Cross-project use

The provider facts in this document are intentionally reusable by projects such as `Ma-XX-oN/Multi-AI`. DownloadConversation's page-realm implementation details are not automatically requirements for another host: Multi-AI currently observes stock ChatGPT primarily through Electron/CDP, so it can consume the same endpoint, stream, identity, ordering, and lifecycle facts without copying DownloadConversation's fetch wrapper.

Keep three layers separate:

1. **Provider fact** — what stock ChatGPT actually sent or did.
2. **Observation mechanism** — page-realm fetch/XHR cloning in DownloadConversation, CDP in Multi-AI, or another independently verified mechanism.
3. **Application policy** — how a project reconciles sources or acts on lifecycle state.

A provider fact can be shared across projects. An observation mechanism or policy should not be imported merely because another project uses it.

## Provider evidence map

| Lifecycle/source fact | Observed stock interface | Established meaning |
| --- | --- | --- |
| New User generation | `POST /backend-api/f/conversation` | Starts the ordinary generation stream. |
| Same-working-turn User follow-up | `POST /backend-api/f/steer_turn` | User submits another instruction while the existing working exchange remains active. |
| Reload activity check | `GET /backend-api/conversation/<conversation-id>/stream_status` | `IS_STREAMING` is positive evidence that the existing response is still active. |
| Reload continuation | `POST /backend-api/f/conversation/resume` | SSE continuation of an already-running exchange after reload; can carry the authoritative terminal sequence. |
| Successful terminal | Structured Assistant final message | `channel:"final"`, `status:"finished_successfully"`, `end_turn:true`. |
| Max-conversation terminal error | Structured stream event | Can arrive after a successful final with top-level `error_code:"conversation_too_large"`. |
| Polling-timeout terminal error | `POST /ces/statsc/flush` telemetry | Structured counter identifies `completion_stream_polling_fallback` / `network_error` / `polling_timeout`. |
| Persisted/history snapshot | `/backend-api/conversations/<id>` | Can lag a completed live stream and can omit stream-only/visually-hidden records. |
| Reload completion corroboration | ChatGPT WebSocket | A `conversation-turn-complete` notification was observed after successful resume completion. It is corroborating evidence, not currently the primary DownloadConversation terminal source. |

The table is an evidence inventory. It does not declare one source universally authoritative for transcript reconstruction.

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

The observed final Assistant metadata can also carry `request_id`, `turn_exchange_id`, `working_turn_id`, and `turn_id`. Preserve those fields through stream patch application; losing them immediately before terminal normalization can make an otherwise valid terminal event impossible to correlate to the active exchange.

DownloadConversation retains the working exchange learned from structured stream records and uses that structured identity across lifecycle consumers.

## Successful terminal state

The evidenced successful Assistant terminal state is a structured Assistant message with:

- `channel: "final"`
- `status: "finished_successfully"`
- `end_turn: true`

The surrounding successful sequence can also include `last_token`, `message_stream_complete`, and `[DONE]`. These markers are useful ordering evidence, but the structured final Assistant state supplies the successful terminal message semantics used by the shared watcher.

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

For `POST /backend-api/f/conversation`, a passive DownloadConversation response clone must be acquired **synchronously in the fetch response handler before the original Response is returned to ChatGPT**.

ChatGPT may lock or disturb its original response body immediately after `fetch()` resolves. Request-body parsing may complete later; the already-owned response clone can wait for request capture and then feed the existing SSE path.

Do not delay clone acquisition until after unrelated async work.

This is a DownloadConversation page-realm ownership requirement. A CDP observer such as Multi-AI does not need to reproduce `Response.clone()`, but it must still attach/observe early enough that it does not miss the relevant stock response or stream frames.

## Reload and stream status

Reload restoration uses the stock Conversation API history plus:

`GET /backend-api/conversation/<conversation-id>/stream_status`

The same structured stream-status result is shared by consumers.

`IS_STREAMING` is positive evidence that the existing response is still active. It can restore/continue the stopwatch and project favicon processing state.

A non-streaming result is **not** proof that the current loaded page observed a successful completion. In particular, `NOT_STREAMING` after reload must not be converted into a successful terminal, a green favicon, or a completion sound merely by inference.

Do not issue duplicate stream-status requests for individual consumers.

## Reload continuation stream

When a hard reload occurs while `stream_status` reports `IS_STREAMING`, ChatGPT can continue the active turn through:

`POST /backend-api/f/conversation/resume`

Live evidence from conversation `6aae0d5c-7cbc-83e9-ac16-fbf6c7d5e82d` established that the resume response is `text/event-stream` and contains the authoritative final lifecycle evidence for the already-running exchange. The captured sequence included the active User `input_message`, the final Assistant message, patches to `status: "finished_successfully"` and `end_turn: true`, `last_token`, `message_stream_complete`, and `[DONE]`. ChatGPT subsequently emitted a WebSocket `conversation-turn-complete` notification and telemetry identifying the reload source as `resume_stream` with result `success`.

Therefore `/f/conversation/resume` is an authoritative input to the **same** lifecycle watcher. DownloadConversation passively clones its request and response before returning the stock objects to ChatGPT and feeds the cloned SSE through the existing conversation-stream parser and terminal normalizer. It must not install a second terminal classifier, infer completion from the DOM, or poll for a substitute terminal signal.

The resume observation is deliberately lifecycle-only. It uses fresh parser state and does not overwrite the persisted original-generation capture used by streamed-tail export reconciliation.

As with the normal generation response, the resume Response clone must be acquired synchronously in the fetch response handler before the original Response is returned to ChatGPT. The resume Request is also cloned before transmission so its `conversation_id` remains available to the passive observer without consuming the page-owned body.

### Reload consumer sequence established by live evidence

The latest reload run established a useful distinction:

1. after refresh, `stream_status` returned `IS_STREAMING`;
2. the favicon visibly became yellow, proving reload processing-state restoration worked;
3. the stopwatch resumed/continued as active;
4. ChatGPT later delivered successful completion through `/f/conversation/resume`;
5. the old watcher did not consume that resume terminal, so the ding did not play, the stopwatch did not stop, and the favicon did not transition yellow → green.

The #140 correction routes resume SSE through the shared parser/normalizer and preserves its exchange identity. Repository regression/CI is green; live acceptance of the corrected reload completion path is still a separate runtime verification step.

The important provider lesson for other projects is that **`IS_STREAMING` establishes active work, while `/f/conversation/resume` can establish the later terminal transition**. Do not infer that transition solely by polling `stream_status` until it becomes non-streaming.

## Provider v1 patch semantics

In the observed reload SSE, the final Assistant message initially carried `request_id`, `turn_exchange_id`, `working_turn_id`, and `turn_id` in `message.metadata`. A later provider patch used `o: "append"` at `/message/metadata` to add completion fields such as `is_complete`, `can_save`, and `finish_details`.

For an existing object receiving an object-valued v1 `append`, DownloadConversation must **merge the appended fields into the existing object**. Replacing the object erases the exchange identity immediately before terminal normalization. String append and array append retain their distinct existing semantics; object merge applies only when both existing and appended values are non-array objects.

This rule is covered by a fixed regression derived from the captured reload stream. Do not reinterpret provider patch operators ad hoc in consumers.

## History can lag the live stream

Conversation API history can be stale relative to a just-completed live streamed turn. A complete successful final Assistant response may be present in the captured live stream while absent from the persisted Conversation API snapshot after reload/export.

Earlier #116 evidence also established that the generation stream can contain stock-internal records marked `metadata.is_visually_hidden_from_conversation=true` that are omitted by History. Stock DOM hydration can still retain/render a completed-stream message while a later History snapshot is stale.

These are source-model observations. They do **not** by themselves define a general precedence rule such as “stream always wins.” Reconciliation must remain identity- and evidence-based.

DownloadConversation's current streamed-tail reconciliation is therefore evidence-constrained and identity/suffix based. It is not permission to replace history wholesale or to use rendered DOM text as transcript truth.

## Conversation-limit / context-exhaustion evidence

Do not estimate the stock `conversation_too_large` condition from exported record count or exported JSONL byte size.

Two independently observed max-length conversations had materially different source-record counts and serialized export sizes:

- conversation `6aa9bce3-55ec-83e9-b17e-b0befc6f4b05`: **3,113 API/source records**, **55,675,391-byte** raw exported JSONL DB;
- conversation `6aad94a5-25b8-83ea-aa57-009d98d5b90b`: **3,473 API/source records**, **49,332,883-byte** raw exported JSONL DB.

A non-max control, conversation `6a9f4f25-90a8-83ea-9fba-a5763070bbcf`, had **4,392 API/source records** and an exported JSONL diagnostic `blob_size` of **33,525,287 bytes**. This falsifies a simple record ceiling below 4,392 and a simple exported-byte threshold near the two max cases.

The exported conversation DBs also contained no authoritative total token-usage fields such as `input_tokens`, `output_tokens`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `token_count`, or `usage`. `metadata.finish_details.stop_tokens` appeared as repeated fixed special-token ID arrays (principally `[200012]` and `[200002]`), switching by record semantics rather than increasing with record number; they are **not accumulated token-use counters**.

Reasoning-related records can expose metadata such as `thinking_effort`, reasoning timestamps/durations, `cot_version`, and reasoning/thought content, but no exact hidden-reasoning token total was found in these exported DBs. A locally tokenized visible export therefore cannot be treated as an authoritative backend context-usage total.

For Multi-AI and other controllers, the explicit structured `conversation_too_large` terminal event is the established stock signal. Record count, export size, visible-text tokenization, and `stop_tokens` are not proven predictors of remaining conversation capacity.

## ChatGPT DOM is virtualized

Mounted conversation DOM is viewport state, not durable conversation chronology. ChatGPT can unmount/remount historical turns as the user scrolls or navigates.

Provider message IDs and structured metadata are preferred over visual position. DOM observation is allowed only for explicitly documented UI/diagnostic purposes and is not a silent transcript fallback.

## Browser favicon selection and state persistence

A page may expose multiple `link[rel~="icon"]` candidates. Browsers can select among them using `media`, `type`, and `sizes`; appending one generic `rel="icon"` does not guarantee that it becomes the tab icon.

Earlier live #148 evidence showed:

- the lifecycle watcher requested `processing`;
- one generated 48×48 render recolored 1,409 pixels and logged success;
- Chrome nevertheless displayed ChatGPT's stock white favicon.

That established that state must be projected onto the existing stock icon candidates the browser may select. Each candidate's generated state must be derived from that candidate's captured original source, never from a previously recolored state. Preserve original candidate state so an explicit stock/original state can be restored.

A later reload run provided different evidence: the yellow processing favicon **was visibly displayed after refresh**, so processing-state restoration and browser selection worked in that run. The missing yellow → green transition coincided with the shared watcher's failure to consume the `/f/conversation/resume` terminal event, the same missing event that left the stopwatch running and suppressed the ding. That is a lifecycle-observation defect, not evidence that the yellow favicon had failed to render.

The same later diagnostic run also showed one favicon candidate with zero recolored pixels while other candidates recolored successfully. That is retained as unresolved presentation evidence, **not** as an established cause of the missing green transition. A separate #148 persistence diagnostic is being built to determine whether ChatGPT later rewrites/replaces projected favicon candidates during head hydration. It must observe/report before any automatic reapply behaviour is considered.

This is a browser presentation rule. It does **not** create a second Agent lifecycle watcher.

## Page realm and passive interception

DownloadConversation installs page-realm fetch/XHR observation at document start. Passive diagnostics and capture must leave ChatGPT's original request/response objects usable by the stock page. Inspection uses clones or separately captured metadata; observer failure must not become a reason to alter ChatGPT networking.

For Multi-AI, the equivalent architectural lesson is to attach its supported host-side observer early enough to see the relevant stock sources while preserving stock ChatGPT behaviour. Phase-2 Multi-AI evidence already uses CDP rather than a page-realm fetch wrapper; this document does not require changing that boundary.

## Evidence provenance

Important established evidence is tracked in the owning issues rather than only in prose here:

- DownloadConversation #116 — completed live stream can lead stale History; stream-only/visually-hidden records.
- DownloadConversation #135 — terminal sound classification and terminal ordering consequences.
- DownloadConversation #136 — User follow-up/stopwatch exchange semantics.
- DownloadConversation #139 — structured polling-timeout evidence.
- DownloadConversation #140 — reload resume terminal observation and v1 object-append identity preservation.
- DownloadConversation #148 — favicon lifecycle projection/browser candidate behaviour.
- Multi-AI #4 — host-side conversation-source observability model; established that these provider facts should be consumed as source evidence without prematurely defining canonical reconciliation policy.

## Maintenance rule

When live evidence teaches us something new about ChatGPT's API, stream shape, working-exchange identity, UI virtualization, browser integration, terminal-state ordering, or conversation-limit behaviour:

1. establish the evidence and regression where deterministic regression is possible;
2. update the owning issue;
3. update this document and `DESIGN.md` when the lesson is architectural;
4. propagate reusable provider facts to dependent projects such as Multi-AI without copying project-specific mechanisms as though they were provider requirements;
5. then make the production correction.

The goal is that future work can start from documented contracts rather than reverse-engineering the same system again.
