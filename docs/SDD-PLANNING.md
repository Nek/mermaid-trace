# SDD: Specification and Planning

Read [SDD.md](SDD.md) first. Use these templates as concise sections, not a requirement to create a file for every step.

## Feature Spec

Include:

```text
Feature:
Problem:
Users / actors:
Goals:
Non-goals:
User stories:
Acceptance criteria:
Constraints:
Open questions:
```

Describe stories as: `As a <user>, I want <capability>, so that <benefit>.`

Acceptance criteria must be observable and testable: `Given <state>, when <action>, then <result>.` Include negative and edge cases. Describe what and why; leave implementation choices to the plan.

## Clarification

Before planning, check for ambiguity, missing edge cases, conflicting requirements, untestable criteria, and hidden security, privacy, performance, compatibility, or operational constraints.

Record important decisions:

```text
Question:
Options:
Recommendation:
Decision:
Rationale:
```

A story is ready only when its acceptance criteria are testable and blocking questions are resolved. Keep nonblocking assumptions explicit.

## Story Slice

Before coding, select one story and freeze its scope:

```text
Story ID:
In scope:
Out of scope:
Dependencies:
Definition of done:
```

Split stories too large to implement and verify cleanly.

## Contracts

For critical behavior, define testable contracts before implementation:

```text
Contract ID / name:
Applies to:
Preconditions:
Postconditions:
Invariants:
Failure behavior:
Observability:
Tests:
```

Cover relevant correctness rules, state transitions, idempotency, authorization, data integrity, error handling, and important edge cases. Omit inapplicable concerns rather than inventing requirements.

## Per-Story Plan

Limit the plan to the selected story and link technical decisions to acceptance criteria or contracts:

```text
Story ID / scope:
Design approach:
Components changed:
Data / state changes:
Interfaces changed:
Risks:
Tests:
Verification:
Rollout / rollback (where relevant):
```

Inspect existing structure, conventions, tests, commands, and entry points before choosing the approach. Reuse existing solutions. Before testing or implementation, load [SDD-DELIVERY.md](SDD-DELIVERY.md).
