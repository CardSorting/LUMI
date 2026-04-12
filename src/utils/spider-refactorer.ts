import { SpiderEngine } from "@/core/policy/SpiderEngine"
import { Layer } from "@/utils/joy-zoning"

export interface RefactoringSuggestion {
	type: "MOVE" | "SPLIT" | "RENAME"
	path: string
	targetLayer?: Layer
	reason: string
}

/**
 * SpiderRefactorer: Analyzes a Spider structural graph and suggests refactorings
 * to reduce overall system entropy.
 */
export class SpiderRefactorer {
	constructor(private engine: SpiderEngine) {}

	/**
	 * Analyzes the current graph and returns a list of actionable suggestions.
	 */
	suggest(): RefactoringSuggestion[] {
		const suggestions: RefactoringSuggestion[] = []
		this.engine.computeEntropy()
		const violations = this.engine.getViolations()

		// 1. Suggest moves for naming violations
		for (const v of violations) {
			if (v.id === "SPI-002") {
				suggestions.push({
					type: "RENAME",
					path: v.path,
					reason: "File name does not follow kebab-case convention, contributing to naming entropy.",
				})
			}
		}

		// 2. Suggest moves for cross-layer coupling hotspots
		const nodes = Array.from(this.engine.nodes.values())
		for (const node of nodes) {
			if (node.layer === "domain") {
				// Check if domain node imports non-pure layers
				const leakCount = node.imports.filter((imp) => {
					const targetLayer = this.engine.resolveLayer(node.id, imp)
					return targetLayer && targetLayer !== "domain" && targetLayer !== "plumbing"
				}).length

				if (leakCount > 2) {
					suggestions.push({
						type: "MOVE",
						path: node.id,
						targetLayer: "infrastructure",
						reason: `Domain file '${node.id}' has ${leakCount} external dependencies. It should likely be an Infrastructure adapter.`,
					})
				}
			}

			if (node.orphaned) {
				suggestions.push({
					type: "MOVE",
					path: node.id,
					reason: "Node is orphaned/unreachable. Consider removing it or integrating it into the core flow.",
				})
			}
		}

		return suggestions
	}
}
