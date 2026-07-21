import { Logger } from "@/shared/services/Logger"
import { DesignDecision, DesignRefinement, ProductDesignIntent } from "./types"

export class ConvergenceEngine {
	public converge(
		intent: ProductDesignIntent,
		refinements: DesignRefinement[],
	): {
		decisions: DesignDecision[]
		resolvedConflicts: Array<{ refinementIds: string[]; resolution: string; rationale: string }>
	} {
		Logger.info(`[MoD] Running convergence engine on ${refinements.length} refinements...`)

		// Step 1: Cluster and Deduplicate
		const deduplicated = this.deduplicateAndMerge(refinements)

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

		// Step 4: Convert remaining/winning refinements to design decisions
		for (const ref of deduplicated) {
			const isSuperseded = supersededRefinementIds.has(ref.id)
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
			})
		}

		return { decisions, resolvedConflicts }
	}

	private deduplicateAndMerge(refinements: DesignRefinement[]): DesignRefinement[] {
		const unique: DesignRefinement[] = []
		for (const ref of refinements) {
			// Check if we have an extremely similar refinement
			const duplicate = unique.find(
				(u) =>
					u.problem.target === ref.problem.target &&
					u.problem.problemId === ref.problem.problemId &&
					u.recommendation.proposedChange.toLowerCase() === ref.recommendation.proposedChange.toLowerCase(),
			)

			if (duplicate) {
				Logger.info(`[MoD] Merging duplicate refinement from role ${ref.role} into ${duplicate.role}`)
				// Merge evidence and tradeoffs
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

				// Conflict indicators:
				// - Same target component/file but proposing different/contradictory changes
				// - Proposing incompatible navigation structures
				// - Accessibility vs Visual styling conflict
				const sameTarget = r1.problem.target === r2.problem.target && r1.problem.target !== "General"
				const explicitConflict =
					r1.governance.conflictsWith.includes(r2.id) || r2.governance.conflictsWith.includes(r1.id)

				if (sameTarget || explicitConflict) {
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
		// Resolve conflicts using priority:
		// 1. Product intent & constraints
		// 2. User safety & accessibility
		// 3. Primary workflow impact
		// 4. Feasibility & Feasibility risks

		// Find accessibility reviewer first if present
		const accessibilityRef = group.find((r) => r.role === "accessibility-reviewer")
		if (accessibilityRef) {
			return {
				winner: accessibilityRef,
				rationale: "Prioritized accessibility recommendation for user safety and accessibility compliance.",
			}
		}

		// Find UX architect next
		const uxRef = group.find((r) => r.role === "ux-architect")
		if (uxRef) {
			return {
				winner: uxRef,
				rationale: "Prioritized UX architect recommendation for workflow and navigation coherence.",
			}
		}

		// Find design system engineer next
		const dsRef = group.find((r) => r.role === "design-system-engineer")
		if (dsRef) {
			return {
				winner: dsRef,
				rationale: "Prioritized Design System Engineer for component reuse and token consistency.",
			}
		}

		// Fallback to highest confidence
		const sorted = [...group].sort((a, b) => {
			const confidenceWeight = { high: 3, medium: 2, low: 1 }
			return confidenceWeight[b.governance.confidence] - confidenceWeight[a.governance.confidence]
		})

		return {
			winner: sorted[0],
			rationale: `Prioritized refinement from ${sorted[0].role} due to higher confidence level.`,
		}
	}
}
