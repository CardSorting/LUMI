# GitHub repository

How **LUMI** uses GitHub for community, CI, and releases. Maintainer-facing summary — contributors should start with [CONTRIBUTING.md](../CONTRIBUTING.md).

## Community files

| File | Purpose |
|------|---------|
| [ISSUE_TEMPLATE/](ISSUE_TEMPLATE/) | Bug, feature, docs, governed-execution forms |
| [DISCUSSION_TEMPLATE/](DISCUSSION_TEMPLATE/) | Q&A and Ideas discussion starters |
| [pull_request_template.md](pull_request_template.md) | PR checklist |
| [SUPPORT.md](SUPPORT.md) | Where to get help |
| [CODEOWNERS](CODEOWNERS) | Default reviewers |
| [FUNDING.yml](FUNDING.yml) | Sponsorship links |
| [labels.yml](labels.yml) | Canonical label definitions (synced to GitHub) |
| [RELEASING.md](RELEASING.md) | Maintainer release runbook |

## Reusable automation

| Asset | Purpose |
|-------|---------|
| [actions/setup-node-monorepo/](actions/setup-node-monorepo/) | Composite action — cached `npm ci` for root + webview-ui |

## Workflows

| Workflow | Trigger | Role |
|----------|---------|------|
| [test.yml](workflows/test.yml) | `main`, PRs | Quality checks + unit/integration tests |
| [e2e.yml](workflows/e2e.yml) | `main`, PRs (code paths) | Cross-platform Playwright e2e |
| [codeql.yml](workflows/codeql.yml) | `main`, PRs, weekly | Security static analysis |
| [scorecard.yml](workflows/scorecard.yml) | `main`, weekly | [OpenSSF Scorecard](https://scorecard.dev/) supply-chain posture |
| [dependency-review.yml](workflows/dependency-review.yml) | PRs | Block high-severity dependency changes |
| [actionlint.yml](workflows/actionlint.yml) | Workflow file changes | Validate GitHub Actions YAML |
| [pr-title.yml](workflows/pr-title.yml) | PRs | Conventional Commits title lint |
| [pr-size.yml](workflows/pr-size.yml) | PRs | `size/XS` … `size/XL` labels |
| [labeler.yml](workflows/labeler.yml) | PRs | Path-based labels |
| [issue-triage.yml](workflows/issue-triage.yml) | Issues | Area-based labels from templates |
| [welcome.yml](workflows/welcome.yml) | First issue/PR | Onboarding message for new contributors |
| [release-drafter.yml](workflows/release-drafter.yml) | `main` | Draft release notes |
| [stale.yml](workflows/stale.yml) | Daily | Close inactive issues |
| [lock-threads.yml](workflows/lock-threads.yml) | Daily | Lock resolved stale threads |
| [label-sync.yml](workflows/label-sync.yml) | `labels.yml` changes | Sync labels to GitHub |
| [dependabot-automerge.yml](workflows/dependabot-automerge.yml) | Dependabot PRs | Auto-merge security/patch updates |
| [merge-conflicts.yml](workflows/merge-conflicts.yml) | PRs | `conflicts` label on merge conflicts |
| [publish.yml](workflows/publish.yml) | Manual | Marketplace release |
| [dependabot.yml](dependabot.yml) | Weekly | npm + GitHub Actions updates (majors ignored for Actions) |

## Releases

See [GOVERNANCE.md](../GOVERNANCE.md) for semver, branch protection, and the `publish` environment secrets.
