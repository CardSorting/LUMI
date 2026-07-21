export type AgentExecutionMode = "standard" | "mixture-of-designers"

export type MoDOutcome = "plan-only" | "plan-and-implement"

export type MoDStage =
	| "initializing"
	| "intent"
	| "classification"
	| "specialist-selection"
	| "specialist-analysis"
	| "recommendation-validation"
	| "convergence"
	| "decision-lock"
	| "implementation-planning"
	| "implementation"
	| "validation"
	| "critique"
	| "completed"
	| "completed-with-limitations"
	| "failed"

export interface ProductDesignIntent {
	request: {
		originalRequest: string
		interpretedGoal: string
		explicitRequirements: string[]
		implicitRequirements: string[]
	}
	product: {
		productArea: string
		productPurpose: string
		targetUsers: string[]
		userExperienceLevels: Array<"new" | "returning" | "advanced">
		primaryJobs: string[]
		secondaryJobs: string[]
	}
	currentExperience: {
		workflow: string[]
		strengths: string[]
		weaknesses: string[]
		frictionPoints: string[]
		existingPatterns: string[]
		unresolvedQuestions: string[]
	}
	constraints: {
		technical: string[]
		product: string[]
		brand: string[]
		accessibility: string[]
		performance: string[]
		platform: string[]
	}
	boundaries: {
		preserve: string[]
		allowedToChange: string[]
		outOfScope: string[]
	}
	success: {
		desiredOutcomes: string[]
		measurableSignals: string[]
		qualitativeSignals: string[]
		failureConditions: string[]
	}
}

export type ProductProblemDimension =
	| "product-strategy"
	| "information-architecture"
	| "workflow"
	| "interaction"
	| "system-status"
	| "visual-hierarchy"
	| "content"
	| "design-system"
	| "accessibility"
	| "responsive-design"
	| "implementation-quality"
	| "agentic-control"
	| "generative-workflow"
	| "cross-surface-consistency"

export interface ClassifiedProductProblem {
	id: string
	dimension: ProductProblemDimension
	target: string
	observation: string
	userImpact: string
	evidence: string[]
	severity: "critical" | "high" | "medium" | "low"
	confidence: "high" | "medium" | "low"
}

export interface ProductProblemClassification {
	problems: ClassifiedProductProblem[]
	preservedStrengths: string[]
	insufficientEvidence: string[]
}

export type DesignerRole =
	| "product-strategist"
	| "ux-architect"
	| "interaction-designer"
	| "visual-systems-designer"
	| "content-designer"
	| "design-system-engineer"
	| "accessibility-reviewer"
	| "responsive-design-reviewer"
	| "frontend-implementation-designer"
	| "product-critic"

export interface SpecialistSelection {
	role: DesignerRole
	reasons: string[]
	assignedProblemIds: string[]
	requiredEvidence: string[]
	relevantArtifacts: string[]
	exclusions: string[]
	priority: "required" | "recommended" | "optional"
	dependsOnRoles: DesignerRole[]
}

export interface DesignerContextPackage {
	role: DesignerRole
	intent: ProductDesignIntent
	assignedProblems: ClassifiedProductProblem[]
	files: Array<{
		path: string
		relevance: string
		access: "read-only" | "proposed-mutation"
	}>
	visualEvidence: string[]
	currentPatterns: string[]
	constraints: string[]
	exclusions: string[]
	preservedStrengths: string[]
	priorDecisions: string[]
	requiredOutput: string[]
}

export interface DesignRefinement {
	id: string
	role: DesignerRole
	problem: {
		problemId: string
		target: string
		observedBehavior: string
		userImpact: string
		severity: "critical" | "high" | "medium" | "low"
		frequency: "constant" | "frequent" | "occasional" | "edge-case"
	}
	evidence: Array<{
		type: "source" | "render" | "workflow" | "test" | "accessibility" | "design-system" | "product-intent"
		reference: string
		observation: string
	}>
	recommendation: {
		designStrategy: string
		proposedChange: string
		familiarPattern?: string
		whyPatternFits?: string
		adaptationNotes: string[]
		alternativesConsidered: string[]
		tradeoffs: string[]
	}
	implementation: {
		affectedFiles: string[]
		affectedComponents: string[]
		affectedStates: string[]
		instructions: string[]
		dependencies: string[]
		riskLevel: "low" | "medium" | "high"
	}
	validation: {
		acceptanceCriteria: string[]
		regressionRisks: string[]
		verificationMethods: string[]
	}
	governance: {
		confidence: "high" | "medium" | "low"
		scopeStatus: "in-scope" | "borderline" | "out-of-scope"
		mutationAuthorityRequired: boolean
		conflictsWith: string[]
	}
}

export interface PatternReference {
	pattern: string
	problemSolved: string
	familiarityReason: string
	suitability: string
	adaptationNotes: string[]
	preservedProductIdentity: string[]
	risks: string[]
	rejectionConditions: string[]
}

export interface DesignDecision {
	id: string
	status: "proposed" | "accepted" | "rejected" | "superseded" | "deferred" | "implemented" | "validated"
	sourceRefinementIds: string[]
	problemIds: string[]
	decision: string
	rationale: string
	evidence: string[]
	tradeoffs: string[]
	affectedAreas: string[]
	acceptanceCriteria: string[]
	locked: boolean
	reopenConditions: string[]
}

export interface DesignImplementationPhase {
	id: string
	title: string
	objective: string
	dependencies: string[]
	taskIds: string[]
}

export interface DesignImplementationTask {
	id: string
	decisionIds: string[]
	objective: string
	affectedFiles: string[]
	affectedComponents: string[]
	affectedStates: string[]
	instructions: string[]
	dependencies: string[]
	acceptanceCriteria: string[]
	validationCommands: string[]
	mutationBoundary: string[]
	preservedBehavior: string[]
	rollbackNotes: string[]
	status: "pending" | "in-progress" | "completed" | "blocked" | "failed" | "validated"
}

export type DesignGate =
	| "product-intent"
	| "ux-architecture"
	| "visual-system"
	| "interaction-state"
	| "accessibility"
	| "implementation-fidelity"
	| "cross-surface-consistency"
	| "final-product-critique"

export interface DesignValidationPlan {
	dimensions: DesignValidationDimension[]
	testSuiteCommands: string[]
}

export interface ConvergedDesignPlan {
	intent: ProductDesignIntent
	problems: ClassifiedProductProblem[]
	selectedSpecialists: SpecialistSelection[]
	acceptedDecisionIds: string[]
	rejectedRefinementIds: string[]
	deferredRefinementIds: string[]
	resolvedConflicts: Array<{
		refinementIds: string[]
		resolution: string
		rationale: string
	}>
	patternReferences: PatternReference[]
	implementationPhases: DesignImplementationPhase[]
	validationPlan: DesignValidationPlan
	knownLimitations: string[]
}

export interface DesignRevisionRequest {
	failedGate: DesignGate
	failureReasons: string[]
	evidence: string[]
	responsibleRoles: DesignerRole[]
	affectedDecisionIds: string[]
	lockedDecisionIds: string[]
	requiredCorrections: string[]
	requiredEvidence: string[]
	revisionNumber: number
	finalAllowedRevision: boolean
}

export type DesignValidationDimension =
	| "product"
	| "ux"
	| "interaction"
	| "visual"
	| "design-system"
	| "responsive"
	| "accessibility"
	| "agentic-control"
	| "implementation"

export interface DesignValidationResult {
	dimension: DesignValidationDimension
	status: "passed" | "failed" | "passed-with-limitations"
	evidence: string[]
	failedCriteria: string[]
	limitations: string[]
	requiredFollowUp: string[]
}

export interface ProductCritiqueFinding {
	id: string
	decisionIds: string[]
	observedFailure: string
	userOrProductImpact: string
	evidence: string[]
	correctionRequired: boolean
	gateToFail?: DesignGate
	confidence: "high" | "medium" | "low"
}

export interface DesignGateResult {
	gate: DesignGate
	passed: boolean
	failureReasons: string[]
	timestamp: string
}

export interface MoDFailure {
	stage: MoDStage
	code: string
	message: string
	evidence: string[]
	recoverable: boolean
	recommendedAction: string
}

export interface MoDRunState {
	runId: string
	mode: "mixture-of-designers"
	outcome: MoDOutcome
	stage: MoDStage
	intent?: ProductDesignIntent
	problemClassification?: ProductProblemClassification
	specialistSelections: SpecialistSelection[]
	specialistResults: SpecialistResult[]
	refinements: DesignRefinement[]
	decisions: DesignDecision[]
	implementationTasks: DesignImplementationTask[]
	validationResults: DesignValidationResult[]
	critiqueFindings: ProductCritiqueFinding[]
	gateResults: DesignGateResult[]
	revisions: DesignRevisionRequest[]
	limitations: string[]
	failure?: MoDFailure
	createdAt: string
	updatedAt: string
}

export interface SpecialistResult {
	role: DesignerRole
	refinements: DesignRefinement[]
	durationMs: number
	success: boolean
	error?: string
}

export type MoDFinalStatus = "completed" | "completed-with-limitations" | "failed"

export type MoDTelemetryEvent =
	| "mod.started"
	| "mod.intent.completed"
	| "mod.classification.completed"
	| "mod.specialists.selected"
	| "mod.specialist.started"
	| "mod.specialist.completed"
	| "mod.specialist.failed"
	| "mod.recommendations.validated"
	| "mod.convergence.completed"
	| "mod.decision.locked"
	| "mod.decision.reopened"
	| "mod.gate.passed"
	| "mod.gate.failed"
	| "mod.revision.started"
	| "mod.revision.completed"
	| "mod.implementation.started"
	| "mod.implementation.completed"
	| "mod.validation.completed"
	| "mod.critique.completed"
	| "mod.completed"
	| "mod.completed_with_limitations"
	| "mod.failed"
