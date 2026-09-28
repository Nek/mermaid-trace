# Saved SVG activation

The generated fork-mapped demo was retired on 2026-09-28. Demo-specific criteria and verification below record the historical ACT-1 experiment; the native [watch preview](../watch-cli/spec.md) and its saved/live browser tests are the current user-facing route. The activation library and format-0 reader remain in use for saved artifacts.

**ACT-1 — implemented:** As a viewer user, I want to select diagram elements and original Markdown in either direction, using a saved SVG without loading Mermaid.

Scope: existing experimental flowchart artifacts, independent activation library, and a generated Markdown demonstration. Depends on MD-1 and MAP-1. Out of scope: source editing, full AST reconstruction, missing-source artifacts (format 0 always embeds source), additional diagram types, unified and VS Code adapters, format v1, publication. Initial verification targets the pinned Chromium; wider browser support is unclaimed.

## Contracts and acceptance

- **ACT-AC1:** `activateSvg(svg, {source?, onSelect})` validates metadata before changing DOM and returns the readonly `mapping`, `highlight(ranges)`, `select(pieceId)`, and idempotent `dispose()`. Click/Enter/Space on the nearest mapped descendant emits its role, ordered piece projections, and primary span. Node declaration is primary, otherwise first occurrence; labels select their label span. Programmatic piece selection selects that occurrence's whole span. All alternatives remain accessible.
- **ACT-AC2:** Source ranges (including carets under half-open containment) highlight associated visuals through `data-mt-selected` and return matching projections in source order. Label-only ranges highlight the label without its parent node/connector; broader ranges highlight the whole mapped element. Bad bounds/unknown pieces fail explicitly. Root-scoped lookup works with duplicate IDs across separate SVGs. Unmapped/background targets select the whole diagram under [DOC-1](../document-selection/spec.md), with role `diagram` and the full local source span. Full-source highlighting marks the SVG root instead of every descendant. Selection gestures prevent navigation through enclosing hyperlinks; hosts should expose ordinary navigation separately.
- **ACT-AC3:** Duplicate attachment rejects. Disposal restores library-owned accessibility/highlight attributes, removes listeners and permits reattachment. Later calls on disposed handles reject; disposal itself is repeatable. Host attribute changes made while active are preserved. Hosts may change presentation styles while active; dispose before replacing or modifying SVG structure or mapping metadata.
- **ACT-AC4:** Safe inline DOM is a precondition, not an outcome of activation. Missing/invalid/stale metadata fails without DOM changes. Browser modules import neither Mermaid nor Markdown rendering. Focus and selection are visible in the demo, mapped elements are keyboard focusable, and source text remains text.
- **ACT-AC5:** The demo uses real Markdown with two diagrams (including a nested fence), pre-rendered static SVG and a readonly source view. Diagram selection chooses the original Markdown envelope, displays exact segments, and offers occurrence alternatives. Source selection highlights both diagrams through MD-1. With scripting disabled, diagrams and original source remain visible. Generated pages need no Mermaid runtime or remote requests. Errors are visible. Browser history retaining the page must retain working interaction. The trusted fixture is rendered during generation; this is not an arbitrary SVG upload/sanitization service.

## Plan

1. Browser tests against a saved fixture: real click and keyboard events, reverse selection, instance isolation, cleanup, stale metadata, and no renderer globals. Confirm failures before implementation.
2. Implement native DOM event delegation and readonly selection data; reuse `readSvgMapping`. The initial host styled `data-mt-selected` and `:focus-visible`; ACT-STYLE below moves the default diagram cues into activation so independent hosts receive them too. No UI framework or state library needed.
3. Add a tiny browser consumer and static-page generator reusing the deterministic rendering harness and MD-1. Vite is the approved dev server; TypeScript still builds modules. Add a real end-to-end test against the generated Markdown page, including a scripts-disabled context and resource checks. Do not update rendering baselines.
4. Verify tests/typecheck and visually inspect the generated page; update roadmap and contracts, then commit. No upstream publication.

| Criterion | Check | Status |
|---|---|---|
| ACT-AC1/2 | Saved SVG browser gestures, exact selections, reverse lookup and duplicate IDs | Pass: `test/svg-activation.test.ts` |
| ACT-AC3 | Duplicate attach, attribute restoration, reattach and disposed operations | Pass: `test/svg-activation.test.ts` |
| ACT-AC4 | Invalid/stale data leaves DOM unchanged; consumer dependency inspection | Pass: activation test plus demo request inventory |
| ACT-AC5 | Generated Markdown browser integration, scripts disabled, offline and visual check | Pass: `test/demo.test.ts`; desktop and narrow viewport screenshots inspected |

Verification: activation and demo tests first failed against their unimplemented functions. Full `pnpm test`: 12 passing, including unchanged raw SVG baselines. Chromium only; no screen-reader acceptance test or other browser engine run. Vite is dev tooling, not part of the activation module. The browser dependency graph contains `demo`, `svg-activation`, `svg-mapping`, and `markdown-source`; type-only producer imports are erased.

Run `make preview ARGS='watch docs/examples/interactive.md --source'` from the repository root to exercise activation in the native preview. No arbitrary file uploads or live source edits. For external artifacts, sanitize before DOM insertion, preserve the inert mapping attributes, then activate. Dispose before replacement and activate the new element.

## LOC-1 — copyable selection location (implemented)

As a reader, I want clicking a diagram element to copy a readable filename and selection range into the clipboard. Scope: display locations in both selection directions and for occurrence alternatives; no editor-specific URL scheme.

- **LOC-AC1:** Display `filename.md:startLine:startColumn-endLine:endColumn`, using one-based lines/UTF-16 columns and an exclusive end. Carets display `filename.md:line:column`. Use the actual original-document selection envelope; retain exact segment details for nested Markdown. LF, CRLF, CR, Unicode and end-of-input offsets are supported; invalid ranges reject.
- **LOC-AC2:** Diagram selection (click, keyboard or occurrence choice) automatically copies exactly the displayed location through the native clipboard API and reports success. There is no copy button. Source-view selection updates the displayed location without writing the clipboard. Clipboard failure/unavailability is explicit, and the readonly location field remains manually selectable. Changing selection clears old copy feedback.

Plan: add formatter checks and browser assertions first (including real clipboard read-back and simulated rejection), confirm failure, implement a pure formatter plus native field and automatic copying, then verify the affected tests and typecheck. Regenerate the running demo, update these results and README, and commit atomically. No new dependency.

Verification: formatter and missing-UI tests failed first. Five affected Markdown/demo tests now pass, including real Chromium clipboard read-back on diagram/occurrence selection, source-selection non-copying, clipboard rejection, Unicode and newline ranges. TypeScript build passes. Clipboard access still depends on browser permission; failure leaves the visible location available for manual copying.

## EDGE-1 — connector hit targets and selection precision (implemented)

As a reader, I want unlabeled connectors to be easy to click and the highlighted visual to match the selected source.

- **EDGE-AC1:** Activation provides a 12 CSS-pixel invisible stroke target following each connector (including curves), without widening the visible line or obscuring labels. Pointer clicks within that target and keyboard activation select the full mapped connector syntax (`-->` or `-->|review|`), not just a label. Targets have no duplicate IDs, metadata or keyboard stops; disposal removes them.
- **EDGE-AC2:** Selecting a distinct label subrange highlights the label, without highlighting its parent node/connector. Equal-span visuals form one logical selection under C2-OWN. Selecting connector syntax highlights the connector and its label if present. Apply the same rule to source-view selections; preserve matching piece projections and repeated-node associations.

Plan: regression assertions for label-only highlighting and real mouse clicks four pixels off labeled/unlabeled paths; use path geometry to place test clicks outside labels. Confirm red tests, add native transparent stroke targets and label-aware highlighting centrally in activation, then run activation/demo tests and the full suite. Update docs and commit separately from LOC-1. No producer or static SVG changes.

Verification: regression tests first reproduced parent highlighting for a label selection, then missed clicks four pixels off a connector. Both now pass with native browser mouse events on labeled/unlabeled curves. Disposal restores the exact original SVG markup, including removing hit targets. The demo verifies full arrow/label source ranges and automatic clipboard locations. All 13 tests pass, including unchanged raw SVG baselines; refreshed demo visually inspected in Chromium.

## INPUT-1 — focus is diagram selection (implemented)

As a reader, I want keyboard focus and mapped diagram selection to identify the same element. Focusing a mapped visual (including Tab/Shift+Tab) updates the highlight, source range and displayed location. Clicks on wide connector targets focus the mapped selection representative; equivalent visual parts share that keyboard stop. Diagram selection keeps focus in the diagram; it must not focus the source textarea. Selection callbacks identify `trigger: 'focus' | 'activation'`; focus navigation does not write the clipboard, while clicks, Enter/Space and occurrence choices still copy. Native text selection starting inside an activated SVG is suppressed; the source textarea and location field retain normal selection. Disposal removes the added listeners.

Plan: tests first for focus-to-selection, Tab navigation without clipboard writes, pointer-target focus, and absence of native SVG text selection. Handle focus centrally in activation, distinguish activation callbacks, and remove source focus transfer in the demo. Verify cleanup and integration; update docs and commit. No changes to SVG artifacts or coordinate contracts.

Verification: tests first failed because focusing did not select and clicks moved focus to the textarea. Activation/demo tests now pass for Tab selection, preserved diagram focus, no clipboard writes on focus alone, native-text-selection suppression and cleanup. Pointer focus prevents native focus scrolling; disabling demo scroll anchoring prevents changing occurrence controls from moving the diagram between mouse-down and mouse-up.

ACT-AC2 / STATE-NOTE-CONNECTOR: when a note body and its connector share the complete statement range, reverse selection wholly inside the visible note label uses that label's authored subrange for containment. It highlights only the label; selecting the whole statement relates both note and connector. The regression uses saved native state SVG, retaining all prior family/activation gates.

Verification: the note-text reverse regression failed by highlighting its connector. The shared containment change passes all saved/live note variants, existing activation and sequence checks, and the full 49-test TypeScript/browser suite with typecheck. Full note-statement selection still selects the connector; note-text selection highlights only the note label.

ACT-AC1/2 / FLOW-2 visibility: activation gives keyboard and widened pointer targets only to painted connectors, using the mounted browser's computed paint styles. Hidden/layout-only connector metadata and programmatic source selection survive; independently visible labels remain controls. Dispose restores original attributes/markup. Hosts reattach after changing artifact/style inputs.

Verification: the failing invisible-link keyboard regression now passes saved/live activation across both layouts, three looks and both HTML modes. The complete 50-test TypeScript/browser suite and typecheck pass, preserving state-region and note-connector acceptance.

ACT-AC2 / STATE-IMPLICIT-LABEL (historical; equal-span behavior superseded by OWN-AC3 below): label-only reverse selection suppresses the enclosing piece with the same semantic kind and identity, even if native node/label visual keys differ and their authored ranges are equal. Explicit pointer/keyboard activation still uses the selected occurrence IDs, preserving node selection. Separate diagram instances remain isolated.

Verification: the implicit-state equal-range regression failed before removing the visual-key equality requirement, then passed all 12 state variants. All 51 TypeScript/browser tests and typecheck pass, including strengthened saved/live reverse-selection and explicit state node keyboard assertions.

ACT-AC1 / FLOW-2 pointer retargeting (ready): a real connector press may start on the widened hit stroke and release on the authored path after focus highlighting changes its painted width. The browser sends the click to their common ancestor. Preserve the mapped press target for that real click, so activation and clipboard select the connector rather than the diagram background. Do not change keyboard/programmatic click handling or source identity. The independent operator matrix reproduces this with a `neo` dotted connector in live Markdown.

Pointer-retargeting delivery: activation retains the mapped primary-button press target for a real common-ancestor click after focus changes the painted stroke. Programmatic/keyboard activation remains unchanged. The 2,340 saved/live operator matrix passes pointer, keyboard, source/clipboard, reverse lookup, isolation and disposal; all 53 TypeScript/browser tests and typecheck pass.

ACT-AC1/2 / OWN-AC3 (ready): group embedded visual selection spans per SVG, without comparing display text or collapsing AST identities. Any group member activates its representative and emits the union of native bindings; exact-span node/label and note/connector parts highlight together. Distinct label subranges retain label-only selection. One representative is tabbable; pointer and programmatic focus redirect equivalent parts to it. Hosts use the group highlight as its focus indication, avoiding a second rectangle around one constituent. Preserve background selection, automatic clipboard activation, instance isolation, saved/static artifacts and exact attribute restoration on disposal.

OWN-AC3 delivery: the reported note regression fails before grouping. Saved/live physical clicks on either body or connector now select both, preserving native bindings and one keyboard stop. Exact-span node/label groups share selection; distinct-label checks across every public shape remain green. All acceptance checks are verified across the complete-suite run and the final test-only bare-ID correction described in [OWN-1](../source-ownership/spec.md#own-ac3-activation-delivery-plan-ready). Typecheck passes; the unchanged static baselines and exact disposal/instance isolation checks pass.

### ACT-STYLE — coherent focus for independent activation (ready)

As an embedding host, I want activating a saved SVG to provide a visible group selection without requiring viewer CSS. Selected parts share the existing teal highlight; keyboard focus uses that highlight instead of a separate browser rectangle. Whole-diagram focus uses the diagram outline. Style effects stay inside that SVG instance, preserve independent labels and disappear on disposal, restoring the original markup. Invalid metadata still fails before any DOM changes. Hosts may override appearance with their own styles.

Plan: the saved journey score regression already fails on the browser's `outline:auto`. Extend the existing activation lifecycle with one instance-scoped SVG style element and a tracked scope attribute; reuse the current viewer's selection appearance and remove the duplicate viewer rules. Add saved-artifact checks for computed highlighting, keyboard focus, instance isolation and exact cleanup, then run activation, score/browser and complete project gates. No producer, source-mapping or grouping changes. This closes the generic focus contract rather than introducing a journey exception.

ACT-STYLE delivered: independent saved-SVG checks failed first on missing highlighting (`filter:none`) and competing browser focus (`outline:auto`). Activation now supplies scoped selection styles and uses the group highlight for focus; the demo and watcher reuse them. Saved/live score grouping, independent-instance styling, stale-metadata validation and exact markup restoration on disposal pass. The full `make test typecheck` gate passes all 67 Rust and 64 TypeScript/browser tests plus typecheck; static baselines remain unchanged.

### ACT-VISIBILITY-TRANSITIONS (delivered)

As a host showing a saved diagram, I want selection targets to track current paint visibility when styles change after activation. A zero-font text label or hidden/unpainted connector starts with no keyboard stop, pointer target or highlight; revealing it makes its existing source-backed visual selectable, and hiding it again removes that target and highlight. Its source evidence remains available throughout. This applies through the shared activator to every mapped family and to live Markdown; equivalent-span parts still share one focus stop. Disposal restores original SVG attributes and stops observing host presentation changes.

Plan: fail Chromium regressions on a saved flowchart connector and native Gantt text label hidden at activation, then reveal/re-hide them through host style changes. Keep all validated mapped candidates; recompute text and connector paint exposure with current style and viewport, and watch presentation attributes on the SVG subtree. Reuse existing grouping, hit-target creation and cleanup; do not parse Mermaid or change the static artifact. Verify keyboard/pointer/source/clipboard where applicable, instance isolation, exact disposal and the full project gate. DOM structure and mapping-metadata mutations while active remain outside this story.

ACT-VISIBILITY-TRANSITIONS delivered: the saved flowchart connector and Gantt label tests failed on reveal before the fix. Activation now reevaluates mapped candidates when presentation changes, removes hidden hit targets, and resolves label-only source highlighting from currently exposed labels. The existing invisible-link test checks the actual widened target rather than another hidden mapped path. Saved and live selection, source pane, clipboard, activation lifecycle and exact disposal pass. `make test typecheck` passes all 98 TypeScript/browser tests, the Rust suite and typecheck.
