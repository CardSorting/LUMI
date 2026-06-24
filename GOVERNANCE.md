# Governance

How the **LUMI** open-source project is maintained and how technical decisions are recorded.

## Roles

| Role | Responsibility |
|------|----------------|
| **Maintainers** (`CardSorting`) | Triage issues/PRs, release extension, security response |
| **Contributors** | Issues and PRs under [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Users** | Bug reports, feature requests, discussions |

## Decision process

1. **Small fixes** (bugs, typos, docs) — PR review and merge when CI passes.
2. **Features** — Issue or discussion for scope agreement before large PRs.
3. **Architecture** — Documented as ADRs in [docs/governed-execution-decisions.md](docs/governed-execution-decisions.md) and [docs/papers/](docs/papers/).

## Governed execution invariants

Changes to swarm harness, roadmap projection, or merge gate must preserve:

- Locks protect mutation; receipts preserve truth.
- Private roadmap state is cheap; workspace roadmap truth is expensive; only the coordinator may spend it.

See [docs/governed-subagent-execution.md](docs/governed-subagent-execution.md).

## Releases

- Version source of truth: `package.json` (`displayName`: LUMI).
- Changelog: [CHANGELOG.md](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/)); detailed history in [changelogv3.md](changelogv3.md).
- **Semantic versioning**: `MAJOR.MINOR.PATCH` — breaking API/UX → major; features → minor; fixes/docs → patch.
- Draft release notes: [Release Drafter](.github/workflows/release-drafter.yml) aggregates merged PRs on `main`.
- CI: [.github/workflows/test.yml](.github/workflows/test.yml) and [.github/workflows/e2e.yml](.github/workflows/e2e.yml) on `main` and PRs.
- Dependency review: [.github/workflows/dependency-review.yml](.github/workflows/dependency-review.yml) on PRs (high-severity blocks merge).
- Publish: [.github/workflows/publish.yml](.github/workflows/publish.yml) (maintainer-triggered, `workflow_dispatch`).
- Nightly pre-release: [.github/workflows/publish-nightly.yml](.github/workflows/publish-nightly.yml) (`CardSorting/LUMI` only).

### Recommended branch protection (`main`)

Maintainers should enable on GitHub (Settings → Branches):

| Rule | Rationale |
|------|-----------|
| Require PR before merge | No direct pushes to `main` |
| Require status checks: **Tests**, **E2E Tests** | Green CI before merge |
| Require conversation resolution | Review feedback addressed |
| Dismiss stale approvals on new commits | Re-review after significant changes |
| Restrict force-push / deletion | Protect release history |

Dependabot and labeler workflows use standard `GITHUB_TOKEN` permissions documented in each workflow file.

### Deployment environment (`publish`)

Create **Settings → Environments → `publish`** on GitHub and add repository secrets used by [.github/workflows/publish.yml](.github/workflows/publish.yml) and [.github/workflows/publish-nightly.yml](.github/workflows/publish-nightly.yml):

| Secret | Purpose |
|--------|---------|
| `VSCE_PAT` | Visual Studio Marketplace |
| `OVSX_PAT` | Open VSX |
| `TELEMETRY_SERVICE_API_KEY` | Telemetry (optional) |
| `ERROR_SERVICE_API_KEY` | Error reporting (optional) |
| `OTEL_*` | OpenTelemetry export (optional) |

Until this environment exists, IDE workflow linters may flag `environment: publish` as unknown.

## Labels and triage

| Label | Use |
|-------|-----|
| `triage` | Needs maintainer classification |
| `governed-execution` | Swarm harness, projection, merge gate |
| `good first issue` | Onboarding-friendly |
| `stale` | Auto-applied by [stale workflow](.github/workflows/stale.yml); exempt labels listed there |

PR path labels (`documentation`, `ci`, `webview`, etc.) are applied by [labeler](.github/workflows/labeler.yml).

## Security

[SECURITY.md](SECURITY.md) — coordinated disclosure via security@dietcode.bot or GitHub private advisories.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant.
