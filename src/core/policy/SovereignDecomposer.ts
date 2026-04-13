import { Project, SyntaxKind } from "ts-morph"
import { getLayer } from "../../utils/joy-zoning"

export interface DecompositionStep {
	action: "EXTRACT" | "MOVE" | "DECOUPLE"
	target: string
	destination: string
	reason: string
	intentSuggestion?: string
}

export interface DecompositionPlan {
	filePath: string
	currentLayer: string
	integrityScore: number
	steps: DecompositionStep[]
}

/**
 * SovereignDecomposer: The Architectural Scalpel.
 * Analyzes "Fat" or "High-Entropy" modules and provides a specific recipe for splitting them.
 */
export class SovereignDecomposer {
	private project = new Project({ useInMemoryFileSystem: true })

	public analyze(filePath: string, content: string): DecompositionPlan {
		const sourceFile = this.project.createSourceFile("analyze.ts", content, { overwrite: true })
		const layer = getLayer(filePath)

		const steps: DecompositionStep[] = []

		// 1. Analyze Method-Level Logic Density vs I/O
		sourceFile.getClasses().forEach((cls) => {
			cls.getMethods().forEach((method) => {
				const { density, hasIO } = this.analyzeMethod(method)

				// VIOLATION: Pure Logic in INFRASTRUCTURE
				if (layer === "infrastructure" && density > 0.3 && !hasIO) {
					steps.push({
						action: "MOVE",
						target: `Method '${method.getName()}'`,
						destination: "DOMAIN",
						reason: "This method is pure business logic (high density, no I/O) and should live in the Domain layer for testability.",
						intentSuggestion: `[SOVEREIGN_INTENT: Pure domain logic for ${method.getName()}]`,
					})
				}

				// VIOLATION: Direct I/O in CORE/DOMAIN
				if ((layer === "core" || layer === "domain") && hasIO) {
					steps.push({
						action: "MOVE",
						target: `Method '${method.getName()}'`,
						destination: "INFRASTRUCTURE",
						reason: "This method performs direct I/O. Extract the I/O to an Interface and inject it to maintain sovereignty.",
						intentSuggestion: `[SOVEREIGN_INTENT: I/O Adapter for ${method.getName()}]`,
					})
				}
			})
		})

		// 2. Analyze Import Bloat
		const imports = sourceFile.getImportDeclarations()
		if (imports.length > 10) {
			steps.push({
				action: "DECOUPLE",
				target: "Module Imports",
				destination: "MULTIPLE",
				reason: "High import coupling (> 10). Split this module into mission-focused services.",
			})
		}

		this.project.removeSourceFile(sourceFile)

		return {
			filePath,
			currentLayer: layer.toUpperCase(),
			integrityScore: 100 - steps.length * 15,
			steps,
		}
	}

	private analyzeMethod(method: MethodDeclaration): { density: number; hasIO: boolean } {
		let nodes = 0
		let logic = 0
		let hasIO = false

		method.forEachDescendant((node) => {
			nodes++
			if (node.isKind(SyntaxKind.IfStatement) || node.isKind(SyntaxKind.SwitchStatement)) logic++

			// Detect I/O signals (fs, http, db calls)
			// In a real implementation, we'd check for specific library symbols
			if (node.getText().includes("fs.") || node.getText().includes("fetch(") || node.getText().includes(".save()")) {
				hasIO = true
			}
		})

		return {
			density: nodes > 0 ? logic / nodes : 0,
			hasIO,
		}
	}
}
