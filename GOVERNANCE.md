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
- OpenSSF Scorecard: [.github/workflows/scorecard.yml](.github/workflows/scorecard.yml) (weekly supply-chain posture).
- Publish: [.github/workflows/publish.yml](.github/workflows/publish.yml) (maintainer-triggered — see [.github/RELEASING.md](.github/RELEASING.md)).
- Dependabot security/patch PRs: auto-merge enabled via [.github/workflows/dependabot-automerge.yml](.github/workflows/dependabot-automerge.yml) when CI passes.
- **GitHub Actions** Dependabot ignores `semver-major` bumps (review major action upgrades manually in focused PRs).

### Recommended branch protection (`main`)

Maintainers should enable on GitHub (Settings → Branches):

| Rule | Rationale |
|------|-----------|
| Require PR before merge | No direct pushes to `main` |
| Require status checks: **Tests**, **E2E Tests**, **CodeQL**, **Dependency Review**, **PR Title**, **Actionlint** | Green CI and workflow hygiene before merge |
| **Squash merge only** | Enabled — merge commits and rebase merges disabled for linear `main` history |
| **Delete head branches** after merge | Enabled via repo settings (`deleteBranchOnMerge`) |
| Require conversation resolution | Review feedback addressed |
| Dismiss stale approvals on new commits | Re-review after significant changes |
| Require review from **CODEOWNERS** | Governed-execution and security paths |
| Restrict force-push / deletion | Protect release history |

Repository rulesets can dry-run branch protection in **evaluate** mode before enforcement (GitHub **Settings → Rules → Rulesets**). **Squash-only** merges, auto-merge (Dependabot security/patch PRs), and delete-branch-on-merge are enabled on the repository.

**Workflow token default:** repository Actions settings should use **read-only** `GITHUB_TOKEN` at workflow scope; write permissions are granted per-job (see `publish.yml`, `scorecard.yml`).

Dependabot and labeler workflows use standard `GITHUB_TOKEN` permissions documented in each workflow file.

### Deployment environment (`publish`)

Create **Settings → Environments → `publish`** on GitHub and add repository secrets used by [.github/workflows/publish.yml](.github/workflows/publish.yml):

| Secret | Purpose |
|--------|---------|
| `VSCE_PAT` | Visual Studio Marketplace |
| `OVSX_PAT` | Open VSX |
| `TELEMETRY_SERVICE_API_KEY` | Telemetry (optional) |
| `ERROR_SERVICE_API_KEY` | Error reporting (optional) |
| `OTEL_*` | OpenTelemetry export (optional) |

PR titles are validated by [.github/workflows/pr-title.yml](.github/workflows/pr-title.yml) (Conventional Commits-style: `feat:`, `fix:`, `docs:`, etc.).

## Labels and triage

| Label | Use |
|-------|-----|
| `triage` | Needs maintainer classification |
| `governed-execution` | Swarm harness, projection, merge gate |
| `good first issue` | Onboarding-friendly |
| `stale` | Auto-applied by [stale workflow](.github/workflows/stale.yml); exempt labels listed there |
| `size/XS` … `size/XL` | PR change size — applied by [pr-size](.github/workflows/pr-size.yml) |
| `conflicts` | Merge conflicts — applied by [merge-conflicts](.github/workflows/merge-conflicts.yml) |

Canonical definitions: [.github/labels.yml](.github/labels.yml) (synced by [label-sync](.github/workflows/label-sync.yml)).

PR path labels (`documentation`, `ci`, `webview`, etc.) are applied by [labeler](.github/workflows/labeler.yml).

Area-specific issue labels (`governed-execution`, `webview`, `broccolidb`) are added by [issue-triage](.github/workflows/issue-triage.yml) when templates mention those areas.

## Security

[SECURITY.md](SECURITY.md) — coordinated disclosure via security@dietcode.bot or GitHub private advisories.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant.
