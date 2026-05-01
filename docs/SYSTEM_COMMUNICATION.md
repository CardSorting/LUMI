---
title: "System Communication & API"
sidebarTitle: "Communication"
description: "How DietCode connects to your editor, tools, and local environment."
---

# System Communication & API

DietCode uses a robust, high-performance communication layer to ensure that the AI agent stays perfectly synchronized with your editor. This guide explains the underlying protocols and how they enable fast, reliable interaction.

## 🛰️ The Communication Protocol

DietCode communicates between its core reasoning engine and your IDE (VS Code, JetBrains) using a specialized **IPC (Inter-Process Communication)** protocol.

- **Fast & Responsive**: By running the AI logic in a separate process, we ensure that your editor never freezes, even during intensive code analysis.
- **Bi-directional Sync**: Changes in your editor (like saving a file or running a test) are instantly reported to the agent, while the agent's suggestions are pushed back to your UI in real-time.
- **Type-Safe Messaging**: All communication is strictly typed using **Protocol Buffers (Protobuf)**, ensuring data integrity and preventing errors between the agent and the host.

## 🌉 The Host Bridge

The "Host Bridge" is the layer that translates high-level agent requests into physical actions on your machine:

- **File System Operations**: Reading, writing, and listing files.
- **Terminal Execution**: Spawning shells, running commands, and capturing output.
- **Browser Control**: Launching and interacting with a web browser for UI testing.
- **Editor UI**: Displaying the sidebar, opening diff views, and showing notifications.

## 🛠️ Extending with MCP

DietCode can also communicate with external tools via the **Model Context Protocol (MCP)**. This allows you to connect the agent to:

- **Databases**: Directly query or modify your local or remote DBs.
- **External APIs**: Integrate with services like GitHub, Slack, or Linear.
- **Custom Tools**: Write your own MCP servers to give DietCode unique capabilities.

---
*Built for performance, designed for scale. DietCode's communication layer is the backbone of your AI workflow.*
