---
title: "User Interface Design"
sidebarTitle: "UI Design"
description: "Guidelines and patterns for the DietCode interactive experience."
---

# User Interface Design

The DietCode interface is designed to be helpful, transparent, and non-intrusive. This guide explains our UI philosophy and the patterns we use to create a seamless experience for developers.

## 🎨 UI Philosophy

- **Transparency First**: Always show what the agent is doing, thinking, and proposing. No hidden actions.
- **Control over Automation**: Every destructive or physical action (like a file edit) must be clearly presented for user approval.
- **Minimal Cognitive Load**: Use clear icons, concise language, and familiar patterns to make the agent's work easy to scan and audit.
- **Responsive & Fluid**: The interface should feel like a natural extension of your editor, with zero latency and smooth transitions.

## 🏗️ Core Components

The DietCode UI (located in `webview-ui/`) is built using **React** and **Vanilla CSS**, focusing on these key areas:

- **The Activity Stream**: A chronological log of every action, thought, and tool call.
- **The Proposal Card**: A high-visibility card that appears when the agent wants to modify a file or run a command. It includes a "Compare" button to see a diff.
- **The Context Bar**: Shows the current model, credit balance, and project health at a glance.
- **The Settings Panel**: Allows you to configure providers, rules, and advanced agent behaviors.

## 🧩 Extension & Customization

The UI can be extended to support new workflows:

- **Custom Tool Views**: If you add a new tool via MCP, DietCode can render custom interactive components for that tool.
- **Theme Support**: The UI automatically follows your IDE's theme (Dark/Light/High Contrast) for a consistent look and feel.

---
*Design is not just how it looks, but how it works with you. DietCode is built to be your most reliable pair programmer.*
