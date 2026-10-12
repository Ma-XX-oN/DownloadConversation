# Recorder panel UI contract

Issue #218 owns the recorder-panel layout and its browser acceptance.
This contract supersedes older arrangements that placed all communication
file actions beside the filename or introduced additional visible rows.

## Visible order

```text
ChatGPT Recorder v<version>                           [Close]

Log: <retained-general-log-count>
<most-recent-error-or-warning>
Diagnostics: <errors | warnings | debug | verbose>

<communication-log-filename> [Pencil]
[ ] Gen   [ ] Comm   [ ] Con   [ ] 1
[Save merged log] [Reset communication log]
--------------------------------------------------
[ ] Timestamp  [ ] Record #  [ ] Turn ID  [ ] Provenance
[ ] JSONL  [x] MD  [Export arrow] [Large/small compression circle]
--------------------------------------------------
[Sound icon and volume] [Jump parachute] [Test flask]
```

The filename scrolls on hover. The Gen and Comm settings control
capture; Con controls continued diagnostic console output; 1 controls
the per-tab recording group. Save opens the combined Gen/Comm log
extraction; Reset clears the active communication log. The compression
circle is large for uncompressed output and small for compressed
output, independent of the separate export-arrow action.

The sound popup retains a 0–10 range and high-contrast white 0, 5,
and 10 markers. The current value is visible beside the speaker icon.
An opaque, viewport-bounded popup uses scrolling rather than placing
controls outside the visible screen. Long diagnostic text is
ellipsized but available in full through its title and accessibility
status. The hidden live-status node remains available to assistive
technology.

These controls are **not** part of the visible panel: Copy log,
Expand log, Duplicate communication log, and Screen On. Their
underlying non-UI logic and relevant regression coverage may remain,
but their old visual layout assertions are superseded.

## Acceptance evidence

Specification tests in `tests/recording-panel-modes.test.mjs` and
`tests/recorder-panel-ui.test.mjs` check section order and controls.
`tests/recording-panel-chromium-layout.test.mjs` renders production
markup and CSS in headless Chromium with long filenames, warnings,
status messages and varied viewport sizes. It checks geometry,
overlap, action-row alignment and slider marker contrast.

A passing hosted test is not a substitute for a manual Tampermonkey
inspection on ChatGPT. Issue #221 owns that final acceptance.
