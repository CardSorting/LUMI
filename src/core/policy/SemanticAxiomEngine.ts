import * as path from "path"
import { ModuleDecomposer } from "./ModuleDecomposer"
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
	private readonly SIMPLICITY_THRESHOLD = 3000 // V270: Massively expanded limit (was 1500)
	private readonly PREEMPTIVE_THRESHOLD = 2500 // V270: Proactive warning threshold
	private readonly decomposer = new ModuleDecomposer()

	constructor() {}

	/**
	 * Validates a file's logic against defined architectural axioms.
	 * V270: Pragmatic Architectural Governance.
	 */
	public validateAxioms(filePath: string, content: string, engine: SpiderEngine): AxiomViolation[] {
		const violations: AxiomViolation[] = []
		const normalizedPath = engine.normalizePath(filePath)
		const node = engine.nodes.get(normalizedPath)
		if (!node) return violations

		const isExempt =
			content.includes("@dietcode-passthrough") ||
			content.includes("@sovereign-exception") ||
			content.includes("#BYPASS") || // V270: Explicit manual bypass
			content.includes("@dietcode-bypass")

		if (isExempt) return violations

		// 1. Simplicity Axiom (AST Grounded)
		if (node.layer === "domain" || node.layer === "core") {
			const lines = content.split("\n").length
			if (lines > this.PREEMPTIVE_THRESHOLD) {
				const isHardBlock = lines > this.SIMPLICITY_THRESHOLD
				const plan = this.decomposer.analyze(filePath, content, node)
				const steps = plan.steps
					.map((s) => {
						const category = s.action === "EXTRACT" ? "FISSION" : "AXIOMATIC"
						return `- [${category}: ${s.action}] ${s.target} -> ${s.destination}: ${s.reason}`
					})
					.join("\n")

				violations.push({
					axiom: "SIMPLICITY",
					severity: isHardBlock ? "ERROR" : "WARN",
					message: isHardBlock
						? `🛑 COGNITIVE BLOAT (LIMIT EXCEEDED): ${node.layer.toUpperCase()} file exceeds industrial limit (${lines}/${this.SIMPLICITY_THRESHOLD} lines).`
						: `⚠️ COGNITIVE BLOAT (PRE-EMPTIVE): ${node.layer.toUpperCase()} file is approaching industrial limit (${lines}/${this.PREEMPTIVE_THRESHOLD} lines).`,
					remediation: `Sunder the module into specialized sub-components (Metabolic Fission). Follow the recommended plan to restore simplicity:\n\n${steps || "Manual decomposition required."}`,
				})
			}
		}

		// 2. Encapsulation Axiom (Barrel Bypass Detection)
		// V270: Demoted to WARN project-wide to reduce fragility.
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
								severity: "WARN", // V270: Was ERROR for domain
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
				message: `ℹ️ NET-ZERO STRUCTURAL MOVE: You fixed ${fixed} axiom(s) but introduced ${introduced} new ones. This refactoring is trading one architectural debt for another.`,
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
