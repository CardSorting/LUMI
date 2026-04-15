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
	private readonly SIMPLICITY_THRESHOLD = 1500 // Max lines per file

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

		// 1. Axiom: SIMPLICITY (Cognitive Weight)
		// PRODUCTION HARDENING: Layer-aware thresholds. Domain is strict (800), others use default (1500).
		const threshold = node.layer === "domain" ? 800 : this.SIMPLICITY_THRESHOLD
		const isExempt =
			normalizedPath.includes("config") ||
			normalizedPath.includes(".json") ||
			normalizedPath.includes(".yaml") ||
			normalizedPath.includes(".yml") ||
			normalizedPath.includes("manifest") ||
			normalizedPath.includes("data") ||
			normalizedPath.includes("assets") ||
			content.includes("@generated") ||
			content.includes("Automatically generated") ||
			normalizedPath.endsWith("scratchpad.md") ||
			normalizedPath.includes("/dist/") ||
			normalizedPath.includes("/node_modules/") ||
			normalizedPath.includes("/.spider/") ||
			normalizedPath.includes("/.vscode/") ||
			content.includes("@sovereign-exception: SIMPLICITY")

		if (lines.length > threshold && !isExempt) {
			violations.push({
				axiom: "SIMPLICITY",
				severity: "ERROR",
				message: `Cognitive Bloat: ${node.layer.toUpperCase()} file exceeds limit (${lines.length}/${threshold} lines).`,
				remediation: "Split the file into focused sub-modules or extract utility functions to @/utils.",
				remediationSnippet: "/* Recommended: Extract core logic to focused sub-modules */",
			})
		}

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
					remediationSnippet: "const myVar = ... // Use const instead of let",
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
				// PRODUCTION HARDENING: Exempt standard ubiquitous library types (express Request/Response)
				// if they are used but don't represent a concrete infrastructure implementation leak.
				if (imp === "express" || imp.includes("express-serve-static-core") || imp.startsWith("@types/express"))
					return false

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

		// 5. Axiom of Purity: Data vs. Utility Distinction
		// PRODUCTION HARDENING: Flag "Utility Classes" in Domain/Core layers.
		if (node.layer === "domain" || node.layer === "core") {
			const classDeclarations = ast.statements.filter(ts.isClassDeclaration)
			for (const cls of classDeclarations) {
				const className = cls.name?.text || ""
				const isUtilityClass =
					className.endsWith("Util") ||
					className.endsWith("Utils") ||
					className.endsWith("Helper") ||
					className.endsWith("Formatter") ||
					className.endsWith("Manager")
				const isDataStructure =
					className.endsWith("Data") ||
					className.endsWith("DTO") ||
					className.endsWith("Request") ||
					className.endsWith("Response") ||
					className.endsWith("Event") ||
					className.endsWith("Message")

				if (isUtilityClass && !isDataStructure) {
					violations.push({
						axiom: "PURITY",
						severity: "WARN",
						message: `Utility/Manager Class '${className}' detected in ${node.layer.toUpperCase()} layer.`,
						remediation: "Move stateless utility classes to the PLUMBING layer or convert to pure functions.",
					})
				}
			}
		}

		// 6. Axiom: COGNITIVE_COMPLEXITY
		// PRODUCTION HARDENING: Layer-aware thresholds. Domain/Core are strict (25/50).
		// Infrastructure/Plumbing/UI are more lenient (50/100) as they often handle complex I/O or rendering.
		const isStrictLayer = node.layer === "domain" || node.layer === "core"
		const warnThreshold = isStrictLayer ? 25 : 50
		const errorThreshold = isStrictLayer ? 50 : 100

		const complexity = this.calculateCognitiveComplexity(ast)
		if (complexity > warnThreshold) {
			violations.push({
				axiom: "COGNITIVE_COMPLEXITY",
				severity: complexity > errorThreshold ? "ERROR" : "WARN",
				message:
					complexity > errorThreshold
						? `CRITICAL logic complexity (${complexity}). This module is too complex to maintain safely.`
						: `High logic complexity (${complexity}). This module is becoming difficult to reason about.`,
				remediation: "Extract complex branching logic into smaller, testable helper functions.",
			})
		}

		// 7. Axiom: COHESION (Fragmented Models)
		// PRODUCTION HARDENING: Warn when a Domain file is too small, suggesting it should be merged with related concepts.
		if (node.layer === "domain" && !isExempt && lines.length < 20) {
			const nonCommentLines = lines.filter(
				(l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
			).length
			if (nonCommentLines < 10) {
				// V8: Cohesion Auto-Healing Suggestions
				const dir = path.dirname(node.path)
				const siblings = Array.from(engine.nodes.values())
					.map((n) => n.path)
					.filter((p: string) => path.dirname(p) === dir && p !== node.path && p.endsWith(".ts"))
				const mergeTarget = siblings.length > 0 ? path.basename(siblings[0]) : "another Domain file"

				violations.push({
					axiom: "COHESION",
					severity: "WARN",
					message: `Fragmented Domain Model: File is very small (${nonCommentLines} logical lines).`,
					remediation: `Consider merging ${path.basename(node.path)} into ${mergeTarget} to maintain structural density.`,
					remediationSnippet: `// Merge into ${mergeTarget}`,
				})
			}
		}

		// 8. Axiom: AUTONOMY (Automation Vectors)
		// PRODUCTION HARDENING: Flag logic that is boilerplate-heavy and could be extracted.
		if (node.layer === "infrastructure") {
			const hasBoilerplate =
				content.includes("try {") && content.includes("} catch (e) {") && content.includes("Logger.error")
			if (hasBoilerplate && lines.length > 100) {
				violations.push({
					axiom: "AUTONOMY",
					severity: "WARN",
					message: "Boilerplate saturation: Infrastructure module contains significant repetitive error handling.",
					remediation: "Extract a shared base class or utility decorator to centralize standard I/O error handling.",
				})
			}
		}

		return isPassthrough ? violations.map((v) => ({ ...v, severity: "WARN" as const })) : violations
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
