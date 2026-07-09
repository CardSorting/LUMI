import fs from "node:fs"
import path from "node:path"
import type {
	ArchitectureDecisionFact,
	DocumentationSurfaceFact,
	HandoffFact,
	KnowledgeDiagnostic,
	RiskAreaFact,
	SubsystemStabilityFact,
	WorkspaceCognitiveModel,
	WorkspaceFact,
	WorkspaceFactLifecycle,
	WorkspaceFactType,
	WorkspaceKnowledgeConfidence,
	WorkspaceKnowledgeHealth,
	WorkspaceProvenance,
} from "./types"

export class WorkspaceIntelligenceReader {
	constructor(
		private readonly model: WorkspaceCognitiveModel,
		private readonly cwd?: string,
	) {}

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

	getKnowledgeHealth(): WorkspaceKnowledgeHealth {
		const result: WorkspaceKnowledgeHealth = {
			status: "healthy",
			recoveryHints: [],
			recentDiagnostics: [],
		}

		if (!this.cwd) {
			return result
		}

		const jsonlPath = path.join(this.cwd, ".wiki/intelligence/diagnostics.jsonl")
		const logPath = path.join(this.cwd, ".wiki/intelligence/diagnostics.log")

		let logContent = ""
		let isJsonl = false

		if (fs.existsSync(jsonlPath)) {
			try {
				logContent = fs.readFileSync(jsonlPath, "utf-8")
				isJsonl = true
			} catch {
				// Stay advisory-only
			}
		} else if (fs.existsSync(logPath)) {
			try {
				logContent = fs.readFileSync(logPath, "utf-8")
			} catch {
				// Stay advisory-only
			}
		}

		if (!logContent) {
			return result
		}

		try {
			const lines = logContent.split("\n").filter(Boolean)

			if (isJsonl) {
				for (const line of lines) {
					try {
						const entry = JSON.parse(line) as KnowledgeDiagnostic
						result.recentDiagnostics.push(entry)
						if (entry.severity === "info") {
							result.lastSuccessfulWrite = entry.timestamp
						}
					} catch {
						// Ignore malformed json lines
					}
				}
			} else {
				// Fallback parsing for legacy raw text log format
				for (const line of lines) {
					const match = line.match(/^\[([^\]]+)\]\s+\[(info|warning|degraded)\]\s+(.*)$/)
					if (match) {
						const timestamp = match[1]
						const severity = match[2] as "info" | "warning" | "degraded"
						const message = match[3]

						result.recentDiagnostics.push({
							severity,
							code: severity === "info" ? "WRITE_SUCCESS" : severity === "warning" ? "PARSE_ERROR" : "WRITE_ERROR",
							message,
							timestamp,
							source: "LegacyLogParser",
							recoveryHints: [],
						})

						if (severity === "info") {
							result.lastSuccessfulWrite = timestamp
						}
					}
				}
			}

			result.recentDiagnostics.reverse()

			const lastEntry = result.recentDiagnostics[0]
			if (lastEntry) {
				if (lastEntry.severity === "degraded") {
					result.status = "degraded"
					result.lastDegradedReason = lastEntry.message

					if (lastEntry.recoveryHints && lastEntry.recoveryHints.length > 0) {
						result.recoveryHints = [...lastEntry.recoveryHints]
					} else {
						if (
							lastEntry.message.toLowerCase().includes("permission") ||
							lastEntry.message.toLowerCase().includes("eacces")
						) {
							result.recoveryHints.push(
								"Filesystem write permission denied. Verify directory permissions of .wiki/intelligence/",
							)
							result.recoveryHints.push(
								"Check if execution is running in a sandbox environment that restricts write access.",
							)
						} else if (
							lastEntry.message.toLowerCase().includes("disk") ||
							lastEntry.message.toLowerCase().includes("nospc")
						) {
							result.recoveryHints.push("Disk space is full. Free up some space or clean up directory files.")
						} else {
							result.recoveryHints.push("Check the full diagnostic trace in .wiki/intelligence/diagnostics.jsonl")
							result.recoveryHints.push("Run a manual finalization attempt or check repository accessibility.")
						}
					}
				} else if (lastEntry.severity === "warning") {
					if (lastEntry.recoveryHints && lastEntry.recoveryHints.length > 0) {
						result.recoveryHints = [...lastEntry.recoveryHints]
					} else {
						result.recoveryHints.push(
							"A warning was logged during model parse. Verify if workspace-intelligence.json JSON format is valid.",
						)
					}
				}
			}
		} catch {
			// Stay advisory-only
		}

		return result
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

		const health = this.getKnowledgeHealth()
		lines.push(
			`Knowledge Health: ${health.status}${health.status === "degraded" ? ` (degraded reason: ${health.lastDegradedReason})` : ""}`,
		)
		if (health.status === "degraded" && health.recoveryHints.length) {
			lines.push(`Recovery Hints: ${health.recoveryHints.join(" | ")}`)
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
		lines.push("- getKnowledgeHealth(): Retrieve current Workspace Knowledge health status, logs & recovery hints")

		return lines.join("\n")
	}
}
