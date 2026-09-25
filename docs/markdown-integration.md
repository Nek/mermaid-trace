# Markdown integration: first-class delivery

Research date: 2026-09-25. This is an integration design and source review, not a claim that adapters already work. Markdown embedding is an initial product requirement: the first end-to-end acceptance page must come from a real Markdown renderer, not handwritten HTML alone.

## Shared flow

`Markdown parser → Mermaid block + document mapping → static SVG producer → inline SVG in HTML → optional activation library → host source selection`

Each renderer adapter finds fenced `mermaid` blocks, retains original document identity/revision and block coordinates, supplies logical Mermaid text to the producer, and inserts the resulting static SVG. Host-owned JavaScript activates all diagrams after insertion. Renderer-specific AST/token types stay in adapters. Renderer and activation are independently consumable; pre-rendered HTML can ship only the activation library.

A second route supports an existing saved annotated SVG embedded inline in HTML. The host supplies any document mapping absent from the artifact. An ordinary image reference to an SVG remains a useful static fallback but does not expose its descendants to the containing page's activation library.

## Renderer assessment

| Renderer / host | Integration mechanism | Assessment and initial priority |
|---|---|---|
| **markdown-it** | Fence renderer rule delegates non-Mermaid blocks to the original rule; adapter preserves tokens and per-render environment. | First reference adapter: small hook surface and reuse in VS Code. Rendering rules return strings, so asynchronous Mermaid rendering needs an explicit preparation stage/cache or host-managed asynchronous replacement; never return a Promise from a synchronous fence rule. |
| **unified / remark / rehype** | Capture source context on mdast code nodes; pass provenance to hast; replace Mermaid code elements with safe inline SVG using an asynchronous transformer. | Second reference adapter before initial integration release. Fits the project's data-transformation approach and static-site/MDX pipelines. Preserve positions before converting/replacing nodes. |
| **Marked** | Renderer override plus token walking; asynchronous work through its documented async pipeline. | Viable additional adapter, not first. Position support needs explicit validation, including normalized line endings and nesting; do not derive offsets by searching for repeated block text. |
| **VS Code Markdown preview** | `markdown.markdownItPlugins` / `extendMarkdownIt` for markup; `markdown.previewScripts` for activation. | Investigate alongside the first adapter. Preview scripts reload when content changes, so activation must tolerate replacement. Exact source-selection transport back to the editor needs a verified public mechanism; do not assume custom-webview messaging APIs apply to the built-in preview. |

Sources: [markdown-it renderer architecture](https://markdown-it.github.io/markdown-it/documents/Architecture.html), [remark-rehype](https://github.com/remarkjs/remark-rehype), [Marked extensions](https://marked.js.org/using_pro), [VS Code Markdown extension API](https://code.visualstudio.com/api/extension-guides/markdown-extension).

## Source mapping is more than a starting line

Markdown containers and normalization can change the text given to Mermaid. A fence inside a blockquote/list can lose prefixes and indentation; CRLF may become LF. In markdown-it 14.1.0 source, fence tokens retain a line range but their content is extracted with indentation removal, and the normalization rule replaces line endings. These observations must be revalidated for the adapter version selected at implementation. [Fence implementation](https://github.com/markdown-it/markdown-it/blob/14.1.0/lib/rules_block/fence.mjs), [normalization](https://github.com/markdown-it/markdown-it/blob/14.1.0/lib/rules_core/normalize.mjs).

Therefore adapters must retain a mapping from logical Mermaid offsets to the original Markdown's offsets/ranges. A simple content-start line is an optimization for unchanged top-level content, not the general contract. A logical multiline span may correspond to several document segments separated by stripped container prefixes. Define both precise segments and a primary editor range; never silently claim stripped prefixes are Mermaid text. Source payload in SVG is the exact text supplied to the Mermaid producer; original Markdown text and extraction provenance remain host-owned.

The unified tree model supports source positions, but positions can be absent on generated nodes. Positions on an entire code block do not alone describe each extracted content character. Marked lists a token-position extension; its existence is not evidence of correctness for all plugin combinations. [unist](https://github.com/syntax-tree/unist), [Marked extensions list](https://github.com/markedjs/marked/blob/master/docs/USING_ADVANCED.md).

## Existing Mermaid plugins and safe insertion

[rehype-mermaid](https://github.com/remcohaszing/rehype-mermaid) already supports inline SVG and image strategies, and uses Playwright outside browsers. It is relevant precedent and a backend candidate, but its documentation does not establish our exact source↔AST↔visual mapping. Inspect reuse before replacing it; do not stack two Mermaid renderers on the same code block.

For interactive embedding, select inline SVG rather than an image/data URL. Keep source metadata inert and define a narrow sanitizer schema covering required SVG elements, attributes, and metadata. Verify mappings after sanitization. Do not enable arbitrary raw HTML merely to preserve diagrams. `rehype-sanitize` drops content outside its schema, so default preservation cannot be assumed. [Sanitizer documentation](https://github.com/rehypejs/rehype-sanitize).

For synchronous hosts, pre-rendered SVG lookup is the preferred path to static HTML; a separate producer integration may asynchronously render at preview time when needed. The activation library always consumes completed SVG and does not acquire a rendering dependency. Cache keys must include exact logical source and rendering configuration; insertion-specific SVG IDs must avoid collisions, with internal references updated consistently.

## Initial integration acceptance

- Both reference adapters preserve non-Mermaid fences, surrounding Markdown, and multiple identical diagrams.
- Plain, indented, blockquoted, and list-contained fences map accurately or explicitly report unsupported mapping; CRLF, tabs, and Unicode are covered.
- Disabling activation leaves complete static diagrams. Enabling it selects logical source and resolves original document ranges.
- Sanitization, document replacement, cache reuse, duplicate SVG IDs, malformed metadata, and stale source revisions are tested.
- The first browser demonstration uses markdown-it; unified/rehype is required before the initial integration milestone closes.
- VS Code preview insertion and activation are investigated early. Native editor-range selection is a separate verified adapter capability; a custom webview remains a fallback if the built-in preview lacks a suitable public bridge.

Hosted services that do not permit custom plugins/scripts are not automatic deployment targets. Compatibility claims name the renderer, adapter version, sanitization setup, and supported syntax.
