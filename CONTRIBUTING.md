# Contributing to LUMI

Thank you for contributing to **LUMI** (`CardSorting.lumi`) — the calm coding companion VS Code extension in the [LUMI](https://github.com/CardSorting/LUMI) monorepo.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

---

## Table of contents

- [Quick links](#quick-links)
- [Reporting bugs](#reporting-bugs)
- [Security vulnerabilities](#security-vulnerabilities)
- [Before you contribute](#before-you-contribute)
- [Development setup](#development-setup)
- [Pull request checklist](#pull-request-checklist)
- [Code quality](#code-quality)
- [Testing](#testing)
- [Documentation changes](#documentation-changes)
- [License](#license)

---

## Quick links

| Resource | Location |
|----------|----------|
| Repository | [github.com/CardSorting/LUMI](https://github.com/CardSorting/LUMI) |
| Issues | [GitHub Issues](https://github.com/CardSorting/LUMI/issues) |
| Discussions | [GitHub Discussions](https://github.com/CardSorting/LUMI/discussions) |
| Support | [.github/SUPPORT.md](.github/SUPPORT.md) |
| Governance | [GOVERNANCE.md](GOVERNANCE.md) |
| Root README | [README.md](README.md) |
| Doc hub | [docs/README.md](docs/README.md) |
| Doc maintainer guide | [docs/MAINTAINER.md](docs/MAINTAINER.md) |
| Architecture | [docs/AGENT_STACK.md](docs/AGENT_STACK.md) |
| Code ↔ docs map | [docs/CODE_TO_DOC_MAP.md](docs/CODE_TO_DOC_MAP.md) |

---

## Reporting bugs

1. [Search existing issues](https://github.com/CardSorting/LUMI/issues) to avoid duplicates.
2. Open a new issue with reproduction steps, VS Code version, extension version (`2.1.0`), and provider used.
3. Include relevant logs from **LUMI → Output** panel when possible.

---

## Security vulnerabilities

**Do not** open public issues for security bugs.

Report privately via [SECURITY.md](SECURITY.md) → **security@dietcode.bot**

Or use [GitHub Security Advisories](https://github.com/CardSorting/LUMI/security/advisories/new) if enabled for the repository.

---

## Before you contribute

| Change type | Requirement |
|-------------|-------------|
| Bug fix, typo, docs correction | PR welcome — link an issue when helpful |
| New feature or behavior change | Open an issue first; wait for maintainer approval |
| BroccoliDB substrate changes | See [broccolidb/](broccolidb/) — separate package conventions |

**PRs without approved issues for large features may be closed.**

Good first targets: issues labeled `good first issue` or `help wanted`, or documentation gaps listed in [docs/REWRITE_PLAN.md](docs/REWRITE_PLAN.md).

---

## Development setup

### Prerequisites

- **Node.js 20+**
- **VS Code 1.84+**
- **Git** (and **git-lfs** for cloning this repo)
- **Git** on PATH (checkpoints in dev workflows)

### Bootstrap

```bash
git clone https://github.com/CardSorting/LUMI.git
cd LUMI
npm run install:all
npm run protos               # required before first build
npm run dev                  # terminal 1 — extension watch
npm run dev:webview          # terminal 2 — webview HMR (optional)
```

Press **F5** in VS Code to launch **Extension Development Host** with LUMI loaded.

Recommended VS Code extension: [esbuild problem matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers).

### Linux integration test dependencies

VS Code extension tests require GUI libraries. On Debian/Ubuntu:

```bash
sudo apt update && sudo apt install -y dbus libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libdrm2 libgbm1 libgtk-3-0 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 \
  libxfixes3 libxkbfile1 libxrandr2 xvfb
```

---

## Pull request checklist

- [ ] Branch is up to date with `main`
- [ ] `npm run ci:check-all` passes locally
- [ ] Tests added/updated for behavior changes
- [ ] Docs updated when changing tools, providers, settings, or architecture ([CODE_TO_DOC_MAP](docs/CODE_TO_DOC_MAP.md))
- [ ] PR description explains **why**, lists test steps, includes screenshots for UI changes
- [ ] Commits use clear messages (conventional commits encouraged: `feat:`, `fix:`, `docs:`)

---

## Code quality

```bash
npm run check-types    # TypeScript — extension + webview
npm run lint           # Biome + proto lint
npm run format:fix     # Auto-format staged/changed files
```

All PRs must pass CI: types, lint, format, roadmap audit, and documentation guardrails.

---

## Testing

```bash
npm test               # unit + integration
npm run test:e2e       # Playwright — build VSIX + run e2e suite
npm run e2e            # Playwright without rebuild
```

E2E tests live in `src/test/e2e/`. See [src/test/e2e/README.md](src/test/e2e/README.md) for fixtures and debug mode.

---

## Documentation changes

LUMI docs live under `docs/` (agent session layer). **Do not** rewrite `broccolidb/docs/` when updating agent docs — link across via [AGENT_STACK.md](docs/AGENT_STACK.md).

After doc edits:

```bash
npm run docs:check-agent-links
npm run docs:check-agent-branding
npm run docs:check-root-readme
npm run docs:check-docs-readme
```

Guide: [docs/MAINTAINER.md](docs/MAINTAINER.md)

---

## Commits and changelog

- **PR titles** must follow Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`, etc.) — enforced by [pr-title.yml](.github/workflows/pr-title.yml).
- **Commit messages** use the same format locally via Husky (`commit-msg` hook).
- Use clear, imperative commit subjects matching the PR title when possible.
- User-facing changes: add an entry under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- Release Drafter groups merged PRs by label for maintainers drafting GitHub releases.

Pull requests are merged with **squash merge** only (linear `main` history). Write PR titles accordingly — they become the squash commit subject on merge.

---

## License

By submitting a pull request, you agree your contributions are licensed under [Apache-2.0](LICENSE).

LUMI is a derivative work of [Cline](https://github.com/cline/cline); see [NOTICE](NOTICE), [Product evolution](docs/EVOLUTION.md), and [README — Origins & acknowledgments](README.md#origins--acknowledgments).
