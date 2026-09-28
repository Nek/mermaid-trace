# Native sequence mapping and browser rendering

Decision, 2026-09-26: focus production on Merman. Remove the legacy Mermaid producer from the preview; preserve upstream snapshots only as reference tests. Implement native sequence selection without removing existing flowchart behavior; producer removal requires parity as defined by [migration principles](../../DESIGN.md#behavior-preserving-migrations).

## SEQ-1: native source-to-visual provenance

As a diagram author, I want to select sequence participants, messages, labels, notes and controls and copy their exact source location.

- **SEQ-AC1:** Native parser occurrences carry exact original ranges and stable per-result semantic/visual identities through rendering. Repeated text, self messages, comments, Unicode and CRLF stay distinguishable. No parallel parser, text matching or ordinal join of separate results.
- **SEQ-AC2:** Saved static SVG contains inert piece/label metadata. Native rendering works without a browser; activation reads saved SVG without Rust or Mermaid. Diagram background selects the full diagram.
- **SEQ-AC3:** Clicking/focusing participants, message connectors/labels, notes, activations and nested control pieces selects their corresponding source; click/Enter/Space copies original Markdown locations. Unlabeled connectors have usable hit targets. Generated decoration is classified rather than assigned fabricated spans.
- **SEQ-AC4:** Preview production has no legacy renderer route. Source revisions, multiple diagrams, file saves and invalid-edit recovery retain existing host behavior. Unsupported native mappings remain explicit.

## BROWSER-1: future dynamic Rust browser renderer

As a browser host, I want to render updated Mermaid text dynamically using the same Rust core compiled to WASM, then activate its annotated SVG. TypeScript is the loader/host, not a second parser. Native and WASM producers share UTF-16 artifact coordinates, identities and conformance fixtures. Worker execution should keep the UI responsive; requests identify a revision so stale results cannot replace newer output. No server is required for rendering after loading the WASM assets. This is a future delivery requirement, not a claim that today's native Node addon works in browsers.

Merman already has WASM/browser bindings: [browser package](https://github.com/Latias94/merman/tree/main/platforms/web). Native addon and WASM are separate build targets. Browser feasibility depends on exporting the new provenance through both transports and testing browser font/layout behavior; visual byte equality across transports is not assumed.

## Selected plan

Inspect and pin a separate Merman source checkout. Reuse its native grammar and parsed events; attach occurrence spans before semantic normalization, retain identities through the sequence DB and SVG emitter, then expose mapped rendering to Trace-owned Rust integration. Start with failing native provenance tests. Generalize the SVG visual binding contract from explicit identities, update browser activation tests, route the CLI through the native producer, and verify the live sequence document. Keep artifacts and Rust source independent of Node to permit WASM later. Build transport wrappers only where needed by the current preview.

## Verification

### SEQ-TITLE (implemented)

Audit S1: displayed sequence titles retain exact statement/payload origins, including both body syntaxes, repeated titles, Unicode/CRLF and frontmatter fallback. The effective title supplies the clickable range; earlier declarations remain queryable without inventing another visual. Empty body titles follow the native renderer's frontmatter fallback. Saved/live source selection, keyboard and clipboard must work with unchanged static SVG.

Plan: capture the existing title action and token spans, reuse shared frontmatter evidence, and bind the native title text. Determine empty-title classification from the parsed database title. Start with native and browser regressions, then check plain/mapped parity and existing sequence acceptance.

Verification: native and browser regressions first failed for missing title bindings. Six original-source title cases, mapped/plain parity, all existing sequence native tests, saved/live title pointer/keyboard/reverse-source/clipboard/isolation, and shared six-family configuration provenance pass. Empty effective body titles retain nonvisual evidence while a visible frontmatter fallback owns its title.

### SEQ-PARTICIPANT-ORIGINS (implemented)

Audits S2–S3: participant labels select the authored `as` payload or effective inline `alias` scalar, including escapes and scalar coercion, with `as` taking precedence. Retain every repeated declaration and genuine implicit declaration; the latest explicit declaration supplies the current visual label. Earlier declarations select the participant without claiming a displayed obsolete label. Notes and message endpoint references keep their existing owners. Cover actor/participant/create forms, identical labels, Unicode/CRLF, mirrored visuals, saved/live source selection, keyboard and clipboard, with static rendering unchanged.

Plan: obtain alias ranges from the existing canonical inline-config parse rather than parsing configuration twice or searching decoded label text. Carry that range back to the located grammar action. Append actor occurrences and mark the effective one instead of replacing earlier provenance. Reuse the current renderer identities and shared activation, starting with failing exact-range and saved/live regressions.

Verification: regressions first failed for an ID range in place of the alias and one declaration in place of two. Eighteen native alias cases cover actor/participant/create forms, Unicode/CRLF, escaped strings, numeric/boolean/null values and `as` precedence; three redeclaration cases preserve explicit and implicit origins. All seven sequence integration tests, 84 native core and 66 native renderer sequence checks pass. Five targeted browser tests pass, including mirrored alias selection, earlier-origin reverse selection, keyboard, clipboard, saved/live activation and instance isolation. Mapped/plain SVG parity is unchanged. The live test waits for a visible selected actor wrapper: the first wrapper can be a vertical lifeline with zero bounding-box width.

### Earlier verification checkpoints

Native exact spans and UTF-16 conversion: 3 Rust integration tests pass, covering repeated labels, self/empty messages, aliases, notes, activations, boxes, rect and nested/branched controls, comments, frontmatter, wrapping prefixes, Unicode and CRLF. The upstream native provenance regression also passes. A fresh checkout reproduces the patched native files byte-for-byte. Saved SVG activation and live Markdown clipboard/watch/recovery checks pass in pinned Chromium; 21 TypeScript tests pass, including unchanged upstream references. Browser WASM runtime acceptance: future, not run. All-family mapping remains the release gate; SEQ-1 is its next implementation slice.

## Implementation contracts and remaining coverage

The Merman fork is pinned to an exact native commit; see [native setup](../../native-renderer.md). Native grammar locations become parser-owned occurrences keyed by actor/message/box identities. The existing preprocessing edit map preserves original byte coordinates; Trace converts them to zero-based UTF-16 half-open ranges. No text matching between SVG and source is used. Renderer-owned identity wrappers bind main pieces and labels, including mirrored participant visuals. `mermaid-trace/1` extends the experimental artifact to node, edge, note, activation and control kinds; the reader still accepts historical format 0 artifacts.

One persistent native Rust process exchanges JSON lines with the Node host, reusing the renderer. The Rust library has no Node/DOM/process dependency. Flowcharts also retain native node/reference, connector and label mapping under [MAP-NATIVE-1](../flowchart-mapping/spec.md#map-native-1-restore-flowchart-behavior-in-rust). Remaining native families report missing element maps; production never falls back to Chromium. Generated sequence number/marker decorations have no invented source pieces.

Complete sequence conformance is still a release gate: lifecycle/menu variants, the full syntax/configuration crosswalk, math labels and wider browser behavior remain open in the [existing-family audit](../diagram-coverage/existing-families-audit.md). The title, configuration-alias and repeated-declaration defects have dedicated regressions above; those fixes do not establish full sequence coverage. These limitations do not weaken the all-family release requirement. Manual in-app browser verification: clicking `Submit draft` copies `watch-preview.md:21:22-21:34`; Tab then Enter on its connector copies `watch-preview.md:21:3-21:34`. The live preview at port 5174 now runs the native Rust process. Dynamic browser/WASM delivery remains future work.

OWN-SEQ delivery: note attachment tokens no longer declare or label sequence participants. Real later declarations/messages supply participant origins; note-only anchors have explicit generated classifications. The note keeps its actual target list and placement as relationship data. Four attachment forms and four declaration/message orderings preserve original CRLF/Unicode spans and mapped/plain static SVG bytes. Twelve saved/live cases verify reverse selection, separate note-label selection, keyboard, clipboard, isolation and disposal. Native core regression and existing sequence provenance checks pass. Full sequence conformance and the remaining ownership audit remain open under [OWN-1](../source-ownership/spec.md). Native commit: `c4614faa`.

Final OWN-SEQ gate: `make test typecheck` passes 53 Rust and 54 TypeScript/browser tests; 1,553 native core tests and public sequence provenance pass. Clean pinned-patch reproduction verifies all 106 changed native files.

Native regression maintenance: the nested-opt wrapping check now locates its control group by DOM attributes instead of an exact opening tag. Provenance attributes no longer make the existing check fail; all three exact wrapped lines remain mandatory. Native sequence SVG suite: 48 pass, one existing ignored test. This repairs the check, not sequence coverage scope.
