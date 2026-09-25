# SDD: Testing, Implementation, and Verification

Read [SDD.md](SDD.md) and the selected story's spec, contracts, and plan first. If these are missing or need revision, use [SDD-PLANNING.md](SDD-PLANNING.md) before implementation.

## Tests from Requirements

Derive tests before implementation; add or update them in the same change when behavior changes.

| Requirement | Appropriate check |
| --- | --- |
| Acceptance criteria | Example tests |
| Failure behavior and edge cases | Negative and boundary tests |
| Contracts | Contract tests |
| Invariants | Property/generative tests where practical |
| Integrations | Integration tests |
| Performance and other measurable non-functional requirements | Measurements or benchmarks |

Choose relevant checks, not every test category for every story. Keep traceability explicit with one row per criterion or contract:

| Requirement / contract ID | Test type | Test name or check | Status |
| --- | --- | --- | --- |
| AC-1 | Example | Specific test or verification command | Not run |

A listed test is not evidence of a passing test. Distinguish automated results, manual verification, and checks not run.

## Implementation

Before editing, inspect the affected code and its callers, conventions, tests, commands, and entry points. Confirm the selected story, acceptance criteria, contracts, and plan.

Implement the smallest design that satisfies the story. Preserve existing public behavior unless the spec says otherwise. Keep errors explicit and actionable, avoid broad rewrites, and add operational signals where required.

After editing, run the narrowest relevant checks and fix failures caused by the change. Use existing project commands from README, CI, task runners, manifests, Makefiles, or equivalents. Report commands run and their results; explain unavailable checks. Record discovered facts in the feature artifacts.

## Verification and Review

Compare the final implementation with the spec. Look for missing criteria, contradictions, undocumented behavior, missing tests, and contract gaps.

```text
[ ] Behavior matches the selected story; no unrelated behavior was added.
[ ] Acceptance criteria are satisfied, including negative and edge cases.
[ ] Relevant contracts are implemented and their tests pass.
[ ] Critical invariants are checked.
[ ] Tests are added or updated and trace to criteria or contracts.
[ ] Required operational signals exist.
[ ] Relevant checks pass; failures and unavailable checks are documented.
[ ] Spec artifacts and design decisions match final agreed behavior.
```

Documenting a failed or unavailable check does not establish that its criterion passed. State remaining verification limits plainly.

## Commit and release conventions

Commit completed, verified changes without waiting for a separate request. Each commit should be independently understandable and contain one coherent change with its relevant tests and documentation. Inspect the staged diff before committing; stage specific files or hunks and leave unrelated user work alone. Check status afterward and report any remaining work.

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): imperative summary`, with optional scope. Use lowercase types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, or `revert`. Describe the concrete result, not a generic "update files". Include rationale or verification in the body when useful. Mark breaking public API or artifact-contract changes with `!` and a `BREAKING CHANGE:` footer explaining migration.

Examples: `feat(mapping): resolve node spans`, `fix(viewer): isolate SVG selections`, `docs: clarify Markdown integration`.

Use [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) for package releases:

- Keep `0.0.0` while this is an unpublished skeleton; the first usable release starts at `0.1.0`.
- Project policy before 1.0: increment minor for features or breaking changes, patch for compatible fixes. Still identify breaking changes explicitly.
- From 1.0: breaking public API changes increment major, compatible features increment minor, compatible fixes increment patch.
- Bump versions when preparing a release, not for every commit. Documentation and internal maintenance alone do not require a release. Use prerelease identifiers such as `0.1.0-alpha.1` when needed.
- Release tags use `vX.Y.Z` (including a prerelease suffix when applicable); never move an existing release tag or replace released contents. Keep release notes under `docs/CHANGELOG.md`, introduced with the first release.
- The SVG mapping format has its own explicit compatibility version; package versions do not substitute for it. Future separately published packages may have independent SemVer versions.

Local commits are routine delivery. Pushing, tagging a release, and publishing require authorization for those actions; adopting this convention does not initiate a release. No commit hooks or release automation are required at this stage.

## Final Response

Briefly report the story or requirement addressed, files changed, checks and results, spec updates, commit IDs, and any uncommitted work or unresolved risks. Do not present unverified assumptions as facts.
