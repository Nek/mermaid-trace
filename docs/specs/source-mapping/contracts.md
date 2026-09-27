# Artifact and integration contracts

Behavioral contracts for the [feature spec](spec.md). Wire names, exact type signatures, and unresolved encoding choices are not frozen. These requirements must be made concrete in M1 before format implementation.

## C1 — Static, portable SVG (S1-AC1, S1-AC4)

Precondition: supported source and successful rendering. Postcondition: standalone SVG is visually usable without scripts or activation. Mapping data is inert. Scripts, event handlers, executable URLs, automatic animation, and runtime fetching of essential visual assets are absent. Safe ordinary hyperlinks may remain, subject to the final link policy. Saving/reloading preserves mapping data when the host retains it. Test with scripting disabled and serialization round-trips; unsupported export content produces a diagnostic, not silent active output.

## C2 — Source ↔ AST ↔ visual integrity (S1-AC2–AC5, S2-AC1–AC2)

Precondition: exact original source and a compatible mapping. Every mapped span is in bounds under the declared coordinate convention. AST references resolve inside the artifact/core result; generated unmapped pieces are explicit. Many-to-many relations are preserved. IDs are stable within one result, not promised across edits. The core offers visual → AST/source, AST → source/visual, and source-range → AST/visual lookup. Tests select exact original substrings and check all reverse associations, including repeated text. Unknown/invalid references yield diagnostics rather than fallback guesses.

## C3 — Embedded metadata and source (S1-AC3–AC4, S2-AC5)

Relevant SVG tags carry versioned `data-*` mapping attributes. Simple source locations are directly readable; compound spans and AST projections may use an inert embedded table. All references are scoped to the containing SVG. Optional source payload round-trips exactly; omission is explicitly represented. Encoding must handle XML-sensitive text, Unicode, CRLF, and `--` safely. A compatibility HTML export may prepend an encoded source comment; a standalone artifact cannot depend on that sibling node. Readers validate versions, types, IDs, and bounds before use. Missing metadata means mapping unavailable; unsupported versions are reported. Sanitization may remove metadata, so post-sanitization validation is required.

## C4 — Separate activation lifecycle (S2-AC1–AC6)

Precondition: a compatible, safe inline SVG DOM element. The activation library accepts that element, attaches interaction, exposes selection/highlight operations and callbacks, and returns a disposal mechanism. It imports neither the Mermaid renderer nor parser to decode a saved artifact. It resolves serialized AST references/projections; optionally supplied matching AST data may provide richer host inspection. It does not promise to reconstruct a full AST from an identifier.

Attachment and cleanup are instance-scoped. Repeated attachment must reject or reuse an existing activation rather than multiply listeners. Disposal removes only library-owned changes and is safe to repeat. Native `data-mt-generated="bounds"` identifies invisible bounds helpers: activation temporarily sets `pointer-events="none"` through the same tracked attribute lifecycle. `data-mt-generated="asset"` classifies icon artwork/placeholder contents; projection must not reinterpret its internal text as an authored label. Its enclosing source-backed node remains selectable. Tests cover nested targets, keyboard access, duplicate IDs across SVGs, and cleanup. An SVG displayed through `<img>` remains static; the host must provide an inline SVG for element-level interaction.

## C5 — Host ownership and trust boundary (S2-AC5, S3-AC1–AC3, S4-AC3)

The host owns file access, source revisions, block identity, editor selection, and Markdown-local translation. Content-start line means the first line inside a Mermaid fence, but is sufficient only where extraction preserves the relevant coordinates. C7 governs general translation. Renderer/core never reopen a source path. If external source is supplied, the reader verifies correspondence using the agreed source-identity mechanism before selection; stale content produces an explicit result.

The first activation API accepts a DOM element, not arbitrary markup insertion. Hosts must sanitize untrusted SVG before inserting it; activation is not a sanitizer and cannot undo code that already ran during insertion. Readers still validate mapping metadata. Source is displayed as text. Invalid data never produces an unrelated source selection. Test stale revisions and malformed mappings separately from rendering.

## C6 — Producer-independent interoperability (S5-AC1–AC2)

TypeScript and Rust producers use the same versioned artifact contract for their shared supported subset. Consumers depend on that contract, not producer internals or SVG layout identity. Cross-language fixtures verify coordinate conversion, IDs/relations, source payload, and JS activation. Unsupported producer features are explicit.

## C7 — Markdown extraction and insertion (S3-AC1, S3-AC4–AC6)

Adapters retain original document/block identity and revision alongside the exact logical text sent to the producer. Every supported logical span translates to original Markdown segments even when extraction removes container prefixes/indentation or normalizes newlines. A primary editor range follows a documented policy; it must not be presented as exact Mermaid text if it includes container syntax. Missing provenance yields unavailable mapping, never guessed coordinates.

Non-Mermaid content retains its renderer's behavior. Synchronous fence hooks consume prepared artifacts; asynchronous production uses a separate preparation or host update stage. Inserted SVG IDs and internal references are consistently scoped per instance. Sanitization preserves only the agreed inert schema; activation validates the result. Test real markdown-it and unified pipelines, nested/repeated blocks, CRLF, Unicode, replacement, and sanitization. See [integration research](../../markdown-integration.md).

## C8 — All diagram coverage (S6-AC1–AC5)

The supported Mermaid version's built-in registry defines the required families, including experimental entries, syntax variants and alternate renderers. Maintain a coverage inventory and real fixtures for each. A family is supported only when parser-derived semantic element/label spans, visual identities, reverse lookup, saved static SVG and browser/Markdown selection pass its conformance checks. Rendering success or a whole-diagram map does not count. Generated decoration has explicit provenance or an unmapped classification. Per-family work may be delivered incrementally, but none of these families may be deferred outside the first usable release merely because its mapping is harder.

## Contract verification status

| Contract | Planned check | Status |
|---|---|---|
| C1 | Static/offline browser rendering and artifact inspection | Experimental demo passes scripts-disabled display; comprehensive export-security acceptance pending |
| C2 | Exact-span and bidirectional relation fixtures | MAP-1, MD-1 and ACT-1 pass for supported flowcharts and format 0 projections |
| C3 | Encoding round-trip and malformed/versioned metadata cases | Format 0 reader checks pass; stable v1 and sanitizer compatibility pending |
| C4 | Renderer-free consumer bundle and browser lifecycle checks | ACT-1 passes saved-SVG gestures, isolation and disposal in pinned Chromium; package distribution pending |
| C5 | Host adapter, stale source, and trust-boundary cases | Stale source/document and unchanged-DOM rejection pass; external-host sanitization acceptance pending |
| C6 | Shared TypeScript/Rust artifact conformance | Not run |
| C8 | Registry inventory and per-family semantic/artifact/browser conformance | Inventory recorded; full coverage not implemented |
| C7 | Real Markdown pipelines, exact extraction ranges, and insertion lifecycle | MD-1/ACT-1/DOC-1 pass markdown-it provenance, sanitized mdast/hast document rendering and browser consumption; general plugins and host replacement integration pending |

Evidence and exact scope: [mapping proof](../flowchart-mapping/spec.md), [Markdown provenance](../markdown-provenance/spec.md), [activation/demo](../svg-activation/spec.md). Passing experimental slices do not freeze artifact v1 or complete cross-host conformance.

## Experimental native SVG format 1

[SEQ-1](../sequence-mapping/spec.md) implements `mermaid-trace/1`: exact source and source pieces remain in encoded root `data-mt-map`; pieces retain per-result semantic IDs, explicit native `domId` keys, UTF-16 `span` and optional contained `labelSpan`. Kinds include `node`, `edge`, `note`, `activation` and `control`; edges include native endpoints. Visual bindings are verified against renderer-owned `data-mt-key`, allowing mirrored actors and separate label groups. The format 0 reader remains for historical fixtures; no legacy renderer is used by the production preview. Both versions remain experimental, not stable public contracts.

FLOW-AC4 occurrence binding: native flowchart pieces may include a boolean `effective` marker identifying the accumulated label's parser origin. All authored occurrences remain queryable. Visual activation uses the effective declaration; the displayed label references only its own occurrence. Superseded label source selections highlight the semantic node without claiming that another displayed label came from that source. Empty authored labels carry no fabricated label range. This is an additive experimental format-1 field, not a stable format revision.
