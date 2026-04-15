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
