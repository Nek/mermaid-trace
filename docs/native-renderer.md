# Native renderer

`mermaid-trace-rs/` contains the Rust library and a JSON-lines executable. The Node watch host keeps one process alive across saves. The browser receives static SVG and the independent activation library; it runs no renderer today.

Use Rust 1.95+ (tested with 1.98.0), Git, Node 24 and pnpm 11.28.0:

```sh
corepack pnpm native:build
corepack pnpm native:test
corepack pnpm preview watch docs/examples/watch-preview.md
```

The bootstrap script clones [Merman](https://github.com/Latias94/merman) into ignored `mermaid-trace-rs/vendor/merman/`, pins revision `72c024776a4bf2dfb9a769b67910736229355906`, and applies the checked-in sequence provenance patch. It recognizes an already applied patch and refuses an incompatible existing checkout. Cargo dependencies are locked. It never resets or deletes a checkout. Merman retains its MIT/Apache-2.0 attribution; the patch is local experimental integration, not an accepted upstream contribution.

The patch extends Merman's existing LALRPOP grammar, semantic construction and SVG emitter. The regenerated parser is included, so normal builds do not need the upstream generator or another parser dependency. When revising the grammar, use Merman's `cargo run -p xtask -- gen-lalrpop-parsers`; the initial change used the same pinned LALRPOP 0.23.1 generator in an isolated tool after the workspace-wide generator's dependency fetch stalled.

`render(id, source)` returns annotated SVG, the exact source, a source-map projection and semantic identities. Inputs are limited to 50,000 UTF-16 units; IDs use lowercase letters, digits and hyphens and begin with a letter. Invalid input yields an error and does not poison subsequent requests. SVG uses Merman's `resvg-safe` pipeline.

Sequence mapping uses experimental `mermaid-trace/1`. Native `data-mt-key` identities bind source pieces; `data-mt-refs`, `data-mt-role`, `data-mt-start` and `data-mt-end` carry selection ranges. Root `data-mt-map` retains source and the projection. Merman's inert metadata also records original byte spans for native inspection. A label selects its label range; a connector selects the whole message statement. Coordinates in the portable map are zero-based UTF-16 with exclusive ends. Markdown adapters translate them to the original file, including nested fence prefixes.

The [sequence spec](specs/sequence-mapping/spec.md) records verified constructs and remaining conformance work. Other families currently have whole-diagram selection only. No all-family support or browser WASM runtime is claimed. [BROWSER-1](specs/sequence-mapping/spec.md#browser-1-future-dynamic-rust-browser-renderer) will expose the same pure Rust rendering path through WASM, optionally in a Worker.
