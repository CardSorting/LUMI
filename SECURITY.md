# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| **2.1.x** (current) | Yes — active patches for the latest release |
| **2.0.x** | Best-effort security fixes |
| Older / fork builds | At maintainer discretion |

Extension ID: **CardSorting.lumi** · Repository: [CardSorting/LUMI](https://github.com/CardSorting/LUMI)

---

## Reporting a vulnerability

If you discover a security vulnerability in **LUMI** or this monorepo:

1. **Email:** security@dietcode.bot
2. **Include:** description, impact, reproduction steps, and affected version
3. **Do not** disclose publicly until we acknowledge and coordinate a fix

We aim to acknowledge reports within **5 business days**. If you receive no response, follow up at the same address.

Preferred for GitHub users: [Private security advisory](https://github.com/CardSorting/LUMI/security/advisories/new) when available.

---

## Scope

In scope:

- LUMI VS Code extension (`src/`, `webview-ui/`)
- Tool approval bypass or silent file write paths
- Credential handling for LLM providers and MCP servers
- BroccoliDB integration surfaces that could leak workspace data

Out of scope (report to the upstream vendor):

- Vulnerabilities in third-party LLM APIs (OpenRouter, OpenAI, etc.)
- VS Code core bugs unrelated to LUMI code paths

---

## Safe use

LUMI is designed **human-in-the-loop**. For high-risk workflows:

- Keep **checkpoints** enabled
- Avoid **YOLO mode** on production codebases
- Scope context with [`.dietcodeignore`](docs/customization/dietcodeignore.mdx)
- Review MCP server permissions before auto-approve

Details: [docs/SECURITY_BEST_PRACTICES.md](docs/SECURITY_BEST_PRACTICES.md)

Thank you for helping keep LUMI users safe.
