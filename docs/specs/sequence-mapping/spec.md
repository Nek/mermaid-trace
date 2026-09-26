# Native sequence mapping and browser rendering

Decision, 2026-09-26: focus production on Merman. Remove the legacy Mermaid producer from the preview; preserve upstream snapshots only as reference tests. Do not wait for legacy feature parity before implementing native sequence selection.

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

Native exact-span, saved-artifact, real browser selection/clipboard and preview regression checks: pending. Browser WASM runtime acceptance: future, not run. All-family mapping remains the release gate; SEQ-1 is its next implementation slice.
