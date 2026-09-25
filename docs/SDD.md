# Lightweight Spec-Driven Development

The spec is the source of truth for intended behavior. Code, tests, plans, and tasks must trace back to it. Explicit user instructions govern scope; record agreed changes in the spec rather than treating an old spec as immutable.

## Workflow

```text
Intent -> Spec -> Clarify -> One Story -> Contracts -> Plan -> Tests -> Implement -> Verify -> Update Spec
```

Do not jump from vague intent directly to code. Repeat the cycle for the next story.

## Core Rules

- Describe what users need and why before deciding how to implement it.
- Implement one user story at a time by default; keep changes small and tied to acceptance criteria or contracts.
- Follow existing project conventions. Prefer the smallest design that works; new dependencies, frameworks, services, or broad rewrites need a concrete rationale.
- Do not silently add behavior outside the selected story. If correctness requires a scope change, record it in the spec and plan.
- Mark ambiguity as `[NEEDS CLARIFICATION: <question>]`. Ask when blocked; otherwise record the smallest safe assumption.
- Update the spec with discoveries and agreed behavior changes. Do not weaken criteria merely to make failing code appear correct.
- Keep artifacts short and proportional to the work. Reuse existing material and avoid duplicated information or empty scaffolding.

## Feature Artifacts

Use existing locations when available. Otherwise prefer:

```text
docs/specs/<feature>/spec.md
docs/specs/<feature>/contracts.md
docs/specs/<feature>/plan.md
docs/specs/<feature>/test-matrix.md
```

For a small story, contracts, decisions, the plan, and the test matrix may be sections in `spec.md`; split them only when useful. Give stories, criteria, and contracts stable identifiers so plans and tests can reference them. Keep important clarification decisions with the affected spec.

Use [SDD-PLANNING.md](SDD-PLANNING.md) for specification and planning, and [SDD-DELIVERY.md](SDD-DELIVERY.md) for testing, implementation, and verification. Load them according to the routing in [AGENTS.md](../AGENTS.md).

## Rule of Thumb

If it matters, put it in the spec. If it can break, make it a contract. If it is a contract, test it. If implementation teaches something, update the spec.
