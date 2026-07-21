import { Logger } from "@/shared/services/Logger"
import { ClassifiedProductProblem, DesignerContextPackage, DesignerRole, ProductDesignIntent } from "./types"

export class ContextBuilder {
	public async build(
		role: DesignerRole,
		intent: ProductDesignIntent,
		problems: ClassifiedProductProblem[],
		workspaceDir: string,
	): Promise<DesignerContextPackage> {
		Logger.info(`[MoD] Building role-aware context package for ${role}...`)

		const assignedProblems = problems.filter((p) => {
			const roleKeywords: Record<DesignerRole, string[]> = {
				"product-strategist": ["strategy", "workflow", "purpose"],
				"ux-architect": ["navigation", "flow", "structure"],
				"interaction-designer": ["interaction", "state", "click", "hover"],
				"visual-systems-designer": ["style", "color", "visual", "hierarchy"],
				"content-designer": ["text", "label", "copy", "instructions"],
				"design-system-engineer": ["component", "token", "primitive"],
				"accessibility-reviewer": ["accessibility", "keyboard", "focus", "aria"],
				"responsive-design-reviewer": ["responsive", "mobile", "screen", "width"],
				"frontend-implementation-designer": ["implementation", "performance", "code"],
				"product-critic": ["critique", "coherence"],
			}
			const keywords = roleKeywords[role] || []
			return keywords.some(
				(keyword) =>
					p.dimension.includes(keyword) ||
					p.observation.toLowerCase().includes(keyword) ||
					p.target.toLowerCase().includes(keyword),
			)
		})

		const files: Array<{ path: string; relevance: string; access: "read-only" | "proposed-mutation" }> = []

		for (const prob of problems) {
			if (prob.target && prob.target !== "General" && prob.target.includes("/")) {
				files.push({
					path: prob.target,
					relevance: `Target of problem ${prob.id}: ${prob.observation}`,
					access: "read-only",
				})
			}
		}

		return {
			role,
			intent,
			assignedProblems: assignedProblems.length > 0 ? assignedProblems : problems,
			files,
			visualEvidence: [],
			currentPatterns: intent.currentExperience.existingPatterns,
			constraints: [...intent.constraints.technical, ...intent.constraints.product, ...intent.constraints.accessibility],
			exclusions: intent.boundaries.outOfScope,
			preservedStrengths: intent.currentExperience.strengths,
			priorDecisions: [],
			requiredOutput: ["DesignRefinement JSON object"],
		}
	}
}
