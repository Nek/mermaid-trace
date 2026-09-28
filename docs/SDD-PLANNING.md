# SDD: Specification and Planning

Read [SDD.md](SDD.md) first. Reuse the relevant spec; add only what the selected work needs.

## Feature Spec

State the problem, requested outcome, observable acceptance, relevant constraints and open questions. Use a user story or Given/When/Then only when it clarifies behavior. Include meaningful negative and edge cases. Keep implementation choices in the plan.

## Clarification

Check for conflicting requirements and constraints that could change the outcome. Ask only about blocking decisions. Record the decision and reason where future work will need them; keep nonblocking assumptions explicit. A story is ready when its acceptance is testable and blockers are resolved.

## Story Slice

Select the next reviewable slice and its acceptance checks. Freeze its scope for the change; if it must change, update the spec and resolve the new boundary before coding. Split large work into atomic commits without calling the requested feature complete until its full gate passes. Reuse an existing story ID; add one only when it helps track a distinct requirement.

## Contracts

Define a separate contract for a public boundary or cross-cutting invariant that acceptance criteria alone do not state clearly. Include relevant inputs, outputs, failure behavior and test evidence. Do not duplicate ordinary acceptance criteria as contracts or invent inapplicable concerns.

## Per-Story Plan

Inspect the affected code, tests and commands first. Then record the smallest approach, the check that will fail first, and any non-obvious risk or rollback. A few sentences in the spec are enough for a small change. Before testing or implementation, load [SDD-DELIVERY.md](SDD-DELIVERY.md).
