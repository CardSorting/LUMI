import * as path from "path"
import * as ts from "typescript"
import { SpiderEngine } from "./SpiderEngine.js"

export interface AxiomViolation {
	axiom: string
	severity: "ERROR" | "WARN"
	message: string
	remediation?: string
}

/**
 * SemanticAxiomEngine: The High-Lvl logic validator.
 * Enforces logical "Truths" and "Purity" rules that go beyond mere structure.
 */
export class SemanticAxiomEngine {
	private readonly SIMPLICITY_THRESHOLD = 300 // Max lines per file

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
		const lines = content.split("\n")

		// 1. Axiom: SIMPLICITY (Cognitive Weight)
		// PRODUCTION HARDENING: Exempt configuration and generated files from hard line-count blocks
		const isExempt =
			normalizedPath.includes("config") ||
			normalizedPath.includes(".json") ||
			normalizedPath.includes(".yaml") ||
			normalizedPath.includes(".yml") ||
			normalizedPath.includes("manifest") ||
			content.includes("@generated") ||
			content.includes("Automatically generated")

		if (lines.length > this.SIMPLICITY_THRESHOLD && !isExempt) {
			violations.push({
				axiom: "SIMPLICITY",
				severity: "ERROR",
				message: `Cognitive Bloat: File exceeds ${this.SIMPLICITY_THRESHOLD} lines (${lines.length}).`,
				remediation: "Split the file into focused sub-modules or extract utility functions to @/utils.",
			})
		}

		if (!node) return violations

		const ast = sourceFile || ts.createSourceFile("temp.ts", content, ts.ScriptTarget.Latest, true)

		// 2. Axiom of Statelessness ([LAYER: PLUMBING])
		if (node.layer === "plumbing") {
			let mutableGlobalsFound = false

			ts.forEachChild(ast, (n) => {
				if (ts.isVariableStatement(n)) {
					const isConst = (n.declarationList.flags & ts.NodeFlags.Const) !== 0
					if (!isConst) {
						mutableGlobalsFound = true
					}
				}
			})

			if (mutableGlobalsFound) {
				violations.push({
					axiom: "STATELESSNESS",
					severity: "ERROR",
					message: "Plumbing logic must be stateless. Mutable top-level variables (let/var) are blocked.",
					remediation: "Convert 'let' or 'var' to 'const' or move state into a class instance if strictly necessary.",
				})
			}
		}

		// 3. Axiom of Interface Segregation (Fat Coordinators)
		if (node.layer === "core") {
			const infraDeps = node.imports.filter((imp) => engine.resolveLayer(node.path, imp) === "infrastructure")
			if (infraDeps.length > 5) {
				violations.push({
					axiom: "INTERFACE_SEGREGATION",
					severity: "WARN",
					message: `Fat Coordinator: Module depends on ${infraDeps.length} infrastructure adapters.`,
					remediation: "Refactor this core logic into smaller, mission-focused services.",
				})
			}
		}

		// 4. Axiom of Dependency Inversion (Sovereign Logic)
		if (node.layer === "domain" || node.layer === "core") {
			const concreteImports = node.imports.filter((imp) => {
				const resolved = engine.resolveImportToNodeId(node.path, imp)
				if (!resolved) return false
				const targetNode = engine.nodes.get(resolved)
				if (targetNode) {
					return !targetNode.isInterface
				}
				const filename = path.basename(resolved)
				return !filename.startsWith("I") && !resolved.includes("/interfaces/") && !resolved.includes("/types/")
			})

			const leaks = concreteImports.filter((imp) => {
				const layer = engine.resolveLayer(node.path, imp)
				return layer === "infrastructure"
			})

			if (leaks.length > 0) {
				violations.push({
					axiom: "DEPENDENCY_INVERSION",
					severity: "ERROR",
					message: `Sovereign Leak: Logic depends on concrete implementation: ${leaks.join(", ")}`,
					remediation: `Extract interface from ${leaks[0]} and depend on that instead.`,
				})
			}
		}

		// 5. Axiom: COGNITIVE_COMPLEXITY
		const complexity = this.calculateCognitiveComplexity(ast)
		if (complexity > 25) {
			violations.push({
				axiom: "COGNITIVE_COMPLEXITY",
				severity: complexity > 50 ? "ERROR" : "WARN",
				message: `High logic complexity (${complexity}). This module is becoming difficult to reason about.`,
				remediation: "Extract complex branching logic into smaller, testable helper functions.",
			})
		}

		return violations
	}

	private normalize(p: string): string {
		const abs = path.resolve(this.cwd, p)
		const rel = path.relative(this.cwd, abs).replace(/\\/g, "/")
		return rel
	}
}
