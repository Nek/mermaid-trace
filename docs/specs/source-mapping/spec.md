# Feature: source-mapped Mermaid diagrams

Status: initial behavioral baseline. Product stories need a concrete diagram/backend/format decision and a per-story plan before implementation. Contracts live in [contracts.md](contracts.md); milestones live in [ROADMAP.md](../../ROADMAP.md).

## Problem, users, and goals

Diagram readers and editor users need to identify the source behind a visual element. Library authors need a reusable source ↔ AST ↔ visual mapping without coupling their application to a particular viewer or file-reading workflow.

Produce static annotated SVG first, then provide optional interaction that works on that artifact. Markdown adapters are part of initial delivery; the first browser demonstration uses real Markdown input. See the [integration investigation](../../markdown-integration.md). Support labels, nodes, cards, links, and equivalent pieces as their diagram types become supported. Preserve provenance rather than guessing locations from repeated display text.

## Constraints and non-goals

- One TypeScript implementation, with Clojure-inspired data transformations and thi.ng preferred as described in [DESIGN.md](../../DESIGN.md). Rust is a later native implementation, not another frontend.
- Core/rendering accept source text; the host owns document paths, Markdown extraction provenance, and source-file access.
- Initial coverage is one explicitly chosen diagram type and documented subset. Unsupported syntax must be reported; it must not produce confident but incorrect mappings.
- No collaboration, CRDTs, visual source rewriting, AST mutation API, round-trip formatter, complete IDE, or production VS Code extension in the initial release.
- No custom Mermaid parser/layout engine unless feasibility proves reuse unsuitable. SVG serialization libraries alone do not establish Mermaid support.

## User stories and acceptance criteria

### S1 — Export an independently displayable mapped SVG

As a renderer consumer, I want SVG containing source-mapping data so I can display or save a diagram without an interactive runtime.

- **S1-AC1:** Given supported Mermaid text, when rendered, then the SVG displays with JavaScript disabled and contains no scripts, event-handler attributes, executable URLs, or automatic animation. It needs no runtime network fetches for essential visual content.
- **S1-AC2:** Given a mapped visual piece, when its metadata is read, then its AST reference(s) and exact Mermaid-local span(s) can be resolved, including repeated labels and multiple occurrences.
- **S1-AC3:** Given Unicode, tabs, CRLF, or comment-delimiter text in the source, when exported and read back, then spans and any included source text remain exact.
- **S1-AC4:** Given an exported SVG saved and reloaded separately, when its metadata is decoded, then mapping works without rerunning Mermaid or opening the originating Markdown file.
- **S1-AC5:** Given invalid or unsupported input, when rendering is requested, then diagnostics distinguish failure/unsupported coverage from unmapped generated decoration; no fabricated span is returned.

### S2 — Activate an existing SVG

As a host developer, I want to attach interaction to a supplied SVG so I can use artifacts generated elsewhere without shipping the renderer.

- **S2-AC1:** Given a compatible inline SVG, when activated, then selecting a mapped descendant by click or keyboard identifies its nearest applicable mapping and emits the AST reference(s), source span(s), and deterministic primary selection.
- **S2-AC2:** Given a source range, when the host requests reverse selection, then matching visuals are highlighted and all matching AST references are available.
- **S2-AC3:** Given multiple SVG instances with identical internal IDs, when one is selected, then lookup, callbacks, and highlights stay scoped to that instance.
- **S2-AC4:** Given an activated SVG, when disposed, then added handlers and library-owned selection/accessibility state are removed without deleting the original diagram. Reactivation must not duplicate handlers.
- **S2-AC5:** Given missing, malformed, incompatible, or stale mapping/source data, when activated or selected, then an explicit unavailable/error result is exposed and unrelated source is never selected. A safe displayable diagram remains displayable.
- **S2-AC6:** Given a visual hyperlink, when a source-selection gesture occurs, then it does not also navigate. Keyboard controls and visible focus/selection are documented.

### S3 — Embed in Markdown and VS Code

As a Markdown/editor host author, I want block-local selections translated into my document so I can use Mermaid Trace alongside my editor.

- **S3-AC1:** Given several Markdown Mermaid blocks, when a local span is selected, then the host adapter selects the correct document/block using explicit identity and extraction provenance, including any stripped prefixes or normalized newlines.
- **S3-AC2:** Given an edited source block, when an older diagram remains visible, then the adapter rejects stale source selection until the mapping is refreshed or matched to its original source.
- **S3-AC3:** Given a VS Code webview and its host editor, when a selection is emitted, then a demonstration adapter selects the corresponding range through the host boundary; the core does not access VS Code APIs.

- **S3-AC4:** Given markdown-it and unified/remark/rehype pipelines, when Mermaid fences are processed, then adapters insert annotated inline SVG while preserving other fences and surrounding content. Disabling activation leaves static diagrams.
- **S3-AC5:** Given nested/list/blockquote fences, tabs, Unicode, or CRLF, when translating a logical source span, then exact original-document segments and a documented primary editor range are returned, or unsupported mapping is explicitly reported. Repeated block text is never located by substring guessing.
- **S3-AC6:** Given sanitized or replaced preview HTML and repeated diagrams, when activated, then retained metadata validates, SVG references remain instance-correct, and old activations are disposed. Missing mapping data leaves static output with an unavailable result.

### S4 — Basic viewer

As a diagram reader, I want a diagram and source view so I can inspect where visual pieces came from.

- **S4-AC1:** Given a mapped SVG plus embedded or supplied matching source, when selecting a visual, then the viewer visibly selects the exact source range; selecting source highlights corresponding visuals.
- **S4-AC2:** Given multiple candidate spans, when selecting, then the viewer shows the documented primary selection and allows access to the alternatives.
- **S4-AC3:** Given an artifact without source text, when displayed, then the viewer can expose locations and report source as unavailable; it does not guess or read a file implicitly.

### S5 — Rust producer and mapping core

As a Rust host author, I want native mapping and SVG generation so I can embed the functionality without a JavaScript rendering dependency.

- **S5-AC1:** Given shared supported fixtures, when processed by either implementation, then semantic mapping results and format compatibility agree; SVG layout need not be byte-identical.
- **S5-AC2:** Given a Rust-produced artifact, when opened by the same JS activation library, then S2 behavior works without a Rust-specific frontend.
- **S5-AC3:** Given performance claims, when published, then reproducible workload, environment, time, and memory measurements accompany them; faster performance is not assumed.

## Clarification decisions

- **D1 — Static artifact:** accepted from the user. SVG contains data; interaction belongs to a separately consumable JS library.
- **D2 — Logical split:** core + producer + activation library + thin viewer. Recommended starting structure in one repository; package extraction follows demonstrated boundaries.
- **D3 — Source packaging:** propose embedded inert SVG metadata as the standalone artifact's canonical payload. A preceding encoded comment remains an optional HTML-fragment export for the original use case; it cannot be the only source payload for a self-contained `.svg`. Exact encoding remains open.
- **D4 — AST availability:** a saved SVG must carry enough serialized AST identity, kind, and provenance to resolve selections. It need not contain the entire parser AST. Core APIs expose actual AST pieces when available; activation returns explicit references/projections, never claims those are a full AST.
- **D5 — Coordinates:** propose zero-based UTF-16 offsets with exclusive end, plus one-based lines/columns for display. This fits JS editor boundaries; Rust must convert explicitly. Final decision and Unicode examples required at M1.

## Open questions and readiness

- [NEEDS CLARIFICATION: Which initial diagram type and syntax subset?] Recommendation: a small flowchart subset with nodes, edge labels, repeated references, and subgraphs. Blocks S1 implementation, not toolchain work.
- [NEEDS CLARIFICATION: Which parser/renderer preserves reliable source spans and visual identity?] Resolve through M1 investigation, including browser versus Node execution needs.
- [NEEDS CLARIFICATION: Exact v1 attribute names, span units, metadata/source encoding, AST projection, source-version check, and size limits?] Resolve before S1/S2 format implementation; do not promise a stable wire format yet.
- [NEEDS CLARIFICATION: Primary span and source-overlap selection policy?] Recommend declaration first where known, otherwise source order; expose all alternatives. Resolve before S2.
- [NEEDS CLARIFICATION: Initial browser support policy and hyperlink gesture?] Resolve with the relevant story. Markdown-it is the proposed first adapter; unified/rehype follows before the integration milestone closes.
- Public package names, distribution layout, and project license remain undecided. Do not publish under an assumed license.

## Verification matrix

| Criteria | Planned checks | Status |
|---|---|---|
| S1-AC1 | Browser with scripts disabled; artifact inspection and offline/resource check | Not implemented / not run |
| S1-AC2–AC4 | Source-span fixtures, Unicode/CRLF boundaries, repeated occurrences, serialized artifact round-trip | Not implemented / not run |
| S1-AC5 | Invalid/unsupported inputs and generated decoration diagnostics | Not implemented / not run |
| S2-AC1–AC2 | Real browser click/keyboard and reverse-selection checks | Not implemented / not run |
| S2-AC3–AC4 | Duplicate IDs across instances, dispose/reactivate lifecycle | Not implemented / not run |
| S2-AC5–AC6 | Invalid metadata/stale source, safe link handling, keyboard acceptance | Not implemented / not run |
| S3-AC1–AC6 | Both Markdown adapters, extraction provenance, sanitization/replacement, edits, and VS Code host demonstration | Not implemented / not run |
| S4-AC1–AC3 | Viewer selection, alternatives, and source-unavailable behavior | Not implemented / not run |
| S5-AC1–AC3 | Cross-language fixtures, Rust artifact activation, reproducible benchmarks | Not implemented / not run |

Split matrix rows to individual criteria and executable checks in each selected story's plan. No product implementation story is currently marked complete.
