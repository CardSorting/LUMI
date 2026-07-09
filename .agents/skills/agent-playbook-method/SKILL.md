---
name: agent-playbook-method
description: Maintain a workspace-specific Agent Playbook inside the wiki. Use when updating .wiki documentation, preserving agent handoff knowledge, reducing repeated workspace discovery, or recording key findings, troubleshooting, common pitfalls, validation commands, and active development state for future agents.
---

# Agent Playbook Method

Use this skill to keep the workspace wiki useful for future agents, not only human operators.

## Goal

Create or update an agent-first playbook inside `.wiki/agent/` that mirrors the workspace's current development state. The playbook should let the next agent orient quickly without rediscovering the same files, commands, pitfalls, and architectural facts.

## Required Files

Maintain these files when the wiki is in scope:

- `.wiki/agent/playbook.md`: entry point with current snapshot, orientation loop, validation commands, and links.
- `.wiki/agent/agent-memory.md`: strict constraints and durable operating assumptions.
- `.wiki/agent/key-findings.md`: evidence-backed findings worth preserving.
- `.wiki/agent/troubleshooting.md`: reproduced failures, exact commands, fixes, and workarounds.
- `.wiki/agent/common-pitfalls.md`: workspace-specific mistakes and risky assumptions.
- `.wiki/agent/patterns.md`: repeatable workflows for common tasks.
- `.wiki/index.md`: must link the agent playbook files.

## Workflow

1. Inspect current evidence before writing:
   - manifests such as `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `ROADMAP.md`
   - active changed files and recent task scope
   - existing wiki files
   - validation scripts and commands
   - failing command output or diagnostics, if any

2. Update the playbook with current facts:
   - active workspace shape and important directories
   - validated commands and known broken commands
   - key findings future agents should not rediscover
   - troubleshooting paths and common pitfalls
   - risky files or surfaces and what to test after touching them

3. Keep content agent-readable:
   - concise bullets
   - exact paths
   - exact command snippets
   - clear "when touching X, validate Y" guidance

4. Preserve quality:
   - do not paste generic boilerplate
   - do not append endless history
   - replace stale guidance when evidence changes
   - mark uncertainty explicitly when evidence is incomplete
   - keep human-authored wiki content intact when possible

## Completion Check

Before finishing a wiki/playbook task, verify:

- `.wiki/index.md` links every agent playbook file that exists.
- `.wiki/agent/playbook.md` reflects the current workspace state.
- Key findings, troubleshooting, and common pitfalls are evidence-backed.
- Validation commands come from project evidence, not guesses.
