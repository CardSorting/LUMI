import { Layer } from "../../../utils/joy-zoning"

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
	}
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
