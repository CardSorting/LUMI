import { SpiderEngine } from "./SpiderEngine.js"
import { Logger } from "@/shared/services/Logger"
import * as path from "path"

export interface AxiomViolation {
	axiom: string
	severity: "ERROR" | "WARN"
	message: string
}

/**
 * SemanticAxiomEngine: The High-Lvl logic validator.
 * Enforces logical "Truths" and "Purity" rules that go beyond mere structure.
 */
export class SemanticAxiomEngine {
	private readonly SIMPLICITY_THRESHOLD = 300 // Max lines per file
	private readonly COMPLEXITY_THRESHOLD = 15  // Max rough cyclomatic "score"

	constructor(private cwd: string) {}

	/**
	 * Validates a file's logic against defined architectural axioms.
	 */
	public validateAxioms(filePath: string, content: string, engine: SpiderEngine): AxiomViolation[] {
		const violations: AxiomViolation[] = []
		const absolutePath = path.resolve(this.cwd, filePath)
		const lines = content.split("\n")

		// 1. Axiom: SIMPLICITY (Cognitive Weight)
		if (lines.length > this.SIMPLICITY_THRESHOLD) {
			violations.push({
				axiom: "SIMPLICITY",
				severity: "ERROR",
				message: `Cognitive Bloat: File exceeds ${this.SIMPLICITY_THRESHOLD} lines (${lines.length}). Logic must be split.`
			})
		}

		// 2. Axiom: PURITY (Logic Leaks)
		const node = engine.nodes.get(this.normalize(filePath))
		if (node && node.layer === "core") {
			const infrastructureLeaks = node.imports.filter(imp => {
				const res = engine.resolveImportToNodeId(node.path, imp)
				return res && engine.nodes.get(res)?.layer === "infrastructure"
			})

			if (infrastructureLeaks.length > 0) {
				violations.push({
					axiom: "PURITY",
					severity: "ERROR",
					message: `Purity Violation: Core logic leaking into Infrastructure via: ${infrastructureLeaks.join(", ")}`
				})
			}
		}

		// 3. Axiom: STABILITY (Dependency Flow)
		if (node && (node.layer === "domain" || node.layer === "core")) {
			const volatileImports = node.imports.filter(imp => {
				const res = engine.resolveImportToNodeId(node.path, imp)
				const targetNode = res ? engine.nodes.get(res) : null
				return targetNode && (targetNode.layer === "ui" || targetNode.layer === "plumbing")
			})

			if (volatileImports.length > 0) {
				violations.push({
					axiom: "STABILITY",
					severity: "WARN",
					message: `Stability Warning: Stable logic (${node.layer}) depends on Volatile logic: ${volatileImports.join(", ")}`
				})
			}
		}

		return violations
	}

	private normalize(p: string): string {
		const abs = path.resolve(this.cwd, p)
		const rel = path.relative(this.cwd, abs).replace(/\\/g, "/")
		return rel
	}
}
