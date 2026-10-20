# DC #333 historic V1 favicon source evidence

The V1 external `.dcfav` binary pack and JSON catalogue are **superseded**,
not current runtime deliverables.  Their exact audited bytes are preserved in
Git history at revision `b9c123d1f178fe57bb3515ed1244b0d5e3fb9c83`
(pack blob `e365d482e10b9e5cb3b29673b4ff5f1c399e3741`,
SHA-256 `26512d41c8d181ac53dcedf91d59739b1dfd79c5372f9e96ba6b2993bcafc100`).
They must not be fetched, committed afresh, registered as a production
artifact, or exposed through the new V2 cache.

Still-useful evidence retained here:
- `originals/` contains the real source ICO, SVG and WebP resource bodies.
- `sources.json` records fetched source digests and HTML link observations;
  these are historical witnesses, not the fixed list for live generation.
- SVG `prefers-color-scheme` changes the rendered original for the *same*
  URL/source digest, so V2 must use the actual browser theme as part of its
  sequence identity.
- `tests/favicon-svg-theme-divergence.test.mjs` and existing production
  Canvas helper comparisons provide independent light/dark/colour baselines.
- Historical V1 tests and tooling under `tests/favicon-pack-*.test.mjs`,
  `scripts/generate-favicon-packs.mjs` and `scripts/favicon-pack-format.mjs`
  remain available for explicitly scoped regression study, not normal CI.

**Current DC #333 provider:** `src/favicon/browser-sequence.mjs`, a
browser-side async function which generates exactly 21 PNG Blobs on a
first-request cache miss for one selected original URL, current browser
theme, base colour and progress step.  It owns neither IndexedDB nor
first-writer election; these are DC #334.  A numbered V2 contract is
proposed on parent DC #332 and is not frozen.
