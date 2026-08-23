# TODO — DownloadConversation

## Table of Contents

- [Project continuity rules](#project-continuity-rules)
- [IDEAS](#ideas)
  - [ISSUE 22 — Investigate and optionally implement ordinary attachment-byte embedding.](#issue-22-investigate-and-optionally-implement-ordinary-attachment-byte-embedding)
  - [ISSUE 36 — Preserve ChatGPT artifact/download controls as Markdown links.](#issue-36-preserve-chatgpt-artifactdownload-controls-as-markdown-links)
  - [ISSUE 38 — Add a live Speak mode that reads newly arriving conversation text aloud.](#issue-38-add-a-live-speak-mode-that-reads-newly-arriving-conversation-text-aloud)
  - [ISSUE 43 — Investigate conversation-specific recorder UI startup failure near the conversation-length limit.](#issue-43-investigate-conversation-specific-recorder-ui-startup-failure-near-the-conversation-length-limit)
- [WORK_IN_PROGRESS](#work_in_progress)
  - [ISSUE 63 — Make conversation capture API-first while preserving extraction fallbacks and exporting Thoughts.](#issue-63-make-conversation-capture-api-first-while-preserving-extraction-fallbacks-and-exporting-thoughts)
- [READY](#ready)
  - [ISSUE 42 — Fix intermittent citation extraction failures during historical/Resume scans.](#issue-42-fix-intermittent-citation-extraction-failures-during-historicalresume-scans)
  - [ISSUE 61 — Keep persistent container IDs separate from actual mounted turn IDs.](#issue-61-keep-persistent-container-ids-separate-from-actual-mounted-turn-ids)
- [IN_REVIEW](#in_review)
  - [ISSUE 39 — Make Resume folder selection and permission recovery explicit and reliable.](#issue-39-make-resume-folder-selection-and-permission-recovery-explicit-and-reliable)
  - [ISSUE 41 — Instrument historical UAP extraction failures and define skip-on-incomplete recovery.](#issue-41-instrument-historical-uap-extraction-failures-and-define-skip-on-incomplete-recovery)
  - [ISSUE 45 — Reveal queued warnings as visible warnings are dismissed.](#issue-45-reveal-queued-warnings-as-visible-warnings-are-dismissed)
  - [ISSUE 49 — Show the active recorder phase in the general status state.](#issue-49-show-the-active-recorder-phase-in-the-general-status-state)
  - [ISSUE 50 — Reliably dismiss the general status popup on outside interaction.](#issue-50-reliably-dismiss-the-general-status-popup-on-outside-interaction)
  - [ISSUE 51 — Always record the script-initialized bootstrap identity event.](#issue-51-always-record-the-script-initialized-bootstrap-identity-event)
  - [ISSUE 52 — Identify recovery warning events by UAP and turn half.](#issue-52-identify-recovery-warning-events-by-uap-and-turn-half)
  - [ISSUE 53 — Use the userscript metadata version as the single runtime version source.](#issue-53-use-the-userscript-metadata-version-as-the-single-runtime-version-source)
  - [ISSUE 54 — Keep the screen on during active capture and log wake-lock/visibility changes.](#issue-54-keep-the-screen-on-during-active-capture-and-log-wake-lockvisibility-changes)
  - [ISSUE 55 — Show missing User and ChatGPT turn-half counts in capture progress.](#issue-55-show-missing-user-and-chatgpt-turn-half-counts-in-capture-progress)
  - [ISSUE 62 — Analyze current conversation index and pagination/network sources.](#issue-62-analyze-current-conversation-index-and-paginationnetwork-sources)
  - [ISSUE 64 — Preserve warning/error notifications until an actual extraction starts.](#issue-64-preserve-warningerror-notifications-until-an-actual-extraction-starts)
- [BLOCKED](#blocked)
  - [ISSUE 57 — Investigate unexpected capture deactivation during Resume forward reconstruction.](#issue-57-investigate-unexpected-capture-deactivation-during-resume-forward-reconstruction)
- [DONE](#done)
  - [ISSUE 1 — Allow persistent UAP indexing when ChatGPT temporarily hides the prompt TOC.](#issue-1-allow-persistent-uap-indexing-when-chatgpt-temporarily-hides-the-prompt-toc)
  - [ISSUE 3 — Support valid manual tail truncation and continuation.](#issue-3-support-valid-manual-tail-truncation-and-continuation)
  - [ISSUE 4 — Add warning/error notification UI and make the recorder control read as a button.](#issue-4-add-warningerror-notification-ui-and-make-the-recorder-control-read-as-a-button)
  - [ISSUE 5 — Prevent duplicate start dialogs and provide immediate start feedback.](#issue-5-prevent-duplicate-start-dialogs-and-provide-immediate-start-feedback)
  - [ISSUE 7 — Apply the selected diagnostics level to bootstrap/startup logging.](#issue-7-apply-the-selected-diagnostics-level-to-bootstrapstartup-logging)
  - [ISSUE 8 — Ensure exported images are followed by a Markdown line break.](#issue-8-ensure-exported-images-are-followed-by-a-markdown-line-break)
  - [ISSUE 9 — Handle prompt edits/branch replacement during live-tail capture.](#issue-9-handle-prompt-editsbranch-replacement-during-live-tail-capture)
  - [ISSUE 10 — Make viewport restoration consistently UAP-anchor based.](#issue-10-make-viewport-restoration-consistently-uap-anchor-based)
  - [ISSUE 11 — Detect materialized empty assistant slots directly from the DOM.](#issue-11-detect-materialized-empty-assistant-slots-directly-from-the-dom)
  - [ISSUE 12 — Show indexed collection progress and completion ETA.](#issue-12-show-indexed-collection-progress-and-completion-eta)
  - [ISSUE 13 — Replace reverse Resume extraction with direct indexed anchor lookup and forward reconstruction.](#issue-13-replace-reverse-resume-extraction-with-direct-indexed-anchor-lookup-and-forward-reconstruction)
  - [ISSUE 14 — Block user interaction while the recorder controls historical/recovery scrolling.](#issue-14-block-user-interaction-while-the-recorder-controls-historicalrecovery-scrolling)
  - [ISSUE 15 — Fix recorder state after Resume catch-up.](#issue-15-fix-recorder-state-after-resume-catch-up)
  - [ISSUE 16 — Keep the recorder popup open while the pointer is still over it.](#issue-16-keep-the-recorder-popup-open-while-the-pointer-is-still-over-it)
  - [ISSUE 17 — Return the recorder icon to normal stopped/idle state after an error is dismissed.](#issue-17-return-the-recorder-icon-to-normal-stoppedidle-state-after-an-error-is-dismissed)
  - [ISSUE 18 — Replace the visible “Test storage” control with an extensible recorder test matrix.](#issue-18-replace-the-visible-test-storage-control-with-an-extensible-recorder-test-matrix)
  - [ISSUE 19 — Upgrade the Test matrix into a persistent automatic/guided regression harness.](#issue-19-upgrade-the-test-matrix-into-a-persistent-automaticguided-regression-harness)
  - [ISSUE 20 — Show an undismissed-warning count badge on the recorder button.](#issue-20-show-an-undismissed-warning-count-badge-on-the-recorder-button)
  - [ISSUE 21 — Dismiss hidden warnings when the warning-summary row is dismissed.](#issue-21-dismiss-hidden-warnings-when-the-warning-summary-row-is-dismissed)
  - [ISSUE 23 — Keep** **`test-results.md`** **tables valid and parse Previous Result directly from them.](#issue-23-keep-test-resultsmd-tables-valid-and-parse-previous-result-directly-from-them)
  - [ISSUE 24 — Fix attachment/action classification.](#issue-24-fix-attachmentaction-classification)
  - [ISSUE 25 — Add complete reconciliation diagnostics.](#issue-25-add-complete-reconciliation-diagnostics)
  - [ISSUE 27 — Make collapsed/partial UAPs ineligible for hash comparison until complete content is obtained.](#issue-27-make-collapsedpartial-uaps-ineligible-for-hash-comparison-until-complete-content-is-obtained)
  - [ISSUE 28 — Preserve the user's viewport anchor during Resume scanning and restore it when reconciliation finishes.](#issue-28-preserve-the-users-viewport-anchor-during-resume-scanning-and-restore-it-when-reconciliation-finishes)
  - [ISSUE 29 — Audit and enforce common keyboard/focus/Esc behaviour across all recorder dialogs.](#issue-29-audit-and-enforce-common-keyboardfocusesc-behaviour-across-all-recorder-dialogs)
  - [ISSUE 30 — Reassess storage self-test UI.](#issue-30-reassess-storage-self-test-ui)
  - [ISSUE 34 — Fix omitted real conversational images in exported UAPs.](#issue-34-fix-omitted-real-conversational-images-in-exported-uaps)
  - [ISSUE 35 — Exclude citation/UI imagery from conversational-image export and emit valid citation Markdown.](#issue-35-exclude-citationui-imagery-from-conversational-image-export-and-emit-valid-citation-markdown)
  - [ISSUE 37 — Accept numeric UAP indices anywhere a UAP identifier is requested.](#issue-37-accept-numeric-uap-indices-anywhere-a-uap-identifier-is-requested)
  - [ISSUE 40 — Show the recorder version at the top of the status popup.](#issue-40-show-the-recorder-version-at-the-top-of-the-status-popup)
  - [ISSUE 44 — Work around Chromium stale File System Access state during recorder writes.](#issue-44-work-around-chromium-stale-file-system-access-state-during-recorder-writes)
  - [ISSUE 46 — Remove progress and ETA from the general status window.](#issue-46-remove-progress-and-eta-from-the-general-status-window)
  - [ISSUE 47 — Show elapsed running time beside ETA and preserve final duration.](#issue-47-show-elapsed-running-time-beside-eta-and-preserve-final-duration)
  - [ISSUE 48 — Keep Stop available throughout all active recorder phases.](#issue-48-keep-stop-available-throughout-all-active-recorder-phases)
  - [ISSUE 56 — Add a Debug diagnostics level for control-flow/state tracing without verbose DOM payloads.](#issue-56-add-a-debug-diagnostics-level-for-control-flowstate-tracing-without-verbose-dom-payloads)
  - [ISSUE 58 — Add deterministic regression tests for implemented issues awaiting review.](#issue-58-add-deterministic-regression-tests-for-implemented-issues-awaiting-review)
  - [ISSUE 59 — Do not start diagnostics until the recorder is opened or recording is requested.](#issue-59-do-not-start-diagnostics-until-the-recorder-is-opened-or-recording-is-requested)
  - [ISSUE 60 — Tolerate one unmatched trailing persistent turn container while ChatGPT is still constructing a UAP.](#issue-60-tolerate-one-unmatched-trailing-persistent-turn-container-while-chatgpt-is-still-constructing-a-uap)
- [WILL_NOT_FIX](#will_not_fix)
  - [ISSUE 2 — Write the User prompt immediately/provisionally.](#issue-2-write-the-user-prompt-immediatelyprovisionally)
- [LEGACY](#legacy)
  - [ISSUE 6 — Improve the initial Record-click availability check UX/performance.](#issue-6-improve-the-initial-record-click-availability-check-uxperformance)
  - [ISSUE 26 — Legacy Resume backward-anchor / forward reconstruction algorithm.](#issue-26-legacy-resume-backward-anchor-forward-reconstruction-algorithm)
  - [ISSUE 31 — Use** **`focus({preventScroll:true})`** **as the fix for the earlier From-here jump.](#issue-31-use-focuspreventscrolltrue-as-the-fix-for-the-earlier-from-here-jump)
  - [ISSUE 32 — Force open the User bookmark popup / scrape hidden React state for UAP mapping.](#issue-32-force-open-the-user-bookmark-popup-scrape-hidden-react-state-for-uap-mapping)
  - [ISSUE 33 — Walk every bookmark to discover** **`turn_id`** **values.](#issue-33-walk-every-bookmark-to-discover-turnid-values)

## Legend

- `IDEAS` Ideas not fully fleshed out.
- `WORK_IN_PROGRESS` Actively being worked on.
- `READY` Defined enough to start next.
- `IN_REVIEW` Implementation is complete and awaiting live verification or review before DONE.
- `BLOCKED` Work cannot proceed until a prerequisite decision, dependency, or result is available. The blocker must be stated.
- `DONE` Completed and verified enough to leave active planning.
- `WILL_NOT_FIX` Item will not be fixed. A reason is required.
- `LEGACY` Superseded approach kept only for compatibility, history, or cleanup tracking.

### Issue-numbering rules

- `ISSUE N` is permanent. Issues are never renumbered, reused, removed, or omitted.
- Every allocated issue number from `1` through the highest allocated issue must appear exactly once.
- Changing status moves the issue number between status lists without duplicating its title/details.
- New issue numbers are allocated monotonically; gaps are never intentionally created or reused.
- Generator validation rejects missing issue definitions, unassigned issues, duplicate status assignments, and unknown issue keys.
- `WILL_NOT_FIX` issues must state **Reason:**.
- `IN_REVIEW` is for completed implementations awaiting verification/review; it is not a blocker.
- `BLOCKED` is only for work that cannot proceed and must state **Blocked by:** or otherwise identify the blocking prerequisite/result.

## Project continuity rules

- The canonical project/repository name is `DownloadConversation`.
- The canonical current-design document is `DESIGN.md`.
- The canonical project history/work ledger is `TODO.md`.
- The TODO and any project DESIGN document are the persistent source of truth across conversation/session boundaries. Chat history alone is not an acceptable repository for an implementation requirement or a verified behavioural fix.
- Before changing code or changing/clarifying a requirement, first ensure the work and the governing behaviour are represented in `TODO.md`. Small follow-ups that remain inside the current WORK_IN_PROGRESS issue are added to that same issue; work outside its scope receives a new permanent ISSUE.
- Every code or requirement revision must update the TODO in the same revision whenever it changes, fixes, supersedes, or further specifies documented behaviour. Never leave stale wording such as an obsolete display field or old PASS criterion behind after the implementation contract changes.
- If a contract is too detailed or architectural to keep unambiguously in the TODO, create and maintain `DESIGN-Download-Conversation.md`, link/reference it from the relevant TODO issue, and update both documents when their shared contract changes. Do not let detailed design exist only in conversation history.
- At the start of a new session, and whenever resuming work after context loss, iteratively reread the current TODO and any DESIGN document(s) until the current WORK_IN_PROGRESS issue, inherited DONE/IN_REVIEW contracts, and latest verified fixes have been reconciled. Preserve prior verified behaviour by default; change it only when the design itself is found faulty or new evidence proves the previous fix/assumption wrong.
- Before delivering a revision, compare the implementation and tests against the documented contract, including shared UI/lifecycle/file-safety behaviour inherited from earlier issues. A new test/path must not silently reimplement or weaken an already established contract.
- The generator and generated TODO must describe the same requirements. If they diverge, reconcile from the latest verified TODO/project evidence and regenerate; do not carry a stale generator forward.

### IDEAS

#### ISSUE 22: **Investigate and optionally implement ordinary attachment-byte embedding.**
- Images are already embedded as Base64.
- Ordinary uploaded files (ZIP/PDF/etc.) are currently referenced through `attachments.json`/Markdown markers rather than embedded.
- Only implement byte retrieval after the live file-tile/download mechanism is proven reliable.

#### ISSUE 36: **Preserve ChatGPT artifact/download controls as Markdown links.**
- ChatGPT can render generated-file/download links as `button.behavior-btn` controls rather than ordinary `<a href>` elements.
- Current failure example exports downloadable artifacts as plain text.
- Future work must use a passive source of file identity/URL and must not activate download or preview controls during export.

#### ISSUE 38: **Add a live Speak mode that reads newly arriving conversation text aloud.**
- Add a recorder-like mode that follows newly arriving conversation content and feeds it to text-to-speech.
- Break responses into speakable units using sentence and block-element boundaries.
- Keep speech-specific segmentation/queueing separate from Markdown export.
- Flesh out controls, voice selection, pause/resume/stop behaviour, and exact segmentation rules before moving this issue out of IDEA.

#### ISSUE 43: **Investigate conversation-specific recorder UI startup failure near the conversation-length limit.**
- Observed on 2026-08-18: the same recorder userscript displayed its Record control on one ChatGPT conversation but did not display it on another conversation.
- DevTools confirmed that the userscript did execute on the failing conversation and emitted bootstrap events, so this was not a Tampermonkey URL-match, syntax, or global script-load failure.
- The failing conversation was at or near ChatGPT's conversation-length limit.
- After one additional message was appended to the end of that conversation, the recorder UI began appearing again without changing the userscript.
- Treat the conversation-length connection as a hypothesis, not a proven cause.
- Reproduce the failure on a conversation at/near the limit and compare the startup DOM/persistent-turn structure before and after appending a message.
- Instrument `makePanel()` startup with exportable string diagnostics: enter/exit, pre-existing `PANEL_ID`, style injection, panel creation, Record-button creation, append result, connected state, geometry, and computed visibility.
- Serialize bootstrap diagnostics as text rather than logging the event object as a second `console.*` argument, because exported DevTools logs currently preserve only `[Conversation recorder bootstrap] Object` and discard the useful fields.
- Determine whether the panel is never created, an exception aborts `makePanel()`, the panel is appended then removed, or it remains connected but invisible.
- 2026-08-18 recording failure on this conversation: `buildPersistentUapIndex()` aborted because two persistent wrappers shared `data-turn-id-container=request-6a8476c3-8e10-83ea-8a76-d04084c09a9d-6`. Source review confirmed the recorder incorrectly names these container identifiers `userTurnId`/`assistantTurnId`, inserts them directly into the duplicate check, and performs no GUID validation; `data-turn-id-container` is therefore being conflated with the mounted `section[data-turn-id]` identity.
- v0.6.14 diagnostic instrumentation: preserve both conflicting persistent wrappers in the fatal diagnostic before the duplicate-container assertion can discard the evidence. Record wrapper ordinal, `data-turn-id-container`, wrapper attributes, mounted `section[data-turn-id]` GUID(s), `data-turn`, `data-message-id`, nearby wrapper IDs/mounted turn IDs, and compact wrapper HTML. Keep the duplicate assertion in place until the conflicting wrapper semantics are understood; do not solve this by merely filtering non-GUID container IDs.

### WORK_IN_PROGRESS

#### ISSUE 63: **Make conversation capture API-first while preserving extraction fallbacks and exporting Thoughts.**
- Use the internal conversation API as the preferred identity/content source when its observed schema is available, but retain the existing DOM/indexed/scroll extraction paths as fallbacks so a backend/UI schema change does not immediately break recording.
- Do not require a DOM `data-turn-id` to construct a UAP. API records expose `metadata.turn_exchange_id` / `working_turn_id`; records sharing the same exchange can be grouped into one User/Assistant exchange. Page traversal uses `page_info.start_cursor`/`end_cursor` with `has_previous_page`/`has_next_page`; backward history requests use `/backend-api/conversations/<id>/messages?before=<start_cursor>&num_turns=...`.
- Preserve API message order and role/channel/content metadata. Select the User message plus the public Assistant output records for the exchange rather than treating every API record as a visible turn; system/tool/internal records remain available for correlation but are not blindly emitted as transcript text.
- Export user-visible assistant reasoning/commentary as a `## Thoughts` section between the User and `## ChatGPT` sections, matching the AgentPanelSpeaker-style distinction. Do not export hidden/internal chain-of-thought merely because the API contains internal `content_type: thoughts` records; only material that corresponds to user-visible Thoughts/commentary should be emitted.
- v0.6.50 establishes the Markdown `## Thoughts` slot and a DOM fallback that preserves materialized rendered thought text when available. The API-first mapper still needs to identify the exact user-visible commentary/reasoning records and feed them into this field.
- Images, attachments and citations should also prefer API metadata/resource identifiers. DOM extraction remains a verification/fallback layer rather than being deleted.
- v0.6.51 adds `Review: Conversation API Access`. The live automatic test uses only an in-memory copy of the original authenticated conversation request context, independently fetches the current conversation API page, validates the `messages[]`/`page_info` schema, and, when `has_previous_page` is true, follows `start_cursor` through the `/messages?before=` endpoint and validates that page too. Sensitive request context is never included in exported analysis/test output. The XHR analysis path now applies the same credential-header redaction as Fetch.
- v0.6.52 makes that live API-access test diagnostic instead of collapsing missing context into one generic skip. It records separate stages for observing a conversation API request, matching it to the current conversation, seeing Authorization, retaining the private in-memory context, fetching the initial page, validating its schema, and exercising the previous-page endpoint. The document-start interceptor now copies raw headers directly from multiple header representations before any redaction/serialization step, and Debug diagnostics report only stage booleans/header names/status/schema counts, never credential values.
- v0.6.53 extends Analyze structural/DOM evidence with a dedicated prompt-index-bar snapshot. At Analyze start and stop, record every `button[data-toc-item-index]`, its parsed/raw index, label/text, full button markup, and bounded surrounding parent markup, plus button count, valid-index count, unique-index count, minimum/maximum index, inferred `max+1` prompt count, duplicate/missing indexes, and a bounded common-container snapshot. This is specifically to correlate a fully visible index bar immediately after page load with the initial conversation API response without requiring any scrolling.
- v0.6.54 was an A/B isolation build for the observed refresh/login and missing-index-bar concerns. Disabling only the early Fetch/XMLHttpRequest interceptor did not change the forced-login-on-refresh behaviour, and the same behaviour continued with the userscript disabled entirely, clearing the recorder as the cause of that login issue. The prompt index bar was also present in both the v0.6.53 and v0.6.54 captures once the intended conversation was selected. Restore the early passive network capture for subsequent API-first work.
- v0.6.55 adds two automatic tests for separating complete API identity discovery from DOM rendering. `Review: API ID Enumeration Logic` uses synthetic overlapping pages to verify oldest-to-newest stable-message-ID ordering, page-boundary deduplication, and User-message/UAP-anchor extraction. `Review: Conversation API Full ID Enumeration` independently walks the current conversation from the initial API page through every `has_previous_page`/`start_cursor`, rejects cursor loops/schema failures, deduplicates stable message IDs, counts User/UAP anchor IDs, correlates that count with the visible prompt index when present, and reports how many enumerated User IDs are not currently mounted in the DOM. A live PASS with unmounted IDs directly verifies that the recorder can enumerate the conversation identity structure before the corresponding Markdown is rendered.
- v0.6.56 implements Phase 1 of the API-first implementation: a reusable conversation-spine builder over the fully paginated API record stream. The spine retains every unique API message in oldest-to-newest order with stable ID, role, channel, content type, timestamps/status, `end_turn`, `turn_exchange_id`, and `working_turn_id`, while separately indexing each User message as an ordered UAP anchor into that record stream. UAP record membership remains provisional for Phase 2 rather than assuming every record between consecutive User messages belongs to that UAP. Synthetic tests validate ordering/metadata/anchor behaviour, and the live `Logger - Branch · Maximal HD Set Wave` test passed with 604 records, 62 ordered UAP anchors, 13 complete API pages, and 60 anchors beyond the two currently mounted User turns. Phase 1 is therefore live-verified.
- v0.6.57 starts Phase 2 exact UAP grouping. The recorder builds candidate UAP membership from exact `turn_exchange_id` and `working_turn_id` matches against User anchors, reports conflicts instead of silently choosing between disagreeing identifiers, and keeps chronological-window membership only as a separately labelled fallback candidate rather than presenting it as exact. Automatic synthetic coverage verifies exact-match, conflict, and fallback classification. The live `Review: Conversation API UAP Grouping` test reports exact/fallback/ungrouped/conflicting record counts and verifies whether each User anchor has exactly one Assistant `final` record assigned by exact identity. The 62-UAP live run passed: 573/604 records grouped exactly, every User anchor paired with exactly one Assistant final record, no identity conflicts, 28 chronological fallback candidates, and 3 ungrouped records.
- v0.6.58 continues Phase 2 with unresolved-record linkage analysis rather than promoting chronology to identity. `Review: API UAP Linkage Logic` uses synthetic records to verify identifier-path extraction, cross-record identifier matching, and that free-form message content is excluded from diagnostics. `Review: Conversation API UAP Linkage` examines only the 31 unresolved live records, records their structural key paths and safe identifier-like scalar fields, compares those identifiers against exactly grouped records, and reports neighbouring exact records/UAP identities. This is intended to test whether tool/call/parent/source identifiers can provide a deterministic transitive path to a UAP, analogous in concept to Codex `call_id`/tool-result correlation, before any fallback is accepted.
- The v0.6.58 live linkage run exposed a flaw in the first generic matcher: values such as `recipient=all` and boolean `end_turn` were mistaken for identifier evidence and therefore made all 31 unresolved records look ambiguously linked to every UAP. The same log also exposed real reverse parent relationships: at least six unresolved records have their own message ID referenced by `metadata.parent_id` on an exactly grouped record. In addition, 27 of the 28 chronological fallback records are bounded immediately before and after by exact records from the same UAP; the remaining fallback is a visually-hidden system record that lies across the UAP 21/22 boundary, while the three completely ungrouped records are visually-hidden system records before the first User anchor.
- v0.6.59 refines Phase 2 linkage evidence: generic recipient/boolean coincidences are excluded from identity matching, call/parent/source/request/response-style identifiers remain eligible, reverse `record.id -> exact.metadata.parent_id` linkage is tested explicitly, and the live analysis separately reports records bounded on both sides by exact records from the same UAP versus records that cross an exact UAP boundary. This keeps same-UAP structural containment distinct from direct/transitive identity proof.
- The v0.6.59 live run verified the refined evidence model: 6 of the 31 unresolved records resolve uniquely through meaningful identifier linkage, 27 are bounded immediately before and after by exact records from the same UAP, and the only boundary-crossing fallback is a visually hidden system record between UAP 21 and UAP 22. The three records before the first User anchor are also visually hidden system records. No identity ambiguity remains.
- v0.6.60 adds the final Phase 2 grouping policy and verification. Exact exchange/working-turn identity remains primary; a unique call/parent/source/request/response linkage derives UAP membership transitively; otherwise a non-system record bounded on both sides by exact records from the same UAP is classified as structurally contained in that UAP. Visually hidden system records that lack exchange/linkage evidence remain conversation-global rather than being forced into an adjacent UAP. Synthetic and live tests require every API record to end as UAP-assigned, conversation-global, or an explicit conflict/unresolved failure, while preserving exactly one Assistant `final` record per UAP.
- **Phase roadmap — Phase 1 (DONE): API conversation spine.** Enumerate the complete conversation through API pagination first and construct the canonical ordered record/UAP-anchor spine independently of rendered DOM state.
- **Phase roadmap — Phase 2 (DONE): exact UAP grouping.** Determine which API records belong to each User/Assistant exchange using verified `turn_exchange_id`, `working_turn_id`, evidence-backed identifier linkage, and same-UAP structural containment. v0.6.60 was live-verified with all 604 records classified, no unresolved/conflicting records, and exactly one Assistant `final` per UAP.
- **Phase roadmap — Phase 3 (WORK_IN_PROGRESS): reconstruct visible User/ChatGPT content from API.** Convert ordinary visible User content and final Assistant content to transcript Markdown and compare against mounted DOM output; use the production DOM fallback whenever API materialization is unsupported or incomplete.
- **Phase roadmap — Phase 4: resolve API file identity and download metadata.** Verify the semantics/stability of `file_id`, `library_file_id`, `local_path`, `display_name`, and any revision/version fields; probe `/simple`, authenticated download resolution, headers/HEAD support, size, timestamps, ETag/checksum, preview metadata, and signed-target lifetime without treating temporary signed URLs as persistent identity.
- **Phase roadmap — Phase 5: optional local attachment archiving.** Add a persistent `Download attachments locally` checkbox. When enabled, archive payloads under `attachments/`, link them from Markdown with relative paths, and retain API identity/association metadata in `attachments.json`. Exact-filename collisions in fresh recordings should first be treated as possible repeated references and verified from API identity rather than overwritten. Resume collisions may download a temporary candidate for byte comparison and, when different, present filename/length/available preview and let the user decide; subsequent occurrences of the same verified collision identity reuse that decision.
- **Phase roadmap — Phase 6: images and multimodal attachments.** Handle `image_asset_pointer`, `sediment://file_...`, file/image metadata, unavailable/expired resources, and API-backed local archiving while retaining current DOM/image fallback behaviour.
- **Phase roadmap — Phase 7: citations and references.** Translate API `content_references`, grouped search results, source URLs, titles, and related metadata into the existing Markdown citation representation, validated against rendered citation pills.
- **Phase roadmap — Phase 8: public Thoughts.** Correlate API reasoning/commentary records with material actually exposed in the user-visible Thoughts UI and export only that public material; never emit hidden/internal chain-of-thought merely because an API record has a reasoning-related content type.
- **Phase roadmap — Phase 9: make normal recording API-first.** Use the API spine/grouping/materializers as the primary recording path and invoke scrolling/rendered extraction only for UAPs or resources that require fallback.
- **Phase roadmap — Phase 10: Resume/rebuild integration.** Use stable API User/UAP identity plus exchange identity/content hashes for Resume and rebuild mapping, including branches and attachment-collision decisions, while preserving deterministic recovery.
- **Phase roadmap — Phase 11: retire obsolete primary dependencies while preserving fallbacks.** Stop requiring the prompt index bar, full-conversation scrolling, or persistent-wrapper inference for primary discovery once API-first live verification is complete, but retain those mechanisms as compatibility/recovery fallbacks.
- The v0.6.60 live verification completed Phase 2: across the 604-record / 62-UAP test conversation, 573 records grouped by exact exchange identity, 6 by meaningful identifier linkage, 21 by same-UAP structural containment, and 4 visually hidden system records remained conversation-global; there were 0 unresolved records, 0 conflicts, and exactly one final Assistant record per UAP.
- v0.6.61-v0.6.65 began Phase 3 conservative API materialization. On the 62-UAP live conversation, 49 UAPs could be materialized from the API using supported ordinary User text and Assistant `final` text; 13 required rendered-DOM fallback, consisting of 12 content-reference/citation cases and 1 attachment case. Unsupported API content remains an explicit fallback rather than being silently simplified or dropped.
- Phase 3 testing exposed that the old persistent-index/scroll assumptions were not reliable enough to serve as the production fallback on the current paginated/virtualized ChatGPT DOM. Work therefore shifted temporarily to making the fallback extractor independently reliable before continuing richer API materialization.
- v0.6.66-v0.6.72 developed a non-index DOM fallback that discovers turns by scrolling backward from the bottom with `scrollIntoView()`, extracts each mounted turn through the real `extractTurn()` path (including citations, images, attachments, and other rendered content), and is intended to make a forward recovery pass after reaching the top. Viewport restoration is deliberately not part of this fallback traversal.
- The fallback timeout policy uses 15 seconds only as an absolute upper bound. DOM/mount progress is polled and settled promptly so successful navigation continues without paying a routine 15-second delay. v0.6.69 demonstrated that treating 15 seconds as a mandatory delay substantially increased runtime without increasing capture coverage.
- v0.6.71 corrected the verification identity model so DOM wrapper/turn IDs are not compared as though they were API message IDs. The live run reached the oldest known content while exposing a small real coverage gap, which is why forward recovery remains necessary rather than treating one backward pass as sufficient.
- v0.6.72 removed the full API-spine/grouping prerequisite from DOM fallback extraction. The fallback must be able to operate when API/index discovery is unavailable or incomplete; API comparison may be used only as an independent oracle after extraction, not as a prerequisite for the fallback itself.
- v0.6.73 promotes the backward/forward DOM implementation out of test-only code into the production fallback function `extractConversationDomFallback(...)`. `Review: DOM Backward Extraction` now invokes that same production fallback implementation rather than maintaining a separate scrolling/extraction pathway.
- The production fallback must use the same extraction semantics when invoked by normal recording: backward discovery, forward recovery, citation/image/attachment extraction, deduplication, ordering, timeout behaviour, and progress accounting. The test may force the fallback branch and assert its result, but must not reimplement the fallback.
- The normal recorder is not API-first yet. Phase 9 still owns the production dispatcher change: normal recording must first use the API spine/grouping/materializers and invoke `extractConversationDomFallback(...)` only for unsupported, incomplete, or unavailable API content.
- The production DOM fallback must reuse the recorder’s established collection-progress/status machinery instead of maintaining a parallel fallback-only banner or timer. During backward discovery the total may be unknown and the progress line is `n / ? UAPs — missed: x, y`; after top discovery it uses the normal `n / m UAPs (p%) — missed: x, y` form. `missed` starts at `0, 0`, increments only for defensibly known missing User/ChatGPT halves, and recovery is represented only by decrementing the corresponding counter. The timing line is `Elapsed: ... — ETA: ...` on one line (or elapsed only when ETA is intentionally suppressed). The established separator/advisory follows exactly: `—\nTo prevent stalling, DO NOT put this tab in\nthe background.  Covering the window may be ok.`
- v0.6.76 fixes the v0.6.75 top-boundary loop and backward missed-counter semantics. The top detector no longer requires a literal near-zero `scrollTop`; it accepts a stable upward fixed point after four consecutive stable `scrollIntoView()` probes, regardless of the layout-specific top offset (the live failure stabilized near 51.85 px). Top probing is bounded to six attempts: real older-content progress returns to backward traversal, while a stable non-progress state either confirms the top or fails explicitly instead of retrying forever. Backward progress now starts `missed: 0, 0` and counts only known internal same-role gaps, so forward recovery reduces the corresponding counter when the missing half is inserted.
- v0.6.75 corrects the forward-recovery progress display to the established semantics: the progress line is `n / m — missed: x, y`; recovering a missing User or ChatGPT half is shown only by decrementing the corresponding `x` or `y`, with no separate recovered-count text.
- v0.6.74 strengthens the production DOM fallback after the v0.6.73 false-positive PASS. `client-created-root` exhaustion is no longer sufficient to declare the top: the fallback performs repeated `scrollIntoView()` boundary probes and requires a stable oldest turn, stable wrapper count/scroll height, the effective upper scroll boundary, and separation from the original bottom viewport before accepting the top. Forward recovery must then actually navigate and re-encounter the original bottom anchor in the viewport; a nontrivial run with zero forward navigation can no longer PASS. The fallback progress line now includes `missed: x, y` immediately after `n / m`, and diagnostics/reporting include forward-start/bottom-reencounter evidence.
- The production fallback inherits the normal active-operation lifecycle: the whole-run elapsed timer starts once, survives backward/forward/recovery/finalization phase changes, refreshes while progress is stalled, and on successful completion persists in the general status/details popup as `Last completed run: ...`. Stop availability/state, wake-lock behaviour, visibility diagnostics, and the foreground-tab advisory must use the shared recorder machinery rather than fallback-specific duplicates. The fallback deliberately retains its separate no-viewport-restoration rule.
- Forward recovery must be a genuine progressive top→bottom sweep through successive virtualized/mounted windows, harvesting each frame and recovering known holes. Merely scrolling directly to the original bottom anchor and observing it again is not sufficient evidence of recovery coverage.
- `Review: DOM Backward Extraction` must fail if any known missing half remains. A valid PASS requires `missed: 0, 0`, true top confirmation, a real forward sweep, confirmed bottom completion, unique identities, materialization of every captured turn, and a final chronological order consistent with the independently established oldest and bottom turns. Rename/interpret the existing `all_turns_extracted` diagnostic so it cannot imply completeness when it merely means every captured turn has Markdown.
- Production fallback verification must cover actual UAP composition and recording assembly, not only an in-memory `turns[]` array. Incomplete User/ChatGPT halves must use the established split-half recovery staging and validated `conversation-rebuild.tmp` consolidation path; do not directly commit an incomplete inferred UAP sequence. Final file replacement, metadata byte offsets/hashes, attachment mapping, and layout/hash validation must retain the existing file-safety invariants.
- The v0.6.76 live run verified the stable fixed-point top detector: it reached oldest User `bbb21a6e-f194-4ff6-b07f-825dd8ab5bf5`, accepted the effective top near 51.85 px after bounded stable probes, and returned to the bottom. However the test PASS was semantically invalid: it made only one forward navigation step, finished with `missed: 0, 1`, and its final `first_turn_id` did not equal the established oldest turn. The fallback-specific banner also violated the established status composition and did not persist the final whole-run elapsed duration.
- **Work in progress:** repair the shared-progress integration, exact banner composition/final elapsed persistence, true progressive forward sweep, missed-half PASS criteria, final ordering, and production staging/rebuild verification exposed by the v0.6.76 live run. Re-run the production fallback test until those contracts are all verified, then resume Phase 3 API materialization.

### READY

#### ISSUE 42: **Fix intermittent citation extraction failures during historical/Resume scans.**
- v0.6.8 live Resume diagnostics show citation extraction can intermittently fail even when other citation groups in the same run export successfully.
- Observed failure: `citation-group-extraction-failed` with `Citation popup opening did not occur within 5 seconds.`
- Investigate why the citation pill popup sometimes does not open during historical/Resume extraction and make citation capture robust without silently dropping citation Markdown.
- Preserve the existing successful multi-source citation traversal/formatting behaviour from ISSUE 35.

#### ISSUE 61: **Keep persistent container IDs separate from actual mounted turn IDs.**
- The `full 11` run proved that `data-turn-id-container` is not necessarily the same identity as the mounted `section[data-turn-id]` GUID. v0.6.42 still assigned container IDs to fields named `user_turn_id` and `assistant_turn_id`, then compared real mounted turn GUIDs against maps built from those container IDs.
- v0.6.43 gives each indexed UAP distinct `user_container_id` / `assistant_container_id` fields and resolves `user_turn_id` / `assistant_turn_id` from the actual mounted sections whenever they are present. Unmounted entries retain the container ID only as a temporary lookup token until their real mounted turn ID is known.
- Turn materialization lookup now accepts either identity: it first searches for the exact mounted turn GUID, then resolves the persistent container and looks for the requested role inside that container. A learned turn-ID-to-container association lets replacement/devirtualized wrappers be found after the real turn GUID has been observed.
- Mounted-turn validation is now performed by the section's owning persistent container and expected role, rather than by incorrectly looking the mounted GUID up in a container-ID map.
- When a User or ChatGPT section mounts during extraction, the indexed entry is rebound to its actual `data-turn-id` before UAP composition, hashing, metadata, and assistant association tracking use that identity.
- Automatic test `Review: Container/Turn ID Separation` uses deliberately different persistent container IDs and mounted turn GUIDs and verifies that both identities resolve to the same mounted sections without conflation.
- The subsequent `full 12` reproduction still failed before capture because positional wrapper roles were assigned before the live wrapper structure had been logged. The mounted User turn was found in a container that the positional model had labelled assistant, but the saved Verbose diagnostics did not include enough pre-assertion DOM structure to determine the real ordering.
- v0.6.44 adds pre-assertion instrumentation without changing the pairing algorithm: Verbose records `persistent-turn-index-wrapper-structure-before-role-validation` with every top-level wrapper ordinal, `data-turn-id-container`, wrapper attributes, directly owned mounted sections, each section turn ID/role, message IDs/author roles, and outerHTML truncated to 8000 characters per wrapper. Debug records `persistent-turn-index-positional-role-assignments` with the exact ordinal/container mapping the current algorithm is about to treat as User versus ChatGPT. Both records are emitted before role-consistency assertions can abort the scan.
- The `full 13` Verbose reproduction established the actual ten-container layout. Ordinals 4, 6, and 8 were mounted User turns; ordinals 5, 7, and 9 were mounted ChatGPT turns; in each mounted case the wrapper `data-turn-id-container` GUID matched the mounted `section[data-turn-id]` GUID. This proves the persistent sequence alternates User/ChatGPT with even ordinals as User and odd ordinals as ChatGPT, and that `client-created-root` at ordinal 0 is the first User container rather than a non-turn prefix.
- v0.6.45 removes the old one-root-plus-pairs arithmetic. Complete UAPs are now indexed as wrapper pairs `[0,1]`, `[2,3]`, ...; an odd wrapper count means only the final even-ordinal User container is deferred while waiting for its ChatGPT partner. Every currently mounted section is treated as authoritative role evidence and must agree with the alternating sequence before UAP entries are constructed.
- v0.6.45 also fixes the Verbose mounted-section collector and mounted-turn lookup for the case where the top-level persistent wrapper is itself the mounted `section[data-turn-id]`; the prior descendant-only query could report an empty `mounted_sections` array even though the wrapper outerHTML was the turn section.
- The virtualization snapshot was updated to the same corrected ordinal model: it now includes ordinal 0, counts mounted roles from the actual mounted sections rather than old odd/even assumptions, and reports complete UAP count as `floor(wrapper_count / 2)`.
- Automatic test `Review: Persistent Role Layout` reproduces the `full 13` ten-wrapper shape with mounted User/ChatGPT sections at ordinals 4 through 9 and verifies that it yields five UAPs with `client-created-root` as the first User container. The trailing-container and container/turn-ID separation tests were updated to the same corrected layout model.
- The `full 14` live run disproved the v0.6.45 root-role inference. `client-created-root` was not a real mounted User turn, the persistent wrapper set grew during the scan, and the recorder falsely finalized from a small current window rather than the full conversation. The visible index bar also disappeared on some conversations as part of an apparent paginated-messages rollout, so this issue is active again rather than awaiting verification.
- **Work in progress:** determine the current complete-index/paginated-window model before replacing the stale positional assumptions.

### IN_REVIEW

#### ISSUE 39: **Make Resume folder selection and permission recovery explicit and reliable.**
- Resume/Continue must not depend exclusively on the previously saved directory handle/path.
- The Start dialog must expose a dedicated `Resume` button beside a folder selector that shows the remembered recording folder and offers `Select another folder…`.
- If the remembered folder requires permission after a browser/computer restart, request that permission immediately from the Resume button user gesture before slow IndexedDB, storage-root, metadata, or reconciliation work can consume transient user activation.
- If `Select another folder…` is chosen, open the directory picker directly from the Resume user gesture.
- Validate a newly selected directory as an existing compatible recording before replacing the remembered directory handle. A failed/cancelled selection must leave the previously remembered handle untouched.
- Do not silently create a new recording when the user intended to continue an existing one.
- v0.6.6 added `Resume from another folder…`; v0.6.20 replaces the split Resume choices with the explicit Resume button/folder-selector model and caches the saved handle/permission state for the start dialog.
- v0.6.20 also secures saved-folder permission before loading the optional storage-root handle. This directly addresses the observed v0.6.19 failure where a 26.8-second storage-root lookup exhausted user activation before `requestPermission()`.
- v0.6.21 applies the recorder's existing dark palette to the Resume folder selector, including `color-scheme: dark`, explicit dark option backgrounds, light text, and matching hover/focus/disabled states so Chrome's native select does not become illegible inside the dark recorder dialog.
- v0.6.22 cleans up the Start dialog layout: Entire conversation and From here are left-aligned with the form; the Resume action reads `Resume in`; the saved-folder option contains only the folder name; and Cancel remains right-aligned in the footer.
- v0.6.22 removes the guessed 260-420 px Resume-select sizing. The browser first gives the native select its intrinsic width from the actual option text, then the dialog expands to the exact row width required. The select is constrained only when the available viewport width is the limiting factor.
- The v0.6.22 Resume-folder selection/permission flow was live-browser verified.
- v0.6.28 makes the Resume click immediately transform the Start dialog into a blocking `Resuming recording…` progress window before any slow preparation. The same window reports folder access/selection, metadata loading, recovered-turn-state loading, and conversation preparation until the normal recorder recovery overlay takes over.
- The permission or directory-picker call still begins directly from the Resume user gesture so immediate visual feedback does not reintroduce the transient-user-activation failure fixed in v0.6.20.
- v0.6.40 adds automatic test `Review: Resume Startup Feedback`, which clicks a synthetic saved-folder Resume action and verifies that the blocking `Resuming recording…` UI appears synchronously before permission preparation completes.
- **In review:** live browser verification that the blocking Resume progress window appears immediately and reports preparation stages until the normal recovery UI takes over.

#### ISSUE 41: **Instrument historical UAP extraction failures and define skip-on-incomplete recovery.**
- Current historical Entire/Resume scans can time out for two distinct reasons: a target turn never materializes, or a turn is mounted and visibly populated but `extractTurn()` still returns no extractable result.
- v0.6.8 instrumentation distinguishes mount/materialization failures from mounted-but-unextractable failures and records targeted DOM/extraction state plus virtualization information.
- v0.6.9 introduced dynamic harvesting of all wanted UAPs in the contiguous currently materialized window, with a 15-second historical capture timeout and no `start` / `end` / `center` recovery jiggle.
- v0.6.10 proved that aggressive forced jump-back retries and immediate in-place hole repair are not viable on a long conversation.
- v0.6.11 recovery policy: the main forward pass never deliberately jumps backward. Previously incomplete UAPs may be recovered opportunistically inside later materialized windows.
- At the end of the forward pass, run explicit recovery sweeps until all incomplete UAPs are recovered or an entire sweep makes zero progress.
- Stage recovered UAPs under `recovered-uaps/`; do not rewrite `conversation.md` during scanning.
- After scanning/recovery, validate layout and staged recovery files, then perform one sequential rebuild through `conversation-rebuild.tmp`.
- Resume uses the same sweep/final-rebuild policy.
- v0.6.11 changed diagnostics storage to append-only `diagnostics.jsonl` with bounded in-memory history and compact virtualization snapshots.
- 2026-08-18 live run: the forward scan completed with 285 incomplete UAPs. Recovery then spent about 15 seconds per unresolved UAP while the UI still showed an exhausted forward-scan ETA. The run was stopped after about 19 minutes with most holes still unresolved.
- v0.6.12 instrumentation added logging around the initial recovery `scrollIntoView({block:'center'})`: target wrapper identity, before/after geometry and scroll position, intersection/mount state, first observed mount time, and terminal wait result. No recovery-navigation policy change was intended.
- 2026-08-18 partial live recovery run verified that the initial recovery jump is functioning: 111/111 observed initial recovery navigations changed scroll position, sweep 1 reduced unrecovered incomplete UAPs from 157 to 71 in the supplied snapshot, and successful mounts were observed as late as about 14.1 seconds against the 15-second historical timeout. Continue evaluating whether the timeout needs adjustment; do not change recovery navigation based on the earlier suppressed-navigation hypothesis.
- v0.6.16 redefines collection progress so `n / m` always means successfully captured UAPs / required UAPs, and therefore `m - n` is always the number still left to capture. Full and From Here keep `m` fixed to the requested range; skipped/incomplete UAPs do not increment `n`, while successful opportunistic or sweep recovery increments `n` exactly once.
- Resume v0.6.16 keeps `m` fixed from the recording's starting UAP through the current conversation end, regardless of whether each UAP was previously captured, skipped, or not yet visited. Resume initializes `n` from already valid captured/staged UAPs in that range and increments only when another required UAP is actually captured. Phase changes do not reset `n / m`.
- v0.6.16 ETA is based on wall-clock time between actual increases in `n`, so failed/time-out attempts are naturally included in the effective completion rate. Entering recovery resets only the ETA sampling window, not the counters. After 10 seconds with no capture progress, recovery displays `ETA: waiting for recovery progress…` instead of a false zero. Finalization preserves `n / m` but hides the UAP ETA because file rebuild work is not measured in UAPs.
- 2026-08-19 live recovery evidence showed that an unresolved UAP can remain inside the currently devirtualized/materialized area and then be retried against the same stale DOM state. This is not limited to the last remaining UAP; it applies whenever an unresolved target is already mounted/intersecting or is expected to materialize in the active window but does not become extractable.
- v0.6.17 recovery rule: before a direct recovery-sweep retry of an unresolved UAP that is still mounted or marked `data-is-intersecting="true"`, navigate to a distant endpoint, confirm that both target turn sections are unmounted and both wrappers are no longer intersecting, then navigate back through the normal capture path. If the recorder cannot confirm that it actually left the target's materialization area, do not retry against the same stale state.
- v0.6.17 also prevents the just-failed direct recovery target from being immediately retried again by the same materialized-window opportunistic harvest. Other incomplete UAPs that newly materialize in that window may still be harvested normally.
- 2026-08-19 live evidence from UAP 341 showed the final assistant `section[data-turn-id]` mounted and intersecting with no `[data-message-author-role="assistant"]` subtree; the recorder nevertheless kept retrying it because empty-assistant classification was gated on the existence of a following UAP.
- v0.6.18 invariant: mounted `section[data-turn-id]` presence is authoritative for materialization. A mounted assistant section with no assistant-message subtree is a completed empty assistant slot. Do not require or navigate to a following UAP for confirmation, including at the conversation tail.
- A later v0.6.19 Entire run over 342 UAPs ended the forward pass with 259 incomplete UAPs and then spent about 1h 52m 43s in a recovery sweep that recovered 0 of 259. This is a separate severe historical materialization/recovery failure and remains unresolved.
- v0.6.24 makes recovery turn-granular instead of treating an incomplete UAP as indivisible. A successfully extracted User or Assistant half is preserved even when its partner does not materialize.
- New recovery staging uses two independent immutable files per incomplete UAP: `<user-turn-id>.user.json` and `<user-turn-id>.assistant.json`. Updating one half never rewrites a combined recovered-UAP JSON file; the presence of those files is the recovery-state index. Legacy whole-UAP `recovery_file` data remains readable for recordings created by older versions.
- During a recovery sweep, each missing half gets at most one normal materialization/extraction opportunity. If a half does not mount, it is deferred to the next sweep; there is no immediate per-UAP leave/return retry and no same-sweep opportunistic retry of a previously failed UAP.
- If the first missing half fails to materialize, the recorder still preserves the partner half when that partner is already mounted, but it does not spend a second full timeout trying to force the partner into view.
- A full leave/unmount cycle is now reserved for the boundary between recovery sweeps when the first unresolved target would otherwise be retried in the same active materialization area. It is no longer paid for every unresolved UAP.
- The initial forward scan preserves an already captured User half when the Assistant half times out. Final rebuild occurs only for UAPs whose two staged halves are complete; single-half files remain intact for later sweeps or Resume.
- Progress remains UAP-based: recovering one half does not increment `n`; `n` increments only when the second required half completes the UAP.
- Runtime `VERSION` v0.6.30 (`@version` was still incorrectly 0.6.28) keeps the initial Entire/From-here historical capture timeout at 15 seconds and escalates the per-turn timeout for recovery sweeps by 15 seconds per sweep: sweep 1 = 30 s, sweep 2 = 45 s, sweep 3 = 60 s, and so on. A turn that mounts earlier is processed immediately; the value is only the maximum wait for that sweep.
- Recovery sweep start/completion and deferred-turn diagnostics record the actual `timeout_ms` used so long runs can be audited against the escalation policy.
- v0.6.32 fixes Resume recovery finalization scope: staged recovered halves are carried through pre-reconciliation recovery and later post-forward recovery instead of calling `finalizeStagedRecoveredUaps()` between those phases.
- Resume recovery sweep numbering is now continuous across those phases. If pre-reconciliation recovery ended on sweep 2 at 45 seconds, the next post-forward recovery attempt is sweep 3 at 60 seconds rather than restarting at sweep 1 / 30 seconds.
- Resume performs one staged-recovery consolidation only at the true terminal recovery point. Complete staged UAPs are incorporated then; genuinely one-sided turn-half files remain in `recovered-uaps/` for a later Resume.
- v0.6.33 replaces direct `scrollIntoView()` target navigation for Entire/From-here historical capture with adaptive half-viewport stepped scrolling on the actual conversation scroll container. Each step uses `scrollBy(..., behavior: 'auto')`, yields to the browser for a frame, and stops immediately if the required turn mounts; the final step centers the persistent wrapper rather than teleporting to it.
- The 15-second initial timeout and escalating recovery timeouts measure mount/extraction waiting after traversal reaches the target; time spent scrolling through the conversation does not consume that timeout budget.
- Recovery v0.6.33 approaches each unresolved UAP from the preceding UAP first, then scrolls forward into the missing turn using the same half-viewport stepping. Each missing half still receives at most one normal attempt per sweep, and a failed half is deferred to the next sweep rather than immediately forced through a leave/return retry.
- The older endpoint-based forced-rematerialization step between recovery sweeps is superseded by the preceding-UAP scroll-through traversal so recovery no longer teleports to distant endpoints solely to provoke virtualization.
- v0.6.34 removes `requestAnimationFrame()` from the stepped capture/recovery traversal critical path because Chrome can suspend animation-frame callbacks when the page is hidden or the screen is locked. Each scroll step now waits for either a target/DOM mutation through `MutationObserver` or a short 75 ms event-loop fallback before continuing.
- Visibility transitions are logged separately so long capture stalls can be correlated with the browser page becoming hidden and later visible.
- v0.6.35 restores coarse positioning for capture traversal: the first requested UAP is reached with one direct `scrollIntoView()` jump, and later distant index gaps are coarsely repositioned before stepped scrolling resumes. Recovery likewise uses coarse positioning to reach a distant recovery area and only scrolls through the local target area.
- v0.6.37 sets the scroll-vs-jump locality threshold to 7 UAP indices. If the next uncaptured/recovery target is within 7 UAPs of the current traversal anchor, continue scrolling so ChatGPT can materialize naturally; if it is farther away, coarse-position near the target and then resume local scrolling.
- v0.6.37 applies the same coarse/local rule to Resume anchor validation so `resume-anchor-check` no longer walks through dozens of UAPs to reach a distant candidate.
- v0.6.37 deletes the obsolete stalled-turn `start` / `end` / `center` `scrollIntoView()` jiggle path entirely. A stalled target is never repositioned in place; it times out/defer and is retried only through a later normal traversal or recovery sweep.
- Materialized wanted UAPs in the current contiguous window continue to be harvested immediately so later traversal does not navigate back to content that was already available.
- v0.6.38 fixes duplicate batch extraction during sequential capture. Once an indexed UAP has been emitted through `onUap`, its index is placed in a consumed set; later materialized-window harvesting skips consumed indices as well as currently buffered indices. This prevents an already captured/written UAP from being extracted again merely because it remains materialized while a subsequent target is processed.
- v0.6.40 adds automatic test `Review: Recovery Policy` for the 15/30/45/60-second timeout progression, the 7-UAP local traversal threshold, and split `.user.json` / `.assistant.json` staging filenames. Live ChatGPT virtualization/materialization behaviour still requires review.
- **Work in progress:** live verification of the 7-UAP scroll-vs-jump threshold, Resume-anchor coarse positioning, immediate materialized-window harvesting, and complete removal of the old jiggle path.

#### ISSUE 45: **Reveal queued warnings as visible warnings are dismissed.**
- When a visible warning is dismissed and additional warnings are hidden by the popup's row limit, immediately promote the next hidden warning into the visible list.
- Keep the active warning queue compact: each persisted warning stores only a stable notification ID plus the byte offset/length of its record in `diagnostics.jsonl`; warning text is hydrated from that append-only file only when the warning becomes visible. Keep only currently visible warning text cached in memory.
- If diagnostics persistence is unavailable or the configured diagnostics level excludes that warning, retain only the small rendered warning text as a fallback for that active warning.
- Dismissed warnings are removed from the in-memory active-warning queue entirely; their durable diagnostic record remains in `diagnostics.jsonl`.
- The `N more warnings not displayed` row retains an `×`. Clicking it must not clear anything immediately; show a Yes/No confirmation explaining that all currently unviewed warnings will be cleared.
- Capture the exact IDs represented by the hidden-warning set before opening that confirmation dialog. If new warnings arrive while the dialog is open, confirming clears only that captured set and never the later warnings.
- Preserve the recorder-button warning count so it continues to represent all active undismissed warnings, including those not currently visible in the popup.
- v0.6.26 implements the compact diagnostic-reference warning queue, on-demand visible-warning hydration, immediate promotion after individual dismissal, and confirmed exact-set bulk clearing of hidden warnings.
- The existing automatic `Warning Overflow` test verifies visible dismissal promotes the next hidden warning and that clearing a captured hidden-ID set does not remove a warning that arrived later.
- **In review:** live browser verification of warning promotion, diagnostic-backed hydration, and the hidden-warning confirmation flow before moving this issue to DONE.

#### ISSUE 49: **Show the active recorder phase in the general status state.**
- The general status popup must not report `State: stopped` while a long-running recorder operation is still active.
- Keep the existing lifecycle state model, but while collection progress is active display `recording - <phase>` using an explicit operation phase.
- Supported active display phases are `collecting`, `resuming`, `recovering`, `finalizing`, and `stopping`.
- When no long-running operation is active, fall back to the ordinary lifecycle state such as `stopped`, `waiting`, or `error`.
- v0.6.25 stores the phase with collection progress and renders the general status state through that phase-aware view.
- v0.6.40 adds automatic test `Review: Phase State` for collecting/resuming/recovering/finalizing/stopping and lifecycle fallback.
- **In review:** live browser verification of the displayed state during collection, Resume, recovery, finalization, stopping, waiting, and error states.

#### ISSUE 50: **Reliably dismiss the general status popup on outside interaction.**
- Preserve the existing hover/focus behaviour so keyboard focus inside the recorder can legitimately keep the popup open.
- Do not rely only on recorder-local `mouseleave` and `focusout` events to close the popup, because the popup can otherwise remain stuck open after unrelated page interaction.
- A pointer interaction outside the recorder panel must explicitly dismiss the popup; if recorder focus is stale, blur that focused recorder control first.
- v0.6.25 adds a capture-phase outside `pointerdown` handler while retaining the existing hover/focus grace behaviour for interactions inside the recorder.
- v0.6.40 adds automatic test `Review: Popup Dismissal` for outside-pointer dismissal plus stale-focus clearing.
- **In review:** live browser verification that mouse-away and outside page interaction close the popup while genuine keyboard focus inside still keeps it open.

#### ISSUE 51: **Always record the script-initialized bootstrap identity event.**
- `script-initialized` is the recorder bootstrap identity record and must always be emitted once per userscript initialization regardless of the selected diagnostics verbosity.
- Keep its event level as `verbose` for classification, but bypass the configured level filter for this event only so the recorder version is always available in the local/bootstrap log and later `diagnostics.jsonl` flush.
- v0.6.27 adds an explicit bootstrap-level-filter bypass used only by `script-initialized`; all other bootstrap/startup events continue to obey the configured diagnostics level.
- 2026-08-20 `full 10` showed that the forced identity event could still be lost before diagnostics persistence: a navigation/hash reset cleared `bootstrapLog`, so `diagnostics.jsonl` began with later Warning records instead of `script-initialized`.
- v0.6.40 preserves the unique `script-initialized` event across bootstrap navigation resets while still discarding ordinary stale bootstrap chatter. Automatic test `Review: Bootstrap Identity` runs at Errors level and verifies exactly one identity event survives while ordinary verbose bootstrap events remain filtered.
- **In review:** live verification that a fresh recording writes `script-initialized` as the first persisted diagnostic even if navigation/hash state changes before the recording directory is opened.

#### ISSUE 52: **Identify recovery warning events by UAP and turn half.**
- Runtime `VERSION` v0.6.29 (`@version` was still incorrectly 0.6.28) gives `scan-target-timeout`, `incomplete-turn-recovery-deferred`, and `incomplete-turn-recovery-staged` a shared self-identifying warning format.
- Each row now displays the 1-based UAP number, the UAP/User turn ID, the role as `User` or `ChatGPT`, and the specific turn ID so simultaneous recovery events cannot be mistaken for three stages of the same turn.
- `scan-target-timeout` now records `uap_turn_id` in the diagnostic event itself rather than relying only on the specific timed-out turn ID.
- The event meanings remain distinct: timeout means the mount/extraction deadline expired; deferred means that missing half is left for a later sweep; staged means that recovered half was successfully written to its staging file.
- v0.6.40 adds automatic test `Review: Recovery Warning Context` for UAP number, UAP/User turn ID, role, and specific turn ID across timeout/deferred/staged warning text.
- **In review:** live browser verification that all three warning rows remain readable with long GUIDs and clearly identify their UAP/turn half.

#### ISSUE 53: **Use the userscript metadata version as the single runtime version source.**
- A packaging regression left the Tampermonkey metadata `@version` at 0.6.28 while the runtime `VERSION` constant advanced to 0.6.29 and 0.6.30. Historical TODO references to those two revisions therefore identify the runtime `VERSION`, not the stale `@version`.
- v0.6.31 makes the userscript metadata `@version` the only maintained version literal and derives the runtime `VERSION` from `GM_info.script.version`.
- Runtime code falls back to `unknown` only if `GM_info` or its script version is unavailable, rather than introducing another independently maintained version number.
- v0.6.40 adds automatic test `Review: Version Source`, which compares runtime `VERSION` directly with `GM_info.script.version`.
- **In review:** install v0.6.31 in Tampermonkey and verify the Tampermonkey script version, recorder status version, and `script-initialized` diagnostic all report 0.6.31.

#### ISSUE 54: **Keep the screen on during active capture and log wake-lock/visibility changes.**
- Add a persistent recorder-popup switch labelled `Screen on when capturing` with ON/OFF state. Default it to ON unless the user has explicitly turned it off.
- While an actual capture operation is active, request `navigator.wakeLock.request('screen')` when the document is visible. Release the wake lock when capture is inactive, stopped, or the switch is turned OFF.
- If Chrome or the operating system releases the wake lock while capture is still active, log a warning. If the page later becomes visible again and the switch remains ON, automatically try to reacquire the wake lock.
- Log `document.visibilityState` transitions, including the wall-clock duration of each hidden interval, so capture slowdown can be correlated with tab/window visibility and screen-lock behaviour.
- A failed wake-lock request must not enter a retry loop; wait for a meaningful state transition such as the page becoming visible again or the user toggling the switch before another request.
- v0.6.34 implements the switch, Screen Wake Lock API lifecycle, warning diagnostics for unexpected release/request failures, automatic visible-page reacquisition, and visibility-transition timing diagnostics.
- v0.6.37 adds a persistent top-of-conversation capture advisory. Preserve the established literal layout and wording: `—\nTo prevent stalling, DO NOT put this tab in\nthe background.  Covering the window may be ok.` The em-dash separator is on its own line and the advisory is deliberately split into two visually balanced lines so the status window does not become unnecessarily wide. This remains visible while collection/recovery/finalization progress is active.
- v0.6.40 adds automatic test `Review: Wake Lock Lifecycle` for visible active-capture acquire/release. Hidden-page release/reacquisition and actual screen behaviour remain live-review items.
- **In review:** verify on Chrome/Windows that the screen remains on during capture, that hiding/locking produces the expected warning/release diagnostics, that a visible page reacquires the lock when appropriate, and that the foreground-tab advisory remains visible throughout active capture.

#### ISSUE 55: **Show missing User and ChatGPT turn-half counts in capture progress.**
- The dedicated top-of-conversation capture status must show `missed: x, y`, where `x` is the number of incomplete User turn halves and `y` is the number of incomplete ChatGPT turn halves.
- The missed counts are turn-granular and independent of `n / m`: recovering one half decrements its corresponding missed count immediately, while `n` increases only when the whole UAP becomes complete.
- Legacy whole-UAP recovery files count as having both halves available; split recovery staging derives the two counters from the presence of `.user.json` and `.assistant.json` state.
- v0.6.35 adds the two missed-half counters to the top capture/recovery status and refreshes them immediately when an individual recovered half is staged.
- v0.6.36 fixes the dedicated capture banner to three stable lines: phase text; UAP progress plus `missed: x, y`; and `Elapsed: ... — ETA: ...` on its own line. When ETA is suppressed, the third line contains elapsed time only.
- The active capture banner is a single visual composition and must preserve this established layout: `<phase>\nn / m UAPs (p%) — missed: x, y\nElapsed: ... — ETA: ...\n—\nTo prevent stalling, DO NOT put this tab in\nthe background.  Covering the window may be ok.` When the total is not yet known, use `n / ? UAPs — missed: x, y`; when ETA is intentionally suppressed, the timing line contains only `Elapsed: ...`. Do not split Elapsed and ETA onto separate lines and do not add a separate recovered-count field.
- v0.6.40 adds automatic test `Review: Missed Half Counts` using synthetic incomplete/staged/legacy recovery state.
- **In review:** verify the counters during Entire/From-here and Resume recovery, including UAPs with only one staged half.

#### ISSUE 62: **Analyze current conversation index and pagination/network sources.**
- Add an `Analyze` / `Stop Analyze` session control to the general recorder status popup so indexed and non-indexed conversations can be compared while the user scrolls through multiple paginated regions and opens citation/image UI.
- Starting analysis records a complete structural snapshot, promotes the bounded startup API prebuffer into the session, keeps the page-context Fetch/XHR instrumentation active, and adds a `PerformanceObserver` for resources made while the user scrolls or opens UI. Stopping analysis stops new resource observation, waits for captured in-flight bodies, records a second structural snapshot, and downloads `chatgpt-conversation-analysis-YYYYMMDD-HHMMSS.json`.
- The session captures URL, method, available request headers/body, timing, response status/headers/body, and errors. Text/JSON/XML bodies are preserved in full; binary bodies are preserved in full as base64. No size truncation or omission is applied.
- DOM evidence is also preserved in full for comparison with API payloads. Start/stop snapshots store the full `outerHTML` of every mounted `section[data-turn-id]`, plus image metadata and full markup for citation/source, dialog, menu, popover, and other relevant overlay elements. While Analyze is active, user clicks outside the recorder UI schedule DOM samples after the UI has had time to open; conversation API responses also schedule post-render DOM samples. This lets an API message/turn ID be correlated with the exact rendered image/citation state.
- The start and stop snapshots also retain wrapper/container IDs, mounted turn GUIDs and roles, pagination sentinels, relevant `data-testid` elements, paginated-messages feature-flag contexts, loaded script URLs, and Fetch/XHR `PerformanceResourceTiming` entries.
- Clicking Analyze activates ordinary diagnostics and emits compact Debug start/stop summaries, but the analysis session itself is collected independently of the selected diagnostics level. Use Debug for the comparison run; Verbose remains unnecessary.
- Install a lightweight page-context API prebuffer at `document-start`, before ChatGPT can retain its own Fetch/XHR references. The passive prebuffer records only selected conversation/content/citation/file backend traffic, keeps complete request/response bodies without truncating individual records, performs no DOM sampling or disk writes, and is bounded by record/byte ceilings with the initial conversation response pinned against eviction. When Analyze is pressed, carry that prebuffer into the interactive analysis session and enable the expensive DOM/resource sampling. Do not replay observed conversation API requests; the prior replay approach returned 401 because it did not reproduce ChatGPT internal authorization. This preserves the original authenticated initial/pagination responses while avoiding a permanent all-network/all-DOM capture that could make the page unresponsive.
- The v0.6.49 startup prebuffer captured the authenticated initial conversation response. Earlier v0.6.48 page-context instrumentation also captured a successful original `/backend-api/conversations/<id>/messages?before=...&num_turns=10` response body with `page_info` cursors and both previous/next-page flags, so backward pagination is now evidenced rather than inferred.
- v0.6.50 redacts credential-bearing request headers (`Authorization`, proxy authorization, cookies) before any Analyze record is retained/exported. Credentials may be used transiently by the page request itself but must never be serialized into an analysis JSON file.
- **In review:** verify a v0.6.50 Analyze export contains `[REDACTED]` for sensitive headers and still contains complete conversation/pagination response bodies.

#### ISSUE 64: **Preserve warning/error notifications until an actual extraction starts.**
- Pressing Record must not clear existing warning/error notifications merely because the start flow or Start Recording dialog is opened.
- Cancelling the start dialog, checking Resume availability, choosing a folder, or otherwise preparing a possible run must leave the current warning/error state intact.
- v0.6.73 removes warning/error clearing from `beginStartFlow()` and moves the reset to the point where the user has committed to an actual historical extraction.
- Conversation-navigation resets remain a separate lifecycle event and are not changed by this issue.
- **In review:** v0.6.73 moved the reset to actual historical extraction start; live-verify that Record/start-dialog preparation/cancel/Resume availability checks preserve existing warning/error notifications while a real extraction start clears them.

### BLOCKED

#### ISSUE 57: **Investigate unexpected capture deactivation during Resume forward reconstruction.**
- Observed in the completed `full 9 (2)` run: while waiting for the ChatGPT half of UAP 198, the screen wake lock was released with reason `capture-inactive-or-disabled`; shortly afterward the indexed-turn wait terminated as `stopped`, the Resume forward rebuild remained incomplete, and some asynchronous batch work continued emitting diagnostics after the fatal failure.
- The prior diagnostics did not identify which programmatic change made capture inactive because Warnings omitted lifecycle/control-flow transitions and Verbose was too expensive for normal long runs.
- v0.6.39 instruments all control variables that determine wake-lock/capture activity. State/stop/progress transitions include previous/next values plus a reason/context, and `wake-lock-not-needed` plus `indexed-turn-wait-stopped` capture a complete lightweight runtime-control snapshot.
- Use a Debug-level reproduction to determine whether the trigger is `stopRequested`, premature collection-progress cleanup/finally execution, a recorder lifecycle transition, or another operation-boundary bug. Also use the resulting trace to determine why asynchronous batch work survives the terminal failure.
- The subsequent `full 10` Debug run completed cleanly and therefore did not reproduce the unexpected deactivation. No deterministic trigger has yet been established, so a synthetic test would only verify instrumentation rather than the underlying failure.
- **Blocked by:** a Debug-level reproduction of the unexpected Resume deactivation. Once reproduced, use the captured transition trace to build a deterministic regression test before changing cancellation/finalization logic.

### DONE

#### ISSUE 1: **Allow persistent UAP indexing when ChatGPT temporarily hides the prompt TOC.**
- Implemented in recorder v0.5.15.
- Persistent UAP count can be derived from the validated `[data-turn-id-container]` skeleton when the prompt TOC is temporarily absent.
- When the TOC is present, its count remains an independent cross-check.

#### ISSUE 3: **Support valid manual tail truncation and continuation.**
- Implemented at UAP boundaries in v0.5.4; extended to partial-UAP recovery in v0.5.5.
- Resume reconciles clean manual tail truncation and reconstructs a damaged partial UAP rather than rejecting the entire recording.
- Retained UAP markers are verified against metadata; unrelated structural inconsistencies remain errors.

#### ISSUE 4: **Add warning/error notification UI and make the recorder control read as a button.**
- Implemented in recorder v0.5.5.
- Added warning/error notification UI, recorder attention state, dismissible rows, and durable diagnostics.

#### ISSUE 5: **Prevent duplicate start dialogs and provide immediate start feedback.**
- Implemented in recorder v0.5.7.
- The first Record click synchronously locks the start flow before asynchronous storage/resume checks, preventing duplicate start dialogs.

#### ISSUE 7: **Apply the selected diagnostics level to bootstrap/startup logging.**
- Implemented in recorder v0.5.17.
- Bootstrap/startup events use the same diagnostics-level filter as persistent diagnostics, except for the unconditional `script-initialized` identity event defined by ISSUE 51.

#### ISSUE 8: **Ensure exported images are followed by a Markdown line break.**
- Implemented in recorder v0.5.20.
- Image Markdown and unavailable-image placeholders emit a blank-line boundary before following transcript content.

#### ISSUE 9: **Handle prompt edits/branch replacement during live-tail capture.**
- Fixed initially in v0.5.8 and extended through v0.6.5.
- Live-tail capture revalidates persistent UAP identity across prompt edits/branch replacement.
- v0.6.5 live verification confirmed recovery from an edited earlier prompt by finding the newest surviving committed UAP and rebuilding forward.

#### ISSUE 10: **Make viewport restoration consistently UAP-anchor based.**
- Historical Entire/From-here scans restore a semantic UAP anchor rather than raw `scrollTop`.
- v0.6.4 disables recorder-driven navigation during ordinary waiting → converting → waiting live-tail cycles.
- Live verification confirmed the viewport-jump problem was fixed.

#### ISSUE 11: **Detect materialized empty assistant slots directly from the DOM.**
- Verified in v0.5.28/v0.5.29 that mounted `section[data-turn-id]` state is the materialization signal.
- v0.6.18 correction: a mounted assistant section with no assistant-message subtree is itself authoritative evidence of a completed empty assistant slot; no following UAP is required.

#### ISSUE 12: **Show indexed collection progress and completion ETA.**
- Implemented across v0.5.22-v0.5.24 with live ETA verification.
- v0.6.16 redefines `n / m` universally as successfully captured UAPs / required UAPs, so `m - n` is always the number left to capture.
- Full and From Here keep `m` fixed to the requested range. Resume keeps `m` fixed from recording start through the current end regardless of previously captured/skipped/not-yet-visited state.
- Recovery ETA uses wall-clock time between actual increases in `n`; sustained zero progress reports `ETA: waiting for recovery progress…`.

#### ISSUE 13: **Replace reverse Resume extraction with direct indexed anchor lookup and forward reconstruction.**
- Implemented in recorder v0.5.21.
- Resume locates a validated persistent-index anchor and rebuilds forward into a temporary file before replacing `conversation.md`.
- The older reverse-file algorithm was retired.

#### ISSUE 14: **Block user interaction while the recorder controls historical/recovery scrolling.**
- Implemented in recorder v0.5.16.
- Entire/From-here and Resume/recovery block interaction with the recorder-controlled scroll region while keeping recorder controls usable.

#### ISSUE 15: **Fix recorder state after Resume catch-up.**
- Fixed in recorder v0.5.6.
- Resume refreshes recorder UI immediately after entering `waiting`.

#### ISSUE 16: **Keep the recorder popup open while the pointer is still over it.**
- Fixed in recorder v0.5.13.
- The popup remains open while hovered even if a focused dismiss control disappears.

#### ISSUE 17: **Return the recorder icon to normal stopped/idle state after an error is dismissed.**
- Implemented across v0.5.9-v0.5.12.
- Error dismissal stops rapid error flashing; after all warnings/errors are dismissed the recorder returns to normal stopped/idle state.

#### ISSUE 18: **Replace the visible “Test storage” control with an extensible recorder test matrix.**
- Implemented in recorder v0.5.10.
- Replaced the standalone storage-test control with an extensible Test matrix.

#### ISSUE 19: **Upgrade the Test matrix into a persistent automatic/guided regression harness.**
- Implemented in recorder v0.5.18.
- Expanded the Test matrix into persistent automatic/guided regression coverage with cumulative `test-results.md` history.

#### ISSUE 20: **Show an undismissed-warning count badge on the recorder button.**
- Implemented in recorder v0.5.11.
- The recorder button shows an undismissed-warning count badge, including warnings hidden beyond the popup row limit.

#### ISSUE 21: **Dismiss hidden warnings when the warning-summary row is dismissed.**
- Fixed in recorder v0.5.14.
- Dismissing a warning-summary row dismisses the exact hidden warnings represented by that row.

#### ISSUE 23: **Keep** **`test-results.md`** **tables valid and parse Previous Result directly from them.**
- Implemented in recorder v0.5.19.
- Removed hidden comments that broke Markdown tables; Previous Result is parsed directly from human-readable result rows.

#### ISSUE 24: **Fix attachment/action classification.**
- `Your message actions` and `Convert to PDF` false positives were corrected; attachment extraction was narrowed to file-like elements.

#### ISSUE 25: **Add complete reconciliation diagnostics.**
- Resume mismatch diagnostics include SHA/text/image/attachment details and bounded text differences.

#### ISSUE 27: **Make collapsed/partial UAPs ineligible for hash comparison until complete content is obtained.**
- Collapsed/partial content is expanded before Resume hashing where possible so incomplete representations are not trusted for hash comparison.

#### ISSUE 28: **Preserve the user's viewport anchor during Resume scanning and restore it when reconciliation finishes.**
- Resume preserves/restores a semantic turn anchor.
- ISSUE 10 generalized the same approach to historical Entire/From-here scanning.

#### ISSUE 29: **Audit and enforce common keyboard/focus/Esc behaviour across all recorder dialogs.**
- Implemented in recorder v0.6.1 and moved to DONE after live use.
- Shared `installDialogFocusPolicy()` owns Tab/Shift+Tab, Escape, modal containment, initial focus, and focus restoration for recorder-created dialogs.

#### ISSUE 30: **Reassess storage self-test UI.**
- Resolved in recorder v0.5.10 by retaining storage self-test capability under the general Test matrix from ISSUE 18.

#### ISSUE 34: **Fix omitted real conversational images in exported UAPs.**
- Live diagnostics identified real User images outside `findMessageRoot()` in `group/message-image` containers.
- v0.5.31-v0.5.32 added full-User-subtree image discovery, DOM-order merging, and one placeholder per failed/loading image slot.
- Live verification completed successfully.

#### ISSUE 35: **Exclude citation/UI imagery from conversational-image export and emit valid citation Markdown.**
- Citation/favicon UI images are excluded from conversational-image extraction and citations are emitted as valid Markdown.
- v0.5.34 fixed single citation pills; v0.5.35 added traversal of grouped `n/n` citation popups.
- v0.5.36-v0.5.43 refined Radix popup interaction, favicon handling, and final citation presentation.
- Final framing uses italicized parenthetical `citation:` / `citations:` groups with remote favicon URLs; the issue was closed after live verification.

#### ISSUE 37: **Accept numeric UAP indices anywhere a UAP identifier is requested.**
- Implemented in recorder v0.6.2 and moved to DONE after live use.
- `resolvePersistentUapIdentifier()` centralizes GUID and numeric-index resolution.
- Non-negative indices count from the start; negative indices count from the end; out-of-range values are rejected.

#### ISSUE 40: **Show the recorder version at the top of the status popup.**
- v0.6.7 prepends `ChatGPT Recorder v${VERSION}` to the status/details area so the displayed version cannot drift from the packaged userscript version.

#### ISSUE 44: **Work around Chromium stale File System Access state during recorder writes.**
- Observed on 2026-08-18 during a long recovery sweep: merely opening/reading `diagnostics.jsonl` externally was followed by Chromium throwing `InvalidStateError: An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.`
- Treat this as a Chromium File System Access stale-interface condition requiring a recorder workaround; a read-only external access is not a recording-content conflict and must not terminate recording.
- v0.6.15 routes recorder writes through a filesystem workaround layer. On this exact Chromium `InvalidStateError`, reacquire the file handle from its parent directory, reread current on-disk state, and retry with bounded backoff.
- Retry only if the current bytes are unchanged from the pre-write snapshot. If the intended write committed despite Chromium throwing, detect that byte-for-byte and treat it as success rather than duplicating the write. If bytes changed to anything else, stop as a real external modification.
- Append operations determine EOF from the freshly reacquired file rather than treating cached `diagnosticsByteLength` as authoritative. `diagnosticsByteLength` is updated only from the successful/confirmed append offset.
- Apply the workaround to normal appends/whole-file writes, truncate-and-rewrite operations, staged recovery files, Resume forward/temp files, `conversation-rebuild.tmp`, and replacement of the final recovered `conversation.md`.
- `validateConversationLayout()` now recomputes and verifies the SHA-256 payload of every recorded UAP, not only incomplete UAPs. Final recovered rebuilds revalidate the source `conversation.md` immediately before replacement so read-only access is harmless while actual byte changes are detected by recorder invariants.
- Live browser verification completed; ISSUE 44 is DONE.

#### ISSUE 46: **Remove progress and ETA from the general status window.**
- Do not display UAP progress or ETA in the general recorder status/details popup.
- Progress and ETA already appear in the dedicated status display at the top of the conversation and should have a single visible home while a scan/recovery is active.
- Removing the duplicate progress lines prevents the general status popup from becoming unnecessarily tall.
- v0.6.19 removes active progress, phase text, and ETA from the general status/details popup. The dedicated top-of-conversation overlay remains the only active progress display.
- Live browser verification completed; this issue is DONE.

#### ISSUE 47: **Show elapsed running time beside ETA and preserve final duration.**
- While collection or recovery is active, display elapsed running time next to the ETA in the dedicated top-of-conversation status display.
- Elapsed time must continue increasing even while ETA is waiting for recovery progress.
- When the recorder reaches the bottom/completes the requested run, place the final elapsed duration in the general status/details popup as a persistent completion fact.
- The completed-run duration must represent the whole run rather than only the final scan or recovery phase.
- v0.6.19 adds a run-level timer that starts when collection progress begins and is not reset by scan/recovery/finalization phase changes. The top overlay renders `Elapsed: ...` beside ETA and refreshes it once per second even while capture progress is stalled.
- On successful Full/From Here or Resume completion, v0.6.19 stores that run duration in the general status/details popup as `Last completed run: ...`; stop/error exits do not manufacture a completed duration.
- Live browser verification completed; this issue is DONE.

#### ISSUE 48: **Keep Stop available throughout all active recorder phases.**
- The recorder must show a persistent Stop control from the moment a run starts until it reaches a terminal state, including initial collection, Resume, incomplete-UAP recovery sweeps, and finalization.
- Do not decide Stop visibility only from `state === recording` or `state === waiting`; an active collection/recovery/finalization operation may temporarily report another state while work is still running.
- When Stop is requested, disable the Stop button, keep the operation visibly in a `Stopping recording…` state, and honour the request at the next safe boundary.
- During final recovered-UAP rebuild, allow Stop before the destination replacement begins. Once the atomic replacement/metadata commit boundary has begun, finish that commit before returning so `conversation.md` cannot be left structurally inconsistent.
- v0.6.23 makes Stop visibility depend on whether a recorder operation is active, not only the coarse recorder state, and adds stop checks around final recovery/rebuild boundaries.
- Live browser verification completed; ISSUE 48 is DONE.

#### ISSUE 56: **Add a Debug diagnostics level for control-flow/state tracing without verbose DOM payloads.**
- Add `Debug` between Warnings and Verbose. Debug includes programmatic control-flow/state transitions needed to diagnose recorder behaviour, while large DOM/HTML/extracted-content diagnostics remain Verbose-only.
- Debug records lifecycle-state changes, `stopRequested` changes, start-flow ownership, collection-progress begin/phase/clear transitions, wake-lock eligibility/acquire/release, page visibility changes, live-tail observer start, and indexed-turn waits that terminate because capture became inactive/stopped.
- v0.6.39 adds the `Errors / Warnings / Debug / Verbose` selector and updates persistent/bootstrap filter self-tests for the four-level hierarchy.
- Verbose remains the most expensive level; Warnings remains the recommended normal long-capture setting, while Debug is intended for behavioural diagnosis without HTML snapshots.
- 2026-08-20 `full 10` live verification changed the selector from Warnings to Debug mid-run: the file contains four Warning-only records before 19:34:11Z, then 554 Debug records plus later Warnings through clean completion, with zero Verbose records. The level change therefore took effect without restart and Debug supplied the intended state/control-flow evidence.
- v0.6.40 adds automatic test `Review: Debug Control Record` to verify Debug control events carry the lightweight runtime-state fields used for behavioural diagnosis.

#### ISSUE 58: **Add deterministic regression tests for implemented issues awaiting review.**
- Expand the built-in Test matrix so reviewable behaviour is exercised by deterministic automatic tests wherever browser/OS integration is not inherently required.
- v0.6.40 adds automatic coverage for Resume immediate startup feedback, recovery-policy constants/staging filenames, phase-aware state display, outside-popup dismissal, bootstrap identity retention, recovery-warning context, runtime version source, wake-lock acquire/release, missed-half counts, and Debug control-record shape.
- Existing `Warning Overflow`, `Diagnostic Filter`, and `Bootstrap Filter` tests continue to cover warning promotion/exact hidden-ID clearing and the four-level logging hierarchy.
- Live-only behaviour such as ChatGPT virtualization/materialization, hidden-window wake-lock release/reacquisition, and an unreproduced unexpected Resume deactivation remain review/blocker items rather than being falsely declared verified by synthetic tests.

#### ISSUE 59: **Do not start diagnostics until the recorder is opened or recording is requested.**
- Before the general recorder status popup is opened or the Record button is pressed, the userscript must not emit, persist, or queue diagnostic events. The sole exception is one `script-initialized` identity/version record so the loaded recorder version can always be established.
- Opening the general status popup or pressing Record activates diagnostics from that point forward at the currently selected Errors / Warnings / Debug / Verbose level; startup events that occurred before activation must not be replayed later.
- The DevTools reproduction on 2026-08-20 showed a startup feedback loop producing tens of thousands of `wake-lock-not-needed` Debug records while the recorder was stopped. Debug wake-lock eligibility logging must therefore be transition-based so repeated reconciliation of an unchanged state does not emit repeated records.
- Add deterministic tests proving pre-activation events are discarded rather than buffered, the version identity remains the only pre-activation record, activation permits subsequent diagnostics, and repeated unchanged wake-lock reconciliation emits at most one eligibility record.
- v0.6.41 implements an explicit diagnostics-activation gate. `script-initialized` now contains only the version identity before activation; opening the general status popup or pressing Record activates diagnostics, and pre-activation events are discarded rather than retained for later replay.
- v0.6.41 also makes wake-lock-needed/not-needed Debug output transition-based and removes the bootstrap-log `updateUi()` feedback path that allowed a diagnostic to schedule another wake-lock reconcile while ChatGPT was starting.
- Automatic tests `Review: Diagnostics Activation` and `Review: Wake Lock Debug Dedup` cover the activation contract and repeated unchanged wake-lock reconciliation.
- Live verification in `fill 11` showed one `script-initialized` record before diagnostics activation, then `diagnostics-activated` only after the general status popup was opened; the previous startup flood did not recur.

#### ISSUE 60: **Tolerate one unmatched trailing persistent turn container while ChatGPT is still constructing a UAP.**
- The `fill 11` run failed immediately because `buildPersistentUapIndex()` required the persistent container count to equal exactly one root plus complete User/ChatGPT pairs. The live page exposed ten top-level containers, so the parity assertion aborted before any UAP was captured.
- v0.6.42 removes container-count parity as a fatal invariant. The indexer still requires the root first, validates every persistent container ID for uniqueness, and indexes only complete positional User/ChatGPT pairs. If one final unmatched container is present, it is deferred rather than treated as corruption.
- When the prompt TOC is available, it may report either the number of complete indexed UAPs or one additional prompt corresponding to the deferred trailing container. Any larger disagreement remains fatal.
- Mounted turns inside only the deferred trailing container are permitted to be absent from the complete-UAP maps; mounted turns elsewhere must still map to the validated persistent index.
- Debug records `persistent-turn-index-trailing-container-deferred` with the wrapper count, complete UAP count, TOC prompt count, and trailing container ID so a future structural mismatch is diagnosable without HTML.
- Automatic test `Review: Persistent Trailing Container` reproduces the exact ten-container shape: root + four complete UAP pairs + one trailing User container, and verifies that the four complete UAPs are accepted while the trailing container is deferred.
- Live verification in `full 11` confirmed v0.6.42 no longer aborts on the ten-container parity condition: `persistent-turn-index-trailing-container-deferred` was emitted and indexing continued. The subsequent failure was a distinct container-ID versus mounted-turn-ID conflation tracked separately as ISSUE 61.

### WILL_NOT_FIX

#### ISSUE 2: **Write the User prompt immediately/provisionally.**
- Persist the User half immediately and complete/replace the provisional tail atomically when the assistant response becomes available.
- **Reason:** The use case is not strong enough to justify the additional provisional-tail complexity.

### LEGACY

#### ISSUE 6: **Improve the initial Record-click availability check UX/performance.**
- Legacy UX/performance idea retained for history; no active change is currently needed.
- The Resume-availability check can occasionally delay the Start Recording dialog, but existing feedback/locking was judged sufficient.
- Revisit only if the availability check becomes materially slower or the current feedback/locking stops being sufficient.

#### ISSUE 26: **Legacy Resume backward-anchor / forward reconstruction algorithm.**
- Older `conversation-reversed.md` / `SIZE:` trailer / backward-anchor algorithm.
- Superseded by ISSUE 13 in v0.5.21.

#### ISSUE 31: **Use** **`focus({preventScroll:true})`** **as the fix for the earlier From-here jump.**
- Targeted runtime logging showed the suspected focus calls did not move `scrollTop`.
- **Reason:** Superseded by evidence; the proposed cause/fix was unsupported.

#### ISSUE 32: **Force open the User bookmark popup / scrape hidden React state for UAP mapping.**
- Superseded by the persistent `[data-turn-id-container]` UAP index.
- **Reason:** Persistent DOM indexing provides the required mapping without forcing bookmark popups or scraping hidden React state.

#### ISSUE 33: **Walk every bookmark to discover** **`turn_id`** **values.**
- Rejected because walking every bookmark would effectively traverse the conversation twice.
- **Reason:** The persistent DOM index provides the mapping directly with less work.
