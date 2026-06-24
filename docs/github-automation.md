# GitHub automation

How **LUMI** uses GitHub for community, CI, and releases. Maintainer-facing summary — contributors should start with [CONTRIBUTING.md](../CONTRIBUTING.md).

## Community files

| File | Purpose |
|------|---------|
| [ISSUE_TEMPLATE/](../.github/ISSUE_TEMPLATE/) | Bug, feature, docs, governed-execution forms |
| [DISCUSSION_TEMPLATE/](../.github/DISCUSSION_TEMPLATE/) | Q&A and Ideas discussion starters |
| [pull_request_template.md](../.github/pull_request_template.md) | PR checklist |
| [SUPPORT.md](../.github/SUPPORT.md) | Where to get help |
| [CODEOWNERS](../.github/CODEOWNERS) | Default reviewers |
| [FUNDING.yml](../.github/FUNDING.yml) | Sponsorship links |
| [labels.yml](../.github/labels.yml) | Canonical label definitions (synced to GitHub) |
| [RELEASING.md](../.github/RELEASING.md) | Maintainer release runbook |

## Reusable automation

| Asset | Purpose |
|-------|---------|
| [actions/setup-node-monorepo/](../.github/actions/setup-node-monorepo/) | Composite action — cached `npm ci` for root + webview-ui |

## Workflows

| Workflow | Trigger | Role |
|----------|---------|------|
| [test.yml](../.github/workflows/test.yml) | `main`, PRs | Quality checks + unit/integration tests |
| [e2e.yml](../.github/workflows/e2e.yml) | `main`, PRs (code paths) | Cross-platform Playwright e2e |
| [codeql.yml](../.github/workflows/codeql.yml) | `main`, PRs, weekly | Security static analysis |
| [scorecard.yml](../.github/workflows/scorecard.yml) | `main`, weekly | [OpenSSF Scorecard](https://scorecard.dev/) supply-chain posture |
| [dependency-review.yml](../.github/workflows/dependency-review.yml) | PRs | Block high-severity dependency changes |
| [actionlint.yml](../.github/workflows/actionlint.yml) | Workflow file changes | Validate GitHub Actions YAML |
| [pr-title.yml](../.github/workflows/pr-title.yml) | PRs | Conventional Commits title lint |
| [pr-size.yml](../.github/workflows/pr-size.yml) | PRs | `size/XS` … `size/XL` labels |
| [labeler.yml](../.github/workflows/labeler.yml) | PRs | Path-based labels |
| [issue-triage.yml](../.github/workflows/issue-triage.yml) | Issues | Area-based labels from templates |
| [welcome.yml](../.github/workflows/welcome.yml) | First issue/PR | Onboarding message for new contributors |
| [release-drafter.yml](../.github/workflows/release-drafter.yml) | `main` | Draft release notes |
| [stale.yml](../.github/workflows/stale.yml) | Daily | Close inactive issues |
| [lock-threads.yml](../.github/workflows/lock-threads.yml) | Daily | Lock resolved stale threads |
| [label-sync.yml](../.github/workflows/label-sync.yml) | `labels.yml` changes | Sync labels to GitHub |
| [dependabot-automerge.yml](../.github/workflows/dependabot-automerge.yml) | Dependabot PRs | Auto-merge security/patch updates |
| [merge-conflicts.yml](../.github/workflows/merge-conflicts.yml) | PRs | `conflicts` label on merge conflicts |
| [stale-branches.yml](../.github/workflows/stale-branches.yml) | Weekly | Delete merged branches older than 30 days |
| [publish.yml](../.github/workflows/publish.yml) | Manual | Marketplace release |
| [dependabot.yml](../.github/dependabot.yml) | Weekly | npm + GitHub Actions updates (majors ignored for Actions) |

## Releases

See [GOVERNANCE.md](../GOVERNANCE.md) for semver, branch protection, and the `publish` environment secrets.
