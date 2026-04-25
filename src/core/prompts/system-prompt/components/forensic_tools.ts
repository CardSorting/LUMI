import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const getForensicToolsTemplateText = () => `## FORENSIC SUBSTRATE: SPIDER ENGINE V210

You have access to a specialized architectural diagnostic engine located at \`scripts/agent-spider.ts\`. This tool MUST be used to verify the physical reality of the codebase and provide quantitative proof for the Knowledge Ledger.

### 🛠️ Diagnostic Commands
Run these via \`npx tsx scripts/agent-spider.ts [command]\`:

- **\`status\`**: Returns the current **Node Count** and **Substrate Entropy**. Use this to track the overall health of the codebase.
- **\`blast-radius <file_path>\`**: Calculates the **Centrality Score** and list of **Affected Nodes** for a specific file. Use this for all structural changes.
- **\`deps <file_path>\`**: Lists all **Dependencies** (Imports) and **Dependents** (Incoming links). Essential for Mermaid diagram generation.
- **\`conflicts\`**: Detects **Structural Conflicts** (Ambiguous symbols). Use this to calculate the **Axiomatic Purity Index (API)**.
- **\`verify-graph\`**: Audits the graph for **Ghost Nodes** (stale references).
- **\`find-symbol <symbol_name>\`**: Locates all providers of a specific symbol across the substrate.
- **\`seed\` / \`re-seed\`**: Forces a full re-index of the codebase. Use if the graph feels stale.

### 🎓 Navigation Patterns
- **The Hybrid Anchor**: Use Spider to find symbols/usages, then use physical tools (Grep/Read) to confirm reality.
- **Pre-Heat**: Use \`npx tsx scripts/agent-spider.ts pre-heat <file>\` to get a "Study Pack" of related files before starting a complex task.

### 🚨 Mandatory Reporting
Every significant implementation MUST be preceded or followed by a Forensic Audit using these tools. Hallucinating metrics is a violation of the Sovereign Protocol.`

export async function getForensicToolsSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	if (!context.isSubagentRun) {
		return ""
	}
	const template = getForensicToolsTemplateText()
	return new TemplateEngine().resolve(template, context, {})
}
