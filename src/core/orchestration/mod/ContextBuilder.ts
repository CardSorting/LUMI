import { Logger } from "@/shared/services/Logger"
import { ClassifiedProductProblem, DesignerContextPackage, DesignerRole, ProductDesignIntent } from "./types"

export class ContextBuilder {
	private readonly targetCache = new Map<
		string,
		{ path: string; relevance: string; access: "read-only" | "proposed-mutation" }[]
	>()
	private readonly contentCache = new Map<string, { content: string; cachedAt: number }>()
	private readonly TTL_MS = 60_000 // 1 minute context cache TTL

	public clearCache(): void {
		this.targetCache.clear()
		this.contentCache.clear()
	}

	public setCachedFileContent(path: string, content: string): void {
		this.contentCache.set(path, { content, cachedAt: Date.now() })
	}

	public getCachedFileContent(path: string): string | undefined {
		const cached = this.contentCache.get(path)
		if (!cached) return undefined
		if (Date.now() - cached.cachedAt > this.TTL_MS) {
			this.contentCache.delete(path)
			return undefined
		}
		return cached.content
	}

	public async buildBatch(
		roles: DesignerRole[],
		intent: ProductDesignIntent,
		problems: ClassifiedProductProblem[],
		workspaceDir: string,
	): Promise<Map<DesignerRole, DesignerContextPackage>> {
		Logger.info(`[MoD Batch Context] Prefetching and building context packages for ${roles.length} roles concurrently...`)
		const results = new Map<DesignerRole, DesignerContextPackage>()
		await Promise.all(
			roles.map(async (role) => {
				const packageCtx = await this.build(role, intent, problems, workspaceDir)
				results.set(role, packageCtx)
			}),
		)
		return results
	}

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

		const cacheKey = problems.map((p) => `${p.id}:${p.target}`).join("|")
		let files = this.targetCache.get(cacheKey)

		if (!files) {
			files = []
			for (const prob of problems) {
				if (prob.target && prob.target !== "General" && (prob.target.includes("/") || prob.target.includes("."))) {
					files.push({
						path: prob.target,
						relevance: `Target of problem ${prob.id}: ${prob.observation}`,
						access: "read-only",
					})
				}
			}
			this.targetCache.set(cacheKey, files)
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
