# Roadmap

Mermaid Trace has a native Merman SVG producer, independent SVG activation, Markdown source provenance, and a live file preview. This is still experimental. The [first usable release](specs/diagram-coverage/spec.md) requires source-to-visual mapping for every built-in Mermaid detector entry; rendering or whole-diagram selection alone does not meet that gate. Small implementation commits do not reduce family scope.

| Milestone | Exit evidence | Status |
| --- | --- | --- |
| M0 — Foundation | Pinned Rust, Node, pnpm and SDD setup | Complete; see [toolchain](specs/toolchain/spec.md) |
| M1 — Feasibility and format | Source-backed mapping proof, deterministic SVG baseline, Markdown provenance and stable artifact contract | Proofs pass; stable format and VS Code selection boundary remain |
| M2 — Static renderer | Every family passes exact source/visual mapping, saved SVG and renderer/configuration conformance | Incomplete; see [coverage gate](specs/diagram-coverage/spec.md) |
| M3 — Optional interaction | Saved SVG click, keyboard, reverse highlighting, validation, isolation and disposal | Experimental activation passes in Chromium; wider browser and stable-format acceptance remain |
| M4 — Embedding and viewer | Markdown adapters, reusable entry points and VS Code webview/editor demonstration | Live preview and mdast/hast document selection work; packaging and VS Code remain |
| M5 — Rust integration | Native artifacts activate through the same JS library; shared conformance fixtures and measured performance | Native slices work; full parity and measurements remain |

## Current implementation focus

The `existing families` goal is blocked pending a concrete scope and completion checklist. Follow the agreed [goal reassessment process](GOAL-REASSESSMENT.md) before resuming; earlier hour estimates have been withdrawn.

The six families with mapped native slices are flowchart, sequence, Gantt, user journey, Kanban and state. [State's pinned inventory](specs/structural-diagrams/spec.md) passes its fixture and interaction gates. [FLOW-2](specs/flowchart-mapping/spec.md#flow-2-complete-flowchart-family-coverage) remains incomplete despite all 1,158 pinned flowchart fixtures rendering and passing mapped/plain SVG parity checks. Finish its syntax, configuration and variant inventory, then complete [sequence](specs/sequence-mapping/spec.md) and [Gantt, journey and Kanban](specs/planning-diagrams/spec.md) inventories. The generic [source-ownership rule](specs/source-ownership/spec.md) applies throughout; existing behavior and acceptance tests remain mandatory during migration.

Class and ER follow this existing-family work. They do not close the wider [all-family release gate](specs/diagram-coverage/spec.md), which includes the other registry entries. The native renderer is the production route. The earlier fork-mapped demo has been retired; the [raw upstream SVG baseline harness](specs/svg-baselines/spec.md) remains independent reference evidence.

Cross-cutting work still includes a stable SVG contract, export/security acceptance, reusable package entry points, unified/rehype and VS Code host integration, and measured Rust performance. See the [feature spec](specs/source-mapping/spec.md) and [contracts](specs/source-mapping/contracts.md) for their acceptance criteria.

## Later

Stable identities across edits, source-rewriting visual editing and collaboration are outside the first release. [BROWSER-1](specs/sequence-mapping/spec.md#browser-1-future-dynamic-rust-browser-renderer) tracks dynamic Rust/WASM rendering in the browser; static SVG and separate activation remain required.
