/**
 * [LAYER: CORE]
 *
 * PlanModeEnforcer: Enforces INTEGRITY DRAFTING workflow during Plan Mode.
 * Ensures scratchpad.md is created before presenting architectural plans.
 */

import fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { IntegrityProtocol } from "./IntegrityProtocol"

export interface PlanModeRequirements {
	draftRequirements: boolean
	drilldownNecessary: boolean
	triadAuditRequired: boolean
	fileReadLimit: number
}

/**
 * PlanModeEnforcer: Integrity Drafting Workflow Enforcement
 *
 * INTEGRITY DRAFTING WORKFLOW:
 * 1. Create/Update scratchpad.md with INTEGRITY DRAFTING template
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
	private scratchpadPath: string
	private currentResponseCount = 0

	constructor(cwd: string) {
		this.scratchpadPath = path.join(cwd, "scratchpad.md")
	}

	/**
	 * Pre-plan-respond enforcement check.
	 * V290: Advisory Architectural Drafting (Non-blocking).
	 */
	public async enforceStrategicReview(): Promise<{ allowed: boolean; reason?: string }> {
		const content = await this.readScratchpad()
		const isSovereign = content?.includes("#SOVEREIGN_MODE") || content?.includes("#BYPASS")

		if (isSovereign) {
			return { allowed: true }
		}

		if (!content || content.trim().length === 0) {
			const template = IntegrityProtocol.generateAuditTemplate("Architectural Drafting")
			return {
				allowed: true, // V290: Total Deblocking
				reason:
					`📍 [STRATEGIC ADVISORY]: Plan Mode is active.\n\n` +
					`Consider initializing your \`scratchpad.md\` with a STRATEGIC REVIEW to ensure architectural alignment.\n\n` +
					`\`\`\`markdown\n${template}\n\`\`\``,
			}
		}

		// Check for sections with fuzzy matching (V290)
		const lines = content.split("\n")
		const hasSection = (patterns: (string | RegExp)[]) =>
			lines.some((l) => patterns.some((p) => (typeof p === "string" ? l.includes(p) : p.test(l))))

		const requirementAnalysis = hasSection(["## Requirement Analysis", "## Analysis", "- Deep Dive", "Objective:"])
		const architecturalAnalysis = hasSection([
			IntegrityProtocol.HEADERS.ARCHITECT,
			IntegrityProtocol.SEMANTIC_PATTERNS.ARCHITECT,
		])
		const criticAnalysis = hasSection([IntegrityProtocol.HEADERS.CRITIC, IntegrityProtocol.SEMANTIC_PATTERNS.CRITIC])
		const sreAnalysis = hasSection([IntegrityProtocol.HEADERS.SRE, IntegrityProtocol.SEMANTIC_PATTERNS.SRE])

		const missing = []
		if (!requirementAnalysis) missing.push("Requirement Analysis")
		if (!architecturalAnalysis) missing.push("Architect review")
		if (!criticAnalysis) missing.push("Critic review")
		if (!sreAnalysis) missing.push("SRE review")

		if (missing.length > 0) {
			return {
				allowed: true, // V290: Advisory only
				reason:
					`📍 [STRATEGIC ADVISORY]: Your \`scratchpad.md\` is missing recommended sections: ${missing.join(", ")}.\n` +
					`Maintaining these sections ensures a robust architectural foundation for your plan.`,
			}
		}

		// V290: Surgical Bypass for Triad markers
		const isSurgical = (content.match(/- \[ \]/g) || []).length <= 2
		const reviewersPending =
			content.includes("[ ] " + IntegrityProtocol.HEADERS.ARCHITECT.replace(/^#+\s+/, "")) ||
			(IntegrityProtocol.SEMANTIC_PATTERNS.ARCHITECT.test(content) && content.includes("[ ]"))

		if (reviewersPending && !isSurgical) {
			return {
				allowed: true, // V290: Advisory only
				reason:
					`📍 [STABILITY ADVISORY]: STABILITY GUARD markers ([ ]) are still pending in your \`scratchpad.md\`.\n` +
					`Finalize your Triad Audit review before proceeding to implementation.`,
			}
		}

		return { allowed: true }
	}

	/**
	 * V300: Drift Prophecy.
	 * Analyzes the proposed plan in scratchpad.md and predicts if it will trigger
	 * TASK DRIFT or MISSION DRIFT alerts during implementation.
	 */
	public predictDrift(content: string, monitor: any): { drift: number; predictedWarning?: string } {
		// Fuzzy search for file paths in the plan (look for markdown lists or code blocks)
		const fileRegex = /(?:src|lib|cli|packages)\/[a-zA-Z0-9_\-./]+/g
		const matches = content.match(fileRegex) || []
		const uniqueFiles = new Set(matches.map((f) => f.trim()))

		const drift = uniqueFiles.size
		const stats = monitor.getStabilityStats()

		// V300: Prophecy Logic
		if (drift > 20) {
			return {
				drift,
				predictedWarning: `🔮 [STABILITY PROPHECY]: Your proposed plan involves ${drift} files. Implementation will likely trigger a TASK DRIFT blockade. Consider breaking this into smaller, atomic increments.`,
			}
		}

		if (drift > 10) {
			const nonCoreCount = Array.from(uniqueFiles).filter((f) => !f.includes("/domain/") && !f.includes("/core/")).length
			const missionRatio = nonCoreCount / drift
			if (missionRatio > 0.8) {
				return {
					drift,
					predictedWarning: `🔮 [MISSION PROPHECY]: Your plan focuses primarily on peripheral files (${Math.round(missionRatio * 100)}%). This may trigger a MISSION DRIFT advisory. Ensure Domain/Core logic remains the priority.`,
				}
			}
		}

		return { drift }
	}

	/**
	 * Provides feedback on the STRATEGIC REVIEW compliance status.
	 */
	public async getStrategicReviewStatus(monitor?: any): Promise<{
		hasScratchpad: boolean
		Requirements: boolean
		Architect: boolean
		Critic: boolean
		SRE: boolean
		TRIADAudit: boolean
		prophecy?: string
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
		const prophecy = monitor ? this.predictDrift(content, monitor).predictedWarning : undefined

		return {
			hasScratchpad: true,
			Requirements: lines.some((l) => l.includes("## Requirement Analysis") || l.includes("Deep Dive")),
			Architect: lines.some(
				(l) => l.includes(IntegrityProtocol.HEADERS.ARCHITECT) || IntegrityProtocol.SEMANTIC_PATTERNS.ARCHITECT.test(l),
			),
			Critic: lines.some(
				(l) => l.includes(IntegrityProtocol.HEADERS.CRITIC) || IntegrityProtocol.SEMANTIC_PATTERNS.CRITIC.test(l),
			),
			SRE: lines.some((l) => l.includes(IntegrityProtocol.HEADERS.SRE) || IntegrityProtocol.SEMANTIC_PATTERNS.SRE.test(l)),
			TRIADAudit:
				!content.includes("[ ] " + IntegrityProtocol.HEADERS.ARCHITECT.replace(/^#+\s+/, "")) &&
				!IntegrityProtocol.SEMANTIC_PATTERNS.ARCHITECT.test(content) &&
				lines.length > 10,
			prophecy,
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
			: `# STRATEGIC REVIEW\n\n## Feasibility Review (${timestamp})\n\n${feedback}`

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
	 * Generates STRATEGIC REVIEW completion prompts.
	 */
	public async generateStrategicReviewPrompts(): Promise<string> {
		const status = await this.getStrategicReviewStatus()

		if (!status.hasScratchpad) {
			return `🛑 STRATEGIC REVIEW NOT STARTED\n\nYou must create ${this.scratchpadPath} first.\nUse the STRATEGIC REVIEW template to structure your analysis.`
		}

		const missing = []
		if (!status.Requirements) missing.push("Requirement Analysis")
		if (!status.Architect) missing.push(IntegrityProtocol.HEADERS.ARCHITECT.replace(/^#+\s+/, "") + " review")
		if (!status.Critic) missing.push(IntegrityProtocol.HEADERS.CRITIC.replace(/^#+\s+/, "") + " review")
		if (!status.SRE) missing.push(IntegrityProtocol.HEADERS.SRE.replace(/^#+\s+/, "") + " review")
		if (!status.TRIADAudit) missing.push("STABILITY GUARD ([x] marks)")

		if (missing.length === 0) {
			return `✅ STRATEGIC REVIEW COMPLETE\n\nYour scratchpad.md ${this.scratchpadPath} is fully drafted:\n- ✓ Requires analysis\n- ✓ Architect review\n- ✓ Critic review\n- ✓ SRE review\n- ✓ STABILITY GUARD completed\n\nYou may now call plan_mode_respond with your proposed plan.`
		}

		return `⚠️ STRATEGIC REVIEW INCOMPLETE\n\nMissing: ${missing.join(", ")}\n\nPlease update ${this.scratchpadPath} to address these items.`
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
		if (!planSummary.includes("error") && !planSummary.includes("handle") && !planSummary.includes("fallback")) {
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
