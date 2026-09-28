# Saved SVG activation

The generated fork-mapped demo was retired on 2026-09-28. The native [watch preview](../watch-cli/spec.md) is the current user-facing route. The independent activation library and format-0 reader remain in use for saved artifacts. ACT-AC5 below records a historical demo criterion, not a currently passing demo test.

**ACT-1 — implemented:** As a viewer user, I want to select diagram elements and original Markdown in either direction, using a saved SVG without loading Mermaid.

Scope: saved SVG from the native producer, independent activation, and Markdown preview. Depends on MD-1 and MAP-1. Source editing, full AST reconstruction, unified and VS Code adapters, format v1, and publication remain separate work. Browser verification targets Chromium; wider browser support is unclaimed.

## Contracts and acceptance

- **ACT-AC1:** `activateSvg(svg, {source?, onSelect})` validates metadata before changing DOM and returns the readonly `mapping`, `highlight(ranges)`, `select(pieceId)`, and idempotent `dispose()`. Click/Enter/Space on the nearest mapped descendant emits its role, ordered piece projections, and primary span. Node declaration is primary, otherwise first occurrence; labels select their label span. Programmatic piece selection selects that occurrence's whole span. All alternatives remain accessible.
- **ACT-AC2:** Source ranges (including carets under half-open containment) highlight associated visuals through `data-mt-selected` and return matching projections in source order. Label-only ranges highlight the label without its parent node/connector; broader ranges highlight the whole mapped element. Bad bounds/unknown pieces fail explicitly. Root-scoped lookup works with duplicate IDs across separate SVGs. Unmapped/background targets select the whole diagram under [DOC-1](../document-selection/spec.md), with role `diagram` and the full local source span. Full-source highlighting marks the SVG root instead of every descendant. Selection gestures prevent navigation through enclosing hyperlinks; hosts should expose ordinary navigation separately.
- **ACT-AC3:** Duplicate attachment rejects. Disposal restores library-owned accessibility/highlight attributes, removes listeners and permits reattachment. Later calls on disposed handles reject; disposal itself is repeatable. Host attribute changes made while active are preserved. Hosts may change presentation styles while active; dispose before replacing or modifying SVG structure or mapping metadata.
- **ACT-AC4:** Safe inline DOM is a precondition, not an outcome of activation. Missing/invalid/stale metadata fails without DOM changes. Browser modules import neither Mermaid nor Markdown rendering. Focus and selection are visible, mapped elements are keyboard focusable, and source text remains text.
- **ACT-AC5 (historical demo):** The retired demo used real Markdown with two diagrams (including a nested fence), pre-rendered static SVG and a readonly source view. Diagram selection chose the original Markdown envelope, displayed exact segments, and offered occurrence alternatives. Source selection highlighted both diagrams through MD-1. With scripting disabled, diagrams and original source remained visible. Generated pages needed no Mermaid runtime or remote requests. Errors were visible. Browser history retaining the page retained interaction. The trusted fixture was rendered during generation; this was not an arbitrary SVG upload/sanitization service. The current preview behavior is specified and tested in [WATCH-1](../watch-cli/spec.md) and [DOC-1](../document-selection/spec.md).

Current checks: [saved SVG activation](../../../mermaid-trace-ts/test/svg-activation.test.ts) covers ACT-AC1–4, grouping, visibility and disposal; [live preview tests](../../../mermaid-trace-ts/test/watch-cli.test.ts) cover the current Markdown route. The historical ACT-AC5 demo test was retired with its generator. Other browser engines and screen readers have not been accepted.

Run `make preview ARGS='watch docs/examples/interactive.md --source'` from the repository root to exercise activation in the native preview. No arbitrary file uploads or live source edits. For external artifacts, sanitize before DOM insertion, preserve the inert mapping attributes, then activate. Dispose before replacement and activate the new element.

## LOC-1 — copyable selection location (implemented)

As a reader, I want clicking a diagram element to copy a readable filename and selection range into the clipboard. Scope: display locations in both selection directions and for occurrence alternatives; no editor-specific URL scheme.

- **LOC-AC1:** Display `filename.md:startLine:startColumn-endLine:endColumn`, using one-based lines/UTF-16 columns and an exclusive end. Carets display `filename.md:line:column`. Use the actual original-document selection envelope; retain exact segment details for nested Markdown. LF, CRLF, CR, Unicode and end-of-input offsets are supported; invalid ranges reject.
- **LOC-AC2:** Diagram selection (click, keyboard or occurrence choice) automatically copies exactly the displayed location through the native clipboard API and reports success. There is no copy button. Source-view selection updates the displayed location without writing the clipboard. Clipboard failure/unavailability is explicit, and the readonly location field remains manually selectable. Changing selection clears old copy feedback.

## EDGE-1 — connector hit targets and selection precision (implemented)

As a reader, I want unlabeled connectors to be easy to click and the highlighted visual to match the selected source.

- **EDGE-AC1:** Activation provides a 12 CSS-pixel invisible stroke target following each connector (including curves), without widening the visible line or obscuring labels. Pointer clicks within that target and keyboard activation select the full mapped connector syntax (`-->` or `-->|review|`), not just a label. Targets have no duplicate IDs, metadata or keyboard stops; disposal removes them.
- **EDGE-AC2:** Selecting a distinct label subrange highlights the label, without highlighting its parent node/connector. Equal-span visuals form one logical selection under C2-OWN. Selecting connector syntax highlights the connector and its label if present. Apply the same rule to source-view selections; preserve matching piece projections and repeated-node associations.

## INPUT-1 — focus is diagram selection (implemented)

As a reader, I want keyboard focus and mapped diagram selection to identify the same element. Focusing a mapped visual (including Tab/Shift+Tab) updates the highlight, source range and displayed location. Clicks on wide connector targets focus the mapped selection representative; equivalent visual parts share that keyboard stop. Diagram selection keeps focus in the diagram; it must not focus the source textarea. Selection callbacks identify `trigger: 'focus' | 'activation'`; focus navigation does not write the clipboard, while clicks, Enter/Space and occurrence choices still copy. Native text selection starting inside an activated SVG is suppressed; the source textarea and location field retain normal selection. Disposal removes the added listeners.

ACT-AC2 / STATE-NOTE-CONNECTOR: when a note body and its connector share the complete statement range, reverse selection wholly inside the visible note label uses that label's authored subrange for containment. It highlights only the label; selecting the whole statement relates both note and connector. The regression uses saved native state SVG, retaining all prior family/activation gates.

ACT-AC1/2 / FLOW-2 visibility: activation gives keyboard and widened pointer targets only to painted connectors, using the mounted browser's computed paint styles. Hidden/layout-only connector metadata and programmatic source selection survive; independently visible labels remain controls. Dispose restores original attributes/markup. Hosts reattach after changing artifact/style inputs.

ACT-AC1 / FLOW-2 pointer retargeting (implemented): a real connector press may start on the widened hit stroke and release on the authored path after focus highlighting changes its painted width. The browser sends the click to their common ancestor. Preserve the mapped press target for that real click, so activation and clipboard select the connector rather than the diagram background. Do not change keyboard/programmatic click handling or source identity.

ACT-AC1/2 / OWN-AC3 (implemented): group embedded visual selection spans per SVG, without comparing display text or collapsing AST identities. Any group member activates its representative and emits the union of native bindings; exact-span node/label and note/connector parts highlight together. Distinct label subranges retain label-only selection. One representative is tabbable; pointer and programmatic focus redirect equivalent parts to it. Hosts use the group highlight as its focus indication, avoiding a second rectangle around one constituent. Preserve background selection, automatic clipboard activation, instance isolation, saved/static artifacts and exact attribute restoration on disposal.

### ACT-STYLE — coherent focus for independent activation (implemented)

As an embedding host, I want activating a saved SVG to provide a visible group selection without requiring viewer CSS. Selected parts share the existing teal highlight; keyboard focus uses that highlight instead of a separate browser rectangle. Whole-diagram focus uses the diagram outline. Style effects stay inside that SVG instance, preserve independent labels and disappear on disposal, restoring the original markup. Invalid metadata still fails before any DOM changes. Hosts may override appearance with their own styles.

### ACT-VISIBILITY-TRANSITIONS (implemented)

As a host showing a saved diagram, I want selection targets to track current paint visibility when styles change after activation. A zero-font text label or hidden/unpainted connector starts with no keyboard stop, pointer target or highlight; revealing it makes its existing source-backed visual selectable, and hiding it again removes that target and highlight. Its source evidence remains available throughout. This applies through the shared activator to every mapped family and to live Markdown; equivalent-span parts still share one focus stop. Disposal restores original SVG attributes and stops observing host presentation changes.
