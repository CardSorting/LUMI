# Structural Navigation Policy: The Hybrid Anchor

To maximize efficiency and eliminate both blind searching and stale-cache hallucinations, all codebase exploration must follow the **Hybrid Anchor** protocol.

"Grep is Reality. Spider is Context."

## The Hybrid Protocol (The Two-Lock Check)

Whenever you need to locate a symbol, understand a dependency, or assess impact, you MUST follow these three steps:

1.  **Scope (Spider First)**: Use `scripts/agent-spider.ts` to identify the structural scope.
    - `find-symbol <symbol>`: Locate provider files.
    - `find-usage <symbol>`: Identify consumers.
    - `deps <file>`: Understand direct links.
2.  **Verify (Grep Second)**: Once you have a scoped list of files/symbols, use `grep_search` to verify the **Physical Reality** on disk.
    - Confirm the exact method signature.
    - Verify literal string constants.
    - Ensure the graph hasn't drifted from recent edits.
3.  **Align (Re-Seed as Needed)**: If Spider and Grep results diverge (e.g., `find-symbol` says it's in File A, but `grep` doesn't see it), run `scripts/agent-spider.ts re-seed` to perform a deterministic re-alignment of the cache with reality.

## Core Mandates

1.  **Stop Blind Grepping**: Never run `grep_search` on the entire workspace without first attempts to narrow the scope via `agent-spider`.
2.  **Verify Every Symbol**: Never assume a symbol definition is correct based solely on the graph. Always perform the "Two-Lock Check" (Spider scoping + Grep verification).
3.  **Study Before Editing**: Use `pre-heat <file>` to generate a "Study Pack" of relevant context before modifying a core module.

## Tooling: `scripts/agent-spider.ts`

- `seed`: Hydrates BroccoliDB.
- `re-seed`: Deterministic, forced-full alignment (clears AST cache).
- `status`: Displays graph health and entropy (drift score).
- `find-symbol <name>`: Scopes providers of a symbol.
- `find-usage <symbol>`: Scopes consumers via AST-analysis.
- `deps <file>`: Scopes direct architectural links.
- `blast-radius <file>`: Scopes downstream impact of changes.
- `pre-heat <file>`: Generates a prioritized reading list (Study Pack) for a file.
- `conflicts`: Lists ambiguous symbols (naming collisions).
- `tutor`: AI-specific guide for the Hybrid Anchor protocol.
