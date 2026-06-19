# Documentation maintainer guide

How to keep LUMI agent docs aligned with the codebase.

## When you change code, update docs

Use [CODE_TO_DOC_MAP.md](CODE_TO_DOC_MAP.md) to find the matching page. Minimum updates:

| Change | Update |
|--------|--------|
| New tool in `DietCodeDefaultTool` | [all-dietcode-tools.mdx](tools-reference/all-dietcode-tools.mdx) + handler in coordinator |
| New wired provider | `providers.json`, `buildApiHandler`, [provider-config/](provider-config/README.mdx), [model-selection-guide](core-features/model-selection-guide.mdx) |
| New hook type | [hooks.mdx](customization/hooks.mdx), [CODE_TO_DOC_MAP](CODE_TO_DOC_MAP.md) |
| New `lumi.*` setting | [roadmap-steering](features/roadmap-steering.mdx) or relevant feature doc |
| Roadmap auto-governance / completion gate | [roadmap-steering](features/roadmap-steering.mdx) · [post-mortem](features/roadmap-auto-governance-postmortem.mdx) |
| Architecture move | [PROJECT_MAP.md](PROJECT_MAP.md), [architecture/current.md](architecture/current.md), [papers/whitepaper.md](papers/whitepaper.md) |

## CI checks

```bash
npm run docs:check-all              # all doc guardrails + Mintlify links
npm run docs:check-agent-links      # required files + relative links
npm run docs:check-agent-branding   # no stale user-facing "DietCode" in core dirs
npm run docs:check-root-readme      # README.md / readme.md parity + live metrics
npm run docs:check-docs-readme      # docs/README.md structure guardrails
npm run docs:check-readme-metrics   # README + companion-brief vs live codebase
npm run docs:tag-legacy-providers   # prepend legacy notice to unwired provider pages
npm run docs:check-links            # Mintlify broken-links (needs docs deps)
```

`docs:check-agent-links`, `docs:check-agent-branding`, `docs:check-root-readme`, `docs:check-root-readme-links`, `docs:check-readme-metrics`, and `docs:check-docs-readme` run in `ci:check-all`. Run **`npm run docs:check-all`** (includes metrics + Mintlify) before publishing docs.

## Branding rules

| Use | When |
|-----|------|
| **LUMI** | Product, sidebar, user-facing behavior |
| **DietCode** | Internal types (`DietCodeMessage`), paths (`.dietcoderules/`), historical filenames |
| **BroccoliDB** | Substrate package only — docs in `broccolidb/docs/` |

Do not rewrite `broccolidb/docs/` when updating agent docs. Link across layers via [AGENT_STACK.md](AGENT_STACK.md).

## Legacy provider pages

Only **4 providers** are wired: OpenRouter, ChatGPT Subscription (`openai-codex`), NousResearch, Cloudflare.

Other `docs/provider-config/*.mdx` files are **reference only**. They should include the legacy `<Note>` from [provider-config/README.mdx](provider-config/README.mdx). Do not delete them without a deliberate deprecation pass.

## Papers

Major architecture or trust-model changes should update:

1. [papers/companion-brief.md](papers/companion-brief.md) — metrics table
2. [papers/philosophy.md](papers/philosophy.md) — values
3. [papers/whitepaper.md](papers/whitepaper.md) — technical depth

## Batch branding pass

```bash
node scripts/rewrite-agent-docs.mjs   # DietCode→LUMI patterns in docs/
```

Review the diff — do not blind-merge enterprise/hosted-service pages that legitimately reference `dietcode.bot`.

## Extension publish (dual marketplace IDs)

| Registry | Extension ID | `package.json` `name` used at publish |
|----------|--------------|--------------------------------------|
| **VS Code Marketplace** | `CardSorting.lumi-vscode` | `lumi-vscode` (default) |
| **Open VSX** | `CardSorting.lumi` | `lumi` (patched by script) |

Set tokens: `VSCE_PAT` ([Azure DevOps](https://dev.azure.com)) · `OVSX_PAT` ([open-vsx.org](https://open-vsx.org/user-settings/tokens))

```bash
npm run package:vsix              # dist/lumi-vscode-<version>.vsix
npm run package:vsix:openvsx        # dist/lumi-<version>.vsix (CardSorting.lumi)
npm run package:vsix:all            # both VSIX variants
npm run doctor                      # health check (packaging + installs)
npm run doctor:install              # check installed extensions only (end users)
npm run doctor:fix                  # repair broken local installs from dist/*.vsix
npm run doctor -- --ci              # fail on errors (used in CI / release)

# Publish to both registries (recommended release)
VSCE_PAT=... OVSX_PAT=... npm run publish:all

# Or one at a time
VSCE_PAT=... npm run publish:vscode
OVSX_PAT=... npm run publish:openvsx

# Pre-release builds
VSCE_PAT=... OVSX_PAT=... npm run publish:all:prerelease
```

Open VSX publish runs `scripts/publish-openvsx.mjs`, which packages via `scripts/package-openvsx-vsix.mjs` and uploads `dist/lumi-<version>.vsix`.

### Open VSX namespace verification

Open VSX shows a **warning** when the publishing GitHub user is not a verified owner of the `CardSorting` namespace. This is **not** fixed by republishing alone — Eclipse must grant namespace ownership.

**One-time setup (CardSorting GitHub account):**

1. Log in at [open-vsx.org](https://open-vsx.org) with the **CardSorting** GitHub account.
2. Link your Eclipse account and sign the **Publisher Agreement** (Profile → Log in with Eclipse → Show Publisher Agreement).
3. Create `OVSX_PAT` at [Access Tokens](https://open-vsx.org/user-settings/tokens).
4. Run `OVSX_PAT=... npm run setup:openvsx` (creates namespace + verifies token).

**Claim ownership (required to remove the warning):**

File an issue at [EclipseFdn/open-vsx.org](https://github.com/EclipseFdn/open-vsx.org/issues) requesting ownership of namespace `CardSorting`. Include links to `https://github.com/CardSorting`, `https://github.com/CardSorting/DietCodeMarie`, and `https://open-vsx.org/extension/CardSorting/lumi`.

Pending claim: [Issue #11189](https://github.com/EclipseFdn/open-vsx.org/issues/11189)

After Eclipse grants ownership (issue labeled `granted`), republish:

```bash
OVSX_PAT=... npm run publish:openvsx
```

New versions will show the verified shield icon. Existing unverified versions remain marked until republished under the verified namespace.
