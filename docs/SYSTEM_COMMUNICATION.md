---
title: "System Communication"
sidebarTitle: "Communication"
description: "How LUMI connects the webview, VS Code host, LLM providers, and MCP."
---

# System Communication

LUMI separates the **React webview**, **extension host**, and **VS Code APIs** so the agent loop stays responsive and type-safe.

## Layers

```
webview-ui/  (React)
    ↕ protobuf messages / gRPC-style handlers
src/core/controller/  (Controller, subscribeTo* handlers)
    ↕ HostProvider.hostBridge (nice-grpc)
src/hosts/vscode/hostbridge/  (VS Code adapter)
    ↕ vscode API
VS Code (files, terminal, window, diff)
```

Parallel paths:

- **LLM** — `src/core/task/` → `buildApiHandler` → provider HTTP/SSE (`src/core/api/providers/`)
- **MCP** — `src/services/mcp/McpHub.ts` → MCP SDK transports
- **BroccoliDB** — `@noorm/broccolidb` via kernel/memory tool handlers

## Webview ↔ extension

The sidebar webview does not call Node APIs directly. Instead:

1. UI sends messages through the VS Code webview API.
2. `src/core/controller/grpc-handler.ts` and related `subscribeTo*` modules deserialize **protobuf** payloads.
3. `Controller` updates state or forwards to the active `Task`.
4. State and partial streams push back through the same channel (`sendStateUpdate`, `sendPartialMessageEvent`, etc.).

Generated types live in `src/generated/` and `src/shared/proto/`.

### Persistent subscriptions (important)

Long-lived `subscribeTo*` RPCs are **event channels**, not job streams. They must stay open while idle and only emit when something happens (button click, state change, partial message, etc.).

A prior bug applied a 10-minute **idle timeout** to all streaming RPCs. Subscriptions that did not send an immediate message (most UI event streams) timed out together and flooded the console with `Timed out waiting for … stream update` errors.

The fix is documented in [gRPC subscription persistence](grpc-subscription-persistence.md). In short:

| Layer | Location | Responsibility |
|-------|----------|------------------|
| Contract | `src/shared/grpc/persistent-stream.ts` | Classify persistent vs finite streams; idle timeout applies only to finite streams |
| Webview transport | `webview-ui/src/services/grpc-client-base.ts` | Skips idle timer when `shouldApplyStreamIdleTimeout(method)` is false |
| Webview runtime | `webview-ui/src/services/grpc-subscription-runtime.ts` | Deduped transports, ref-count, reconnect, visibility recovery |
| Webview bindings | `webview-ui/src/context/useExtensionGrpcSubscriptions.ts` | Declarative subscription list |
| Server fanout | `src/core/controller/persistent-subscription-hub.ts` | One hub per stream type; prune dead subscribers on broadcast failure |

New persistent streams should use `PersistentSubscriptionHub` on the server and `useGrpcSubscription` on the client — not private `Set` fanout or one-off `useEffect` reconnect logic.

## Host bridge

`HostProvider` (`src/hosts/host-provider.ts`) is initialized in `src/extension.ts` with:

| Factory | VS Code implementation |
|---------|------------------------|
| `createWebviewProvider` | `VscodeWebviewProvider` |
| `createDiffViewProvider` | `VscodeDiffViewProvider` |
| `createTerminalManager` | `VscodeTerminalManager` |
| `createCommentReviewController` | `VscodeCommentReviewController` |
| `hostBridge` | `vscodeHostBridgeClient` |

The gRPC client in `src/hosts/vscode/hostbridge/client/host-grpc-client.ts` calls generated services for window, workspace, env, diff, and watch operations. This keeps `src/core/` free of direct `vscode` imports.

## Task loop messaging

Inside `Task` (`src/core/task/index.ts`):

1. User input is parsed for @ mentions (`src/core/mentions/`) and slash commands (`src/core/slash-commands/`).
2. Context managers attach file, model, and environment metadata (`src/core/context/`).
3. The API handler streams assistant content; tool uses are parsed from the stream.
4. `ToolExecutorCoordinator` executes tools; hooks may intercept (`src/core/hooks/`).
5. Results append to conversation history on disk (`src/core/storage/disk.ts`).

## MCP

`McpHub` manages server lifecycle, OAuth, and tool/resource routing. MCP tools surface to the agent as `use_mcp_tool` and `access_mcp_resource`. User configuration is stored under the extension global storage MCP directory (see `ensureMcpServersDirectoryExists` in `src/core/storage/disk.ts`).

## Protobuf & code generation

```bash
npm run protos   # node scripts/build-proto.mjs
```

Schemas: `proto/dietcode/`. Output: `src/generated/`, formatted by `postprotos` script.

## Related docs

- [gRPC subscription persistence](grpc-subscription-persistence.md) — why subscriptions broke, idle-timeout bug, runtime architecture
- [Project map](PROJECT_MAP.md)
- [Architecture (current)](architecture/current.md)
- [MCP overview](mcp/mcp-overview.mdx)
