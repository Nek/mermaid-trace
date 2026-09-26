# Saved SVG activation and Markdown demonstration

**ACT-1 — implemented:** As a viewer user, I want to select diagram elements and original Markdown in either direction, using a saved SVG without loading Mermaid.

Scope: existing experimental flowchart artifacts, independent activation library, and a generated Markdown demonstration. Depends on MD-1 and MAP-1. Out of scope: source editing, full AST reconstruction, missing-source artifacts (format 0 always embeds source), additional diagram types, unified and VS Code adapters, format v1, publication. Initial verification targets the pinned Chromium; wider browser support is unclaimed.

## Contracts and acceptance

- **ACT-AC1:** `activateSvg(svg, {source?, onSelect})` validates metadata before changing DOM and returns the readonly `mapping`, `highlight(ranges)`, `select(pieceId)`, and idempotent `dispose()`. Click/Enter/Space on the nearest mapped descendant emits its role, ordered piece projections, and primary span. Node declaration is primary, otherwise first occurrence; labels select their label span. Programmatic piece selection selects that occurrence's whole span. All alternatives remain accessible.
- **ACT-AC2:** Source ranges (including carets under half-open containment) highlight associated visuals through `data-mt-selected` and return matching projections in source order. Label-only ranges highlight the label without its parent node/connector; broader ranges highlight the whole mapped element. Bad bounds/unknown pieces fail explicitly. Root-scoped lookup works with duplicate IDs across separate SVGs. Decorative targets produce no selection. Selection gestures prevent navigation through enclosing hyperlinks; hosts should expose ordinary navigation separately.
- **ACT-AC3:** Duplicate attachment rejects. Disposal restores library-owned accessibility/highlight attributes, removes listeners and permits reattachment. Later calls on disposed handles reject; disposal itself is repeatable. Host attribute changes made while active are preserved. Hosts dispose before replacing or modifying SVG/metadata; in-place mutation while active is unsupported.
- **ACT-AC4:** Safe inline DOM is a precondition, not an outcome of activation. Missing/invalid/stale metadata fails without DOM changes. Browser modules import neither Mermaid nor Markdown rendering. Focus and selection are visible in the demo, mapped elements are keyboard focusable, and source text remains text.
- **ACT-AC5:** The demo uses real Markdown with two diagrams (including a nested fence), pre-rendered static SVG and a readonly source view. Diagram selection chooses the original Markdown envelope, displays exact segments, and offers occurrence alternatives. Source selection highlights both diagrams through MD-1. With scripting disabled, diagrams and original source remain visible. Generated pages need no Mermaid runtime or remote requests. Errors are visible. Browser history retaining the page must retain working interaction. The trusted fixture is rendered during generation; this is not an arbitrary SVG upload/sanitization service.

## Plan

1. Browser tests against a saved fixture: real click and keyboard events, reverse selection, instance isolation, cleanup, stale metadata, and no renderer globals. Confirm failures before implementation.
2. Implement native DOM event delegation and readonly selection data; reuse `readSvgMapping`. The host styles `data-mt-selected` and `:focus-visible`. No UI framework or state library needed.
3. Add a tiny browser consumer and static-page generator reusing the deterministic rendering harness and MD-1. Vite is the approved dev server; TypeScript still builds modules. Add a real end-to-end test against the generated Markdown page, including a scripts-disabled context and resource checks. Do not update rendering baselines.
4. Verify tests/typecheck and visually inspect the generated page; update roadmap and contracts, then commit. No upstream publication.

| Criterion | Check | Status |
|---|---|---|
| ACT-AC1/2 | Saved SVG browser gestures, exact selections, reverse lookup and duplicate IDs | Pass: `test/svg-activation.test.ts` |
| ACT-AC3 | Duplicate attach, attribute restoration, reattach and disposed operations | Pass: `test/svg-activation.test.ts` |
| ACT-AC4 | Invalid/stale data leaves DOM unchanged; consumer dependency inspection | Pass: activation test plus demo request inventory |
| ACT-AC5 | Generated Markdown browser integration, scripts disabled, offline and visual check | Pass: `test/demo.test.ts`; desktop and narrow viewport screenshots inspected |

Verification: activation and demo tests first failed against their unimplemented functions. Full `pnpm test`: 12 passing, including unchanged raw SVG baselines. Chromium only; no screen-reader acceptance test or other browser engine run. Vite is dev tooling, not part of the activation module. The browser dependency graph contains `demo`, `svg-activation`, `svg-mapping`, and `markdown-source`; type-only producer imports are erased.

Run `corepack pnpm demo` to generate `dist/index.html` and serve locally. The generator reuses the deterministic browser producer with the trusted checked-in Markdown fixture; generated output is ignored build output. No arbitrary file uploads or live source edits. For external artifacts, sanitize before DOM insertion, preserve the inert mapping attributes, then activate. Dispose before replacement and activate the new element.

## LOC-1 — copyable selection location (implemented)

As a reader, I want clicking a diagram element to copy a readable filename and selection range into the clipboard. Scope: display locations in both selection directions and for occurrence alternatives; no editor-specific URL scheme.

- **LOC-AC1:** Display `filename.md:startLine:startColumn-endLine:endColumn`, using one-based lines/UTF-16 columns and an exclusive end. Carets display `filename.md:line:column`. Use the actual original-document selection envelope; retain exact segment details for nested Markdown. LF, CRLF, CR, Unicode and end-of-input offsets are supported; invalid ranges reject.
- **LOC-AC2:** Diagram selection (click, keyboard or occurrence choice) automatically copies exactly the displayed location through the native clipboard API and reports success. There is no copy button. Source-view selection updates the displayed location without writing the clipboard. Clipboard failure/unavailability is explicit, and the readonly location field remains manually selectable. Changing selection clears old copy feedback.

Plan: add formatter checks and browser assertions first (including real clipboard read-back and simulated rejection), confirm failure, implement a pure formatter plus native field and automatic copying, then verify the affected tests and typecheck. Regenerate the running demo, update these results and README, and commit atomically. No new dependency.

Verification: formatter and missing-UI tests failed first. Five affected Markdown/demo tests now pass, including real Chromium clipboard read-back on diagram/occurrence selection, source-selection non-copying, clipboard rejection, Unicode and newline ranges. TypeScript build passes. Clipboard access still depends on browser permission; failure leaves the visible location available for manual copying.

## EDGE-1 — connector hit targets and selection precision (implemented)

As a reader, I want unlabeled connectors to be easy to click and the highlighted visual to match the selected source.

- **EDGE-AC1:** Activation provides a 12 CSS-pixel invisible stroke target following each connector (including curves), without widening the visible line or obscuring labels. Pointer clicks within that target and keyboard activation select the full mapped connector syntax (`-->` or `-->|review|`), not just a label. Targets have no duplicate IDs, metadata or keyboard stops; disposal removes them.
- **EDGE-AC2:** Selecting only a label highlights the label, without highlighting its parent node/connector. Selecting connector syntax highlights the connector and its label if present. Apply the same rule to source-view selections; preserve matching piece projections and repeated-node associations.

Plan: regression assertions for label-only highlighting and real mouse clicks four pixels off labeled/unlabeled paths; use path geometry to place test clicks outside labels. Confirm red tests, add native transparent stroke targets and label-aware highlighting centrally in activation, then run activation/demo tests and the full suite. Update docs and commit separately from LOC-1. No producer or static SVG changes.

Verification: regression tests first reproduced parent highlighting for a label selection, then missed clicks four pixels off a connector. Both now pass with native browser mouse events on labeled/unlabeled curves. Disposal restores the exact original SVG markup, including removing hit targets. The demo verifies full arrow/label source ranges and automatic clipboard locations. All 13 tests pass, including unchanged raw SVG baselines; refreshed demo visually inspected in Chromium.
