import type {
	ArchitectureDecisionFact,
	DocumentationSurfaceFact,
	HandoffFact,
	RiskAreaFact,
	SubsystemStabilityFact,
	WorkspaceCognitiveModel,
	WorkspaceFact,
	WorkspaceFactLifecycle,
	WorkspaceFactType,
	WorkspaceKnowledgeConfidence,
	WorkspaceProvenance,
} from "./types"

export class WorkspaceIntelligenceReader {
	constructor(private readonly model: WorkspaceCognitiveModel) {}

	getFacts(): WorkspaceFact[] {
		return this.model.facts || []
	}

	getFactsByTypeAndLifecycle(type: WorkspaceFactType, lifecycle: WorkspaceFactLifecycle = "active"): WorkspaceFact[] {
		return this.getFacts().filter((f) => f.type === type && f.lifecycle === lifecycle)
	}

	getStableSubsystems(): string[] {
		return this.getFactsByTypeAndLifecycle("subsystem_stability")
			.filter((f) => (f.value as SubsystemStabilityFact)?.status === "stable")
			.map((f) => (f.value as SubsystemStabilityFact)?.path)
			.filter(Boolean)
	}

	getVolatileSubsystems(): string[] {
		return this.getFactsByTypeAndLifecycle("subsystem_stability")
			.filter((f) => (f.value as SubsystemStabilityFact)?.status === "volatile")
			.map((f) => (f.value as SubsystemStabilityFact)?.path)
			.filter(Boolean)
	}

	getRecentArchitectureDecisions(): Array<{ id: string; title: string; status: string }> {
		return this.getFactsByTypeAndLifecycle("architecture_decision")
			.map((f) => f.value as ArchitectureDecisionFact)
			.filter(Boolean)
	}

	getStaleDocumentationSurfaces(): string[] {
		return this.getFactsByTypeAndLifecycle("documentation_surface")
			.map((f) => {
				const val = f.value as DocumentationSurfaceFact
				return val?.summary || (f.value as string)
			})
			.filter(Boolean)
	}

	getRecurringRiskAreas(): string[] {
		return this.getFactsByTypeAndLifecycle("risk_area")
			.map((f) => {
				const val = f.value as RiskAreaFact
				return val?.risk || (f.value as string)
			})
			.filter(Boolean)
	}

	getHandoffRelevantFacts(): string[] {
		return this.getFactsByTypeAndLifecycle("handoff_fact")
			.map((f) => {
				const val = f.value as HandoffFact
				return val?.fact || (f.value as string)
			})
			.filter(Boolean)
	}

	// Query Service APIs

	getSubsystemHealth(subsystemPath: string): {
		status: "stable" | "volatile" | "unknown"
		confidence: WorkspaceKnowledgeConfidence
		provenance: WorkspaceProvenance[]
	} {
		const subsystemFacts = this.getFactsByTypeAndLifecycle("subsystem_stability")

		const volatileFact = subsystemFacts.find((f) => {
			const val = f.value as SubsystemStabilityFact
			return (
				val?.status === "volatile" &&
				(val?.path === subsystemPath || subsystemPath.startsWith(val?.path) || val?.path.startsWith(subsystemPath))
			)
		})
		if (volatileFact) {
			return { status: "volatile", confidence: volatileFact.confidence, provenance: volatileFact.provenance }
		}

		const stableFact = subsystemFacts.find((f) => {
			const val = f.value as SubsystemStabilityFact
			return (
				val?.status === "stable" &&
				(val?.path === subsystemPath || subsystemPath.startsWith(val?.path) || val?.path.startsWith(subsystemPath))
			)
		})
		if (stableFact) {
			return { status: "stable", confidence: stableFact.confidence, provenance: stableFact.provenance }
		}

		return { status: "unknown", confidence: "needs_verification", provenance: [] }
	}

	getMostVolatileAreas(): Array<{
		path: string
		confidence: WorkspaceKnowledgeConfidence
		changesCount: number
		provenance: WorkspaceProvenance[]
	}> {
		return this.getFactsByTypeAndLifecycle("subsystem_stability")
			.filter((f) => (f.value as SubsystemStabilityFact)?.status === "volatile")
			.map((f) => {
				const val = f.value as SubsystemStabilityFact
				return {
					path: val.path,
					confidence: f.confidence,
					changesCount: f.provenance.length,
					provenance: f.provenance,
				}
			})
			.sort((a, b) => b.changesCount - a.changesCount)
	}

	getRecentArchitectureChanges(): Array<{
		id: string
		title: string
		status: string
		provenance: WorkspaceProvenance[]
	}> {
		return this.getFactsByTypeAndLifecycle("architecture_decision").map((f) => {
			const val = f.value as ArchitectureDecisionFact
			return {
				id: val.id,
				title: val.title,
				status: val.status,
				provenance: f.provenance,
			}
		})
	}

	queryRecurringRiskAreas(): Array<{
		risk: string
		confidence: WorkspaceKnowledgeConfidence
		provenance: WorkspaceProvenance[]
	}> {
		return this.getFactsByTypeAndLifecycle("risk_area").map((f) => {
			const val = f.value as RiskAreaFact
			return {
				risk: val.risk || (f.value as string),
				confidence: f.confidence,
				provenance: f.provenance,
			}
		})
	}

	getHandoffSummary(): { facts: string[]; lastTaskId: string; generatedAt: string } {
		return {
			facts: this.getHandoffRelevantFacts(),
			lastTaskId: this.model.taskId,
			generatedAt: this.model.generatedAt,
		}
	}

	explainFact(factId: string): WorkspaceFact | undefined {
		return this.getFacts().find((f) => f.id === factId)
	}

	getFactsByProvenance(runId: string): WorkspaceFact[] {
		return this.getFacts().filter((f) => f.provenance.some((p) => p.runId === runId))
	}

	getStaleFacts(): WorkspaceFact[] {
		return this.getFacts().filter((f) => f.lifecycle === "stale")
	}

	getDisputedFacts(): WorkspaceFact[] {
		return this.getFacts().filter((f) => f.lifecycle === "disputed")
	}

	getCompactSummary(): string {
		const lines: string[] = [
			`=== Workspace Intelligence (Task ${this.model.taskId}) ===`,
			`Model generated at: ${this.model.generatedAt}`,
		]
		if (this.getStableSubsystems().length) {
			lines.push(`Stable Subsystems: ${this.getStableSubsystems().join(", ")}`)
		}
		if (this.getVolatileSubsystems().length) {
			lines.push(`Volatile Subsystems: ${this.getVolatileSubsystems().join(", ")}`)
		}
		if (this.getRecentArchitectureDecisions().length) {
			const decs = this.getRecentArchitectureDecisions()
				.map((d) => `${d.id} (${d.status})`)
				.join(", ")
			lines.push(`Recent Decisions: ${decs}`)
		}
		if (this.getStaleDocumentationSurfaces().length) {
			lines.push(`Stale Documentation: ${this.getStaleDocumentationSurfaces().join("; ")}`)
		}
		if (this.getRecurringRiskAreas().length) {
			lines.push(`Recurring Risk Areas: ${this.getRecurringRiskAreas().join("; ")}`)
		}
		if (this.getHandoffRelevantFacts().length) {
			lines.push(`Handoff-Relevant Facts: ${this.getHandoffRelevantFacts().join(" | ")}`)
		}

		lines.push("")
		lines.push("=== Programmatic Query Endpoints ===")
		lines.push("- getSubsystemHealth(path): Query stability/volatility & provenance trail")
		lines.push("- getMostVolatileAreas(): Sorted list of high-churn directories")
		lines.push("- getRecentArchitectureChanges(): ADR tracking with provenance")
		lines.push("- queryRecurringRiskAreas(): Boundary & cross-surface risks")
		lines.push("- getHandoffSummary(): Key facts for current handoff")
		lines.push("- explainFact(factId): Fetch a fact details including full provenance & lifecycle status")
		lines.push("- getFactsByProvenance(runId): Query facts observed in a specific task execution run")
		lines.push("- getStaleFacts(): List stale facts pending deprecation")
		lines.push("- getDisputedFacts(): List disputed/diverged workspace observations")

		return lines.join("\n")
	}
}
