@.dietcoderules/general.md
@.dietcoderules/network.md
@.dietcoderules/cli.md
@.dietcoderules/navigation.md

# Structural Navigation Mandate: The Hybrid Anchor
All codebase exploration MUST follow the **Hybrid Anchor** protocol: "Structure First, Forensic Second." 
1. Use **Spider Engine** (`scripts/agent-spider.ts`) to scope your analysis (find symbols, usages, and impact).
2. Use **Grep** (`grep_search`) to verify physical reality on disk within that scope.
3. Use **Seed** to re-align the graph if drift is detected.
Run `npx tsx scripts/agent-spider.ts tutor` to master this interaction pattern.
