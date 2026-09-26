# Mermaid Trace: TypeScript design direction

Decision: use TypeScript for the JavaScript ecosystem implementation, applying Clojure's data-oriented and functional ideas wherever they improve clarity. The separately requested Rust implementation remains in scope. Library review: 2026-09-25.

## Component boundaries

The [feature spec](specs/source-mapping/spec.md) is the source of truth for behavior; [contracts](specs/source-mapping/contracts.md) define the artifact and host boundaries.

Use four logical components in one project: a DOM-free mapping core; a Mermaid-to-static-SVG producer; an independently consumable SVG activation library; and a thin viewer composing activation with a source view. Separate package publication is not required initially.

The producer embeds inert source locations and AST references/projections. Generated SVG displays independently, with no embedded scripts or runtime requirement. The activation library accepts an existing inline SVG and never requires Mermaid parsing/rendering merely to activate it. Saving and loading an artifact must not require the producer to remain present. A serialized AST projection is not the full parser AST.

Prefer source metadata inside SVG for standalone portability; retain an optional encoded preceding comment for HTML-fragment compatibility. Exact format and coordinates remain proposed until M1. The same artifact contract will let the TypeScript activation library consume Rust-produced SVG.

Markdown integration is an early architectural constraint. Thin renderer adapters own fence extraction and original-document provenance; core spans refer to the exact logical Mermaid input. A start-line offset cannot represent all nested/normalized Markdown. Begin with markdown-it and verify VS Code preview hooks during feasibility; add unified/rehype before the integration milestone closes. The [document-selection producer](specs/document-selection/spec.md) now uses mdast/hast for CommonMark block and inline positions while reusing the markdown-it fence-origin adapter. A document-wide range coordinates Markdown and diagram selection; the SVG artifact stays independent. See [integration research](markdown-integration.md).

## Working principles

- Represent syntax, semantic identities, source spans, and visual mappings as explicit data. Prefer plain records and discriminated unions to class hierarchies.
- Write small, named, composable transformation functions. Keep parsing/mapping logic separate from DOM operations, file access, and host-editor callbacks.
- Treat inputs and published results as immutable values. Use readonly fields and readonly collections consistently through nested types. TypeScript readonly is a compile-time restriction, not runtime freezing or Clojure-style persistent storage.
- Local mutation of newly allocated builders is fine when it makes a traversal simpler or avoids repeated copying. Never mutate caller-owned input or previously published results.
- Distinguish identity from state: retain explicit node identifiers and model relationships through identifiers. Keep source occurrences separate from the semantic entity they reference; preserve provenance through transformations.
- Make reference equality, structural equality, and semantic identity explicit where used. Native JS objects and Maps do not acquire Clojure value equality from readonly annotations.
- Use exhaustive handling of node variants. Represent expected parse/mapping failures as explicit diagnostic data; validate external inputs at boundaries.
- Use native map/filter/flatMap/reduce, loops, and generators when clear. Prefer a named intermediate value over clever point-free composition. Use libraries for capabilities they supply, not to imitate Clojure syntax mechanically.
- Test transformation invariants: inputs remain unchanged, spans select the original text, all supported node variants are handled, and reverse mappings preserve multiple occurrences.

## Preferred ecosystem: thi.ng

Prefer individual thi.ng packages for functional utilities before adding overlapping libraries or implementing equivalents. Its ecosystem covers substantially more than transducers. Native TypeScript operations remain appropriate for simple work. These are researched candidates, not installed dependencies; local compatibility, bundle size, and performance remain unverified. The project's canonical repository is now [Codeberg](https://codeberg.org/thi.ng/umbrella); GitHub is a read-only mirror.

| Library | Relevant capability | Decision |
|---|---|---|
| [@thi.ng/transducers](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/transducers) + [compose](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/compose) | Clojure-inspired transformation pipelines, reducers, iterables, and function composition. | First choice for reusable transformation and indexing pipelines. |
| [@thi.ng/paths](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/paths) | Typed nested access and immutable updates with structural sharing. | First choice for get-in/update-in style operations. Documented type inference covers the first eight path levels; deeper paths lose precision. |
| [@thi.ng/zipper](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/zipper) | Immutable tree editing and navigation. | Investigate against our concrete AST before writing a generic traversal/editing layer. |
| [@thi.ng/defmulti](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/defmulti) | Dynamic multiple dispatch. | Candidate for extensible diagram/node-specific handlers. Does not by itself replace exhaustive checking of a closed TypeScript union. |
| [@thi.ng/equiv](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/equiv) + [associative](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/associative) | Deep value equivalence and Map/Set-compatible collections with customizable equality. | Use where value semantics are needed; do not assume all supplied collections are persistent or immutable. |
| [@thi.ng/atom](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/atom) | State wrappers for nested immutable values, with optional history and transactions. | Candidate for viewer state; history remains outside the initial requirements. |
| [@thi.ng/hiccup](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/hiccup) + [hiccup-svg](https://codeberg.org/thi.ng/umbrella/src/branch/develop/packages/hiccup-svg) | HTML/SVG serialization from data and SVG element helpers. | Candidate for generated SVG or viewer markup. Serialization does not supply Mermaid parsing or diagram layout. |

Previously reviewed alternatives remain available only for a demonstrated gap: [Remeda](https://remedajs.com/docs/) and [Ramda](https://ramdajs.com/) for collection utilities; [optics-ts](https://akheron.github.io/optics-ts/tutorial/) for richer optics; [ts-pattern](https://github.com/gvergnaud/ts-pattern) for exhaustive structural matching; [Immutable.js](https://immutable-js.com/) for persistent collections; [Immer](https://immerjs.github.io/immer/pitfalls/) for draft-based tree updates. Avoid installing overlapping suites by default.

Path copying is not a persistent trie, multimethod dispatch is not exhaustive pattern matching, and SVG serialization is not a Mermaid renderer. Preserve those distinctions when evaluating fit. External data must not control unsafe property paths; emitted source and attributes must be escaped appropriately. No verified thi.ng package currently settles our Mermaid parsing, layout, and exact source-span preservation requirements.

## Initial implementation approach

Start with strict TypeScript, ES modules, plain immutable-by-convention data, and pure mapping functions. The initial tooling targets ES2022 under Node 24 LTS. Public browser compatibility remains a product decision; see [toolchain setup](specs/toolchain/spec.md).

Evaluate shortlisted utilities against the first real diagram mapping flow. Add the smallest useful set when implementing that flow, and verify type inference, emitted bundle, and actual behavior. No framework, persistent collection library, optics layer, or transducer abstraction is mandatory just to call the code functional.

Expose ordinary JavaScript functions/data and TypeScript declarations. Preserve the common source-mapping contract for Rust without requiring identical internal data structures.

The [reference SVG harness](specs/svg-baselines/spec.md) pins upstream Mermaid and checks raw SVG equality before mapping work. Rendering snapshots remain independent of future metadata assertions. It is test tooling, not the public renderer API.

The [first mapping proof](specs/flowchart-mapping/spec.md) captured source ranges from isolated instances of Mermaid 12's existing Jison parser and FlowDB. That runtime interception has been replaced by the fork's explicit API. A separate SVG metadata module reads saved artifacts without the renderer; its format remains experimental `mermaid-trace/0`.

The [fork story](specs/mermaid-fork/spec.md) supplies explicit grammar provenance and an opt-in render result in a small upstream-oriented Mermaid fork. Mermaid remains the authoring DSL; Trace owns the portable SVG format and optional interaction.
