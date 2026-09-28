# Merman backend migration

## MERMAN-FORK: pinned fork delivery (implemented)

Replace the accumulated patch with the same native source committed in `Nek/merman`, retaining its history and the existing `vendor/merman` path. Pin a full commit SHA; do not upgrade renderer code or alter diagram acceptance. A fresh bootstrap must fetch that exact commit, repeat safely, and reject an existing dirty or differently pinned checkout without modifying it. Existing development symlinks remain usable when clean and pinned. Preserve licenses and keep the upstream remote separate from the fork used for pushes.

Plan: publish the already verified native branch, add an offline bootstrap regression for pinning and checkout preservation, then replace patch application with checkout validation. Verify the fork tree equals the patched baseline, exercise a fresh network bootstrap/build, run existing native and saved/live integration checks, update current setup guidance, and remove the patch only after the fork is available. Historical audit references retain their original revisions.

Verification: the bootstrap regression failed when a fresh checkout still required the absent patch; it now passes exact non-tip pinning, repeat runs, branch preservation, and refusal of dirty/untracked/differently pinned checkouts. A fresh network clone of `333b4c32dc2220a3356e6a4b93f8bd1160a525f5` matches the previous native source tree and passes the build and all 113 native tests. Seventeen bootstrap/producer/saved-live/CLI checks and TypeScript typechecking pass. This changes dependency delivery only, not diagram scope or behavior.

Decision, 2026-09-26: use Merman as the new producer backend on `feat/merman-backend` in this repository. TypeScript remains the host and activation language; Merman supplies the Rust rendering core through its native Node binding. Use `mermaid-trace-ts/` and `mermaid-trace-rs/` as independent language package directories; shared docs remain at the root. Keep one repository because artifact, Markdown, viewer and CLI contracts remain shared. A future upstream Merman provenance patch belongs in a separate upstream checkout, not a second Trace product.

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

1. Move shared source-map types into `mermaid-trace-ts/src/source-mapping.ts` and isolate the existing Chromium producer in `mermaid-trace-ts/src/producer/mermaid-browser.ts`. Preserve behavior and raw reference snapshots.
2. TDD a small native Merman adapter: exact source + semantic JSON + static SVG + explicit unavailable mapping. Reuse its engine and native deterministic IDs; constrain source to the existing artifact ceiling. No custom Mermaid parser.
3. Route non-flowchart preview production through Merman. Keep legacy flowchart mapping explicit; inject only whole-source metadata when occurrence provenance is unavailable. Reuse existing activation and Markdown adapters.
4. Verify real Node rendering, instance IDs, repeated inputs, syntax failures, resource/lifecycle handling and existing browser/CLI tests. Record results and commit coherent changes immediately.

## Next required story: native provenance

Export parser-derived source occurrences together with semantic/render identities from Merman. Preserve them through layout/SVG emission; use UTF-8-to-UTF-16 conversion at the Trace boundary. Start with sequence participants, messages/connectors, labels, notes, activations and nested controls, including repeated text, comments, Unicode and CRLF. Generalize visual bindings from actual native renderer identities; never use text search or ordinal guessing to join separately produced results. The current format-0 node/edge selectors are not universal.

Switch mapped flowcharts only after the native producer passes their existing selection contracts. Then complete every required family, including Mermaid 12 entries absent from the pinned Merman catalog. Static rendering success must never be recorded as mapped support.

## Verification

| Contract | Check | Status |
|---|---|---|
| MERMAN-AC1/2 | Native Node test: exact CRLF/Unicode source and repeated-message semantics, fresh instance IDs, interleaved repeatability, bounds, syntax/unsupported errors, recovery and disposal | Passed on macOS arm64 / Node 24 |
| MERMAN-AC3 | Native sequence SVG equality + retained mapped flowchart test; real Markdown/standalone preview, clipboard, saves, recovery and CLI shutdown | Passed |
| MERMAN-AC4 | Full suite including unchanged upstream references, renderer-free activation and moved workspace | Passed: 20/20 |

Sources: [native Node package](https://github.com/Latias94/merman/tree/main/platforms/node), [Merman coverage](https://github.com/Latias94/merman/blob/main/docs/alignment/STATUS.md). Package contents and public runtime operations were inspected locally; source-map export is not currently available through the selected binding.

TDD: the native producer test failed with `Merman producer not implemented` before implementation and passes against the real native addon. No DOM or browser is loaded. TypeScript build passes; source-span export remains unavailable. The preceding mapping/legacy-producer refactor passed all 18 existing checks with unchanged raw baselines. Sandbox browser startup/file-watcher failures required running the existing integration suite outside the sandbox.

Workspace restructuring: the root scripts delegate to `mermaid-trace-ts/`, while the preview command keeps root-relative input paths. The pnpm lock remains shared. `mermaid-trace-rs/` reserves the native package boundary without inventing an unused Cargo crate. Root `pnpm test` passed all 19 tests after the move; raw upstream SVGs remain unchanged. Frozen workspace install and TypeScript build passed.

MERMAN-1 implementation: `mermaid-trace-ts/src/producer/merman.ts` is the reusable native producer; `producer/preview.ts` explicitly routes flowcharts to the isolated legacy producer and other types to Merman. The latter adds inert whole-source metadata only. The native preview test failed with `Native preview producer not implemented` before implementation. Current checks pass without updating any upstream SVG/environment baseline. Exact native visual provenance remains the next story and S6/C8 is still incomplete.

## Superseding decision

2026-09-26: the user removed the legacy production compatibility requirement. [SEQ-1](../sequence-mapping/spec.md) supersedes the transitional routing in MERMAN-AC3. Legacy snapshots remain reference evidence. Future browser rendering through Rust/WASM is required by [BROWSER-1](../sequence-mapping/spec.md#browser-1-future-dynamic-rust-browser-renderer).

2026-09-26 layout correction: [LAYOUT-1](../toolchain/spec.md#layout-1-separate-language-tooling) removes the root pnpm workspace. All JS manifests, the lockfile and dependencies belong to `mermaid-trace-ts/`; root Make targets coordinate Rust and TS. Earlier workspace verification above is historical.
