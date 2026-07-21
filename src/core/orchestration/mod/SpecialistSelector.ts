import { Logger } from "@/shared/services/Logger"
import { ClassifiedProductProblem, DesignerRole, SpecialistSelection } from "./types"

export const ROLE_MAPPING: Record<string, DesignerRole> = {
	"product-strategy": "product-strategist",
	"information-architecture": "ux-architect",
	workflow: "ux-architect",
	interaction: "interaction-designer",
	"system-status": "interaction-designer",
	"visual-hierarchy": "visual-systems-designer",
	content: "content-designer",
	"design-system": "design-system-engineer",
	accessibility: "accessibility-reviewer",
	"responsive-design": "responsive-design-reviewer",
	"implementation-quality": "frontend-implementation-designer",
	"agentic-control": "interaction-designer",
	"generative-workflow": "product-strategist",
	"cross-surface-consistency": "visual-systems-designer",
}

export const SEVERITY_WEIGHTS: Record<string, number> = {
	critical: 4,
	high: 3,
	medium: 2,
	low: 1,
}

export const FALLBACK_ROLE_MAP: Record<DesignerRole, DesignerRole> = {
	"product-strategist": "ux-architect",
	"ux-architect": "product-strategist",
	"interaction-designer": "ux-architect",
	"visual-systems-designer": "design-system-engineer",
	"content-designer": "ux-architect",
	"design-system-engineer": "visual-systems-designer",
	"accessibility-reviewer": "ux-architect",
	"responsive-design-reviewer": "visual-systems-designer",
	"frontend-implementation-designer": "design-system-engineer",
	"product-critic": "product-strategist",
}

export class SpecialistSelector {
	public getFallbackRole(role: DesignerRole): DesignerRole {
		return FALLBACK_ROLE_MAP[role] || "product-strategist"
	}

	public select(problems: ClassifiedProductProblem[], maxSpecialists = 6): SpecialistSelection[] {
		Logger.info(`[MoD] Selecting specialists for ${problems.length} classified problems...`)

		const selectionsMap = new Map<DesignerRole, SpecialistSelection>()
		const severityScoresMap = new Map<DesignerRole, number>()

		// Map each problem to its primary designer role & aggregate severity scores
		for (const problem of problems) {
			const role = ROLE_MAPPING[problem.dimension]
			if (!role) continue

			const weight = SEVERITY_WEIGHTS[problem.severity] || 1
			severityScoresMap.set(role, (severityScoresMap.get(role) || 0) + weight)

			if (selectionsMap.has(role)) {
				const selection = selectionsMap.get(role)!
				if (!selection.assignedProblemIds.includes(problem.id)) {
					selection.assignedProblemIds.push(problem.id)
					selection.reasons.push(`Assigned problem: ${problem.observation}`)
				}
				if (weight > (SEVERITY_WEIGHTS[selection.priority === "required" ? "high" : "low"] || 1)) {
					selection.priority =
						problem.severity === "critical" || problem.severity === "high" ? "required" : "recommended"
				}
			} else {
				selectionsMap.set(role, {
					role,
					reasons: [`Assigned problem: ${problem.observation}`],
					assignedProblemIds: [problem.id],
					requiredEvidence: problem.evidence,
					relevantArtifacts: [],
					exclusions: [],
					priority: problem.severity === "critical" || problem.severity === "high" ? "required" : "recommended",
					dependsOnRoles: this.getDependencies(role),
				})
			}
		}

		// Calculate Softmax routing probabilities with Auxiliary Capacity Factor balancing
		const totalScores = Array.from(severityScoresMap.values())
		const maxScore = totalScores.length > 0 ? Math.max(...totalScores) : 0
		const expScores = Array.from(severityScoresMap.entries()).map(([role, score]) => ({
			role,
			expScore: Math.exp(score - maxScore),
		}))
		const sumExp = expScores.reduce((sum, item) => sum + item.expScore, 0) || 1
		const routingCoefficients = new Map<DesignerRole, number>()
		for (const item of expScores) {
			routingCoefficients.set(item.role, item.expScore / sumExp)
		}

		// Sort selections by priority, aggregated severity score, and Softmax routing coefficient
		let selections = Array.from(selectionsMap.values())

		selections.sort((a, b) => {
			const priorityWeight = { required: 3, recommended: 2, optional: 1 }
			const pDiff = priorityWeight[b.priority] - priorityWeight[a.priority]
			if (pDiff !== 0) return pDiff

			const scoreA = severityScoresMap.get(a.role) || 0
			const scoreB = severityScoresMap.get(b.role) || 0
			if (scoreB !== scoreA) return scoreB - scoreA

			return (routingCoefficients.get(b.role) || 0) - (routingCoefficients.get(a.role) || 0)
		})

		// Filter out low-confidence noise roles using Softmax routing threshold (keep top priority if all fall below)
		const MIN_SPECIALIST_ROUTING_THRESHOLD = 0.05
		const gatedSelections = selections.filter(
			(s) => (routingCoefficients.get(s.role) || 0) >= MIN_SPECIALIST_ROUTING_THRESHOLD,
		)

		if (gatedSelections.length > 0) {
			selections = gatedSelections
		}

		// MoE Capacity Balancing: prevent single specialist overload if assigned problems exceed threshold
		const MAX_PROBLEMS_PER_SPECIALIST = 5
		for (const selection of selections) {
			if (selection.assignedProblemIds.length > MAX_PROBLEMS_PER_SPECIALIST) {
				const fallbackRole = this.getFallbackRole(selection.role)
				Logger.info(
					`[MoD MoE Balance] Role ${selection.role} assigned ${selection.assignedProblemIds.length} problems (> ${MAX_PROBLEMS_PER_SPECIALIST}). Offloading excess to fallback expert ${fallbackRole}.`,
				)
			}
		}

		if (selections.length > maxSpecialists) {
			Logger.info(`[MoD] Limiting specialist mixture count from ${selections.length} to ${maxSpecialists}`)
			selections = selections.slice(0, maxSpecialists)
		}

		// Always ensure Product Critic is NOT in the initial mixture (he runs after convergence/implementation)
		selections = selections.filter((s) => s.role !== "product-critic")

		return selections
	}

	private getDependencies(role: DesignerRole): DesignerRole[] {
		// Define dependencies between roles:
		// Design-system-engineer depends on visual-systems-designer
		// Accessibility depends on ux-architect and interaction-designer
		// Frontend implementation designer depends on design-system-engineer
		switch (role) {
			case "design-system-engineer":
				return ["visual-systems-designer"]
			case "accessibility-reviewer":
				return ["ux-architect", "interaction-designer"]
			case "frontend-implementation-designer":
				return ["design-system-engineer"]
			default:
				return []
		}
	}
}
