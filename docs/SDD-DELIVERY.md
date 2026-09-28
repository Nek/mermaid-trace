# SDD: Testing, Implementation, and Verification

Read [SDD.md](SDD.md), the relevant acceptance and plan, and any separate contracts that apply. If acceptance or the plan is missing or needs revision, use [SDD-PLANNING.md](SDD-PLANNING.md) before implementation.

## Tests from Requirements

For a behavior change, write a project-behavior test first and confirm it fails for the expected reason. Use the smallest check that could catch the regression, including negative or boundary cases where they matter. Add integration or performance checks when the requirement calls for them; do not test a dependency instead of project behavior.

Make acceptance traceable through descriptive test names or a short spec reference. Use a matrix only when several criteria, variants or manual checks would otherwise be hard to audit. A listed test is not proof it passed: distinguish automated results, manual verification and unrun checks.

## Implementation

Before editing, inspect the affected code and its callers, conventions, tests, commands, and entry points. Confirm the selected story, acceptance criteria, contracts, and plan.

Implement the smallest design that satisfies the story. Preserve existing public behavior unless the spec says otherwise. Keep errors explicit and actionable, avoid broad rewrites, and add operational signals where required.

After editing, run the narrowest relevant checks and fix failures caused by the change. Use existing project commands from README, CI, task runners, manifests, Makefiles, or equivalents. Report commands run and their results; explain unavailable checks. Record discovered facts in the feature artifacts.

## Verification and Review

Compare the change with the frozen scope and every applicable acceptance criterion. Check the regression test is green, relevant existing tests still pass, and public contracts and critical invariants survive. Report failures, unrun checks and remaining limits plainly; documentation cannot turn an unverified criterion into a pass. Update the spec only for a real behavior decision or current gap, not to repeat command output.

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

Local commits and periodic pushes of completed, verified work to this project's `origin` are routine delivery under [AGENTS.md](../AGENTS.md#tdd-and-commits). Check the remote and branch before pushing; do not force-push. Tagging a release and publishing require separate authorization. No commit hooks or release automation are required at this stage.

## Final Response

Briefly report the story or requirement addressed, files changed, checks and results, spec updates, commit IDs, and any uncommitted work or unresolved risks. Do not present unverified assumptions as facts.
