import * as ts from "typescript"
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
	buildHealth: number
	integrityScore: number // V100: Structural integrity (0-100)
	steps: DecompositionStep[]
}

/**
 * SovereignDecomposer: The Architectural Scalpel.
 * Analyzes "Fat" or "High-Entropy" modules and provides a specific recipe for splitting them.
 */
export class SovereignDecomposer {
	/**
	 * V140: Industrial Decomposition Analysis.
	 * Calculates real integrity and health scores based on Forensic Node metadata.
	 */
	public analyze(filePath: string, content: string, node?: import("./spider/types").SpiderNode): DecompositionPlan {
		const sourceFile = ts.createSourceFile("analyze.ts", content, ts.ScriptTarget.Latest, true)
		const layer = getLayer(filePath)

		const steps: DecompositionStep[] = []

		// 1. Analyze Method-Level Logic Density vs I/O
		const visit = (node: ts.Node) => {
			if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.body) {
				const { density, hasIO } = this.analyzeNodeLogic(node, sourceFile)
				const name = node.name?.getText(sourceFile) || "anonymous"

				// VIOLATION: Pure Logic in INFRASTRUCTURE
				if (layer === "infrastructure" && density > 0.3 && !hasIO) {
					steps.push({
						action: "MOVE",
						target: `Logic '${name}'`,
						destination: "DOMAIN",
						reason: "This logic is purely computational (high density, no I/O) and should live in the Domain layer.",
						intentSuggestion: `[SOVEREIGN_INTENT: Pure domain logic for ${name}]`,
					})
				}

				// VIOLATION: Direct I/O in CORE/DOMAIN
				if ((layer === "core" || layer === "domain") && hasIO) {
					steps.push({
						action: "MOVE",
						target: `Logic '${name}'`,
						destination: "INFRASTRUCTURE",
						reason: "This logic performs direct I/O. Extract the I/O to a specialized adapter.",
						intentSuggestion: `[SOVEREIGN_INTENT: I/O Adapter for ${name}]`,
					})
				}
			}

			if (ts.isImportDeclaration(node)) {
				// No action here yet, handled after visit
			}

			ts.forEachChild(node, visit)
		}

		visit(sourceFile)

		// 2. Analyze Import Bloat
		let importCount = 0
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isImportDeclaration(node)) {
				importCount++
			}
		})

		if (importCount > 10) {
			steps.push({
				action: "DECOUPLE",
				target: "Module Imports",
				destination: "MULTIPLE",
				reason: `High import coupling (${importCount} > 10). Split this module into mission-focused services.`,
			})
		}

		// V140: Industrial Metric Actualization
		const namingPenalty = node ? (1 - node.namingScore) * 50 : 0
		const couplingPenalty = node ? Math.min(node.afferentCoupling * 2, 40) : 0
		const integrityScore = Math.max(0, 100 - namingPenalty - couplingPenalty)

		// V140: Build Health is a forensic aggregate of physical state and structural debt
		let buildHealth = 100
		if (node) {
			if (node.orphaned) buildHealth -= 30
			if (node.afferentCoupling > 15) buildHealth -= 20
			if (node.namingScore < 0.8) buildHealth -= 10
		}
		buildHealth = Math.max(0, buildHealth)

		return {
			filePath,
			currentLayer: layer,
			buildHealth,
			integrityScore,
			steps,
		}
	}

	private analyzeNodeLogic(
		node: ts.MethodDeclaration | ts.FunctionDeclaration,
		sourceFile: ts.SourceFile,
	): { density: number; hasIO: boolean } {
		let nodes = 0
		let logic = 0
		let hasIO = false

		const visit = (node: ts.Node) => {
			nodes++
			if (ts.isIfStatement(node) || ts.isSwitchStatement(node)) logic++

			const text = node.getText(sourceFile)
			// Detect I/O signals (fs, http, db calls)
			if (text.includes("fs.") || text.includes("fetch(") || text.includes(".save()")) {
				hasIO = true
			}
			ts.forEachChild(node, visit)
		}

		if (node.body) {
			visit(node.body)
		}

		return {
			density: nodes > 0 ? logic / nodes : 0,
			hasIO,
		}
	}
}
