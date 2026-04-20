# Structural Navigation Policy

To maximize efficiency and minimize redundant file scans, all codebase exploration must follow a **Structure First** interaction model via the Spider Engine and BroccoliDB.

## Core Mandates

1.  **Query Before Grep**: Before using `grep_search` or `run_command` (find/grep), you MUST query the structural graph using `scripts/agent-spider.ts`.
2.  **Symbol Registry**: Use `find-symbol <symbol>` to locate the physical definition of symbols (classes, functions, interfaces) across the workspace.
3.  **Dependency Analysis**: Use `deps <file>` to understand the imports and dependents of a module before modifying it.
4.  **Impact Assessment**: Use `blast-radius <file>` to evaluate the architectural risk of a change.
5.  **Persistence Integrity**: Ensure BroccoliDB is seeded (`scripts/agent-spider.ts seed`) at the start of complex tasks to anchor your exploration in a high-fidelity AST graph.

## Tooling: `scripts/agent-spider.ts`

- `seed`: Hydrates BroccoliDB from `git ls-files` and bootstraps the structural graph.
- `status`: Displays graph density, node count, and entropy.
- `find-symbol <name>`: Locates all providers of a specific symbol.
- `deps <file>`: Lists direct dependencies and dependents.
- `blast-radius <file>`: Calculates the downstream impact of structural changes.
