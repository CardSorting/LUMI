---
title: "Codebase Standards & Rules"
sidebarTitle: "Codebase Standards"
description: "How LUMI maps to the agent workspace layout and how to keep projects AI-friendly."
---

# Codebase Standards & Rules

This guide covers (1) how **this repository** is structured for the LUMI agent, and (2) how **your project** can stay easy for LUMI to work in.

## Agent workspace layout (this repo)

Verified map — full detail in [Project map](PROJECT_MAP.md):

| Directory | Role |
|-----------|------|
| `src/core/controller/` | Session controller, MCP, gRPC handlers |
| `src/core/task/` | Agent loop (~4k lines) |
| `src/core/task/tools/` | Tool coordinator + handlers |
| `src/core/api/` | LLM providers (4 wired) |
| `src/core/context/` | Context window, rules, file tracking |
| `src/core/hooks/` | Lifecycle hooks |
| `src/core/storage/` | StateManager, disk persistence |
| `src/hosts/vscode/` | VS Code host bridge (only full host) |
| `src/integrations/` | Checkpoints, terminal, diff |
| `src/services/` | MCP, browser, roadmap, tree-sitter |
| `src/infrastructure/` | DB pool, orchestrator |
| `webview-ui/` | React sidebar — **LUMI** user-facing copy |
| `broccolidb/` | Substrate package (separate docs) |

### Dependency discipline

- **Core** must not import `vscode` directly — use `HostProvider`.
- **Host-specific** code stays under `src/hosts/vscode/`.
- **BroccoliDB** is consumed via `@noorm/broccolidb` and tool handlers, not by duplicating substrate logic in the extension.

### UI copy

| User-facing strings live in `webview-ui/src/copy/lumiVoice.ts`. North star: [LUMI UX](../../webview-ui/docs/LUMI_UX.md) — *keep it open all day without feeling managed*.

## Your project: AI-friendly patterns

- **Type safety** — Prefer explicit types; avoid `any` in code LUMI will edit.
- **Clear module boundaries** — One primary responsibility per file; refactor before files exceed ~1,500 lines.
- **Descriptive names** — Functions and types should read without comments.
- **Lint config** — LUMI respects existing Biome/ESLint setups in the workspace.

## Enforcing standards in your repo

| Mechanism | Purpose |
|-----------|---------|
| [`.dietcoderules/`](customization/dietcode-rules.mdx) | Always-on project rules |
| [Workflows](customization/workflows.mdx) | Slash-invoked playbooks |
| [Hooks](customization/hooks.mdx) | Cancel or steer tools at runtime |
| [`.dietcodeignore`](customization/dietcodeignore.mdx) | Hide secrets and deps from context |
| **JoyZoning audit** | Architecture/layer compliance (`lumi.joyZoningAudit`) |
| **Spider / stability tools** | Structural checks via BroccoliDB integration |

## JoyZoning

The sidebar includes **JoyZoning Audit** (`lumi.joyZoningButtonClicked`) for architecture compliance review. This is separate from everyday lint — it targets layering and structural discipline.

JoyZoning now has two operating postures:

| Posture | When it applies | Behavior |
|---------|-----------------|----------|
| **Canonical** | Empty/greenfield workspaces or projects that opt in with `stability.config.json` | Domain, Core, Infrastructure, UI, and Plumbing are structural boundaries and can be audited directly. |
| **Blended workspace-native** | Existing projects without a JoyZoning structural opt-in | Existing topology, vocabulary, framework idioms, and tests determine code shape. JoyZoning remains continuously active as non-blocking steering for cohesion, ownership, explicit boundaries, testability, and side-effect isolation. |

Blended workspace-native mode follows **Mirror → Steer → Verify**: mirror the nearest established seam, steer new functions/classes with JoyZoning principles, then verify with native tooling and tests. It does not add layer directories, mandatory tags, DDD interfaces, or broad refactors merely to make an existing project resemble a greenfield JoyZoning application.

For implementation, this expands to **Discover → Classify → Converge → Prove**:

1. Discover repository rules, analogous code, dependencies, tests, and operational constraints.
2. Classify the familiar native pattern (vertical slice, MVC/MVVM, layered, hexagonal, modular monolith, event-driven, or plugin) and the affected abstraction level.
3. Converge on the smallest reversible design that mirrors the workspace while improving JoyZoning qualities.
4. Prove functional correctness and the relevant quality attributes with native tooling and risk-proportionate evidence.

Runtime steering uses stable, non-blocking advisory IDs:

| ID | Concern | Expected response |
|----|---------|-------------------|
| `JZ-C01` | Function cohesion | Consider extracting one responsibility using a nearby project pattern. |
| `JZ-B01` | Decision/effect boundary | Use an existing boundary seam where it improves independent testing. |
| `JZ-O01` | Class ownership | Verify that the class still represents one cohesive capability. |

Thresholds are workspace-calibratable under `global.joyZoningSteering`:

```json
{
  "global": {
    "architectureMode": "workspace-native",
    "joyZoningSteering": {
      "maxFunctionLines": 80,
      "minBoundaryLines": 20,
      "minBoundaryDecisions": 2,
      "maxClassMethods": 12
    }
  }
}
```

Set `global.architectureMode` in `stability.config.json` to `joy-zoning` or `workspace-native` to override automatic detection. A legacy `stability.config.json` without this field remains a canonical JoyZoning opt-in for compatibility.

## Related

- [Philosophy — extension without chaos](papers/philosophy.md#vii-extension-without-chaos)
- [Security best practices](SECURITY_BEST_PRACTICES.md)
- [BroccoliDB codebase standards](../broccolidb/docs/papers/philosophy.md) — substrate layering
