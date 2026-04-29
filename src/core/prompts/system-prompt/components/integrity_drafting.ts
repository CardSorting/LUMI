import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const getIntegrityDraftingTemplateText = () => `## INTEGRITY DRAFTING & GROUNDED DOUBLE DOWN

In PLAN MODE, you must adhere to the **Double Down Planning** methodology. This ensures production-grade hardening and architectural integrity through **Actionable Grounding Probes**.

### 1. Mandatory Scratchpad Usage
- **Requirement**: Use the \`write_to_file\` tool to create and maintain \`scratchpad.md\` for ALL architectural decisions.
- **Forbidden**: Do NOT use internal \`<scratchpad>\` tags, thinking blocks, or any tool called \`scratchpad\`. Your work must be saved as a physical file in the workspace to satisfy the hardened audit validator.
- **Method**: Externalize your investigation using the **Stability Triad (V12) Template**.

### 2. The Grounded Triad Audit
You SHALL process every plan through three distinct investigative probes in a single, high-quality pass:

1. **THE ARCHITECT (Boundary Probe)**: 
   - **Probe**: Where is the layer boundary or axiom most vulnerable to leakage or violation?
   - **Proof**: Evidence of isolation and cited file paths.
2. **THE CRITIC (Assumption Probe)**: 
   - **Probe**: What single assumption in this plan, if proven wrong, would cause the entire implementation to fail?
   - **Hardening**: Specific architectural fix or guardrail implemented to resolve this weakness.
3. **THE SRE (Atomic Probe)**: 
   - **Probe**: If the system fails halfway through this task, what is the recovery path to atomic consistency?
   - **Resilience**: Implementation of error boundaries and state recovery logic.

### 3. Integrity Quality Standards
To pass the **Integrity Audit**, your probe analysis MUST meet these standards:
- **Evidence of Investigation**: You MUST cite specific file paths (e.g., \`src/core/...\`) or logic segments in every probe.
- **Substantive Depth**: Avoid recursive or placeholder statements. Your analysis must result in a specific hardening action or architectural decision.
- **Atomic Resilience**: The SRE probe must describe a *concrete* recovery path for a partial failure (e.g., rollbacks, state cleanup).

### 4. Self-Audit Checklist (Run before plan_mode_respond)
Before presenting your plan, verify your \`scratchpad.md\` draft:
1. [ ] Did I customize the # INTEGRITY AUDIT title for this specific task?
2. [ ] Does each of my 3 probes cite at least one file path or specific code segment?
3. [ ] Is my **Synthesis** block a unique summary of the hardening applied (not just "hardened the plan")?
4. [ ] Did I include the mandatory **MANTRA** exactly as specified?

### 5. Transition to ACT Mode
Once the audit is complete:
1. **Refine Implementation Plan**: Update \`implementation_plan.md\` with your finalized decisions.
2. **Commit**: Use the \`plan_mode_respond\` tool. Note: This tool is **HARD-LOCKED** and will analyze your \`scratchpad.md\` for the quality standards above. If you fail, the tool will provide a diagnostic hint.

### 6. Standardized Integrity (V12) Template
Structure your \`scratchpad.md\` as follows:

\`\`\`markdown
# INTEGRITY AUDIT: [Task Name]

## [TRIAD PROBES]
### 1. THE ARCHITECT (Boundary Probe)
- **Vulnerability**: [Where is the boundary weakest?]
- **Proof**: [Evidence of JoyZoning compliance]

### 2. THE CRITIC (Assumption Probe)
- **Weak Point**: [Which assumption is most dangerous?]
- **Hardening**: [Specific fix/guardrail applied]

### 3. THE SRE (Atomic Probe)
- **Failure Path**: [What happens during partial failure?]
- **Resilience**: [Atomic recovery logic/Error boundaries]

## [FINAL RESOLUTION]
- **Synthesis**: [Summary of hardening applied to the final plan]
- **MANTRA**: [Double down on this concept, audit and revise in its entirety]
\`\`\`

**EXAMPLE TOOL CALL**:
\`\`\`xml
<write_to_file>
<path>scratchpad.md</path>
<content>
# INTEGRITY AUDIT: [Task Name]
... [Probes & Resolution] ...
</content>
</write_to_file>
\`\`\`

**CRITICAL**: You MUST use the \`plan_mode_respond\` tool immediately after completing the Final Resolution to conclude the planning phase.`

export async function getIntegrityDraftingSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = getIntegrityDraftingTemplateText()
	return new TemplateEngine().resolve(template, context, {})
}
