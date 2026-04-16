import * as ts from "typescript"
import { getLayer } from "../../utils/joy-zoning"

export interface DecompositionStep {
	action: "EXTRACT" | "MOVE" | "DECOUPLE"
	target: string
	destination: string
	reason: string
	risk?: "LOW" | "MEDIUM" | "HIGH"
	boilerplate?: string
	intentSuggestion?: string
}

export interface DecompositionPlan {
	filePath: string
	currentLayer: string
	buildHealth: number
	projectedHealth?: number
	integrityScore: number // V100: Structural integrity (0-100)
	projectedIntegrity?: number
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
		const totalLines = content.split("\n").length

		const steps: DecompositionStep[] = []
		const symbolGraph = this.buildLocalSymbolGraph(sourceFile)
		const islands = this.findExtractionIslands(symbolGraph)

		// 1. Analyze Method-Level Logic Density vs I/O
		const visit = (node: ts.Node) => {
			if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.body) {
				const { density, hasIO } = this.analyzeNodeLogic(node, sourceFile)
				const name = (node as any).name?.getText(sourceFile) || "anonymous"

				// VIOLATION: Pure Logic in INFRASTRUCTURE
				if (layer === "infrastructure" && density > 0.3 && !hasIO) {
					steps.push({
						action: "MOVE",
						target: `Logic '${name}'`,
						destination: "DOMAIN",
						risk: "MEDIUM",
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
						risk: "MEDIUM",
						reason: "This logic performs direct I/O. Extract the I/O to a specialized adapter.",
						intentSuggestion: `[SOVEREIGN_INTENT: I/O Adapter for ${name}]`,
					})
				}
			}

			ts.forEachChild(node, visit)
		}

		visit(sourceFile)

		// 2. Metabolic Fission: Identify High-Mass Entities (V160 Forensic Tracking)
		if (totalLines > 800) {
			const islandImports = this.mapSourceImports(sourceFile)

			ts.forEachChild(sourceFile, (n) => {
				if (ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isFunctionDeclaration(n)) {
					const name = (n as any).name?.getText(sourceFile) || "anonymous"
					const start = sourceFile.getLineAndCharacterOfPosition(n.getStart()).line
					const end = sourceFile.getLineAndCharacterOfPosition(n.getEnd()).line
					const mass = end - start + 1

					// If an entity is an "Island" or "Leaf", it's LOW_RISK (V160)
					const islandSymbols = islands.find((island) => island.includes(name)) || [name]
					const isIsland = islands.some((island) => island.includes(name) && island.length > 0)
					const dependents = symbolGraph[name]?.dependents.length || 0

					// V180: Zombie Sensing - Detect internal helpers used only by this entity
					const zombies = this.detectZombieSymbols(islandSymbols, symbolGraph)
					const extendedIsland = [...islandSymbols, ...zombies]

					// If an entity is > 20% of the total file mass and file is large
					if (mass > 200 || (totalLines > 1200 && mass > 100)) {
						const boilerplate = this.generateBoilerplate(extendedIsland, sourceFile, islandImports, layer)

						steps.push({
							action: "EXTRACT",
							target: `${ts.isClassDeclaration(n) ? "Class" : "Entity"} '${name}'`,
							destination: "NEW_MODULE",
							risk: isIsland && islandSymbols.length > 0 ? "LOW" : dependents === 0 ? "LOW" : "HIGH",
							reason: `Metabolic Bloat: '${name}' consumes ${mass} lines (${Math.round((mass / totalLines) * 100)}% of file). ${isIsland ? "Identified as a self-contained island." : dependents === 0 ? "Identified as a leaf node." : `WARNING: This entity is used by ${dependents} other symbols locally.`}${zombies.length > 0 ? ` [V180: ${zombies.length} Zombie Symbols detected and included in fission blueprint].` : ""}`,
							boilerplate,
							intentSuggestion: `[SOVEREIGN_INTENT: Extract ${name} to sovereign module]`,
						})
					}
				}
			})
		}

		// 3. Shadow Complexity & God Methods (V150 Forensic Pass)
		const complexVisit = (n: ts.Node, depth: number) => {
			if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.body) {
				const start = sourceFile.getLineAndCharacterOfPosition(n.getStart()).line
				const end = sourceFile.getLineAndCharacterOfPosition(n.getEnd()).line
				const methodMass = end - start + 1
				const name = (n as any).name?.getText(sourceFile) || "anonymous"

				if (methodMass > 150) {
					steps.push({
						action: "EXTRACT",
						target: `God Method '${name}'`,
						destination: "HELPER_FUNCTIONS",
						risk: "MEDIUM",
						reason: `Atomic Bloat: Method '${name}' is ${methodMass} lines. Factor out sub-procedures.`,
						intentSuggestion: `[SOVEREIGN_INTENT: Decompose God Method ${name}]`,
					})
				}
			}

			// Detect deep nesting
			if (ts.isIfStatement(n) || ts.isForStatement(n) || ts.isSwitchStatement(n)) {
				if (depth > 4) {
					steps.push({
						action: "DECOUPLE",
						target: "Nested Logic",
						destination: "PRIVATE_METHOD",
						risk: "LOW",
						reason: "Shadow Complexity: Deep nesting detected (depth > 4). Extract the inner logic to a private method.",
					})
				}
				ts.forEachChild(n, (child) => complexVisit(child, depth + 1))
			} else {
				ts.forEachChild(n, (child) => complexVisit(child, depth))
			}
		}
		complexVisit(sourceFile, 0)

		// 4. Analyze Import Bloat
		let importCount = 0
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isImportDeclaration(node)) {
				importCount++
			}
		})

		if (importCount > 12) {
			steps.push({
				action: "DECOUPLE",
				target: "Module Imports",
				destination: "MULTIPLE",
				risk: "HIGH",
				reason: `High import coupling (${importCount} > 12). Split this module into mission-focused services.`,
			})
		}

		// V140: Industrial Metric Actualization
		const namingPenalty = node ? (1 - node.namingScore) * 50 : 0
		const couplingPenalty = node ? Math.min(node.afferentCoupling * 2, 40) : 0
		const complexityPenalty = totalLines > 1500 ? 50 : totalLines > 1200 ? 20 : 0
		const integrityScore = Math.max(0, 100 - namingPenalty - couplingPenalty - complexityPenalty)

		// V140: Build Health is a forensic aggregate of physical state and structural debt
		let buildHealth = 100
		if (node) {
			if (node.orphaned) buildHealth -= 30
			if (node.afferentCoupling > 15) buildHealth -= 20
			if (node.namingScore < 0.8) buildHealth -= 10
		}
		if (totalLines > 1500) buildHealth -= 40
		buildHealth = Math.max(0, buildHealth)

		const plan: DecompositionPlan = {
			filePath,
			currentLayer: layer,
			buildHealth,
			integrityScore,
			steps,
		}

		// V180: Projected Metric Simulation
		const { projectedHealth, projectedIntegrity } = this.calculateProjectedMetrics(plan, totalLines, steps, sourceFile)
		plan.projectedHealth = projectedHealth
		plan.projectedIntegrity = projectedIntegrity

		return plan
	}

	private buildLocalSymbolGraph(sourceFile: ts.SourceFile): Record<string, { dependents: string[]; dependencies: string[] }> {
		const symbols: Record<string, { dependents: string[]; dependencies: string[] }> = {}

		// 1. Identify all top-level declarations
		ts.forEachChild(sourceFile, (node) => {
			if (
				ts.isClassDeclaration(node) ||
				ts.isFunctionDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node)
			) {
				const name = node.name?.getText(sourceFile)
				if (name) {
					symbols[name] = { dependents: [], dependencies: [] }
				}
			}
		})

		// 2. Map dependencies
		ts.forEachChild(sourceFile, (node) => {
			let currentSymbol: string | null = null
			if (
				ts.isClassDeclaration(node) ||
				ts.isFunctionDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node)
			) {
				currentSymbol = node.name?.getText(sourceFile) || null
			}

			if (currentSymbol && symbols[currentSymbol]) {
				const visit = (n: ts.Node) => {
					if (ts.isIdentifier(n)) {
						const id = n.getText(sourceFile)
						if (symbols[id] && id !== currentSymbol) {
							if (!symbols[currentSymbol!].dependencies.includes(id)) {
								symbols[currentSymbol!].dependencies.push(id)
							}
							if (!symbols[id].dependents.includes(currentSymbol!)) {
								symbols[id].dependents.push(currentSymbol!)
							}
						}
					}
					ts.forEachChild(n, visit)
				}
				ts.forEachChild(node, visit)
			}
		})

		return symbols
	}

	private findExtractionIslands(graph: Record<string, { dependents: string[]; dependencies: string[] }>): string[][] {
		const islands: string[][] = []
		const visited = new Set<string>()

		for (const symbol of Object.keys(graph)) {
			if (!visited.has(symbol)) {
				const island: string[] = []
				const queue = [symbol]
				visited.add(symbol)

				while (queue.length > 0) {
					const current = queue.shift()!
					island.push(current)

					const neighbors = [...graph[current].dependencies, ...graph[current].dependents]
					for (const neighbor of neighbors) {
						if (!visited.has(neighbor)) {
							visited.add(neighbor)
							queue.push(neighbor)
						}
					}
				}
				islands.push(island)
			}
		}

		return islands
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

	private detectZombieSymbols(
		island: string[],
		graph: Record<string, { dependents: string[]; dependencies: string[] }>,
	): string[] {
		const zombies: string[] = []
		const islandSet = new Set(island)

		for (const symbol of Object.keys(graph)) {
			if (islandSet.has(symbol)) continue

			// A symbol is a zombie if all its dependents are within the island
			const dependents = graph[symbol].dependents
			if (dependents.length > 0 && dependents.every((dep) => islandSet.has(dep))) {
				zombies.push(symbol)
			}
		}

		return zombies
	}

	private calculateProjectedMetrics(
		plan: DecompositionPlan,
		totalLines: number,
		steps: DecompositionStep[],
		sourceFile: ts.SourceFile,
	): { projectedHealth: number; projectedIntegrity: number } {
		let linesRemoved = 0
		steps
			.filter((s) => s.action === "EXTRACT" && s.risk === "LOW")
			.forEach((step) => {
				// Find the mass of the target to subtract
				ts.forEachChild(sourceFile, (n) => {
					const name = (n as any).name?.getText(sourceFile)
					if (name && step.target.includes(`'${name}'`)) {
						const start = sourceFile.getLineAndCharacterOfPosition(n.getStart()).line
						const end = sourceFile.getLineAndCharacterOfPosition(n.getEnd()).line
						linesRemoved += end - start + 1
					}
				})
			})

		const projectedLines = Math.max(0, totalLines - linesRemoved)

		// Recalculate based on projected lines
		const complexityPenalty = projectedLines > 1500 ? 50 : projectedLines > 1200 ? 20 : 0
		const projectedIntegrity = Math.max(0, plan.integrityScore + (plan.integrityScore < 100 ? 10 : 0)) // Hypothetical boost

		let projectedHealth = plan.buildHealth
		if (projectedLines <= 1500 && totalLines > 1500) projectedHealth += 40
		else if (projectedLines <= 1200 && totalLines > 1200) projectedHealth += 20

		return {
			projectedHealth: Math.min(100, projectedHealth),
			projectedIntegrity: Math.min(100, projectedIntegrity),
		}
	}

	private mapSourceImports(sourceFile: ts.SourceFile): ts.ImportDeclaration[] {
		const imports: ts.ImportDeclaration[] = []
		ts.forEachChild(sourceFile, (n) => {
			if (ts.isImportDeclaration(n)) {
				imports.push(n)
			}
		})
		return imports
	}

	private generateBoilerplate(
		symbols: string[],
		sourceFile: ts.SourceFile,
		imports: ts.ImportDeclaration[],
		layer: string,
	): string {
		const islandNodes: ts.Node[] = []
		const externalDeps = new Set<string>()

		// 1. Identify all nodes belonging to this island and their external deps
		ts.forEachChild(sourceFile, (n) => {
			if (
				ts.isClassDeclaration(n) ||
				ts.isFunctionDeclaration(n) ||
				ts.isInterfaceDeclaration(n) ||
				ts.isTypeAliasDeclaration(n)
			) {
				const name = (n as any).name?.getText(sourceFile)
				if (name && symbols.includes(name)) {
					islandNodes.push(n)

					// Find external deps within these nodes
					const visit = (child: ts.Node) => {
						if (ts.isIdentifier(child)) {
							const id = child.getText(sourceFile)
							if (!symbols.includes(id)) {
								externalDeps.add(id)
							}
						}
						ts.forEachChild(child, visit)
					}
					ts.forEachChild(n, visit)
				}
			}
		})

		// 2. Filter imports that provide these external deps
		const neededImports: string[] = []
		for (const imp of imports) {
			const text = imp.getText(sourceFile)
			let needsImp = false

			if (imp.importClause) {
				if (imp.importClause.name && externalDeps.has(imp.importClause.name.text)) needsImp = true
				if (imp.importClause.namedBindings) {
					if (ts.isNamedImports(imp.importClause.namedBindings)) {
						for (const el of imp.importClause.namedBindings.elements) {
							if (externalDeps.has(el.name.text)) {
								needsImp = true
								break
							}
						}
					} else if (ts.isNamespaceImport(imp.importClause.namedBindings)) {
						if (externalDeps.has(imp.importClause.namedBindings.name.text)) needsImp = true
					}
				}
			}

			if (needsImp) neededImports.push(text)
		}

		// 3. Construct final content
		let content = `// [LAYER: ${layer.toUpperCase()}]\n`
		if (neededImports.length > 0) {
			content += neededImports.join("\n") + "\n\n"
		}

		islandNodes.forEach((node) => {
			content += node.getText(sourceFile) + "\n\n"
		})

		return content.trim()
	}
}
