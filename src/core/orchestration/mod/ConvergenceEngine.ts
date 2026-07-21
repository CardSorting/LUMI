import { Logger } from "@/shared/services/Logger"
import { DesignDecision, DesignRefinement, ProductDesignIntent } from "./types"

export const PRIORITY_LATTICE: Record<string, number> = {
	"product-strategist": 5,
	"accessibility-reviewer": 4,
	"ux-architect": 3,
	"design-system-engineer": 2,
	"visual-systems-designer": 1,
	"interaction-designer": 1,
	"content-designer": 1,
	"responsive-design-reviewer": 1,
	"frontend-implementation-designer": 1,
	"product-critic": 0,
}

export class ConvergenceEngine {
	public converge(
		intent: ProductDesignIntent,
		refinements: DesignRefinement[],
	): {
		decisions: DesignDecision[]
		resolvedConflicts: Array<{ refinementIds: string[]; resolution: string; rationale: string }>
	} {
		Logger.info(`[MoD] Running convergence engine on ${refinements.length} refinements...`)

		// BFT Phase 1 & Phase 2: Syntactic Rejection & Scope Boundary Filtering
		const bftFiltered = this.applyBFTFiltering(intent, refinements)

		// Step 1: Cluster and Deduplicate valid refinements
		const deduplicated = this.deduplicateAndMerge(bftFiltered)

		// Step 2: Detect conflicts
		const conflicts = this.detectConflicts(deduplicated)

		// Step 3: Resolve conflicts and create Decisions
		const decisions: DesignDecision[] = []
		const resolvedConflicts: Array<{ refinementIds: string[]; resolution: string; rationale: string }> = []

		const conflictGroups = new Map<string, DesignRefinement[]>()
		for (const conflict of conflicts) {
			const groupKey = conflict.refinementIds.sort().join(",")
			if (!conflictGroups.has(groupKey)) {
				const groupRefinements = deduplicated.filter((r) => conflict.refinementIds.includes(r.id))
				conflictGroups.set(groupKey, groupRefinements)
			}
		}

		// Keep track of refinements that were superseded/rejected during resolution
		const supersededRefinementIds = new Set<string>()

		for (const [groupKey, groupRefinements] of conflictGroups.entries()) {
			const { winner, rationale } = this.resolveConflictGroup(intent, groupRefinements)

			resolvedConflicts.push({
				refinementIds: groupRefinements.map((r) => r.id),
				resolution: `Selected recommendation from ${winner.role} because: ${rationale}`,
				rationale,
			})

			for (const ref of groupRefinements) {
				if (ref.id !== winner.id) {
					supersededRefinementIds.add(ref.id)
				}
			}
		}

		// Step 4: Convert remaining/winning refinements to design decisions with Utility scores
		for (const ref of deduplicated) {
			const isSuperseded = supersededRefinementIds.has(ref.id)
			const utility = this.calculateDecisionUtility(ref)

			decisions.push({
				id: `dec-${ref.id}`,
				status: isSuperseded ? "superseded" : "accepted",
				sourceRefinementIds: [ref.id],
				problemIds: [ref.problem.problemId],
				decision: ref.recommendation.proposedChange,
				rationale: ref.recommendation.designStrategy,
				evidence: ref.evidence.map((e) => `${e.type}: ${e.observation} (${e.reference})`),
				tradeoffs: ref.recommendation.tradeoffs,
				affectedAreas: [...ref.implementation.affectedFiles, ...ref.implementation.affectedComponents],
				acceptanceCriteria: ref.validation.acceptanceCriteria,
				locked: !isSuperseded, // locked before implementation if accepted
				reopenConditions: ref.validation.regressionRisks,
				utility,
			})
		}

		return { decisions, resolvedConflicts }
	}

	private applyBFTFiltering(intent: ProductDesignIntent, refinements: DesignRefinement[]): DesignRefinement[] {
		const outOfScopePaths = intent.boundaries?.outOfScope || []
		const allowedPaths = intent.boundaries?.allowedToChange || []

		return refinements.filter((ref) => {
			// BFT Phase 1: Syntactic Isolation
			if (!ref.problem || !ref.recommendation || !ref.recommendation.proposedChange) {
				Logger.warn(`[MoD BFT Rejection] Refinement ${ref.id} dropped: Malformed payload`)
				ref.governance.bftStatus = "malformed"
				return false
			}

			// BFT Phase 2: Semantic Boundary Verification
			const affectedFiles = ref.implementation?.affectedFiles || []
			const touchesOutOfScope = affectedFiles.some((f) => outOfScopePaths.includes(f))
			if (touchesOutOfScope) {
				Logger.warn(`[MoD BFT Rejection] Refinement ${ref.id} dropped: Touches out-of-scope boundaries`)
				ref.governance.bftStatus = "out-of-scope"
				return false
			}

			ref.governance.bftStatus = "valid"
			return true
		})
	}

	private deduplicateAndMerge(refinements: DesignRefinement[]): DesignRefinement[] {
		const unique: DesignRefinement[] = []
		for (const ref of refinements) {
			const duplicate = unique.find(
				(u) =>
					u.problem.target === ref.problem.target &&
					u.problem.problemId === ref.problem.problemId &&
					u.recommendation.proposedChange.toLowerCase() === ref.recommendation.proposedChange.toLowerCase(),
			)

			if (duplicate) {
				Logger.info(`[MoD] Merging duplicate refinement from role ${ref.role} into ${duplicate.role}`)
				duplicate.evidence.push(...ref.evidence)
				duplicate.recommendation.tradeoffs.push(...ref.recommendation.tradeoffs)
				duplicate.recommendation.adaptationNotes.push(...ref.recommendation.adaptationNotes)
				duplicate.validation.acceptanceCriteria.push(...ref.validation.acceptanceCriteria)
				duplicate.validation.regressionRisks.push(...ref.validation.regressionRisks)
				duplicate.validation.verificationMethods.push(...ref.validation.verificationMethods)
			} else {
				unique.push(ref)
			}
		}
		return unique
	}

	private detectConflicts(refinements: DesignRefinement[]): Array<{ refinementIds: string[] }> {
		const conflicts: Array<{ refinementIds: string[] }> = []
		for (let i = 0; i < refinements.length; i++) {
			for (let j = i + 1; j < refinements.length; j++) {
				const r1 = refinements[i]
				const r2 = refinements[j]

				const sameTarget = r1.problem.target === r2.problem.target && r1.problem.target !== "General"
				const sameDimension = r1.problem.problemId === r2.problem.problemId || r1.role === r2.role
				const explicitConflict =
					r1.governance.conflictsWith.includes(r2.id) || r2.governance.conflictsWith.includes(r1.id)

				// Refinements targeting the same file across DIFFERENT dimensions are complementary, not conflicting
				if (explicitConflict || (sameTarget && sameDimension)) {
					conflicts.push({ refinementIds: [r1.id, r2.id] })
				}
			}
		}
		return conflicts
	}

	private resolveConflictGroup(
		intent: ProductDesignIntent,
		group: DesignRefinement[],
	): { winner: DesignRefinement; rationale: string } {
		// Evaluate using the full 9-role priority lattice map
		const sorted = [...group].sort((a, b) => {
			const pA = PRIORITY_LATTICE[a.role] ?? 1
			const pB = PRIORITY_LATTICE[b.role] ?? 1
			if (pB !== pA) return pB - pA

			// Secondary tie-breaker: confidence
			const confidenceWeight = { high: 3, medium: 2, low: 1 }
			return confidenceWeight[b.governance.confidence] - confidenceWeight[a.governance.confidence]
		})

		const winner = sorted[0]
		const pWinner = PRIORITY_LATTICE[winner.role] ?? 1

		let rationale = `Prioritized recommendation from ${winner.role} based on Priority Lattice matrix (level ${pWinner}).`
		if (winner.role === "accessibility-reviewer") {
			rationale = "Prioritized accessibility recommendation for user safety and accessibility compliance."
		} else if (winner.role === "product-strategist") {
			rationale = "Prioritized Product Strategist recommendation to preserve JTBD and product goals."
		} else if (winner.role === "ux-architect") {
			rationale = "Prioritized UX Architect recommendation for workflow and navigation coherence."
		} else if (winner.role === "design-system-engineer") {
			rationale = "Prioritized Design System Engineer for component reuse and token consistency."
		}

		return { winner, rationale }
	}

	private calculateDecisionUtility(ref: DesignRefinement): number {
		const severityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
		const confidenceWeight: Record<string, number> = { high: 1.0, medium: 0.75, low: 0.5 }

		const s = severityWeight[ref.problem?.severity] || 2
		const c = confidenceWeight[ref.governance?.confidence] || 0.75

		return Number.parseFloat((s * c).toFixed(2))
	}
}
