# HostBridge & Protobus: The Neural Interface

The **HostBridge** and **Protobus** layers form the "Neural Interface" (Layer 0) of the DietCode substrate. They enable the core reasoning engine to communicate with diverse machine environments (VSCode, CLI, Terminal) through a high-performance, environment-agnostic GRPC protocol.

## 🛰️ Protobus Overview

The Protobus is a centralized communication bus that manages all agentic interactions. It uses **GRPC (HTTP/2)** to provide low-latency, streaming-capable connectivity between the DietCode Core and its Host.

### Key Specifications
- **Default Port**: `26040` (configurable via `PROTOBUS_ADDRESS`).
- **Protocol**: GRPC over TCP (Insecure for local IPC).
- **Service Registry**: Auto-generated from `.proto` schemas in `src/generated`.

## 🏗️ The HostBridge Client

The `HostBridgeClient` (`src/standalone/hostbridge-client.ts`) is the primary adapter used by the standalone core to interact with the host. It provides the following industrial capabilities:

1.  **Environment Agnosticism**: Standardizes interaction regardless of whether the host is a VSCode extension host or a remote server.
2.  **Streaming Response Handlers**: Uses the `wrapStreamingResponseHandler` to pipe real-time tool logs and reasoning chains to the UI without blocking.
3.  **Request-ID Tracing**: Every Protobus call is tagged with a `request-id` header to enable high-fidelity forensic logging and audit trails.

## 🧬 Service Layers

The Protobus exposes several industrial services that map 1:1 to the internal toolchain:

- **`dietcode.v1.FileService`**: Low-level AST-aware file operations (read, write, audit).
- **`dietcode.v1.TerminalService`**: Direct machine-anchored terminal execution.
- **`dietcode.v1.PolicyService`**: Real-time validation against the [Fluid Policy Engine](ARCHITECTURAL_ENFORCEMENT_HARDENING).
- **`grpc.health.v1.Health`**: Standardized health check implementation for substrate readiness probes.

## 🛠️ Developer Protocol

When extending the substrate, developers interact with the Protobus through standardized wrappers:

### `wrapHandler`
Converts Promise-based internal logic into GRPC-compatible unary callbacks. This ensures that core reasoning remains clean and async-native while the protocol layer handles the RPC plumbing.

### `wrapStreamingResponseHandler`
The "Industrial Heartbeat" of the system. It manages long-running tool executions, ensuring that the host receives a continuous stream of events (e.g., `ToolCalling` -> `ToolResponse` -> `AuditComplete`).

---

## 🔍 Forensic Debugging
To debug Protobus communication, enable full industrial logging in your environment:
```bash
export DIETCODE_LOG_LEVEL=debug
export GRPC_VERBOSITY=debug
```
Detailed Protobus requests will be logged to the industrial log stream with the `[ProtoBus]` prefix.
