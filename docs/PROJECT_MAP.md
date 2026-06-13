---
title: "Project Map & Architecture"
sidebarTitle: "Project Map"
description: "A literal guide to the DietCode codebase structure and how it works."
---

# Project Map & Architecture

DietCode is a modular system designed for transparency and stability. This guide provides a literal map of where the core logic lives and how the different parts of the codebase work together.

## 🗺️ Workspace Overview

The project is organized into several key modules, each with a clear responsibility:

| Directory | Name | Role |
| :--- | :--- | :--- |
| **`src/core/`** | **Orchestration** | The main reasoning engine. It manages the agent's "thinking" loop, executes plans, and monitors task progress. |
| **`src/domain/`** | **Business Logic** | Defines the core rules, standards, and data models that govern how DietCode behaves across all platforms. |
| **`src/services/`** | **Capabilities** | Shared services including AI model communication (LLM providers), prompt generation, and context management. |
| **`src/infrastructure/`** | **Tools & I/O** | The "hands" of the agent. Handles file system access, terminal command execution, and browser automation. |
| **`src/integrations/`** | **Editor Adapters** | Connects the core logic to specific IDEs (VS Code, JetBrains) and handles UI event synchronization. |
| **`src/integrity/`** | **Stability & Policy** | Monitors the system for errors, enforces security policies, and ensures that code changes follow project standards. |
| **`src/types/`** | **Type System** | Central repository for TypeScript definitions used across the entire project. |
| **`webview-ui/`** | **Interface** | The React-based frontend for the DietCode sidebar and interactive panels. |
| **`broccolidb/`** | **Context Store** | A local SQLite database that persists your task history and project-specific knowledge. |

---

## 🏗️ Core Architectural Patterns

### 1. VS Code Extension Core
DietCode's reasoning engine runs inside the VS Code extension and communicates with the webview through the extension host.

### 2. Forensic Code Analysis
To provide accurate suggestions, DietCode uses deep static analysis (powered by Tree-Sitter in `src/services/`). It maps your project's symbols and dependencies in real-time, allowing it to understand the "blast radius" of any suggested change.

### 3. Human-in-the-Loop Safety
Safety is built into the architecture. The **Stability & Policy** layer (`src/integrity/`) intercepts all proposed actions (file edits, shell commands, etc.) and presents them for your approval. No physical change is made to your workspace without your explicit consent.

---

## 🛠️ Key Components

- **The Main Loop**: Located in `src/core/DietCodeController.ts`, this manages the "Observe → Plan → Act" cycle.
- **Tool Registry**: Found in `src/infrastructure/tools/`, this defines the capabilities available to the agent.
- **Provider Adapters**: Managed in `src/services/providers/`, these connect to external AI services like Anthropic, OpenAI, and Google Gemini.

---
*Understanding the codebase is the first step to mastering DietCode. Focus on clarity, build with confidence.*
