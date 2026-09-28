# Lean Spec-Driven Development

The spec records intended behavior and open gaps. Explicit user instructions govern scope; record agreed changes rather than treating an old spec as immutable. Use the least documentation that makes the next change reviewable.

## Workflow

```text
Intent -> Acceptance -> Resolve blockers -> Brief plan -> Failing test -> Change -> Verify
```

Use an existing spec when it already states the behavior. Update it when implementation reveals a decision or changes the accepted outcome. Repeat the cycle for the next delivery slice.

## Core Rules

- State the requested outcome and observable acceptance before designing. A small story or commit is a delivery slice, not a reduction of requested feature or diagram-family scope.
- Follow existing code and conventions. Prefer deletion, reuse, standard libraries and native facilities before adding dependencies or abstractions. Keep the plan proportional to the actual design choice.
- Do not silently change scope or weaken acceptance to make code pass. Record a necessary scope change and resolve it with the user before implementing the changed behavior.
- Ask about blocking ambiguity; record a safe assumption for nonblocking details.
- Keep the spec about current behavior, acceptance and open gaps. Git history and tests retain delivery history; do not append a diary of each commit or test run.

## Feature Artifacts

Use existing locations. A new feature normally needs only:

```text
docs/specs/<feature>/spec.md
```

Put decisions, contracts, a short plan and test references in that file when needed. Split out `contracts.md`, `plan.md` or `test-matrix.md` only when their size makes the spec harder to use. Existing separate files remain valid. Give requirements stable identifiers where cross-references help; do not invent IDs for trivial prose.

Use [SDD-PLANNING.md](SDD-PLANNING.md) for specification and planning, and [SDD-DELIVERY.md](SDD-DELIVERY.md) for testing, implementation, and verification. Load them according to the routing in [AGENTS.md](../AGENTS.md).

## Rule of Thumb

Specify observable behavior, test what can regress, and write down only decisions that future work needs.
