import * as path from "path"
import type { SpiderEngine } from "./spider/SpiderEngine.js"
import type { SpiderNode } from "./spider/types.js"

export interface RefactoringSuggestion {
	type: "RENAME" | "MOVE" | "EXTRACT" | "DELETE"
	target: string
	reason: string
	benefit: string
	synthesis?: string
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

		// 3. Identify Fat Coordinators
		for (const node of engine.nodes.values()) {
			if (node.layer === "core" && node.afferentCoupling > 10) {
				suggestions.push({
					type: "EXTRACT",
					target: path.basename(node.path),
					reason: `Module is becoming a 'Fat Coordinator' with ${node.afferentCoupling} incoming dependencies.`,
					benefit: "Improves maintainability by splitting orchestration logic.",
					synthesis: this.synthesizeInterface(node),
				})
			}
		}

		return suggestions
	},

	/**
	 * PRODUCTION HARDENING: Synthesizes a virtual interface for a problematic module.
	 */
	synthesizeInterface(node: SpiderNode): string {
		const baseName = path.basename(node.path).split(".")[0]
		const interfaceName = `I${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}`

		// V140: Industrial Member Mapping
		const members = node.exports
			.filter((e) => e !== "default")
			.map((e) => `\t${e}: any; // Industrial member: Refined signature mapping recommended.`)

		const header = [
			"/**",
			" * [LAYER: DOMAIN]",
			" * Aromatic Synthesis: This interface was forensicly synthesized to break coupling",
			` * with the Fat Coordinator '${baseName}'.`,
			" */",
		].join("\n")

		return [header, `export interface ${interfaceName} {`, ...members, memberBlock(baseName), "}"].join("\n")
	},
}

function memberBlock(name: string): string {
	return [
		"\t/**",
		`\t * Industrial Placeholder: Dependents of ${name} should now consume this`,
		"\t * interface via Dependency Inversion to restore architectural integrity.",
		"\t */",
		"\tsync?(): Promise<void>;",
	].join("\n")
}
