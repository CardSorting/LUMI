# System Architecture: Physical Substrate Map

The DietCode system is organized into distinct physical layers that separate high-level agentic reasoning from low-level machine execution. This document maps the `src/` directory to the architectural concepts used in our documentation.

## 🗺️ Physical Directory Map

| Directory | Architectural Role | Description |
| :--- | :--- | :--- |
| **`src/core/`** | **Policy & Reasoning** | The higher-level "Brain." Contains the policy engine, diagnostic auditing, and metabolic monitoring. |
| **`src/domain/`** | **Business Logic** | Pure interfaces and domain models that define the "What" of the application without platform dependencies. |
| **`src/standalone/`** | **Neural Interface (Layer 0)** | The "Headless" substrate. Contains the Protobus/GRPC services and HostBridge client for out-of-process execution. |
| **`src/hosts/`** | **IDE Adapters** | IDE-specific implementations (e.g., VSCode, JetBrains) that connect the core logic to the editor UI. |
| **`src/integrations/`** | **I/O Substrate** | Physical connectors for terminal, task management, and diagnostic propagation. |
| **`src/infrastructure/`** | **External Adapters** | Concrete implementations of domain interfaces (e.g., AI providers, storage, file systems). |
| **`src/generated/`** | **Service Contracts** | Automated code generated from Protobuf/GRPC schemas for inter-process communication. |
| **`broccolidb/`** | **Context Engine** | The underlying high-performance graph library powering cognitive memory. |
| **`src/services/`** | **Utility Layer** | Shared cross-cutting concerns (logging, telemetry, config, tree-sitter sensing). |

---

## 🏗️ The Execution Substrate

### 1. The Headless Core (`src/standalone`)
Unlike traditional extensions, DietCode is built to be **Host-Agnostic**. The logic in `src/standalone` allows the core "Brain" to run as a separate process communicating via the **Protobus** (GRPC).

- **`dietcode-core.ts`**: The main entry point for the standalone server.
- **`protobus-service.ts`**: Implements the GRPC service registry for remote tool execution.

### 2. The Shared State (`src/shared`)
Type definitions and pure logic that are shared across the extension, webview, and standalone CLI to ensure **Axiomatic Consistency**.

### 3. The Forensic Sensing Suite (`src/services/tree-sitter`)
The system uses deep AST analysis powered by **Tree-Sitter** to "see" code. This layer provides the raw structural data that the [Spider Engine](JOYZONING_SOVEREIGNTY_3_0) uses for fingerprinting.

---

## 🧬 Architectural Axioms in the Codebase

- **Layer 0 (HostBridge)**: Managed in `src/standalone`.
- **Layer 1 (Core)**: Managed in `src/core`.
- **Layer 2 (Domain)**: Managed in `src/domain`.
- **Layer 3 (Infrastructure)**: Managed in `src/infrastructure`.

> [!TIP]
> **Industrial Navigation**: When investigating an architectural alarm, trace the signal from the `SovereignGuard` (src/core/policy) down to the `EnvironmentSovereignty` (src/core/integrity) to find the physical root of the violation.
