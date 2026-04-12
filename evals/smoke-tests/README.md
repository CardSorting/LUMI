# CodeMarie Smoke Tests

> [!NOTE]
> Smoke tests are a critical part of our CI/CD pipeline, ensuring that CodeMarie's agentic capabilities remain reliable across different LLM providers and model updates.

## Overview

CodeMarie is an advanced AI coding assistant that can use the **CLI** and **Editor** to handle complex software development tasks. Unlike traditional AI scripts that run in sandboxed environments, CodeMarie provides a human-in-the-loop GUI to approve file changes and terminal commands.

The **Smoke Tests** are a suite of automated evaluations designed to verify the core functionality of the CodeMarie CLI. They focus on:
- **Tool Execution**: Verifying `write_to_file`, `replace_in_file`, `read_file`, etc.
- **Provider Reliability**: Ensuring consistent behavior across Anthropic, OpenAI, Gemini, and others.
- **Reasoning & Planning**: Validating that the model can chain multiple tools to solve multi-step tasks.
- **Regressions**: Catching breaking changes in prompt engineering or response parsing.

## Quick Start

To run smoke tests locally, follow these steps:

### 1. Build the CLI
Ensure you have the latest version of the CLI built and linked:
```bash
npm run eval:smoke:build
```

### 2. Configure Authentication
If you haven't already, authenticate with your preferred provider:
```bash
codemarie auth
```
*Note: For CI or non-interactive use, see the [Authentication](#authentication) section.*

### 3. Run the Tests
Run the full suite (3 trials per scenario by default):
```bash
npm run eval:smoke
```

## Command Reference

| Command | Description |
|---------|-------------|
| `npm run eval:smoke` | Build the CLI and run all tests (3 trials). |
| `npm run eval:smoke:run` | Run tests using the already installed CLI. |
| `npm run eval:smoke:build` | Rebuild and link the CLI from source. |
| `npm run eval:smoke:ci` | Optimized for CI: 1 trial, parallel execution. |

### Options & Flags

You can pass arguments to the test runner using `--`:

```bash
# Run a specific scenario
npm run eval:smoke:run -- --scenario 01-create-file

# Change the number of trials (default: 3)
npm run eval:smoke:run -- --trials 5

# Override the model for all tests
npm run eval:smoke:run -- --model openai/gpt-4o

# Run tests in parallel (default limit: 4)
npm run eval:smoke:run -- --parallel --parallelLimit 8
```

## Metrics & Reliability

We use specific metrics to measure model performance and reliability:

- **pass@k**: The probability that at least one of `k` trials succeeds. This measures the model's *potential* to solve the task.
- **pass^k**: The probability that *all* `k` trials succeed. This measures the model's *consistency* and reliability.
- **Flakiness Score**: Calculated based on the variance between trials in a single scenario.

The test runner will display `pass@1` for single-trial runs and `pass@3` for standard runs.

## Scenarios

Scenarios are defined in the `scenarios/` directory. Each scenario consists of:
- `config.json`: Defines the prompt, expected outcomes, and timeouts.
- `template/` (Optional): A directory containing initial files for the workspace.

### Core Scenarios

| ID | Name | Focus |
|----|------|-------|
| `01-create-file` | Create File | Basic `write_to_file` usage. |
| `02-edit-file` | Edit File | Complex edits with `replace_in_file`. |
| `03-read-summarize`| Read & Context | Efficiently reading and synthesizing file content. |
| `05-typescript` | Code Gen | Generating valid, lint-free TypeScript code. |
| `06-apply-patch` | Native Tools | Testing native tool-calling capabilities (GPT-5/Claude 4). |

## Adding New Scenarios

To add a new smoke test:

1. Create a new folder in `evals/smoke-tests/scenarios/`.
2. Add a `config.json` file:
```json
{
  "name": "Feature Description",
  "description": "What is being tested",
  "prompt": "The specific task for CodeMarie",
  "expectedFiles": ["output.js"],
  "expectedContent": [
    { "file": "output.js", "contains": "export function" }
  ],
  "timeout": 120
}
```
3. Run your new scenario:
```bash
npm run eval:smoke:run -- --scenario your-scenario-name
```

## CI/CD Integration

Smoke tests run automatically on every Pull Request and Push to `main`. Results are posted as a summary in the GitHub Action run.

### Required Secrets
- `CODEMARIE_API_KEY`: Required for the default provider in CI.
- `CLINE_API_KEY`: Fallback key used in legacy environments.

## Troubleshooting

- **CLI Not Found**: Ensure you ran `npm run eval:smoke:build` to link the binary.
- **Authentication Failures**: Check that your API keys are set in `.env` or passed via `codemarie auth`.
- **Timeouts**: Some complex scenarios might require more time. Increase the `timeout` in `config.json`.
