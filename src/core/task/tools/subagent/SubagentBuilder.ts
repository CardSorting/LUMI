import { buildApiHandler } from "@core/api"
import { PromptRegistry } from "@core/prompts/system-prompt"
import { DietCodeToolSet } from "@core/prompts/system-prompt/registry/DietCodeToolSet"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { DietCodeDefaultTool } from "@shared/tools"
import { ApiConfiguration, ApiProvider } from "@/shared/api"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import type { TaskConfig } from "../types/TaskConfig"
import type { AgentBaseConfig } from "./AgentConfigLoader"
import { AgentConfigLoader } from "./AgentConfigLoader"

export type AgentConfig = Partial<AgentBaseConfig>

export const SUBAGENT_DEFAULT_ALLOWED_TOOLS: DietCodeDefaultTool[] = [
	DietCodeDefaultTool.FILE_READ,
	DietCodeDefaultTool.FILE_EDIT,
	DietCodeDefaultTool.FILE_NEW,
	DietCodeDefaultTool.LIST_FILES,
	DietCodeDefaultTool.SEARCH,
	DietCodeDefaultTool.LIST_CODE_DEF,
	DietCodeDefaultTool.BASH,
	DietCodeDefaultTool.USE_SKILL,
	DietCodeDefaultTool.ATTEMPT,
	DietCodeDefaultTool.MCP_USE,
	DietCodeDefaultTool.MCP_ACCESS,
	DietCodeDefaultTool.MEM_REFRESH,
	DietCodeDefaultTool.SOVEREIGN_DIAGNOSE,
	DietCodeDefaultTool.SOVEREIGN_SWEEP,
]

// Peer-Review & Consensus loops
const CONSENSUS_PROTO = `
### SWARM CONSENSUS PROTOCOL
If you are performing a critical or complex modification, you SHOULD request a peer review before finalizing:
1. Use the 'use_subagents' tool with a 'Verifier' profile.
2. Provide the 'Verifier' with your proposed changes and the original objective.
3. If the 'Verifier' identifies issues, address them before calling 'attempt_completion'.
4. Signal consensus by including 'SIGNAL: CONSENSUS_REACHED' in your final report.
`

const AUTONOMOUS_NUDGE_PROTO = `
AUTONOMOUS NUDGE: If you sense "Context Uncertainty" (ambiguous requirements or inability to ground your task), invoke the 'mem_refresh' tool or explicitly request a "Grounded Specification Refresh" from the parent in your result.
`

const STRUCTURED_SIGNALING_PROTO = `
STRUCTURED SIGNALING: When signaling critical findings or final results, use structured markers [SIGNAL: ARCHITECTURE_VIOLATION] or [SIGNAL: SECURITY_RISK] followed by detailed JSON metadata if possible.
`

const FORENSIC_AXIOMS = `
### FORENSIC HARDENING AXIOMS
1. DOCUMENTATION IS CODE: Every technical change must be mirrored in the Knowledge Ledger (.wiki/).
2. THE OMNI-BRIDGE RULE: Documentation MUST guarantee maximum success for humans and agents by explicitly defining constraints, schemas, and implementation patterns.
3. HIERARCHICAL TAXONOMY: You MUST organize the wiki into strict subdirectories (\`onboarding/\`, \`architecture/\`, \`agent/\`). Do NOT dump files in the root.
4. DECISIONS & RISK MAPPING: You MUST document the "Why" (ADRs) behind architectural choices and map the blast radius/risk of fragile systems.
5. ENVIRONMENTAL PARITY: Always provide self-verification commands to ensure a contributor's environment is fully configured.
6. VISUAL CLARITY: Use Mermaid diagrams (\`mermaid\` blocks) to visualize complex structural relationships or state logic.
7. ENVIRONMENTAL REALITY: Document what the workspace IS (structure, tech stack, gravity centers), not just what changed in git.
8. PHYSICAL VERIFICATION RULE: You MUST cite the relative paths of ALL modified files in your documentation.
9. METABOLIC CITATIONS GAUGE: Documentation depth MUST be proportional to the file's churn. Complex changes REQUIRE granular logic/structural records.
10. ZERO HALLUCINATION: Citations must be grounded in actual file reads and Spider Engine diagnostics.
11. ANTI-STALL: Avoid reading massive git logs. Use structural tools for context.
12. STRUCTURAL SYNC: Verify that all internal wiki links are valid and that index.md is current.
`

export const SUBAGENT_SYSTEM_SUFFIX = `
${AUTONOMOUS_NUDGE_PROTO}
${STRUCTURED_SIGNALING_PROTO}
${CONSENSUS_PROTO}
${FORENSIC_AXIOMS}

Standardized Swarm Reporting:
1. RESEARCH MANDATE: Every file you explore MUST be identified by its architectural layer (Domain, Core, Infrastructure, UI, or Plumbing). 
2. DOMAIN-FIRST: Prioritize understanding the Domain layer before exploring implementation details in Infrastructure or UI.
3. REPORTING MANDATE: In your final 'attempt_completion' result, you MUST provide a "JoyZoning Alignment" section, categorizing your findings by their respective layers and evaluating their "Architectural Suitability" (e.g., is the logic appearing in the right zone?).
4. DEPENDENCY RULE: Ensure your recommendations respect the "Outside-In" dependency rule (Infrastructure/UI -> Core -> Domain).
5. SWARM IDENTITY: You are part of a collective swarm. Value inherited context as foundational truth, but adjust dynamically based on your specialized research.
6. SHARED KNOWLEDGE: Proactively signal critical findings (hotspots, violations) via your result messages to inform the broader swarm.
7. AUTONOMOUS NUDGE: If you sense "Context Uncertainty" (ambiguous requirements or inability to ground your task), invoke the 'mem_refresh' tool or explicitly request a "Grounded Specification Refresh" from the parent in your result.
8. STRUCTURED SIGNALING: When signaling critical findings or final results, use structured markers [SIGNAL: ARCHITECTURE_VIOLATION] or [SIGNAL: SECURITY_RISK] followed by detailed JSON metadata if possible.
`

export class SubagentBuilder {
	private readonly agentConfig: AgentConfig = {}
	private allowedTools: DietCodeDefaultTool[]
	private readonly apiHandler: ReturnType<typeof buildApiHandler>
	private parentStreamContext: string | null = null

	constructor(
		private readonly baseConfig: TaskConfig,
		subagentName?: string,
	) {
		const subagentConfig = AgentConfigLoader.getInstance().getCachedConfig(subagentName)
		this.agentConfig = subagentConfig ?? {}
		this.allowedTools = this.resolveAllowedTools(this.agentConfig.tools)

		const mode = this.baseConfig.services.stateManager.getGlobalSettingsKey("mode")
		const apiConfiguration = this.baseConfig.services.stateManager.getApiConfiguration()
		const effectiveApiConfiguration = {
			...apiConfiguration,
			ulid: this.baseConfig.ulid,
		}

		this.applyModelOverride(effectiveApiConfiguration as Record<string, unknown>, mode, this.agentConfig.modelId)
		this.apiHandler = buildApiHandler(effectiveApiConfiguration as typeof apiConfiguration, mode)
	}

	setAllowedTools(tools: DietCodeDefaultTool[]): void {
		this.allowedTools = Array.from(new Set([...tools, DietCodeDefaultTool.ATTEMPT]))
	}

	getApiHandler(): ReturnType<typeof buildApiHandler> {
		return this.apiHandler
	}

	setParentStreamContext(context: string): void {
		this.parentStreamContext = context
	}

	getAllowedTools(): DietCodeDefaultTool[] {
		return this.allowedTools
	}

	getConfiguredSkills(): string[] | undefined {
		return this.agentConfig.skills
	}

	buildSystemPrompt(generatedSystemPrompt: string): string {
		const configuredSystemPrompt = this.agentConfig?.systemPrompt?.trim()
		const systemPrompt = configuredSystemPrompt || generatedSystemPrompt

		// 1. Fetch current structural health signal
		let architectureSignal = ""
		architectureSignal = `\n\n# SUBSTRATE HEALTH SIGNAL\n[STATUS: JOY-ZONED]\n[SIGNAL: Every file you modify must respect the architecture axioms defined in 'SOVEREIGN_GUIDE.md'.]`

		const parentContextBlock = this.parentStreamContext
			? `\n\n# Parent Agent Context\n${this.parentStreamContext}\nUse the context above to prioritize your research within the broader task goals.`
			: ""

		return `${this.buildAgentIdentitySystemPrefix()}${systemPrompt}${architectureSignal}${parentContextBlock}${SUBAGENT_SYSTEM_SUFFIX}`
	}

	buildNativeTools(context: SystemPromptContext) {
		const family = PromptRegistry.getInstance().getModelFamily(context)
		const toolSets = DietCodeToolSet.getToolsForVariantWithFallback(family, this.allowedTools)
		const filteredToolSpecs = toolSets
			.map((toolSet) => toolSet.config)
			.filter(
				(toolSpec) =>
					this.allowedTools.includes(toolSpec.id) &&
					(!toolSpec.contextRequirements || toolSpec.contextRequirements(context)),
			)

		const converter = DietCodeToolSet.getNativeConverter(context.providerInfo.providerId, context.providerInfo.model.id)
		return filteredToolSpecs.map((tool) => converter(tool, context))
	}

	private resolveAllowedTools(configuredTools?: DietCodeDefaultTool[]): DietCodeDefaultTool[] {
		const sourceTools = configuredTools && configuredTools.length > 0 ? configuredTools : SUBAGENT_DEFAULT_ALLOWED_TOOLS
		return Array.from(new Set([...sourceTools, DietCodeDefaultTool.ATTEMPT]))
	}

	private buildAgentIdentitySystemPrefix(): string {
		const name = this.agentConfig?.name?.trim()
		const description = this.agentConfig?.description?.trim()

		if (!name && !description) {
			return ""
		}

		const lines = ["# AGENT PROFILE"]
		if (name) {
			lines.push(`Identity: ${name}`)
		}
		if (description) {
			lines.push(`Objective: ${description}`)
		}

		return `${lines.join("\n")}\n\n`
	}

	private applyModelOverride(apiConfiguration: ApiConfiguration, _mode: string, modelId?: string): void {
		const trimmedModelId = modelId?.trim()
		if (!trimmedModelId) {
			// Even if no modelId is overridden, we still apply the thinking budget for subagents
			this.applyThinkingBudgetOverride(apiConfiguration)
			return
		}

		const modeKey = _mode === "plan" ? "plan" : "act"
		const providerKey = _mode === "plan" ? "planModeApiProvider" : "actModeApiProvider"
		const provider = apiConfiguration[providerKey as keyof ApiConfiguration] as ApiProvider
		if (provider) {
			const modelKey = getProviderModelIdKey(provider, modeKey)
			const config = apiConfiguration as Record<string, unknown>
			if (modelKey in config) {
				config[modelKey] = trimmedModelId
			}
		}

		// Apply thinking budget after model override
		this.applyThinkingBudgetOverride(apiConfiguration)
	}

	/**
	 * Applies a reduced thinking budget for subagents by default.
	 * Subagents often perform well with lower thinking budgets than parent agents.
	 * The budget is capped to 8k tokens unless explicitly overridden to a higher value.
	 * @param apiConfig The API configuration object.
	 */
	private applyThinkingBudgetOverride(apiConfig: ApiConfiguration): void {
		// Phase 3: Adaptive Thinking Budget Delegation
		// Subagents reach high performance with lower thinking budgets than parents.
		// We cap it to 8k by default for subagents unless explicitly overridden.
		const subagentDefaultThinkingBudget = 8192

		// If thinkingBudgetTokens is already set, we take the minimum of the current value and the subagent default.
		// This allows a parent to explicitly set a lower budget, but prevents a subagent from using a higher default.
		const config = apiConfig as Record<string, unknown>
		if (config.thinkingBudgetTokens !== undefined && config.thinkingBudgetTokens !== null) {
			config.thinkingBudgetTokens = Math.min(config.thinkingBudgetTokens as number, subagentDefaultThinkingBudget)
		} else {
			// If thinkingBudgetTokens is not set, we apply the subagent default.
			config.thinkingBudgetTokens = subagentDefaultThinkingBudget
		}
	}
}
