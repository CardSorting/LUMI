import * as ts from "typescript"
import { Logger } from "../../shared/services/Logger"
import { getLayer } from "../../utils/joy-zoning"

export interface DecompositionStep {
	action: "EXTRACT" | "MOVE" | "DECOUPLE" | "HARDEN"
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
 * SovereignDecomposer: The Architectural Analyzer.
 * Analyzes high-activity modules and provides a specific guide for splitting them.
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
			if (this.isFunctionalNode(node)) {
				const body = node.body
				if (body) {
					const { density, hasIO } = this.analyzeNodeLogic(node, sourceFile)
					const name = this.getFunctionName(node)

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
							intentSuggestion: `[PROTOCOL_INTENT: I/O Adapter for ${name}]`,
						})
					}
				}
			}

			// V215: Production Hardening - Deep 'any' Sourcing
			const checkDeepAny = (typeNode: ts.TypeNode | undefined): boolean => {
				if (!typeNode) return false
				if (typeNode.kind === ts.SyntaxKind.AnyKeyword) return true
				let found = false
				ts.forEachChild(typeNode, (child) => {
					if (ts.isTypeNode(child) && checkDeepAny(child)) found = true
				})
				return found
			}

			if (ts.isTypeAssertionExpression(node) || ts.isAsExpression(node)) {
				const type = ts.isTypeAssertionExpression(node) ? node.type : node.type
				if (checkDeepAny(type)) {
					steps.push({
						action: "HARDEN",
						target: "Unsafe Type Cast",
						destination: "STABLE_TYPES",
						risk: "HIGH",
						reason: "Production Risk: 'any' keyword detected within type cast. This bypasses the integrity of the substrate.",
					})
				}
			}

			if (ts.isPropertyAccessExpression(node)) {
				const text = node.getText(sourceFile)
				if (text === "process.env" && !this.isInTryCatch(node)) {
					steps.push({
						action: "HARDEN",
						target: "Raw Environment Access",
						destination: "SAFE_CONFIG",
						risk: "MEDIUM",
						reason: "Production Risk: Direct 'process.env' access without a try-catch or safe-loading wrapper.",
					})
				}
				if (text.includes("fs.readFileSync") || text.includes("fs.writeFileSync")) {
					steps.push({
						action: "HARDEN",
						target: "Legacy Sync I/O",
						destination: "ASYNC_ADAPTER",
						risk: "HIGH",
						reason: "Production Risk: Synchronous filesystem I/O will block the substrate event loop.",
					})
				}
			}

			ts.forEachChild(node, visit)
		}

		visit(sourceFile)

		// 2. Metabolic Fission: Identify High-Mass Entities (V160 Forensic Tracking)
		// V215: Increased threshold to 1500 lines to avoid fragmentation in standard modules.
		if (totalLines > 1500) {
			const islandImports = this.mapSourceImports(sourceFile)

			ts.forEachChild(sourceFile, (n) => {
				if (ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isFunctionDeclaration(n)) {
					const name = (n as ts.NamedDeclaration).name?.getText(sourceFile) || "anonymous"
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

					// V215: Significantly increased extraction thresholds.
					// If an entity is > 500 lines OR (file is massive and entity is > 300 lines).
					if (mass > 500 || (totalLines > 2000 && mass > 300)) {
						const boilerplate = this.generateBoilerplate(extendedIsland, sourceFile, islandImports, layer)

						steps.push({
							action: "EXTRACT",
							target: `${ts.isClassDeclaration(n) ? "Class" : "Entity"} '${name}'`,
							destination: "NEW_MODULE",
							risk: isIsland && islandSymbols.length > 0 ? "LOW" : dependents === 0 ? "LOW" : "HIGH",
							reason: `High Module Activity: '${name}' consumes ${mass} lines. ${isIsland ? "Identified as a self-contained island." : dependents === 0 ? "Identified as a leaf node." : `NOTICE: This entity is used by ${dependents} other symbols locally.`}${zombies.length > 0 ? ` [V180: ${zombies.length} helpers detected and included in stability plan].` : ""}`,
							boilerplate,
							intentSuggestion: `[PROTOCOL_INTENT: Extract ${name} to stable module]`,
						})
					}
				}
			})
		}

		// 3. Shadow Complexity & God Methods (V150 Forensic Pass)
		const complexVisit = (n: ts.Node, depth: number) => {
			if (this.isFunctionalNode(n)) {
				const body = (n as ts.FunctionLikeDeclaration).body
				if (body) {
					const start = sourceFile.getLineAndCharacterOfPosition(n.getStart()).line
					const end = sourceFile.getLineAndCharacterOfPosition(n.getEnd()).line
					const methodMass = end - start + 1
					const name = this.getFunctionName(n)

					// V215: Increased God Method threshold to 300 lines.
					if (methodMass > 300) {
						steps.push({
							action: "EXTRACT",
							target: `God Method '${name}'`,
							destination: "HELPER_FUNCTIONS",
							risk: "MEDIUM",
							reason: `High Method Activity: Method '${name}' is ${methodMass} lines. Factor out sub-procedures for better maintainability.`,
							intentSuggestion: `[PROTOCOL_INTENT: Decompose Large Method ${name}]`,
						})
					}
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

		if (importCount > 25) {
			steps.push({
				action: "DECOUPLE",
				target: "Module Imports",
				destination: "MULTIPLE",
				risk: "HIGH",
				reason: `High import coupling (${importCount} > 25). Consider splitting this module into mission-focused services.`,
			})
		}

		// V140: Industrial Metric Actualization
		const namingPenalty = node ? (1 - node.namingScore) * 50 : 0
		const couplingPenalty = node ? Math.min(node.afferentCoupling * 2, 40) : 0
		const complexityPenalty = totalLines > 1500 ? 50 : totalLines > 1200 ? 20 : 0
		const integrityScore = Math.max(0, 100 - namingPenalty - couplingPenalty - complexityPenalty)

		// V207: Build Health is a forensic aggregate of physical state and structural debt
		let buildHealth = 100
		if (node) {
			if (node.orphaned) buildHealth -= 30
			if (node.afferentCoupling > 30) buildHealth -= 20 // V215: Increased threshold to 30
			if (node.namingScore < 0.8) buildHealth -= 10
			if (node.anyDensity > 0.3) buildHealth -= 15 // V215: Increased threshold to 0.3 (calibrated density)
		}

		// V207: Complexity Penalties - Forensic markers for structural debt
		const godMethods = steps.filter((s) => s.target.startsWith("God Method")).length
		const deepNesting = steps.filter((s) => s.target === "Nested Logic").length
		const importBloat = steps.filter((s) => s.target === "Module Imports").length
		const hardeningGaps = steps.filter((s) => s.action === "HARDEN").length

		buildHealth -= godMethods * 8
		buildHealth -= deepNesting * 4
		buildHealth -= importBloat * 10
		buildHealth -= hardeningGaps * 5

		if (totalLines > 2500)
			buildHealth -= 60 // V215: Massive module penalty
		else if (totalLines > 1500) buildHealth -= 40
		else if (totalLines > 1000) buildHealth -= 10 // V215: Minor penalty for 1000+

		buildHealth = Math.max(5, buildHealth) // V208: Maintain floor to avoid negative substrate health

		const plan: DecompositionPlan = {
			filePath,
			currentLayer: layer,
			buildHealth: Math.round(buildHealth),
			integrityScore: Math.round(integrityScore),
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
							if (!symbols[currentSymbol].dependencies.includes(id)) {
								symbols[currentSymbol].dependencies.push(id)
							}
							if (!symbols[id].dependents.includes(currentSymbol)) {
								symbols[id].dependents.push(currentSymbol)
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
					const current = queue.shift()
					if (!current) continue
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

	private analyzeNodeLogic(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): { density: number; hasIO: boolean } {
		let nodes = 0
		let logic = 0
		let hasIO = false

		const visit = (node: ts.Node) => {
			nodes++
			if (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node)) logic++

			const text = node.getText(sourceFile)
			// Detect I/O signals (fs, http, db calls)
			if (
				text.includes("fs.") ||
				text.includes("fetch(") ||
				text.includes(".save()") ||
				text.includes(".find(") ||
				text.includes("axios.")
			) {
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

	private isFunctionalNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
		return (
			ts.isFunctionDeclaration(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isConstructorDeclaration(node) ||
			ts.isGetAccessorDeclaration(node) ||
			ts.isSetAccessorDeclaration(node) ||
			ts.isArrowFunction(node) ||
			ts.isFunctionExpression(node)
		)
	}

	private getFunctionName(node: ts.Node): string {
		const nameNode = (node as ts.NamedDeclaration).name
		if (nameNode && ts.isIdentifier(nameNode)) return nameNode.text

		// Try to find name from parent if it's a variable assignment
		if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
			return node.parent.name.text
		}

		if (node.parent && ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) {
			return node.parent.name.text
		}

		return "anonymous"
	}

	private isInTryCatch(node: ts.Node): boolean {
		let current = node.parent
		while (current) {
			if (ts.isTryStatement(current)) return true
			current = current.parent
		}
		return false
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

		// V210: Forensic Target Identification - Recursive search for methods/entities
		const findEntityMass = (node: ts.Node, targetName: string): number => {
			let mass = 0
			const visit = (n: ts.Node) => {
				const name = (n as ts.NamedDeclaration).name?.getText(sourceFile)
				if (name && targetName.includes(`'${name}'`)) {
					const start = sourceFile.getLineAndCharacterOfPosition(n.getStart()).line
					const end = sourceFile.getLineAndCharacterOfPosition(n.getEnd()).line
					mass = end - start + 1
					return // Found it
				}
				ts.forEachChild(n, visit)
			}
			visit(node)
			return mass
		}

		steps
			.filter((s) => s.action === "EXTRACT" && (s.risk === "LOW" || s.risk === "MEDIUM"))
			.forEach((step) => {
				linesRemoved += findEntityMass(sourceFile, step.target)
			})

		const projectedLines = Math.max(0, totalLines - linesRemoved)

		// V215: Incremental Health Recovery Model
		let projectedHealth = plan.buildHealth

		// 1. Threshold Recovery
		if (projectedLines <= 1000 && totalLines > 1000) projectedHealth += 10
		if (projectedLines <= 1500 && totalLines > 1500) projectedHealth += 40
		if (projectedLines <= 2500 && totalLines > 2500) projectedHealth += 20

		// 2. Structural Debt Recovery (reversing penalties)
		steps.forEach((step) => {
			if (step.target.startsWith("God Method")) projectedHealth += 8
			if (step.target === "Nested Logic") projectedHealth += 4
			if (step.target === "Module Imports") projectedHealth += 10
			if (step.action === "HARDEN") projectedHealth += 5
		})

		// 3. Baseline Improvement for any refactoring
		if (steps.length > 0) {
			projectedHealth += Math.min(15, steps.length * 2)
		}

		// V215: Dynamic Integrity Projection
		// Calculates gain based on the percentage of total issues being resolved.
		const resolvedRatio = steps.length / Math.max(1, steps.length + 5) // Conservative growth
		const projectedIntegrity = Math.max(0, plan.integrityScore + Math.round((100 - plan.integrityScore) * resolvedRatio))

		return {
			projectedHealth: Math.min(100, Math.round(projectedHealth)),
			projectedIntegrity: Math.min(100, Math.round(projectedIntegrity)),
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
				const name = (n as ts.NamedDeclaration).name?.getText(sourceFile)
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
			content += `${neededImports.join("\n")}\n\n`
		}

		islandNodes.forEach((node) => {
			content += `${node.getText(sourceFile)}\n\n`
		})

		return content.trim()
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose(): void {
		// Currently stateless instance-level, but reserved for future analysis caches.
		Logger.info("[SovereignDecomposer] Decomposer substrate released.")
	}
}
