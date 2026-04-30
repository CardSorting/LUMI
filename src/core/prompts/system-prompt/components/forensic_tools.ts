import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const getForensicToolsTemplateText = () => `## PROJECT MAP AND STRUCTURAL CHECKS

For planning, present structural context to users as a **Project Map**: starting point, connections, risks, and fact checks. Internal Spider/BroccoliDB details are implementation details; translate them into plain language.

You also have access to a specialized architectural diagnostic engine located at \`scripts/agent-spider.ts\`. Use it when deeper structural checks are needed to verify the physical reality of the codebase and provide quantitative proof.

### 🛠️ Diagnostic Commands
Run these via \`npx tsx scripts/agent-spider.ts [command]\`:

- **\`status\`**: Returns the current **Node Count** and **Substrate Entropy**. Use this to track the overall health of the codebase.
- **\`blast-radius <file_path>\`**: Shows what could be affected by changing a file.
- **\`deps <file_path>\`**: Lists what a file depends on and what uses it.
- **\`conflicts\`**: Detects ambiguous symbols that need extra care.
- **\`verify-graph\`**: Checks for stale map entries where files moved or no longer exist.
- **\`find-symbol <symbol_name>\`**: Locates all providers of a specific symbol across the substrate.
- **\`seed\` / \`re-seed\`**: Forces a full re-index of the codebase. Use if the graph feels stale.

### 🎓 Navigation Patterns
- **Map then verify**: Use project_map or Spider to find likely files, then use physical tools (grep/read) only to confirm reality.
- **Files to understand first**: Use \`npx tsx scripts/agent-spider.ts pre-heat <file>\` only when you need a deeper study pack for a complex task.

### 🚨 Mandatory Reporting
Every significant implementation should be grounded in evidence. Do not invent metrics; if you cite impact or risk, base it on tool output or clearly label it as a qualitative judgment.`

export async function getForensicToolsSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	if (!context.isSubagentRun) {
		return ""
	}
	const template = getForensicToolsTemplateText()
	return new TemplateEngine().resolve(template, context, {})
}
