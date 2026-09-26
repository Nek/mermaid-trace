# Merman backend migration

Decision, 2026-09-26: use Merman as the new producer backend on `feat/merman-backend` in this repository. TypeScript remains the host and activation language; Merman supplies the Rust rendering core through its native Node binding. Keep one repository because artifact, Markdown, viewer and CLI contracts remain shared. A future upstream Merman provenance patch belongs in a separate upstream checkout, not a second Trace product.

## Scope and contracts

**MERMAN-1:** As a host developer, I want a reusable native producer and isolated renderer-specific code, so the new implementation can advance without discarding working selection.

- **MERMAN-AC1:** A pinned native engine renders flowchart and sequence SVG without browser globals or Chromium. Caller IDs are applied natively and deterministic repeated/interleaved renders agree.
- **MERMAN-AC2:** Results retain exact input and native semantic data. Missing native occurrence/visual provenance is explicitly unavailable; no source matching or guessed spans. Invalid input, unsafe IDs, duplicate batch IDs and oversized input reject. Unsupported families produce a native diagnostic, never silent fallback.
- **MERMAN-AC3:** The watch preview uses Merman for non-flowchart diagrams, reuses one engine across saves and disposes it at shutdown. Existing mapped flowcharts remain on the explicitly documented legacy producer until Merman mapping reaches parity. Minimal UI, original Markdown positions, static display and error recovery remain intact.
- **MERMAN-AC4:** Mapping types and activation have no producer dependency. Official Mermaid SVG snapshots remain an independent compatibility reference; legacy selection tests stay green. The migration must not overwrite upstream expected SVGs with Merman output.

All-family exact selection remains required by [S6/C8](../diagram-coverage/spec.md). This story is migration infrastructure, not completion of diagram mapping. No new DSL, visual editor, general renderer plugin framework or separate repository.

## Native package boundary

Pin `@mermanjs/node@0.8.0-alpha.6` and its matching platform addon in the lockfile. It supports Node >=22 on macOS arm64/x64, Linux x64 glibc/musl and Windows x64 MSVC; this project uses Node 24. Missing or unloadable addons fail explicitly. There is no automatic browser/WASM fallback. Use the public API and the sealed `resvg-safe` SVG pipeline for HTML embedding.

Live package inspection supersedes the earlier cached research: alpha.6 is now published. Its native runtime admits `semantic-json`, `layout-json`, `svg` and `svg-plan-json`. Successful semantic JSON contains identities but no source spans. Editor/analysis facts are outside this package surface. Runtime catalog counts and the supported-diagram list differ; neither is an element-mapping coverage claim. Use actual fixtures and the pinned package's metadata rather than a GitHub-main feature count.

## Selected story plan

1. Move shared source-map types into `src/source-mapping.ts` and isolate the existing Chromium producer in `src/producer/mermaid-browser.ts`; move shared source-map types into a DOM-free module and isolate the existing Chromium producer. Preserve behavior and raw reference snapshots.
2. TDD a small native Merman adapter: exact source + semantic JSON + static SVG + explicit unavailable mapping. Reuse its engine and native deterministic IDs; constrain source to the existing artifact ceiling. No custom Mermaid parser.
3. Route non-flowchart preview production through Merman. Keep legacy flowchart mapping explicit; inject only whole-source metadata when occurrence provenance is unavailable. Reuse existing activation and Markdown adapters.
4. Verify real Node rendering, instance IDs, repeated inputs, syntax failures, resource/lifecycle handling and existing browser/CLI tests. Record results and commit coherent changes immediately.

## Next required story: native provenance

Export parser-derived source occurrences together with semantic/render identities from Merman. Preserve them through layout/SVG emission; use UTF-8-to-UTF-16 conversion at the Trace boundary. Start with sequence participants, messages/connectors, labels, notes, activations and nested controls, including repeated text, comments, Unicode and CRLF. Generalize visual bindings from actual native renderer identities; never use text search or ordinal guessing to join separately produced results. The current format-0 node/edge selectors are not universal.

Switch mapped flowcharts only after the native producer passes their existing selection contracts. Then complete every required family, including Mermaid 12 entries absent from the pinned Merman catalog. Static rendering success must never be recorded as mapped support.

## Verification

| Contract | Check | Status |
|---|---|---|
| MERMAN-AC1/2 | Native Node tests: exact source/semantic data, repeatability, IDs, invalid input and bounds | Planned |
| MERMAN-AC3 | Existing live Markdown/standalone sequence and save/recovery/shutdown browser checks | Planned |
| MERMAN-AC4 | Typecheck, full existing suite, unchanged reference snapshots, renderer-free activation | Planned |

Sources: [native Node package](https://github.com/Latias94/merman/tree/main/platforms/node), [Merman coverage](https://github.com/Latias94/merman/blob/main/docs/alignment/STATUS.md). Package contents and public runtime operations were inspected locally; source-map export is not currently available through the selected binding.
