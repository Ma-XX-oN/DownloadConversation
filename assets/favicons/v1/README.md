# DC #333 — favicon pack producer checkpoint

Owner: DC #333; parent: DC #332.  Interface A V1 is frozen at Git blob
`e2460ba2bf1c1852579782ecbb05139de32e505e`.

## Source provenance

The three original binary resource bodies live under `originals/`; the
`sources.json` entries list their independently checked SHA-256 digests,
dimensions, original URLs, and archival Git blob identities.  The archive
is source provenance, not a replacement for a current Chrome tab's actual
`link[rel~="icon"]` inventory.  An archived 2026 ChatGPT HTML snapshot
includes both ICO and SVG links plus the pinned 48×48 WebP (the HTML labels
that WebP `type=image/png` despite its actual WebP response body).  On
2026-10-20, hosted Node CI fetched all three public source resources and
independently confirmed their exact recorded hashes.  The extra root
`/favicon.ico` candidate also occurs in the archived HTML, but its direct
network retrieval returned HTTP 403; the root icon's bytes, identity and
possible relationship to the pinned ICO are not established.  Its link
must stay untouched until current-browser source evidence is available.
Do not claim an exhaustive current authenticated-tab candidate inventory.

## Generated pack (not committed yet)

The original, *unoptimised* deterministic Chromium-generator output has:

- Target path: `assets/favicons/v1/chatgpt-v1.dcfav`
- Header: ASCII `DCFC0001`
- Exact size: `10,620,388` bytes
- SHA-256: `26512d41c8d181ac53dcedf91d59739b1dfd79c5372f9e96ba6b2993bcafc100`
- Git blob SHA-1: `e365d482e10b9e5cb3b29673b4ff5f1c399e3741`
- Entries: three pinned source variants, 588 PNGs each (1,764 total)
- Hosted source evidence: GitHub Actions run `39466337326`
- Structured result artifact: `12285691338`

Generation command (requires Node 22 and Chromium):

```text
node scripts/generate-favicon-packs.mjs --build
```

Byte-for-byte verification, after the canonical pack is committed:

```text
node scripts/generate-favicon-packs.mjs --verify
```

The pack was reconstructed and independently SHA-256 verified against
the hosted result, but the GitHub binary blob upload is **not done**.
The connected GitHub binary-object tool terminated with an HTTP/2
transport error even after a lossless size optimisation was tested.
An optimised candidate is not canonical generator output and must not
replace the above pack until deterministic regeneration is implemented
and verified for it.  Do not create an invalid placeholder catalogue.

Once the exact binary is committed and its commit is immutable,
run the catalogue publisher with that **pack-bearing commit SHA** and
the minimum normalised DC version boundary:

```text
node scripts/generate-favicon-packs.mjs --catalogue <commit> <major.minor.patch>
node scripts/generate-favicon-packs.mjs --verify-catalogue
```

Re-run regression, exact-candidate CI and full pack checks before
handoff to DC #334.  Never silently substitute a synthetic fixture.

## Contract incompatibility pending DC #332

The genuine SVG's CSS uses black fill in light theme and white fill in
dark theme, while the original resource's SHA-256 is unchanged.  Frozen
V1 keys a complete PNG frame grid only by the source-resource digest.
Consequently, the light/dark SVG raster cannot both be represented by
that single digest-keyed grid with source-pixel fidelity.  At default
light-mode Chromium rendering, all 147 yellow/green pairs are identical
for that SVG; the same occurs for the dark-coloured ICO original.
The WebP yellow/green pairs are different.

Evidence and options were sent to DC #332.  No new V2 semantics have
been adopted.  Until the contract owner resolves the dynamic-theme
case, do not certify SVG pixel equivalence across both colour schemes.

All work remains on the issue branch.  **No merge authorised.**
