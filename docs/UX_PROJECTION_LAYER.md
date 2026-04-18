# UI Projection Layer: Webview Architecture

The DietCode UI is implemented as a high-performance **Projection Layer** that visualizes the state of the underlying industrial substrate. It is built using modern web standards to ensure a high-velocity, responsive developer experience.

## 🎨 Tech Stack

The projection layer operates in a sandboxed VSCode Webview environment using the following stack:

- **Framework**: [React](https://react.dev/) (Functional components with Hooks).
- **Bundler**: [Vite](https://vitejs.dev/) for ultra-fast HMR and building.
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) for axiomatic design consistency.
- **Language**: TypeScript (Strongly typed state and props).

---

## 📡 Projection Protocol (Bridge)

Connectivity between the Extension Core and the UI is managed by a bi-directional JSON-RPC message bus.

### 1. Extension -> UI (Push)
The Core pushes state updates and logs to the UI using the `webview.postMessage` API.
- **Message Type**: `ActionResponse`
- **State Sync**: The entire `DietCodeProviderState` is synchronized whenever the [StateManager](SYSTEM_ARCHITECTURE) detects a change in the forensic substrate.

### 2. UI -> Extension (Request)
The UI requests actions (e.g., starting a task, approving a tool) via the `vscode.postMessage` API.
- **Pattern**: `postMessage({ command: 'actionName', text: '...' })`.
- **Handling**: These messages are captured by the `DietCodeProvider` in the extension logic and routed to the corresponding core services.

---

## 🏗️ UI Physical Structure

| Directory | Role | Description |
| :--- | :--- | :--- |
| **`webview-ui/src/components`** | **Visual Atoms** | Fragmented UI components (buttons, panels, terminal logs). |
| **`webview-ui/src/context`** | **State Management** | React Contexts for global UI state (Theme, Task History, Provider Info). |
| **`webview-ui/src/styles`** | **Aesthetic Tokens** | Global Tailwind styles and custom industrial CSS animations. |
| **`webview-ui/src/hooks`** | **Reactive Logic** | Specialized hooks for handling the VSCode message bus (`useVsCodeApi`). |

---

## 🧬 Industrial UX Axioms

- **Axiom of Transparency**: Always visualize the "Forensic Breadcrumbs"—the raw tool calls and command outputs that inform the agent's reasoning.
- **Axiom of Response**: Every agentic action must trigger a visual state change in the projection layer within <100ms.
- **Axiom of Sovereignty**: UI state must be ultimately driven by the [High-Velocity Substrate](SOVEREIGN_GUIDE); the UI is a mirror, not the data source.

---

## 🛠️ Developer Workflow

To develop the UI projection layer locally:
1.  Navigate to `webview-ui/`.
2.  Run `npm install`.
3.  Run `npm run dev` to start the Vite HMR server.
4.  Launch the VSCode Extension in "Development" mode.

> [!TIP]
> **Tailwind Tokens**: Use the predefined industrial palette (e.g., `text-pale-yellow`, `bg-deep-ink`) to ensure that all new components respect the DietCode aesthetic hardening.
