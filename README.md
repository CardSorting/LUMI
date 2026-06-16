# LUMI

**LUMI** is a calm coding companion — comfort-first developer tooling for long sessions.

LUMI is a VS Code extension that acts as an agentic pair programmer: it reads your workspace, plans changes, runs terminal commands, uses a browser, and edits files — with your approval at every step.

## Install

Install from a VSIX or the Extensions panel:

```bash
cursor --install-extension lumi-1.0.3.vsix
```

Search for **LUMI** in Extensions (`CardSorting.lumi`).

## Quick start

1. Open the **LUMI** activity bar panel.
2. Sign in or configure an API provider (OpenRouter, ChatGPT Subscription, NousResearch, or Cloudflare Workers AI).
3. Describe a task in natural language and approve each proposed action.

## Documentation

| Area | Location |
|------|----------|
| User & developer docs | [docs/README.md](docs/README.md) |
| Architecture | [docs/architecture/current.md](docs/architecture/current.md) |
| Agent stack | [docs/AGENT_STACK.md](docs/AGENT_STACK.md) |
| Code ↔ docs | [docs/CODE_TO_DOC_MAP.md](docs/CODE_TO_DOC_MAP.md) |
| Project map | [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md) |
| Agent papers | [docs/papers/README.md](docs/papers/README.md) |
| BroccoliDB (context store) | [broccolidb/docs/README.md](broccolidb/docs/README.md) |

## Development

```bash
npm run install:all
npm run dev          # watch extension + protos
npm run dev:webview  # webview hot reload
npm test             # unit + integration tests
```

## Notes

- Disable other DietCode forks (`dreambeesai.dietcode`, `dietcode.dietcode`) to avoid activity bar conflicts.
- Internal code still uses `DietCode` prefixes for types and storage keys; the user-facing product name is **LUMI**.
