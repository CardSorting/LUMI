---
title: "Codebase Standards & Rules"
sidebarTitle: "Codebase Standards"
description: "Guidelines for maintaining a clean, consistent, and AI-friendly codebase."
---

# Codebase Standards & Rules

DietCode works best when your project follows consistent patterns. This guide outlines the standards we use to ensure that the AI agent can navigate and modify your code safely and effectively.

## 📐 Project Layering

We follow a modular architecture to prevent complexity from spiraling out of control. Every file should have a clear home:

1.  **Core (`src/core`)**: Orchestration logic and the main agent loop.
2.  **Domain (`src/domain`)**: Pure interfaces and models. No external dependencies.
3.  **Services (`src/services`)**: Business logic and capabilities (AI, Analysis).
4.  **Infrastructure (`src/infrastructure`)**: Concrete adapters for files, terminal, and browser.
5.  **Interface (`webview-ui`)**: User-facing React components.

### 🚫 Dependency Rules
- **Outside-In only**: Infrastructure can import from Domain, but Domain cannot import from Infrastructure.
- **No Circular Imports**: Files should not depend on each other in a loop.
- **Single Responsibility**: Each module should do one thing well.

## 🤖 AI-Friendly Patterns

To help DietCode understand your intent, follow these best practices:

- **Type Safety**: Use TypeScript interfaces for everything. Avoid `any`.
- **Descriptive Names**: Variable and function names should explain what they do without needing comments.
- **Module Size**: Keep files under 1500 lines. If a file gets larger, refactor it into smaller sub-modules.
- **Documentation**: Use JSDoc comments for complex business logic.

## 🛡️ Enforcing Standards

DietCode automatically checks your code against these standards during every task:

- **`.dietcoderules`**: You can define custom project rules in this file. DietCode will read them and ensure all suggestions comply.
- **Linter Integration**: DietCode respects your existing `eslint` or `biome` configurations.
- **Review Loop**: If the agent proposes a change that violates a standard, it will flag it during the review step.

---
*Consistency is the key to collaboration. Build a project that both humans and AI love to work in.*
