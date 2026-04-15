/**
 * [LAYER: CORE]
 *
 * PlanModeEnforcer: Enforces SOVEREIGN DRAFTING workflow during Plan Mode.
 * Ensures scratchpad.md is created before presenting architectural plans.
 */

import fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface PlanModeRequirements {
	draftRequirements: boolean
	drilldownNecessary: boolean
	triadAuditRequired: boolean
	fileReadLimit: number
}

/**
 * PlanModeEnforcer: Sovereign Drafting Workflow Enforcement
 *
 * SOVEREIGN DRAFTING WORKFLOW:
 * 1. Create/Update scratchpad.md with SOVEREIGN DRAFTING template
 * 2. Perform Double Down Passes on requirement analysis
 * 3. Execute TRIAD AUDIT (The Architect, The Critic, The SRE)
 * 4. Only then can plan_mode_respond be called
 *
 * TRIAD AUDIT COMPONENTS:
 * - The Architect: Architecture soundness, JoyZoning layer discipline
 * - The Critic: Edge cases, failure modes, scaling concerns
 * - The SRE: System reliability, observability, deployment
 */
export class PlanModeEnforcer {
	constructor(cwd: string) {
		this.scratchpadPath = path.join(cwd, "scratchpad.md")
	}

	/**
	 * Pre-plan-respond enforcement check.
	 * If not satisfied, returns an error that should block the plan_mode_respond call.
	 */
	public async enforceSovereignDrafting(): Promise<{ allowed: boolean; reason?: string }> {
		// Implementation: Check scratchpad.md existence and content
		// Enforce SOVEREIGN DRAFTING workflow completion
		// Track Double Down Passes completion
		// Verify TRIAD AUDIT has been performed

		const content = await this.readScratchpad()

		if (!content || content.trim().length === 0) {
			return {
				allowed: false,
				reason:
					`🛑 SOVEREIGN DRAFTING NOT COMPLETE\n\n` +
					`Before presenting an architectural plan, you must complete the SOVEREIGN DRAFTING workflow:\n\n` +
					`1️⃣ Create/Update ${this.scratchpadPath} with the SOVEREIGN DRAFTING template\n\n` +
					`SOVEREIGN DRAFTING TEMPLATE:\`\`\`\n` +
					`# SOVEREIGN DRAFTING\n\n` +
					`## Requirement Analysis\n` +
					`- What are the core requirements? (Deep Dive #1)\n` +
					`- What are the edge cases? (Deep Dive #2)\n\n` +
					`## The Architect (Your Brain)\n` +
					`- Analyze architecture soundness and JoyZoning layer discipline\n` +
					`- Ensure Domain/Core/Infrastructure/UI/Plumbing boundaries are respected\n\n` +
					`## The Critic (The Skeptic)\n` +
					`- Identify failure modes, scaling bottlenecks, maintenance risks\n` +
					`- What could go wrong and how to fail fast?\n\n` +
					`## The SRE (Reliability Engineer)\n` +
					`- Address observability, error handling, fallback strategies\n` +
					`- How will we know if this works in production?\n\n` +
					`## Required Reviewers\n` +
					`- [ ] The Architect [ ] The Critic [ ] The SRE\n\n` +
					`\`\`\`\n\n` +
					`💡 TIP: After completing the template with answers for ALL sections, ` +
					`you can call plan_mode_respond with your plan.`,
			}
		}

		// Check for Double Down Passes (at least 2 rounds of focused analysis)
		const lines = content.split("\n")
		const requirementAnalysis = lines.some((l) => l.includes("## Requirement Analysis") || l.includes("- Deep Dive"))
		const architecturalAnalysis = lines.some((l) => l.includes("## The Architect") || l.includes("The Architect"))
		const criticAnalysis = lines.some((l) => l.includes("## The Critic") || l.includes("The Critic"))
		const sreAnalysis = lines.some((l) => l.includes("## The SRE") || l.includes("The SRE"))

		if (!requirementAnalysis || !architecturalAnalysis || !criticAnalysis || !sreAnalysis) {
			return {
				allowed: false,
				reason:
					`⚠️ SOVEREIGN DRAFTING INCOMPLETE\n\n` +
					`Your scratchpad.md ${this.scratchpadPath} is missing required sections:\n` +
					`- ✓ Requirement Analysis (Deep Dive #1)\n` +
					`- ✓ The Architect review\n` +
					`- ✓ The Critic review\n` +
					`- ✓ The SRE review\n\n` +
					`Complete all four sections before presenting a plan.`,
			}
		}

		// Check for TRIAD AUDIT completion markers
		const reviewers = content.includes("[ ] The Architect")
		if (reviewers) {
			return {
				allowed: false,
				reason:
					`⚠️ TRIAD AUDIT NOT COMPLETED\n\n` +
					`You must complete the TRIAD AUDIT before presenting a plan.\n` +
					`Find the Required Reviewers section in your scratchpad.md and mark:\n` +
					`- [x] The Architect\n` +
					`- [x] The Critic\n` +
					`- [x] The SRE\n\n` +
					`Then you can call plan_mode_respond.`,
			}
		}

		// All checks passed
		this.currentResponseCount++
		return { allowed: true }
	}

	/**
	 * Provides feedback on the SOVEREIGN DRAFTING compliance status.
	 */
	public async getSovereignDraftingStatus(): Promise<{
		hasScratchpad: boolean
		Requirements: boolean
		Architect: boolean
		Critic: boolean
		SRE: boolean
		TRIADAudit: boolean
	}> {
		const content = await this.readScratchpad()
		if (!content) {
			return {
				hasScratchpad: false,
				Requirements: false,
				Architect: false,
				Critic: false,
				SRE: false,
				TRIADAudit: false,
			}
		}

		const lines = content.split("\n")
		return {
			hasScratchpad: true,
			Requirements: lines.some((l) => l.includes("## Requirement Analysis") || l.includes("Deep Dive")),
			Architect: lines.some((l) => l.includes("## The Architect") || l.includes("The Architect")),
			Critic: lines.some((l) => l.includes("## The Critic") || l.includes("The Critic")),
			SRE: lines.some((l) => l.includes("## The SRE") || l.includes("The SRE")),
			TRIADAudit: !content.includes("[ ] The Architect") && lines.length > 10,
		}
	}

	/**
	 * Updates the scratchpad.md file with feedback on compliance status.
	 */
	public async updateScratchpadWithFeasibility(feedback: string): Promise<void> {
		const currentContent = await this.readScratchpad()
		const timestamp = new Date().toISOString()

		const updatedContent = currentContent
			? `${currentContent}\n\n---\n\n## Feasibility Review (${timestamp})\n\n${feedback}`
			: `# SOVEREIGN DRAFTING\n\n## Feasibility Review (${timestamp})\n\n${feedback}`

		await fs.writeFile(this.scratchpadPath, updatedContent, "utf-8")
		Logger.info(`[PlanModeEnforcer] Updated scratchpad.md with feasibility feedback`)
	}

	/**
	 * Checks if the user has performed sufficient architectural exploration.
	 */
	public checkExplorationDepth(fileReadCount: number): "shallow" | "adequate" | "overdetailed" {
		const thresholds = {
			shallow: 5,
			adequate: 10,
		}

		if (fileReadCount < thresholds.shallow) return "shallow"
		if (fileReadCount < thresholds.adequate) return "adequate"
		return "overdetailed"
	}

	/**
	 * Generates SOVEREIGN DRAFTING completion prompts.
	 */
	public async generateSovereignDraftingPrompts(): Promise<string> {
		const status = await this.getSovereignDraftingStatus()

		if (!status.hasScratchpad) {
			return `🛑 SOVEREIGN DRAFTING NOT STARTED\n\nYou must create ${this.scratchpadPath} first.\nUse the SOVEREIGN DRAFTING template to structure your analysis.`
		}

		const missing = []
		if (!status.Requirements) missing.push("Requirement Analysis")
		if (!status.Architect) missing.push("The Architect review")
		if (!status.Critic) missing.push("The Critic review")
		if (!status.SRE) missing.push("The SRE review")
		if (!status.TRIADAudit) missing.push("TRIAD AUDIT ([x] marks)")

		if (missing.length === 0) {
			return `✅ SOVEREIGN DRAFTING COMPLETE\n\nYour scratchpad.md ${this.scratchpadPath} is fully drafted:\n- ✓ Requires analysis\n- ✓ Architect review\n- ✓ Critic review\n- ✓ SRE review\n- ✓ TRIAD AUDIT completed\n\nYou may now call plan_mode_respond with your proposed plan.`
		}

		return `⚠️ SOVEREIGN DRAFTING INCOMPLETE\n\nMissing: ${missing.join(", ")}\n\nPlease update ${this.scratchpadPath} to address these items.`
	}

	/**
	 * Acts as The Architect in TRIAD AUDIT.
	 */
	public performArchitectAudit(planSummary: string): string[] {
		const issues: string[] = []

		// Check for layer violations
		const layerCheck = this.checkLayerDiscipline(planSummary)
		if (layerCheck.violations.length > 0) {
			issues.push(`ARCHITECTURAL VIOLATIONS:\n${layerCheck.violations.map((v) => `- ${v}`).join("\n")}`)
		}

		// Check for Domain/Core/Infrastructure separation
		if (planSummary.match(/domain.*core|core.*domain|domain.*infrastructure|core.*infrastructure/gi)) {
			issues.push("Geo-Clash Detected: Mixing layers in a single proposal. Separate them.")
		}

		// Check for circular dependencies
		if (planSummary.includes("circular") || planSummary.includes("cycle")) {
			issues.push("Circular Dependency Pattern: This creates a lock-in risk. Extract interfaces.")
		}

		return issues
	}

	/**
	 * Acts as The Critic in TRIAD AUDIT.
	 */
	public performCriticAudit(planSummary: string): string[] {
		const issues: string[] = []

		// Check for edge cases
		if (!planSummary.includes("edge") && !planSummary.includes("exception") && !planSummary.includes("failure")) {
			issues.push("CRITICAL: No edge case or failure mode analysis found. What breaks?")
		}

		// Check for scalability
		if (!planSummary.includes("scale") && !planSummary.includes("scalability") && !planSummary.includes("handles")) {
			issues.push("WARNING: No scalability or growth considerations mentioned. Will this handle load?")
		}

		// Check for security
		if (!planSummary.includes("security") && !planSummary.includes("auth") && !planSummary.includes("permission")) {
			issues.push("SECURITY GAP: No security or authorization strategy present.")
		}

		return issues
	}

	/**
	 * Acts as The SRE in TRIAD AUDIT.
	 */
	public performSREAudit(planSummary: string): string[] {
		const issues: string[] = []

		// Check for observability
		if (!planSummary.includes("log") && !planSummary.includes("metric") && !planSummary.includes("trace")) {
			issues.push("SRE CRITICAL: No observability strategy (logging, metrics, tracing). How do we know it's working?")
		}

		// Check for error handling
		if (!planSummary.includes("error") && !planSummary.includes("handle") && !plan.includes("fallback")) {
			issues.push("SRE CRITICAL: No error handling or fallback strategies. What happens when things fail?")
		}

		// Check for deployments
		if (!planSummary.includes("deploy") && !planSummary.includes("release") && !planSummary.includes("production")) {
			issues.push("SRE WARNING: No deployment or production considerations. How is this delivered?")
		}

		return issues
	}

	/**
	 * Runs the complete TRIAD AUDIT.
	 */
	public performTriadAudit(planSummary: string): {
		architect: string[]
		critic: string[]
		sre: string[]
		summary: string
	} {
		const architect = this.performArchitectAudit(planSummary)
		const critic = this.performCriticAudit(planSummary)
		const sre = this.performSREAudit(planSummary)

		const allIssues = [...architect, ...critic, ...sre]
		const summary =
			allIssues.length === 0
				? "✅ TRIAD AUDIT PASSED: Plan appears sound from all three perspectives."
				: `⚠️ TRIAD AUDIT FOUND ${allIssues.length} CONCERNS:\n\n${allIssues.join("\n\n")}`

		return { architect, critic, sre, summary }
	}

	/**
	 * Gets layer discipline violations in a plan.
	 */
	private checkLayerDiscipline(planSummary: string): { violations: string[] } {
		const violations: string[] = []
		const layers = ["domain", "core", "infrastructure", "ui", "plumbing"]

		layers.forEach((layer) => {
			const regex = new RegExp(`${layer}[\\s:]+`, "gi")
			if (planSummary.match(regex)) {
				const layerUpper = layer.toUpperCase()
				violations.push(`Mixes ${layerUpper} layer with other concepts in plan. Separate into its own section or module.`)
			}
		})

		return { violations }
	}

	/**
	 * Reads the draft scratchpad file.
	 */
	private async readScratchpad(): Promise<string | null> {
		try {
			return await fs.readFile(this.scratchpadPath, "utf-8")
		} catch {
			return null
		}
	}
}
