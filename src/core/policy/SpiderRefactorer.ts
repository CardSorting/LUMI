import * as path from "path"
import type { SpiderEngine } from "./SpiderEngine.js"

export interface RefactoringSuggestion {
	type: "RENAME" | "MOVE" | "EXTRACT" | "DELETE"
	target: string
	reason: string
	benefit: string
}

/**
 * SpiderRefactorer: Analyzes the Spider graph to identify architectural improvements.
 */
export const SpiderRefactorer = {
	getRefactoringSuggestions(engine: SpiderEngine): RefactoringSuggestion[] {
		const suggestions: RefactoringSuggestion[] = []

		// 1. Identify Orphan Nodes
		for (const node of engine.nodes.values()) {
			if (node.orphaned && !node.path.includes("index") && !node.path.includes("main")) {
				suggestions.push({
					type: "DELETE",
					target: path.basename(node.path),
					reason: "No incoming dependencies detected in the architectural graph.",
					benefit: "Reduces codebase entropy and cognitive load.",
				})
			}
		}

		// 2. Identify Layer Violations (Heuristic)
		// This can be expanded based on SpiderViolation results
		const violations = engine.getViolations()
		for (const v of violations) {
			if (v.severity === "ERROR") {
				suggestions.push({
					type: "MOVE",
					target: path.basename(v.path),
					reason: v.message,
					benefit: "Restores architectural integrity and prevents cross-layer pollution.",
				})
			}
		}

		return suggestions
	},
}
