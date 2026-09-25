# Agent Guidance

## Project Context

- Read [DESIGN.md](docs/DESIGN.md) before project design or implementation work. It records Mermaid Trace's design decisions and constraints.
- Keep feature specs consistent with those decisions; update `docs/DESIGN.md` when an agreed change alters the design direction.
- Library shortlists are candidates, not installed or mandatory dependencies. Follow the preferences and constraints in `docs/DESIGN.md`.
- Discover commands from the current README, CI, task runners, manifests, or Makefiles. Do not invent project commands or claim unavailable checks ran.

All project Markdown except root `README.md` and `AGENTS.md` belongs under `docs/`, including feature specs.

## TDD and commits

- Always use TDD for behavioral changes: write a test for the required project behavior, run it and confirm it fails for the expected reason, implement the smallest change that passes, then refactor with tests green. Fixes start with a failing regression test. Do not substitute tests of the compiler or dependencies for tests of project behavior.
- Documentation-only changes need appropriate review/link checks, not artificial behavior tests.
- Always use atomic commits: each commit contains one coherent change, including its relevant tests and documentation. Verify it before committing, keep unrelated changes separate, and never bundle unrelated user work into a commit.
- Commit each completed, verified atomic change as soon as it is ready; do not wait for the user to ask. Before ending a task, inspect Git status and commit all completed changes belonging to the task. Report any remaining uncommitted work and why it remains. Do not commit knowingly failing or unfinished work just to make the tree clean.
- Use Conventional Commits and Semantic Versioning as defined in [Commit and release conventions](docs/SDD-DELIVERY.md#commit-and-release-conventions). Local commits do not authorize pushing, publishing, or creating a release.

## SDD Routing

This project uses Spec-Driven Development. The files below are instructions to read when their conditions apply, not merely background references. Paths are relative to this file.

| Task or phase | Read |
| --- | --- |
| Specify, plan, implement, test, or review project behavior | [SDD.md](docs/SDD.md) and the relevant existing feature artifacts |
| Create or revise a spec, clarify requirements, select a story, define contracts, or plan implementation | Also [SDD-PLANNING.md](docs/SDD-PLANNING.md) |
| Write tests, implement or fix behavior, verify work, or review an implementation | Also [SDD-DELIVERY.md](docs/SDD-DELIVERY.md) |
| Answer a general question or make an editorial/documentation-only change | Read only the relevant documents; no feature-spec scaffolding is required |

Apply every matching route. Load a phase document before entering that phase, including when the task changes mid-turn. Implementation requires a ready story and plan: if these are absent, ambiguous, or need revision, read the planning guidance first. A review reports gaps without automatically implementing fixes.
