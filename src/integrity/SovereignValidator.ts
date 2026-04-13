import { Project, SyntaxKind } from "ts-morph"
import { SovereignPolicy } from "../core/policy/SovereignPolicy"
import { getLayer } from "../utils/joy-zoning"

/**
 * SovereignValidator: The Architectural Unit-Test Engine.
 * Allows modules to verify their own structural integrity during CI/CD.
 */
export class SovereignValidator {
	private project = new Project({ useInMemoryFileSystem: true })

	constructor(private cwd: string) {}

	/**
	 * Validates a file's logic density and I/O entropy against its layer axioms.
	 */
	public validate(
		filePath: string,
		content: string,
	): {
		ok: boolean
		score: number
		violations: string[]
		metrics: { density: number; entropy: number }
		excepted?: boolean
	} {
		// --- Exception Suppression ---
		if (content.includes("[SOVEREIGN_EXCEPTION]")) {
			return {
				ok: true,
				score: 100,
				violations: [],
				metrics: { density: 0, entropy: 0 },
				excepted: true,
			}
		}

		const sourceFile = this.project.createSourceFile("temp.ts", content, { overwrite: true })
		const layer = getLayer(filePath)
		const policy = SovereignPolicy.getInstance(this.cwd).getLayerConfig(layer)

		let totalNodes = 0
		let logicNodes = 0
		sourceFile.forEachDescendant((node) => {
			totalNodes++
			if (
				node.isKind(SyntaxKind.IfStatement) ||
				node.isKind(SyntaxKind.ForStatement) ||
				node.isKind(SyntaxKind.SwitchStatement)
			) {
				logicNodes++
			}
		})

		const imports = sourceFile.getImportDeclarations()
		const ioImports = imports.filter((imp) => {
			const spec = imp.getModuleSpecifierValue()
			return !spec.startsWith(".") && !spec.startsWith("@/")
		}).length

		const density = totalNodes > 0 ? logicNodes / totalNodes : 0
		const entropy = imports.length > 0 ? ioImports / imports.length : 0

		const violations: string[] = []

		// Axiom Checks
		if (layer === "domain" && entropy > policy.maxIOEntropy) {
			violations.push(
				`DOMAIN layer must have ${policy.maxIOEntropy * 100}% I/O entropy. Found: ${(entropy * 100).toFixed(1)}%`,
			)
		}
		if (layer === "domain" && density < policy.optimalLogicDensity) {
			violations.push(
				`DOMAIN layer should have high logic density (> ${policy.optimalLogicDensity * 100}%). Found: ${(density * 100).toFixed(1)}%`,
			)
		}
		if (layer === "core" && entropy > policy.maxIOEntropy) {
			violations.push(
				`CORE layer must have ${policy.maxIOEntropy * 100}% direct entropy. Found: ${(entropy * 100).toFixed(1)}%`,
			)
		}

		this.project.removeSourceFile(sourceFile)

		return {
			ok: violations.length === 0,
			score: Math.max(0, 100 - violations.length * 20),
			violations,
			metrics: { density, entropy },
		}
	}
}
