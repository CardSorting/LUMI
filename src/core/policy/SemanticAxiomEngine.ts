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
	 * Validates a file's logic against defined architectural axioms.
	 */
	public validateAxioms(filePath: string, content: string, engine: SpiderEngine): AxiomViolation[] {
		const violations: AxiomViolation[] = []
		const node = engine.nodes.get(this.normalize(filePath))
		const lines = content.split("\n")

		// 1. Axiom: SIMPLICITY (Cognitive Weight)
		if (lines.length > this.SIMPLICITY_THRESHOLD) {
			violations.push({
				axiom: "SIMPLICITY",
				severity: "ERROR",
				message: `Cognitive Bloat: File exceeds ${this.SIMPLICITY_THRESHOLD} lines (${lines.length}).`,
				remediation: "Split the file into focused sub-modules or extract utility functions to @/utils.",
			})
		}

		if (!node) return violations

		// 2. Axiom of Statelessness ([LAYER: PLUMBING])
		if (node.layer === "plumbing") {
			const sourceFile = ts.createSourceFile("temp.ts", content, ts.ScriptTarget.Latest, true)
			let mutableGlobalsFound = false

			ts.forEachChild(sourceFile, (node) => {
				if (ts.isVariableStatement(node)) {
					const isConst = (ts.getCombinedModifierFlags(node.declarationList) & ts.ModifierFlags.Const) !== 0
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
				const filename = path.basename(resolved)
				// Violation if it doesn't look like an interface (e.g. LocalStorage.ts vs IStorage.ts)
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
					remediation: `Extract interface from ${leaks[0]} and depend on that instead. Run: arch_heal extract_interface ${leaks[0]}`,
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
