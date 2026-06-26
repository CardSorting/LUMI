# OpenSSF Scorecard

LUMI tracks supply-chain hygiene with the [OpenSSF Scorecard](https://securityscorecards.dev/viewer/?uri=github.com/CardSorting/LUMI).

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/CardSorting/LUMI/badge)](https://securityscorecards.dev/viewer/?uri=github.com/CardSorting/LUMI)

## Automated in this repository

| Check | Status |
|-------|--------|
| CodeQL (SAST) | `.github/workflows/codeql.yml` |
| Dependency Review | `.github/workflows/dependency-review.yml` |
| Dependabot | `.github/dependabot.yml` |
| Security policy | `SECURITY.md` |
| License | `LICENSE` (Apache-2.0) |
| Pinned GitHub Actions | `scripts/pin-github-actions.mjs` |
| Signed release artifacts | `.github/workflows/package-extension.yml`, `publish.yml` |
| Scorecard SARIF upload | `.github/workflows/scorecard.yml` |

Re-pin actions after bumping tags:

```bash
node scripts/pin-github-actions.mjs
```

## Repository admin settings (GitHub UI)

These checks require org/repo settings and cannot be enforced from code alone:

### Branch protection (`main`)

Settings → Branches → Add rule for `main`:

- Require a pull request before merging
- Require approvals (at least 1)
- Dismiss stale pull request approvals when new commits are pushed
- Require status checks: **Quality Checks**, **test**, **CodeQL**
- Require branches to be up to date before merging
- Do not allow bypassing the above settings

This improves **Branch-Protection** and **Code-Review** scores.

### Security features

Settings → Code security and analysis:

- Enable **Dependabot alerts** and **Dependabot security updates**
- Enable **Secret scanning** (if available for the org)
- Enable **Private vulnerability reporting**

### Releases and signing

- Tag releases as `v*` (for example `v2.1.0`) so `package-extension.yml` builds and signs VSIX artifacts with [cosign](https://docs.sigstore.dev/).
- Marketplace publish remains manual via **Publish Release** (`publish.yml`).

## Scores that improve over time

| Check | Notes |
|-------|-------|
| **Maintained** | Scorecard penalizes repos younger than 90 days; this clears automatically. |
| **Contributors** | Requires contributors from multiple organizations. |
| **Vulnerabilities** | Driven by open Dependabot/npm audit findings; triage via Dependabot PRs. |
| **CII-Best-Practices** | Apply at [OpenSSF Best Practices](https://www.bestpractices.dev/) when ready. |

## Fuzzing (optional)

ClusterFuzzLite or OSS-Fuzz integration would improve the **Fuzzing** check. That is not yet configured for this extension host.
