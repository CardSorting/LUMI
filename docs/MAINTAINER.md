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
| Architecture move | [PROJECT_MAP.md](PROJECT_MAP.md), [architecture/current.md](architecture/current.md), [papers/whitepaper.md](papers/whitepaper.md) |

## CI checks

```bash
npm run docs:check-all              # all doc guardrails + Mintlify links
npm run docs:check-agent-links      # required files + relative links
npm run docs:check-agent-branding   # no stale user-facing "DietCode" in core dirs
npm run docs:check-root-readme      # README.md / readme.md parity + live metrics
npm run docs:check-docs-readme      # docs/README.md structure guardrails
npm run docs:tag-legacy-providers   # prepend legacy notice to unwired provider pages
npm run docs:check-links            # Mintlify broken-links (needs docs deps)
```

`docs:check-agent-links`, `docs:check-agent-branding`, `docs:check-root-readme`, and `docs:check-docs-readme` run in `ci:check-all`.

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
