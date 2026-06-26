# Changelog

All notable changes to **LUMI** are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Per-agent roadmap projection with coordinator-only workspace commits
- Governed swarm operator console fields (accepted/rejected patches, rebase, commit status)
- GitHub community templates (issues, PR, discussions, support)
- CI automation: OpenSSF Scorecard, actionlint, PR size labels, welcome bot, lock-threads
- Composite action `.github/actions/setup-node-monorepo` for cached monorepo installs
- Labels as code (`.github/labels.yml`), Dependabot auto-merge, merge-conflict labeling
- Security advisory issue template, maintainer [RELEASING.md](.github/RELEASING.md) runbook
- Husky `commit-msg` hook for Conventional Commits

### Changed

- Repository renamed to [CardSorting/LUMI](https://github.com/CardSorting/LUMI)
- E2E workflow skips docs-only pull requests (path filter)
- Removed legacy JetBrains and nightly publish automation

## [2.1.1] - 2026-06-26

### Fixed

- actionlint CI workflow: run via official download script (`rhysd/actionlint` is not a GitHub Action)
- CodeQL analysis configuration for JS/TS monorepo

### Changed

- Dependency security updates across monorepo (npm audit fixes)

## [2.1.0] - 2026-06-23

Current extension release (`package.json`). See [changelogv3.md](changelogv3.md) for detailed substrate and provider history from prior product iterations.

### Highlights

- Calm VS Code companion UX (`CardSorting.lumi-vscode` / `CardSorting.lumi`)
- Plan/Act modes with approval-gated tools
- Governed subagent swarms with merge gate and durable receipts
- BroccoliDB-backed cognitive memory integration

---

Older detailed entries: [changelogv3.md](changelogv3.md)
