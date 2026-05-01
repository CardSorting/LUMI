---
title: "Security & Best Practices"
sidebarTitle: "Security"
description: "How DietCode protects your code and data while ensuring safe automation."
---

# Security & Best Practices

Security is at the heart of DietCode. Because the agent has the power to read and modify your codebase, we have implemented multiple layers of protection to ensure that you are always in control.

## 🛡️ Our Security Model

### 1. Zero-Trust Architecture
Your code never touches our servers. DietCode runs entirely client-side on your machine. It communicates directly with your chosen AI provider (e.g., Anthropic, OpenAI) using your own API keys or tokens.

### 2. Human-in-the-Loop Approval
DietCode cannot perform any "physical" action on your workspace without your explicit consent. This includes:
- Writing or editing files.
- Running terminal commands.
- Launching or interacting with a browser.
- Making external API calls via MCP.

### 3. Secure Credential Management
Your API keys and OAuth tokens are stored in your operating system's native secure storage (e.g., macOS Keychain, Windows Credential Manager). They are never logged, exported, or shared.

## 💡 Best Practices for Safe Use

To get the most out of DietCode while staying secure, we recommend these practices:

- **Use `.dietcodeignore`**: Create a `.dietcodeignore` file in your root to hide sensitive files (like `.env`, `.ssh`, or database backups) from the agent.
- **Review Every Diff**: Before clicking "Approve," use the built-in diff viewer to see exactly what the agent changed.
- **Set Spending Limits**: Use your provider's dashboard to set usage limits and prevent unexpected costs.
- **Restrict Shell Commands**: If you are working in a sensitive environment, you can configure DietCode to ask for permission for *all* terminal commands, or restrict it to "Read-Only" mode.

---
*Safety is not a feature; it's the foundation. DietCode gives you the power of AI with the security of total control.*
