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

## [2.1.6] - 2026-06-27

### Added

- Receipt authority refactor: coordinator-owned halt decisions, advisory receipts, governance diagnostics (ADR-015)
- Three-tier blocker policy (hard / soft / advisory) and explicit lane state machine
- Parent I/O bulkhead and `IoRequestCoalescer` for parallel safe reads with deduplication
- `CoordinatorExecutionAuthority`, `loadSealReceiptContext`, soft-block retry budgets
- Documentation: [governed execution authority](docs/governed-execution-authority.md)

### Changed

- Subagent parent gate signals are advisory warnings, not lane-blocking `criticalSignals`
- Non-blocking running status emission; parallel seal drain and audit preflight
- Advisory lane timeout degrades to `degraded_complete` instead of failing the swarm
- Lane mutation tools defer post-guard; batched governed receipt reads at seal

## [2.1.4] - 2026-06-27

### Added

- Parent-thread I/O execution authority (`executionAuthority.ts`) — hot/warm/cold tool path for reads and searches
- Documentation: [parent-thread execution authority](docs/parent-thread-execution-authority.md), ADR-014, gate failure catalog

### Changed

- Shift-right parent gates: I/O tools skip full UniversalGuard; deferred post-guard and advisory audits
- Subagent lane completion: sync quality preflight only; hardening audit deferred to seal barrier
- Completion gate cache-aside (5 min TTL), progressive critical-only threshold, soft cooldown/duplicate preflight

## [2.1.3] - 2026-06-26

### Changed

- Hardened `.vscodeignore` for Open VSX pre-publish scanners (exclude shell scripts, dev tooling, SQLite test binaries)
- `lumi-doctor` now verifies Open VSX packaging rules on every VSIX build

## [2.1.2] - 2026-06-26

### Changed

- Version republish after 2.1.1 was already published to marketplaces

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
