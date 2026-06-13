import { isAnthropicModelId } from "@utils/model-utils"
import { getShell } from "@utils/shell"
import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import type { DeepPlanningVariant } from "../types"

/**
 * Creates the Anthropic Claude variant for deep-planning prompt
 * This variant is optimized for Claude models
 */
export function createAnthropicVariant(): DeepPlanningVariant {
	return {
		id: "anthropic",
		description: "Deep-planning variant optimized for Anthropic Claude models",
		family: "anthropic",
		version: 1,
		matcher: (context: SystemPromptContext) => {
			const modelId = context.providerInfo?.model?.id
			if (!modelId) {
				return false
			}
			return isAnthropicModelId(modelId)
		},
		template: generateTemplate(),
	}
}

/**
 * Generates the deep-planning template with shell-specific commands
 */
function generateTemplate(): string {
	const detectedShell = getShell()

	// FIXME: detectedShell returns a non-string value on some Windows machines
	let isPowerShell = false
	try {
		isPowerShell =
			detectedShell != null &&
			typeof detectedShell === "string" &&
			(detectedShell.toLowerCase().includes("powershell") || detectedShell.toLowerCase().includes("pwsh"))
	} catch {}

	return `<explicit_instructions type="deep-planning">
Your task is to create a comprehensive implementation plan before writing any code. This process has five distinct steps that must be completed in order.

Your behavior should be methodical and thorough - take time to understand the codebase completely before making any recommendations. The quality of your investigation directly impacts the success of the implementation.

## STEP 1: Map the project

<important>
until explicitly instructed by the user to proceed with coding.
You must thoroughly understand the existing codebase before proposing any changes.
Perform your research without commentary or narration. Execute commands and read files without explaining what you're about to do. Only speak up if you have specific questions for the user.
</important>

### Required Research Activities
For existing code, start with a **Project Map**. Prefer the \`project_map\` tool when available; use Spider/BroccoliDB commands only as deeper internal checks.
- **Starting point**: Resolve likely files or symbols from the user's request.
- **Connections**: Identify files that import, depend on, use, or often change with the starting point.
- **Risks**: Identify what could be affected, risky hubs, ambiguous symbols, stale map warnings, and files that need extra care.
- **Files to understand first**: Use \`npx tsx scripts/agent-spider.ts pre-heat <file>\` only when a deeper study pack is needed.
- **Context**: Use cognitive memory context where available to find semantically related files.

Use these tools to determine the language(s) used in the codebase, and to identify the domain(s) and layers (Domain, Core, Infrastructure) relevant to the user's request.


## STEP 2: Check the facts

### Required Research Activities
Verify the Project Map with targeted terminal commands and file reads. Use the map's suggested searches and reads first instead of broad exploration.
If the map and disk results diverge, mark the map as stale and run \`npx tsx scripts/agent-spider.ts re-seed\` only when re-indexing is necessary.

You will tailor these commands to explore and identify key functions, classes, methods, types, and variables that are directly, or indirectly related to the task.
These commands must be crafted to not produce exceptionally long or verbose search results. For example, you should exclude dependency folders such as node_modules, venv or php vendor, etc. Carefully consider the scope of search patterns. Use the Project Map to tailor the commands for balanced search result lengths. If a command returns no results, you may loosen the search patterns or scope slightly.

Here are some example commands, remember to adjust them as instructed previously:

${
	isPowerShell
		? // PowerShell-specific commands

			`# Discover project structure and file types
Get-ChildItem -Recurse -Include "*.py","*.js","*.ts","*.java","*.cpp","*.go" | Select-Object -First 30 | Select-Object FullName

# Find all class and function definitions
Get-ChildItem -Recurse -Include "*.py","*.js","*.ts","*.java","*.cpp","*.go" | Select-String -Pattern "class|function|def|interface|struct"

# Analyze import patterns and dependencies
Get-ChildItem -Recurse -Include "*.py","*.js","*.ts","*.java","*.cpp" | Select-String -Pattern "import|from|require|#include" | Sort-Object | Get-Unique

# Find dependency manifests
Get-ChildItem -Recurse -Include "requirements*.txt","package.json","Cargo.toml","pom.xml","Gemfile","go.mod" | Get-Content

# Identify technical debt and TODOs
Get-ChildItem -Recurse -Include "*.py","*.js","*.ts","*.java","*.cpp","*.go" | Select-String -Pattern "TODO|FIXME|XXX|HACK|NOTE"
`
		: // bash/zsh-specific commands
			`# Discover project structure and file types
find . -type f -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.java" -o -name "*.cpp" -o -name "*.go" | head -30 | cat

# Find all class and function definitions
grep -r "class\\|function\\|def\\|interface\\|struct\\|func\\|type.*struct\\|type.*interface" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" --include="*.go" . | cat

# Analyze import patterns and dependencies
grep -r "import\\|from\\|require\\|#include" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" . | sort | uniq | cat

# Find dependency manifests
find . -name "requirements*.txt" -o -name "package.json" -o -name "Cargo.toml" -o -name "pom.xml" -o -name "Gemfile" -o -name "go.mod" | xargs cat

# Identify technical debt and TODOs
grep -r "TODO\\|FIXME\\|XXX\\|HACK\\|NOTE" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" --include="*.go" . | cat
`
}


## STEP 3: Discussion and Questions

Ask the user brief, targeted questions that will influence your implementation plan. Keep your questions concise and conversational. Ask only essential questions needed to create an accurate plan.

**Ask questions only when necessary for:**
- Clarifying ambiguous requirements or specifications
- Choosing between multiple equally valid implementation approaches  
- Confirming assumptions about existing system behavior or constraints
- Understanding preferences for specific technical decisions that will affect the implementation

Your questions should be direct and specific. Avoid long explanations or multiple questions in one response.

## STEP 4: Create Implementation Plan Document

### Grounded review
Before finalizing your plan, you must follow the **Double Down Planning** workflow:
1. **Draft**: Use \`scratchpad.md\` for your investigation. You MUST follow the **Sovereign Triad V8 Template** (Grounding Probes -> Hazard Analysis -> Resolution).
2. **Grounded Audit**: Answer the three investigative probes (Boundary, Assumption, Atomic) in the scratchpad.
3. **Risk analysis**: Explicitly list any risk areas found in Step 1 (high-impact files, hotspots, ambiguous symbols, or cleanup/debt areas) and explain how your plan mitigates them.
4. **Stale-map and impact check**: Verify mapped files still exist, forecast conflicts where available, and use \`npx tsx scripts/agent-spider.ts blast-radius\` when impact needs quantifying.
5. **Draft Resolution**: Synthesize all hardening results into the formal \`implementation_plan.md\`.
6. **User Presentation**: Use the \`plan_mode_respond\` tool as your VERY NEXT action to deliver the finalized plan. The system will automatically transition to ACT MODE for implementation.

Once you have obtained sufficient context to understand all code modifications that will be required, create a structured markdown document containing your complete implementation plan. The document must follow this exact format with clearly marked sections:

### Document Structure Requirements

Your implementation plan must be saved as implementation_plan.md, and *must* be structured as follows:


# Implementation Plan

[Project Map]
Starting point, connected files, risk areas, verified facts, and confidence in plain language.

[Recommended Approach]
The preferred path forward and why it balances safety, scope, and maintainability.

[Choices]
Any meaningful alternatives, such as minimal fix, recommended approach, or larger cleanup/refactor.

[Overview]
Single sentence describing the overall goal.

Multiple paragraphs outlining the scope, context, and high-level approach. Explain why this implementation is needed and how it fits into the existing system.

[Types]  
Single sentence describing the type system changes.

Detailed type definitions, interfaces, enums, or data structures with complete specifications. Include field names, types, validation rules, and relationships.

[Files]
Single sentence describing file modifications.

Detailed breakdown:
- New files to be created (with full paths and purpose)
- Existing files to be modified (with specific changes)  
- Files to be deleted or moved
- Configuration file updates

[Functions]
Single sentence describing function modifications.

Detailed breakdown:
- New functions (name, signature, file path, purpose)
- Modified functions (exact name, current file path, required changes)
- Removed functions (name, file path, reason, migration strategy)

[Classes]
Single sentence describing class modifications.

Detailed breakdown:
- New classes (name, file path, key methods, inheritance)
- Modified classes (exact name, file path, specific modifications)
- Removed classes (name, file path, replacement strategy)

[Dependencies]
Single sentence describing dependency modifications.

Details of new packages, version changes, and integration requirements.

[Testing]
Single sentence describing testing approach.

Test file requirements, existing test modifications, and validation strategies.

[Implementation Order]
Single sentence describing the implementation sequence.

Numbered steps showing the logical order of changes to minimize conflicts and ensure successful integration.


## STEP 5: Create Implementation Task

Use the new_task command to create a task for implementing the plan. The task must include a <task_progress> list that breaks down the implementation into trackable steps.

### Task Creation Requirements

Your new task should be self-contained and reference the plan document rather than requiring additional codebase investigation. Include these specific instructions in the task description:

**Plan Document Navigation Commands:**
The implementation agent should use these commands to read specific sections of the implementation plan. You should adapt these examples to conform to the structure of the .md file you created, and explicitly provide them when creating the new task:

${
	isPowerShell
		? `
# Read Overview section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\\[Overview\\]').LineNumber; $end = ($content | Select-String -Pattern '\\[Types\\]').LineNumber; $content[($start-1)..($end-2)]

# Read Types section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\\[Types\\]').LineNumber; $end = ($content | Select-String -Pattern '\\[Files\\]').LineNumber; $content[($start-1)..($end-2)]

# Read Files section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\\[Files\\]').LineNumber; $end = ($content | Select-String -Pattern '\\[Functions\\]').LineNumber; $content[($start-1)..($end-2)]

# Read Functions section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\\[Functions\\]').LineNumber; $end = ($content | Select-String -Pattern '\\[Classes\\]').LineNumber; $content[($start-1)..($end-2)]

# Read Classes section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\\[Classes\\]').LineNumber; $end = ($content | Select-String -Pattern '\\[Dependencies\\]').LineNumber; $content[($start-1)..($end-2)]

# Read Dependencies section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\\[Dependencies\\]').LineNumber; $end = ($content | Select-String -Pattern '\\[Testing\\]').LineNumber; $content[($start-1)..($end-2)]

# Read Testing section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\\[Testing\\]').LineNumber; $end = ($content | Select-String -Pattern '\\[Implementation Order\\]').LineNumber; $content[($start-1)..($end-2)]

# Read Implementation Order section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\\[Implementation Order\\]').LineNumber; $content[($start-1)..($content.Length-1)]
`
		: `
# Read Overview section
sed -n '/\\[Overview\\]/,/\\[Types\\]/p' implementation_plan.md | head -n 1 | cat

# Read Types section  
sed -n '/\\[Types\\]/,/\\[Files\\]/p' implementation_plan.md | head -n 1 | cat

# Read Files section
sed -n '/\\[Files\\]/,/\\[Functions\\]/p' implementation_plan.md | head -n 1 | cat

# Read Functions section
sed -n '/\\[Functions\\]/,/\\[Classes\\]/p' implementation_plan.md | head -n 1 | cat

# Read Classes section
sed -n '/\\[Classes\\]/,/\\[Dependencies\\]/p' implementation_plan.md | head -n 1 | cat

# Read Dependencies section
sed -n '/\\[Dependencies\\]/,/\\[Testing\\]/p' implementation_plan.md | head -n 1 | cat

# Read Testing section
sed -n '/\\[Testing\\]/,/\\[Implementation Order\\]/p' implementation_plan.md | head -n 1 | cat

# Read Implementation Order section
sed -n '/\\[Implementation Order\\]/,$p' implementation_plan.md | cat
`
}


**Task Progress Format:**
<IMPORTANT>
You absolutely must include the task_progress contents in context when creating the new task. When providing it, do not wrap it in XML tags- instead provide it like this:


task_progress Items:
- [ ] Step 1: Brief description of first implementation step
- [ ] Step 2: Brief description of second implementation step  
- [ ] Step 3: Brief description of third implementation step
- [ ] Step N: Brief description of final implementation step


You also MUST include the path to the markdown file you have created in your new task prompt. You should do this as follows:

Refer to @path/to/file/markdown.md for a complete breakdown of the task requirements and steps. You should periodically read this file again.

{{FOCUS_CHAIN_PARAM}}

{{NEW_TASK_INSTRUCTIONS}}

### Automatic Mode Transition

The system automatically manages plan and act mode. New tasks begin in PLAN MODE. When the implementation task starts, call plan_mode_respond with a brief summary referencing your spec document; the system will automatically transition to ACT MODE for implementation.
</IMPORTANT>

## Quality Standards

You must be specific with exact file paths, function names, and class names. You must be comprehensive and avoid assuming implicit understanding. You must be practical and consider real-world constraints and edge cases. You must use precise technical language and avoid ambiguity.

Your implementation plan should be detailed enough that another developer could execute it without additional investigation.

---

**Execute all five steps in sequence. Your role is to plan thoroughly, not to implement. Code creation begins only after the new task is created and you receive explicit instruction to proceed.**

Below is the user's input when they indicated that they wanted to create a comprehensive implementation plan.
</explicit_instructions>
`
}
