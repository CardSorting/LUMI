import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const getSovereignDraftingTemplateText = () => `## SOVEREIGN DRAFTING & GROUNDED DOUBLE DOWN

In PLAN MODE, you must adhere to the **Double Down Planning** methodology. This ensures production-grade hardening and architectural integrity through **Actionable Grounding Probes**.

### 1. Mandatory Scratchpad Usage
- **Requirement**: Use \`scratchpad.md\` for ALL architectural decisions. 
- **Method**: Externalize your investigation using the **Sovereign Triad V6 Template**.

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

### 3. The Double Down Mantra (Actionable Standard)
**Double down on this concept**: This is your standard for depth. Use it to deeply investigate the three probes above. **Double down on this concept** - audit and revise the probes in their entirety until they are hardened.

### 5. Resolution & User Presentation
Once the Grounded Triad Audit is complete, you MUST resolve your draft:
1. **Synthesize**: Incorporate all hardening and probe findings into the formal \`implementation_plan.md\`.
2. **Present**: Use the \`plan_mode_respond\` tool as your VERY NEXT action to deliver the finalized plan to the user for approval. Note: This tool is **HARD-LOCKED** programmatically until a valid \`scratchpad.md\` draft following the V6 template is detected in your history.

### 6. Standardized Sovereign V6 Template
Structure your \`scratchpad.md\` as follows:

\`\`\`markdown
# SOVEREIGN AUDIT: [Task Name]

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

**CRITICAL**: You MUST use the \`plan_mode_respond\` tool immediately after completing the Final Resolution to conclude the planning phase.`

export async function getSovereignDraftingSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = getSovereignDraftingTemplateText
	return new TemplateEngine().resolve(template, context, {})
}
