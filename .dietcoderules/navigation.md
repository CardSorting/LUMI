# Structural Navigation Policy

To maximize efficiency and minimize redundant file scans, all codebase exploration must follow a **Structure First** interaction model via the Spider Engine and BroccoliDB.

## Core Mandates

1.  **Query Before Search**: Before using `grep_search`, `search_web`, or `list_dir`, you MUST query the structural graph using `scripts/agent-spider.ts`. High-fidelity navigation depends on BroccoliDB, not blind string matching.
2.  **Symbol Registry**: Use `find-symbol <symbol>` to locate physical definitions. This is the ONLY reliable way to distinguish between active code and orphaned aliases.
3.  **Dependency Analysis**: Use `deps <file>` to understand the imports and dependents of a module. Never modify a core file without checking its dependents first.
4.  **Impact Assessment**: Use `blast-radius <file>` to evaluate architectural risk.
5.  **Persistence Integrity**: Ensure BroccoliDB is seeded (`scripts/agent-spider.ts seed`) at the start of complex tasks. If the graph feels stale, re-seed.

## Tooling: `scripts/agent-spider.ts`

- `seed`: Hydrates BroccoliDB from `git ls-files` and bootstraps the structural graph. Use `--force-full` for a deep flush.
- `status`: Displays graph density, node count, and entropy.
- `find-symbol <name>`: Locates all providers of a specific symbol.
- `find-usage <symbol>`: Finds all files importing a specific symbol cross-referenced via AST.
- `deps <file>`: Lists direct dependencies and dependents.
- `blast-radius <file>`: Calculates the downstream impact and centrality score.
- `verify-graph`: Internal integrity check to prune "Ghost Nodes".
