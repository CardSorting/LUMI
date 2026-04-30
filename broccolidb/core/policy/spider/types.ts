import { Layer } from "../../../utils/joy-zoning.js"
export type { Layer }

export interface SpiderNode {
	id: string
	path: string
	layer: Layer
	imports: string[]
	dependents: string[]
	depth: number
	orphaned: boolean
	afferentCoupling: number
	logicDensity: number
	ioEntropy: number
	astComplexity: number
	hash: string
	isInterface: boolean
	exports: string[]
	consumptions: Record<string, string[]> // V16: Resolved Node ID -> symbols imported
	mtime: number // V20: Modification timestamp for Merkle Healing
	namingScore: number // V140: Industrial Naming Integrity (0-1.0)
	symbolDensity: number // V160: Ratio of exports to logical complexity
	logicCohesion: number // V160: Internal symbol re-use score
	blastRadius: number // V190: Systemic risk score (0-1.0)
	isFragile: boolean // V190: Flag for high-blast radius components
	cognitiveComplexity: number // V200: Logic depth/branching complexity
	isHotspot: boolean // V200: Flag for High Risk + High Complexity
	anyDensity: number // V210: Forensic marker for unsafe type usage (as any)
	reExports: string[] // V215: Resolved Node IDs of wildcard re-exports (export * from ...)
	churnIntensity: number // V350: Forensic volatility (update count)
	semanticDrift: number // V350: Architectural drift (layer change count)
	lastLayer?: Layer // V350: Historical layer for drift sensing
	hazardScore: number // V450: Probability of catastrophic failure (0-1.0)
	vitality?: number // Added for SpiderService compatibility
	resolvedImports: Map<string, string> // V500: specifier -> resolved Node ID
}

export interface SpiderSnapshot {
	timestamp: string
	entropyScore: number
	nodes: SpiderNode[]
	components: {
		depthScore: number
		namingScore: number
		orphanScore: number
		couplingScore: number
		cycles: number
		cognitiveScore: number
	}
}

export interface SpiderEntropyReport {
	score: number
	components: {
		depthScore: number
		namingScore: number
		orphanScore: number
		couplingScore: number
		cycles: number
		cognitiveScore: number
	}
	entropyVelocity: number // V215: Temporal structural health (rate of change)
}

export interface SpiderViolation {
	id: string
	severity: "ERROR" | "WARN" | "INFO"
	message: string
	path: string
	remediation?: string
}

export interface SpiderRegistryPayload {
	layerFingerprints: Record<string, string>
	nodes: [string, SpiderNode][]
}
