---
title: "Custom Interceptors (Hooks)"
sidebarTitle: "Custom Interceptors"
description: "Extend DietCode's intelligence with custom scripts that run at every stage of the agentic lifecycle."
---

# Custom Interceptors (Hooks)

DietCode is designed to be **Extensible by Default**. The built-in Hooks system allows you to write custom "Interceptors" in any language (Node, Python, Bash, etc.) to monitor, modify, or block the agent's actions.

## 🔄 The Agentic Lifecycle

You can hook into the following lifecycle stages to enforce policies or inject context:

| Hook | When it runs | Primary Use Case |
| :--- | :--- | :--- |
| **UserPromptSubmit** | Before the AI sees your message | Inject global project rules or context. |
| **PreToolUse** | Before the agent executes a tool | Validate parameters or block unsafe actions. |
| **PostToolUse** | After a tool returns a result | Audit the output or trigger external scripts. |
| **TaskStart/Complete** | At the beginning or end of a task | Generate reports or clean up build artifacts. |
| **PreCompact** | Before context compression | Ensure critical landmarks are preserved. |

## 🛠️ How it Works

DietCode looks for executable scripts in two locations:
1. **Global Hooks**: `~/Documents/DietCode/Hooks/`
2. **Workspace Hooks**: `.dietcoderules/hooks/` within your project root.

### Example: A PreToolUse Interceptor (Bash)

This hook blocks the agent from running `bash` commands if they contain `rm -rf`.

```bash
#!/bin/bash
# .dietcoderules/hooks/PreToolUse.sh

# Read the JSON input from DietCode
read -r INPUT

# Check if the tool is 'bash' and the command is dangerous
COMMAND=$(echo $INPUT | jq -r '.preToolUse.parameters')

if [[ "$COMMAND" == *"rm -rf"* ]]; then
  # Return a cancellation JSON
  echo '{"cancel": true, "errorMessage": "Dangerous command blocked by workspace policy."}'
else
  # Allow the command to continue
  echo '{"cancel": false}'
fi
```

## 🧠 Powerful Integration Patterns

### 1. Enterprise Compliance
Force the agent to follow internal security policies. Automatically block any tool use that attempts to access sensitive environment variables or private keys.

### 2. Dynamic Rule Injection
Use the `UserPromptSubmit` hook to analyze the current workspace state and inject relevant **Workspace Rules** (`.dietcoderules`) only when they are needed, keeping the AI's context window clean and efficient.

### 3. Automated CI/CD Gates
Have a `PostToolUse` hook run your local test suite after the agent edits a file. If the tests fail, the hook can provide the test output back to the agent for immediate self-correction.

---
*DietCode isn't just a tool; it's a platform. Build your own guardrails and supercharge your agentic workflow.*
