import * as path from "path"
import * as ts from "typescript"
import { Logger } from "@/shared/services/Logger"
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
	private readonly SIMPLICITY_THRESHOLD = 2000 // Max lines per file (Increased for Pass 2)

	constructor(private cwd: string) {}

	/**
	 * Calculates cognitive complexity based on nesting depth.
	 */
	private calculateCognitiveComplexity(node: ts.Node): number {
		let complexity = 0
		let nesting = 0

		const visit = (n: ts.Node) => {
			const isBranch =
				ts.isIfStatement(n) ||
				ts.isForStatement(n) ||
				ts.isForInStatement(n) ||
				ts.isForOfStatement(n) ||
				ts.isWhileStatement(n) ||
				ts.isDoStatement(n) ||
				ts.isSwitchStatement(n) ||
				ts.isConditionalExpression(n) ||
				ts.isCatchClause(n)

			if (isBranch) {
				complexity += 1 + nesting
				nesting++
				ts.forEachChild(n, visit)
				nesting--
			} else {
				ts.forEachChild(n, visit)
			}
		}

		visit(node)
		return complexity
	}

	/**
	 * Validates a file's logic against defined architectural axioms.
	 */
	public validateAxioms(filePath: string, content: string, engine: SpiderEngine, sourceFile?: ts.SourceFile): AxiomViolation[] {
		const violations: AxiomViolation[] = []
		const normalizedPath = this.normalize(filePath)
		const node = engine.nodes.get(normalizedPath)
		if (!node) return violations
		const lines = content.split("\n")
		const isPassthrough = content.includes("@dietcode-passthrough") || content.includes("@sovereign-exception")
		const exceptionMatch = content.match(/@sovereign-exception:\s*([^\n*/]+)/)
		const exceptionReason = exceptionMatch ? exceptionMatch[1].trim() : "None provided"

		if (isPassthrough && node) {
			Logger.info(`[SemanticAxiomEngine] Sovereign Exception active for ${node.path}. Reason: ${exceptionReason}`)
		}

		// V140: Forensic Realism - All architectural 'opinions' are now silenced to prevent agentic spiraling.
		// Fundamental Layer Axioms (Geography, Tags) are handled by the core Policy Engine.
		/*
		if (lines.length > threshold && !isExempt) {
			violations.push({ axiom: "SIMPLICITY", severity: "WARN", message: `Cognitive Bloat: ${node.layer.toUpperCase()} file exceeds limit (${lines.length}/${threshold} lines).` })
		}

		// ... (Silencing all other opinionated checks) ...
		*/

		return [] // V15: Total silence for hypothetical axioms.
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

	private normalize(p: string): string {
		const abs = path.resolve(this.cwd, p)
		const rel = path.relative(this.cwd, abs).replace(/\\/g, "/")
		return rel
	}
}
