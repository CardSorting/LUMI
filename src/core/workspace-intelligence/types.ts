export const WORKSPACE_KNOWLEDGE_CATEGORIES = ["permanent", "operational", "historical", "failure", "predictive"] as const

export type WorkspaceKnowledgeCategory = (typeof WORKSPACE_KNOWLEDGE_CATEGORIES)[number]

export type WorkspaceKnowledgeConfidence = "confirmed" | "inferred" | "needs_verification"

export type WorkspaceKnowledgeSource =
	| "documentation"
	| "finalization"
	| "harness"
	| "manifest"
	| "previous_model"
	| "repository"
	| "roadmap"
	| "source_code"
	| "troubleshooting"

export interface WorkspaceKnowledgeSignal {
	id: string
	category: WorkspaceKnowledgeCategory
	title: string
	summary: string
	evidence: string[]
	confidence: WorkspaceKnowledgeConfidence
	source: WorkspaceKnowledgeSource
	observedAt: string
	status: "active" | "carried_forward" | "needs_review"
	expiresAt?: string
}

export type WorkspaceDriftKind =
	| "architecture_drift"
	| "dependency_drift"
	| "documentation_drift"
	| "implementation_drift"
	| "knowledge_gap"
	| "operational_drift"
	| "terminology_drift"

export interface WorkspaceDriftFinding {
	id: string
	kind: WorkspaceDriftKind
	severity: "low" | "medium" | "high"
	summary: string
	evidence: string[]
	recommendation: string
	confidence: WorkspaceKnowledgeConfidence
}

export interface WorkspaceIntelligenceSourceSnapshot {
	workspaceName: string
	packageName?: string
	packageVersion?: string
	packageScripts: string[]
	preferredCommands: string[]
	workspaces: string[]
	manifests: string[]
	topLevelEntries: string[]
	documentationFiles: string[]
	architecturalSurfaces: string[]
	providerKeys: string[]
	toolCount?: number
	readOnlyToolCount?: number
	hasRoadmap: boolean
}

export interface WorkspaceCognitiveModel {
	schemaVersion: 2
	workspaceName: string
	workspaceRoot: "."
	generatedAt: string
	taskId: string
	finalizationRunId: string
	sourceSnapshot: WorkspaceIntelligenceSourceSnapshot
	categories: Record<WorkspaceKnowledgeCategory, WorkspaceKnowledgeSignal[]>
	driftFindings: WorkspaceDriftFinding[]
	assumptions: string[]
	knownUnknowns: string[]
	highRiskSurfaces: string[]
	metaReflection: {
		repeatedFriction: string[]
		rediscoveryCosts: string[]
		selfImprovements: string[]
	}
	previousModel?: {
		generatedAt: string
		taskId: string
		categoryCounts: Record<WorkspaceKnowledgeCategory, number>
	}
	facts: WorkspaceFact[]
}

export interface WorkspaceProvenance {
	type: "finalization_evidence" | "manifest" | "git_commit" | "adr" | "test_run" | "file_change"
	path?: string
	runId?: string
	ref?: string
	description: string
	timestamp: string
}

export const WORKSPACE_FACT_LIFECYCLES = ["active", "stale", "superseded", "disputed", "archived"] as const
export type WorkspaceFactLifecycle = (typeof WORKSPACE_FACT_LIFECYCLES)[number]

export const WORKSPACE_FACT_TYPES = [
	"subsystem_stability",
	"architecture_decision",
	"documentation_surface",
	"risk_area",
	"handoff_fact",
	"general",
] as const
export type WorkspaceFactType = (typeof WORKSPACE_FACT_TYPES)[number]

export interface SubsystemStabilityFact {
	path: string
	status: "stable" | "volatile"
}

export interface ArchitectureDecisionFact {
	id: string
	title: string
	status: string
}

export interface DocumentationSurfaceFact {
	summary: string
}

export interface RiskAreaFact {
	risk: string
}

export interface HandoffFact {
	fact: string
}

export type WorkspaceFactValue =
	| SubsystemStabilityFact
	| ArchitectureDecisionFact
	| DocumentationSurfaceFact
	| RiskAreaFact
	| HandoffFact
	| Record<string, unknown>
	| string

export interface WorkspaceFact {
	id: string
	type: WorkspaceFactType
	value: WorkspaceFactValue
	confidence: WorkspaceKnowledgeConfidence
	provenance: WorkspaceProvenance[]
	lifecycle: WorkspaceFactLifecycle
	lastUpdated: string
}

export interface WorkspaceIntelligenceArtifactRecord {
	relPath: string
	absPath: string
}

export interface WorkspaceIntelligenceFinalizationInput {
	taskId: string
	finalizationRunId: string
	timestamp: string
	impactSummary: string
}

export interface WorkspaceIntelligenceRunResult {
	model: WorkspaceCognitiveModel
	records: WorkspaceIntelligenceArtifactRecord[]
	categoryCounts: Record<WorkspaceKnowledgeCategory, number>
	memoryLayerUpdated: boolean
}
