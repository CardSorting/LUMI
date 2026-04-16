import * as path from "path"
import { SovereignDecomposer } from "./SovereignDecomposer"
import { SpiderEngine } from "./spider/SpiderEngine.js"

export interface AxiomViolation {
	axiom: string
	severity: "ERROR" | "WARN"
	message: string
	remediation?: string
	remediationSnippet?: string // PRODUCTION HARDENING: Proactive fix snippet for agent success
}

/**
 * SemanticAxiomEngine: The High-Lvl logic validator.
 * Enforces logical "Truths" and "Purity" rules that go beyond mere structure.
 */
export class SemanticAxiomEngine {
	private readonly SIMPLICITY_THRESHOLD = 1500 // V15: Industrial limit for Domain logic
	private readonly decomposer = new SovereignDecomposer()

	constructor() {}

	/**
	 * Validates a file's logic against defined architectural axioms.
	 * V150: Industrial Awakening (Hardened Enforcement).
	 */
	public validateAxioms(filePath: string, content: string, engine: SpiderEngine): AxiomViolation[] {
		const violations: AxiomViolation[] = []
		const normalizedPath = engine.normalizePath(filePath)
		const node = engine.nodes.get(normalizedPath)
		if (!node) return violations

		const isExempt = content.includes("@dietcode-passthrough") || content.includes("@sovereign-exception")

		// 1. Simplicity Axiom (AST Grounded)
		if (node.layer === "domain" || node.layer === "core") {
			const lines = content.split("\n").length
			if (lines > this.SIMPLICITY_THRESHOLD && !isExempt) {
				const plan = this.decomposer.analyze(filePath, content, node)
				const steps = plan.steps
					.map((s, i) => `${i + 1}. [${s.action}] ${s.target} -> ${s.destination}: ${s.reason}`)
					.join("\n")

				violations.push({
					axiom: "SIMPLICITY",
					severity: "ERROR",
					message: `Cognitive Bloat: ${node.layer.toUpperCase()} file exceeds industrial limit (${lines}/${this.SIMPLICITY_THRESHOLD} lines).`,
					remediation: `Sunder the module into specialized sub-components (Metabolic Fission). Recommended Decomposition Plan:\n\n${steps || "No automatic split detected. Manual decomposition required."}`,
				})
			}
		}

		// 2. Encapsulation Axiom (Barrel Bypass Detection)
		// Detects if an agent imports from a sub-directory when an index.ts file is available in the parent.
		const imports = node.imports
		for (const imp of imports) {
			if (imp.startsWith(".")) {
				const resolvedId = engine.resolveImportToNodeId(normalizedPath, imp)
				if (resolvedId) {
					const parts = resolvedId.split("/")
					const dir = parts.slice(0, -1).join("/")
					const fileName = parts[parts.length - 1]

					// If the file is inside a directory but NOT called index.ts, check if index.ts exists in that dir
					if (fileName !== "index.ts" && fileName !== "index.js") {
						const indexPath = path.join(dir, "index.ts")
						const indexPathJs = path.join(dir, "index.js")
						if (engine.nodes.has(indexPath) || engine.nodes.has(indexPathJs)) {
							violations.push({
								axiom: "ENCAPSULATION",
								severity: node.layer === "domain" ? "ERROR" : "WARN",
								message: `Barrel Bypass: Direct import detected in ${node.layer.toUpperCase()} layer. Symbol should be consumed via index barrel.`,
								remediation: `Use barrel export from ${dir} instead of direct import from ${fileName}.`,
							})
						}
					}
				}
			}
		}

		return violations
	}

	/**
	 * PRODUCTION HARDENING: Detects "Zero-Sum" refactors where an edit fixes one axiom but breaks another.
	 */
	public compareAxiomSessions(
		oldViolations: AxiomViolation[],
		newViolations: AxiomViolation[],
	): { status: "POSITIVE" | "ZERO_SUM" | "NEGATIVE"; message?: string } {
		const fixed = oldViolations.filter((ov) => !newViolations.some((nv) => nv.axiom === ov.axiom)).length
		const introduced = newViolations.filter((nv) => !oldViolations.some((ov) => ov.axiom === nv.axiom)).length

		if (introduced > 0 && fixed > 0 && introduced >= fixed) {
			return {
				status: "ZERO_SUM",
				message: `⚠️ NET-ZERO STRUCTURAL MOVE: You fixed ${fixed} axiom(s) but introduced ${introduced} new ones. This refactoring is trading one architectural debt for another.`,
			}
		}

		if (introduced > 0 && introduced > fixed) {
			return {
				status: "NEGATIVE",
				message: `🛑 STRUCTURAL REGRESSION: This edit introduces ${introduced - fixed} net-new axiomatic violations.`,
			}
		}

		return { status: "POSITIVE" }
	}
}
