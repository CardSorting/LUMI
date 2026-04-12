import { SpiderEngine, SpiderNode } from "../policy/SpiderEngine.js"
import { Logger } from "@/shared/services/Logger"

export interface DriftReport {
	path: string
	originalPurpose: string
	currentPurpose: string
	driftDetected: boolean
}

/**
 * DriftOrchestrator: Monitors the "Semantic Intent" of files.
 * Tracks how a file's responsibility evolves and warns if it starts to 
 * violate the Single Responsibility Principle (SRP).
 */
export class DriftOrchestrator {
	private purposeRegistry: Map<string, string> = new Map()

	constructor() {}

	/**
	 * Records the initial purpose of a file (based on its exports and tags).
	 */
	public async registerPurpose(node: SpiderNode, content: string) {
		const purpose = this.extractPurpose(content)
		this.purposeRegistry.set(node.id, purpose)
	}

	/**
	 * Analyzes a file for semantic drift.
	 */
	public analyzeDrift(node: SpiderNode, content: string): DriftReport {
		const original = this.purposeRegistry.get(node.id) || "Unknown Purpose"
		const current = this.extractPurpose(content)
		
		const driftDetected = original !== "Unknown Purpose" && !this.purposesAlign(original, current)

		return {
			path: node.path,
			originalPurpose: original,
			currentPurpose: current,
			driftDetected
		}
	}

	private extractPurpose(content: string): string {
		// Heuristic: Use first class/exported interface name as primary purpose
		const match = content.match(/export (class|interface|type|const) (\w+)/)
		return match ? match[2] || "Generic Logic" : "Generic Logic"
	}

	private purposesAlign(original: string, current: string): boolean {
		// Simplistic alignment check for the prototype
		return original === current || current.includes(original)
	}
}
