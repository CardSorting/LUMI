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

export class SpecialistSelector {
	public select(problems: ClassifiedProductProblem[], maxSpecialists = 6): SpecialistSelection[] {
		Logger.info(`[MoD] Selecting specialists for ${problems.length} classified problems...`)

		const selectionsMap = new Map<DesignerRole, SpecialistSelection>()

		// Map each problem to its primary designer role
		for (const problem of problems) {
			const role = ROLE_MAPPING[problem.dimension]
			if (!role) continue

			if (selectionsMap.has(role)) {
				const selection = selectionsMap.get(role)!
				if (!selection.assignedProblemIds.includes(problem.id)) {
					selection.assignedProblemIds.push(problem.id)
					selection.reasons.push(`Assigned problem: ${problem.observation}`)
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

		// Sort by priority and limit to maxSpecialists
		let selections = Array.from(selectionsMap.values())

		selections.sort((a, b) => {
			const priorityWeight = { required: 3, recommended: 2, optional: 1 }
			return priorityWeight[b.priority] - priorityWeight[a.priority]
		})

		if (selections.length > maxSpecialists) {
			Logger.info(`[MoD] Limiting specialist count from ${selections.length} to ${maxSpecialists}`)
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
