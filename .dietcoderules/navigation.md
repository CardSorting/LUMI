# Structural Navigation Policy: The Hybrid Anchor (V8: Sovereign Audit)

To maximize efficiency and eliminate both blind searching and technical debt, all codebase exploration must follow the **Hybrid Anchor** protocol.

"Grep is Reality. Spider is Context. Forensic is Hardening."

## The Hybrid Protocol (V8 Sequence)

Whenever you need to locate a symbol, understand a dependency, or assess impact, you MUST follow these steps in sequence:

1.  **SCOPE (Spectral Scoping)**: Use \`scripts/agent-spider.ts\` and **BroccoliDB** to identify the structural and semantic scope.
    - \`find-symbol <symbol>\` / \`find-usage <symbol>\`: Structural mapping.
    - \`broccolidb_semantic_search\`: Semantic discovery for logically related concepts.
2.  **AUDIT (Forensic Analysis)**: Identify architectural hazards before proposing changes.
    - \`audit\`: Global violation sensing (circular deps, layer leaks).
    - \`bridges\`: Identify Single Points of Failure.
    - \`hotspots\`: Detect high-hazard files with toxic churn.
    - \`debt\`: Identify implicit interfaces and logic clones.
3.  **VERIFY (Physical Verification)**: Anchor the structural findings in physical reality.
    - \`grep_search\` / \`read_file\`: Confirm signatures, constants, and disk state.
    - **Constraint**: DO NOT read more than 5 files without running a Spectral Scope first.
4.  **FORECAST (Ghost Grounding)**: Quantify impact before implementation.
    - \`broccolidb_simulate_merge\`: Forecast conflicts and logic clashes.
    - \`blast-radius <file>\`: Quantify the architectural reach of the change.
5.  **ALIGN (Re-Seed)**: If Spider and Grep diverge, run \`scripts/agent-spider.ts re-seed\` to re-align the substrate.

## Core Mandates

1.  **Stop Blind Grepping**: Never run \`grep_search\` on the entire workspace without first narrowing the scope via \`agent-spider\`.
2.  **Verify Every Symbol**: Never assume a symbol definition is correct based solely on the graph. Always perform the "Two-Lock Check" (Spider scoping + Grep verification).
3.  **Audit Before Editing**: Run \`hotspots\` or \`bridges\` before modifying any core module to understand the hazard level.
4.  **Study Pack Protocol**: Use \`pre-heat <file>\` to generate a prioritized reading list before making complex changes.

## Tooling: \`scripts/agent-spider.ts\`

- \`status\`: Displays graph health and entropy.
- \`audit\`: Global architectural audit (violations, deadwood).
- \`bridges\`: Detects single points of failure.
- \`hotspots\`: Detects high-hazard modules.
- \`debt\`: Detects structural debt (clones, implicit interfaces).
- \`find-symbol <name>\` / \`find-usage <symbol>\`: Structural scoping.
- \`blast-radius <file>\`: Impact forecasting.
- \`pre-heat <file>\`: Generates a Study Pack for context mastery.
- \`tutor\`: AI-specific guide for the V8 protocol.
