export const GOLDEN_CARTRIDGE_SKILL_NAME = "golden-cartridge-protocol"

export type GoldenCartridgeVerb =
	| "trace"
	| "slice"
	| "resolve_authority"
	| "find_reuse"
	| "compress"
	| "compare_mass"
	| "design_compact"
	| "patch_smallest"
	| "disprove"
	| "measure"
	| "reclaim"
	| "seal"

export type GoldenCartridgeProvenance = "repository" | "runtime" | "telemetry" | "caller" | "inference" | "unavailable"

export interface GoldenCartridgeEvidence {
	source: string
	provenance: GoldenCartridgeProvenance
	statement: string
}

export interface GoldenCartridgeSideEffects {
	readsRepository: boolean
	releasesActiveContext: boolean
	executesCommands: boolean
	mayMutateViaDelegatedPrimitive: boolean
	projectionOnly: boolean
}

export interface GoldenCartridgeResult<T = unknown> {
	verb: GoldenCartridgeVerb
	summary: string
	evidence: GoldenCartridgeEvidence[]
	result: T
	observations?: Record<string, unknown>
	limitations?: string[]
	suggestedNextVerb?: GoldenCartridgeVerb
	sideEffects: GoldenCartridgeSideEffects
}

export interface GoldenCartridgeValidationObservation {
	question?: string
	command: string
	relevantSurfaces: string[]
	outcome: {
		status: "passed" | "failed" | "denied" | "timed_out" | "execution_error" | "inconclusive"
		exitCode?: number
		signal?: string
		durationMs?: number
		approvalStatus: "approved" | "denied" | "not_required" | "unknown"
	}
	repositoryRevision: string
	sequence: number
	provenance: "runtime"
}

export interface SolutionCandidate {
	id: string
	description: string
	filesTouched?: number
	publicInterfaces?: number
	dependencies?: number
	persistedFormats?: number
	newAuthorities?: number
	newAbstractions?: number
	existingAuthoritiesReused?: number
	runtimeWork?: "low" | "medium" | "high"
	validationScope?: "focused" | "integration" | "subsystem" | "full"
	regressionExposure?: "low" | "medium" | "high"
	reviewBurden?: "low" | "medium" | "high"
	removalDifficulty?: "low" | "medium" | "high"
	maintenanceSurface?: "low" | "medium" | "high"
	correctnessConfidence?: "low" | "medium" | "high"
	uncertainty?: "low" | "medium" | "high"
}
