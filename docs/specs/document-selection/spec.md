# DOC-1 — consistent Markdown and diagram selection

Status: implemented (experimental CommonMark view; pinned Chromium). As a document reader, I want click/focus selection and text dragging to identify original Markdown, including whole diagrams and headings.

## Contracts

- **DOC-AC1:** Focus/click on prose, headings, lists, quotes or ordinary code selects that source construct. A heading, including the document title, selects only its own Markdown heading syntax and text; it never expands to the section or document. Diagrams outside that range must not be highlighted. Diagram background/focus selects its whole fenced Markdown block; diagram children retain precise node/edge/label selection. Source view, visible location and highlights follow one document range. Tab previews; click/Enter/Space copies.
- **DOC-AC2:** Native text dragging outside SVG maps selected characters back to original source, including across inline formatting, repeated text, entities, escapes, Unicode, CRLF and container prefixes. Multi-block selections return their enclosing original range. Render-only whitespace has no source; transformed content without exact correspondence reports enclosing-range precision, never guessed character positions. SVG is atomic in cross-block text ranges.
- **DOC-AC3:** Input HTML and unsafe links remain inert. Render safe HTML through unified's mdast/hast utilities and sanitization, then insert only trusted pre-rendered SVG. Retain the existing markdown-it adapter and verify extraction correspondence using original fence positions, never repeated-text matching. The browser loads mapping data and selection code, not either parser/renderer.
- **DOC-AC4:** Source text dragging and keyboard focus remain usable. Clipboard writes happen on explicit activation or completion of a rendered text drag, not on Tab or source-view selection. Block activation does not swallow the native text drag that produces a range. Mapping/focus events from inside SVG must not also activate ancestor Markdown blocks.

## Plan

Use the already-planned unified ecosystem for inline positions: `mdast-util-from-markdown`, `mdast-util-to-hast`, `hast-util-sanitize`, `hast-util-to-html`. Keep browser selection independent. Annotate rendered text with origin runs and block targets with AST positions; derive entity/escape offsets within those bounded spans using the existing Markdown decoder. No document-wide string searches. The old markdown-it adapter remains supported; its fence origins are reused by the demo producer.

Tests first: document rendering/provenance/security, background selection, focus and real browser text drags with clipboard read-back. Implement one shared demo selection path, verify the existing suite and updated browser page, update README/roadmap, then commit. No Rust or VS Code changes.

## Verification

| Contract | Check | Result |
| --- | --- | --- |
| DOC-AC1 | Real browser block/heading focus, diagram background click/Enter, nested target isolation, reverse source selection | Pass: `test/demo.test.ts` |
| DOC-AC2 | Real word drag; native ranges across formatting, entities and multiple blocks; original CRLF/Unicode/escape/container coordinates | Pass: `test/demo.test.ts`, `test/markdown-view.test.ts` |
| DOC-AC3 | Unsafe HTML/links removed; missing SVG rejects; no producer/parser browser requests; scripts-disabled diagrams | Pass: Markdown-view and demo tests |
| DOC-AC4 | Clipboard read-back, no copying on focus/source selection, drag highlight retained, focus clears old native selection, denied clipboard fallback | Pass: demo test |

Tests first failed for absent rendering, background selection, duplicate container highlighting, paragraph highlighting during a word drag, and stale native selection after focus navigation. All 15 project tests and the TypeScript build now pass; raw upstream SVG snapshots are unchanged. The initial section-selection behavior is superseded by the heading correction below.

The view currently handles CommonMark through mdast/hast and reuses markdown-it fence extraction. It is not a general remark plugin or GFM implementation. Character origins are UTF-16 spans; a rendered entity may map to several source characters. Unsupported text transformations explicitly use the enclosing AST span. Native rendered-text drags keep their own highlight; reverse source selection identifies the enclosing Markdown block and mapped diagram elements. Links retain native navigation. Wider browser verification remains pending.

## Heading selection correction

User clarification: clicking a title selects only the title. Apply the same rule to every heading level and keyboard focus/activation. Remove section-range expansion at the producer so every selection consumer receives the correct heading span. First update producer and browser regression tests (title and subheading, copied location, no selected SVGs), confirm failure, then remove expansion and verify. Broad ranges remain available through text dragging.

Verification: producer and browser regressions failed first with section/document spans. After removing expansion, the affected 3 tests pass, including exact title/subheading source and clipboard ranges, keyboard focus, and zero diagram highlights. The other 12 tests passed in the full run; TypeScript build passes. The demo was regenerated.

## Native source selection

**DOC-AC5:** Original Markdown uses a real browser text selection, with no duplicated text or overlay. Preview selection selects that exact source range while retaining preview focus. Native source dragging updates mapping and location without copying. Selection must survive horizontal/vertical scrolling and resizing. Rendered-text drags and source selection must coexist.

Plan: replace the textarea/mirror with a read-only `pre` in a same-origin `srcdoc` frame containing only escaped text and styles. Separate documents provide independent native selections through `Document.getSelection()`, preserving native rendered-text drags. Escape all source text; no contenteditable or editor dependency. Use DOM Range for source offsets and reveal its start inside the scrolling pane. Browser regressions first for actual selection, no overlay, focus, native source drag, scrolling/resizing and simultaneous rendered/source selections. Keep static source display with JavaScript disabled. Then remove the mirror, verify and commit.

Supersedes the textarea overlay introduced in `850e7e9`. Native source selections are mapped without resetting them during a drag. The source frame contains no scripts; disabling scripts via a sandbox prevented real mouse selection in the verified Chromium, so the generated text-only frame uses normal same-origin event delivery. Its HTML source is escaped, and activation rebuilds one exact text node to retain original CRLF offsets.

Verification: the regression first failed against the overlay. All 15 project tests and TypeScript build pass. The browser test verifies actual `Selection` ranges and normal Copy of source text, real source/rendered mouse drags, independent ranges, focus retention, horizontal/vertical scrolling, resizing and script-free static display. The source highlight was also visually checked with preview focus retained. Browser verification remains pinned to Chromium.
