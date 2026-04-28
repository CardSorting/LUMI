import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import { Logger } from "../../../shared/services/Logger.js"
import { PathResolver } from "./PathResolver.js"
import { SpiderNode, SpiderSnapshot } from "./types.js"

export class ForensicEngine {
	private ghostVerificationCache: Map<string, { hash: string; ghosts: string[]; turn: number }> = new Map()
	private turnCounter = 0

	/**
	 * V215: Substrate Sentience (Forensic Prophecy).
	 * Calculates the mathematical probability of a change propagating up the graph.
	 * Returns a map of NodeID -> RippleProbability (0-1.0).
	 */
	public calculateRippleProbability(nodes: Map<string, SpiderNode>): Map<string, number> {
		const rippleMap = new Map<string, number>()
		for (const node of nodes.values()) {
			const reachable = new Set<string>()
			const queue = [node.id]
			while (queue.length > 0) {
				const current = queue.shift()
				if (!current) continue
				const currNode = nodes.get(current)
				if (currNode) {
					for (const dep of currNode.dependents) {
						if (!reachable.has(dep)) {
							reachable.add(dep)
							queue.push(dep)
						}
					}
				}
			}
			// Ripple Probability is a function of reachability vs total nodes
			rippleMap.set(node.id, Math.min(1.0, reachable.size / Math.max(1, nodes.size * 0.2)))
		}
		return rippleMap
	}

	/**
	 * V215: Domain Drift Detection.
	 * Identifies modules that are semantically diverging from their historical domain.
	 */
	public detectDomainDrift(node: SpiderNode, snapshots: SpiderSnapshot[]): string | null {
		if (snapshots.length < 5) return null // Need historical baseline

		const vocabulary = new Set(node.exports.flatMap((e) => e.split(/(?=[A-Z])|_/)))
		const historicalVocabs = snapshots.map((s) => {
			const n = s.nodes.find((n) => n.id === node.id)
			return n ? new Set(n.exports.flatMap((e) => e.split(/(?=[A-Z])|_/))) : new Set<string>()
		})

		const baselineVocab = new Set<string>()
		for (const v of historicalVocabs) {
			for (const word of v) baselineVocab.add(word)
		}

		const newWords = [...vocabulary].filter((w) => !baselineVocab.has(w))
		if (newWords.length > 3) {
			return `[SPI-111] DOMAIN DRIFT: ${path.basename(node.path)} is accumulating new domain vocabulary: [${newWords.join(", ")}]. Possible domain fission required.`
		}
		return null
	}

	constructor(
		private cwd: string,
		private resolver: PathResolver,
	) {}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose() {
		this.ghostVerificationCache.clear()
	}

	/**
	 * V200: Cache Saturation & Generational GC.
	 */
	private checkCacheSaturation() {
		const MAX_ENTRIES = 5000
		const MAX_AGE = 5 // Turns

		if (this.ghostVerificationCache.size > MAX_ENTRIES) {
			this.ghostVerificationCache.clear()
			Logger.info("[ForensicEngine] Ghost verification cache saturated. Metaphorical sweep performed.")
			return
		}

		// Generational Purge: Clear nodes that haven't been seen in N turns
		let purged = 0
		for (const [path, entry] of this.ghostVerificationCache.entries()) {
			if (this.turnCounter - entry.turn > MAX_AGE) {
				this.ghostVerificationCache.delete(path)
				purged++
			}
		}
		if (purged > 0) {
			Logger.info(`[ForensicEngine] Generational GC: Purged ${purged} stale ghost entries.`)
		}
	}

	public findGhosts(nodes: Map<string, SpiderNode>, sessionBuffer?: Map<string, string>): Set<string> {
		this.turnCounter++
		this.checkCacheSaturation()

		const allGhosts = new Set<string>()
		for (const node of nodes.values()) {
			const absPath = path.resolve(this.cwd, node.path)

			// V150: Memory-First Forensic Sensing
			const sessionContent = sessionBuffer ? sessionBuffer.get(node.path) : null
			let content = sessionContent
			if (!content) {
				if (!fs.existsSync(absPath)) continue
				content = fs.readFileSync(absPath, "utf-8")
			}

			// V215: Dependency-Aware Forensic Signature
			// We include the hashes of all resolved dependencies to ensure the cache is invalidated
			// if a dependency's exports change, even if this file's content remains identical.
			const depHashes: string[] = []
			for (const imp of node.imports) {
				const targetId = this.resolver.resolveImportToNodeId(node.path, imp, nodes)
				if (targetId) {
					const targetNode = nodes.get(targetId)
					if (targetNode) depHashes.push(targetNode.hash)
				}
			}
			const forensicSignature = crypto
				.createHash("md5")
				.update(content + depHashes.join(""))
				.digest("hex")

			const cached = this.ghostVerificationCache.get(node.path)
			if (cached && cached.hash === forensicSignature) {
				cached.turn = this.turnCounter // Refresh TTL
				for (const g of cached.ghosts) {
					allGhosts.add(g)
				}
				continue
			}

			const nodeGhosts: string[] = []
			let sourceFile: ts.SourceFile | null = null
			let imports: { specifier: string; symbols: string[] }[] | null = null
			try {
				sourceFile = ts.createSourceFile(node.path, content, ts.ScriptTarget.Latest, true)
				imports = this.getImportedSymbols(sourceFile)
				const hasGhostException = content.includes("[SOVEREIGN_EXCEPTION: Ghost Symbols]")

				for (const { specifier, symbols } of imports) {
					const diskPath = this.resolver.getDiskPath(node.path, specifier)
					const targetId = this.resolver.resolveImportToNodeId(node.path, specifier, nodes)

					if (!diskPath) {
						// PRODUCTION HARDENING: Ignore ghost files for common build/config files, Node builtins, or external packages
						if (!specifier.startsWith(".") && !this.resolver.isProjectAlias(specifier)) continue
						if (specifier.endsWith(".config.js") || specifier.endsWith(".config.ts") || specifier.endsWith(".json"))
							continue

						const msg = `[SPI-101] GHOST FILE: ${node.path} -> ${specifier}`
						allGhosts.add(msg)
						nodeGhosts.push(msg)
					} else if (symbols.length > 0 && !hasGhostException) {
						// V16: Use Node exports for high-precision verification
						const targetNode = targetId ? nodes.get(targetId) : null

						if (targetNode) {
							// V215: Recursive Export Resolution
							const resolveSymbol = (target: SpiderNode, sym: string, visited = new Set<string>()): boolean => {
								if (visited.has(target.id)) return false
								visited.add(target.id)

								if (target.exports.includes(sym)) return true
								for (const reExpId of target.reExports || []) {
									const reExpNode = nodes.get(reExpId)
									if (reExpNode && resolveSymbol(reExpNode, sym, visited)) return true
								}
								return false
							}

							let foundMissingInExport = false
							for (const symbol of symbols) {
								if (symbol === "*" || resolveSymbol(targetNode, symbol)) continue

								const msg = `[SPI-102] GHOST SYMBOL: ${node.path} -> ${symbol} from ${specifier}`
								allGhosts.add(msg)
								nodeGhosts.push(msg)
								foundMissingInExport = true
							}

							// V150 High-Velocity Calibration: If exports match, don't hit the disk for symbol verification
							if (foundMissingInExport) continue

							// Fallback to detailed AST check if target is in session but exports are stale
							const targetSessionId = this.resolver.normalizePath(diskPath)
							const targetSessionContent = sessionBuffer ? sessionBuffer.get(targetSessionId) : null
							if (targetSessionContent) {
								let targetAst: ts.SourceFile | null = ts.createSourceFile(
									diskPath,
									targetSessionContent,
									ts.ScriptTarget.Latest,
									true,
								)
								const exportedSymbols = this.getExportedSymbolsFull(targetAst)

								for (const symbol of symbols) {
									if (symbol === "*" || exportedSymbols.has(symbol)) continue
									const msg = `[SPI-102] GHOST SYMBOL: ${node.path} -> ${symbol} from ${specifier}`
									allGhosts.add(msg)
									nodeGhosts.push(msg)
								}
								targetAst = null
							}
						}
					}
				}
				this.ghostVerificationCache.set(node.path, {
					hash: forensicSignature,
					ghosts: nodeGhosts,
					turn: this.turnCounter,
				})
			} finally {
				// V200: Forensic Closure Hygiene
				sourceFile = null
				imports = null
			}
		}
		this.checkCacheSaturation()
		return allGhosts
	}

	/**
	 * V16: Identifies exported symbols that are never consumed project-wide.
	 */
	/**
	 * V140: Industrial Hardening - Precise Unused Export Forensics.
	 * V160: Zombie Detection - Flags symbols exported but only used within their own module.
	 */
	public findUnusedExports(nodes: Map<string, SpiderNode>): string[] {
		const unusedViolations: string[] = []
		const globalConsumption = new Map<string, Set<string>>()

		// 1. Build Global Consumption Map (TargetNodeID -> Set of Symbols)
		// V215: Forensic Filter - We only count consumption from 'Live' (non-orphaned) nodes.
		for (const node of nodes.values()) {
			if (node.orphaned && node.layer !== "plumbing") continue // Skip orphans (except plumbing helpers)

			for (const [targetId, symbols] of Object.entries(node.consumptions)) {
				if (!globalConsumption.has(targetId)) {
					globalConsumption.set(targetId, new Set())
				}
				const consumptionSet = globalConsumption.get(targetId)
				if (consumptionSet) {
					for (const s of symbols) {
						consumptionSet.add(s)
					}
				}
			}
		}

		// 2. Identify Deadwood (Exports never consumed)
		for (const node of nodes.values()) {
			const consumedSymbols = globalConsumption.get(node.id) || new Set()

			// V215: Elite Deadwood Suppression
			// Namespace imports, root files, or barrel files (index.ts) prevent pruning.
			if (consumedSymbols.has("*")) continue
			if (
				node.path === "src/main.ts" ||
				node.path.endsWith("/index.ts") ||
				node.path === "src/extension.ts" ||
				node.isInterface // V215: Interfaces are low-cost architectural markers
			) {
				continue
			}

			// V215: Zombie Module Detection
			const unusedExports = node.exports.filter((exp) => exp !== "default" && !consumedSymbols.has(exp))
			const isZombie = unusedExports.length === node.exports.length && node.exports.length > 0

			if (isZombie) {
				unusedViolations.push(`[SPI-103] ZOMBIE MODULE: ${node.path} (100% of exports are unused).`)
				continue
			}

			for (const exp of unusedExports) {
				// V215: Noise Filtering
				// Only flag unused exports if the file is significant or the symbol name is unique.
				if (node.astComplexity > 1000 || node.afferentCoupling > 5) {
					unusedViolations.push(`[SPI-103] UNUSED EXPORT: ${node.path} -> ${exp}`)
				}
			}
		}

		return unusedViolations
	}

	/**
	 * V160: Contract Drift Forensics.
	 */
	public compareContracts(oldNodes: Map<string, SpiderNode>, newNodes: Map<string, SpiderNode>): string[] {
		const drifts: string[] = []
		for (const [id, newNode] of newNodes.entries()) {
			const oldNode = oldNodes.get(id)
			if (!oldNode) continue

			const removedExports = oldNode.exports.filter((e) => !newNode.exports.includes(e))
			if (removedExports.length > 0) {
				drifts.push(
					`[SPI-105] CONTRACT DRIFT (REMOVAL): ${newNode.path} -> removed exports: ${removedExports.join(", ")}`,
				)
			}
		}
		return drifts
	}

	/**
	 * V190: Fragility Sensing (Structural Risk Analysis).
	 * Calculates the 'Blast Radius' of each node based on afferent coupling and
	 * depth in the architectural graph.
	 */
	public computeFragility(
		nodes: Map<string, SpiderNode>,
		pressureMap: Map<string, number> = new Map(),
	): Map<string, { blastRadius: number; isFragile: boolean }> {
		const results = new Map<string, { blastRadius: number; isFragile: boolean }>()
		const totalNodes = nodes.size
		if (totalNodes === 0) return results

		// 1. Initial Pass: Direct Afferent Coupling
		for (const node of nodes.values()) {
			const directDependents = node.dependents.length
			const layerWeight = node.layer === "domain" ? 2.0 : node.layer === "core" ? 1.5 : 1.0
			const scaleFactor = Math.max(50, totalNodes) * 0.1
			let blastRadius = Math.min((directDependents * layerWeight) / scaleFactor, 1.0)

			// V215: Metabolic Dampening.
			// If a file is stable (0 pressure), its blast radius is dampened by 50%.
			// If a file is under high pressure (pressure > 0.5), its blast radius is amplified.
			const pressure = pressureMap.get(node.id) || 0
			if (pressure === 0) {
				blastRadius *= 0.5
			} else if (pressure > 0.5) {
				blastRadius = Math.min(1.0, blastRadius * 1.5)
			}

			if (directDependents < 5) {
				blastRadius *= 0.5
			}

			results.set(node.id, { blastRadius, isFragile: false })
		}

		// 2. Deep Pass: Recursive Blast Radius (Second-Order Impact)
		for (const node of nodes.values()) {
			let recursiveImpact = 0
			for (const depId of node.dependents) {
				const depRadius = results.get(depId)?.blastRadius || 0
				recursiveImpact += depRadius * 0.2
			}

			const stats = results.get(node.id)
			if (stats) {
				stats.blastRadius = Math.min(1.0, stats.blastRadius + recursiveImpact)
				// V215: Metabolic Fragility Threshold.
				const pressure = pressureMap.get(node.id) || 0
				const fragilityThreshold = pressure > 0.3 ? 0.45 : 0.6
				stats.isFragile =
					stats.blastRadius > fragilityThreshold || (node.afferentCoupling > 15 && stats.blastRadius > 0.4)
			}
		}

		return results
	}

	/**
	 * V215: Structural Bridge Detection.
	 * Identifies "Articulated Points"—nodes that, if removed, would increase the
	 * number of disconnected components in the architectural graph.
	 * These represent 'Single Points of Failure'.
	 */
	public detectStructuralBridges(nodes: Map<string, SpiderNode>): string[] {
		const nodeIds = Array.from(nodes.keys())
		if (nodeIds.length < 3) return []

		const disc = new Map<string, number>()
		const low = new Map<string, number>()
		const parent = new Map<string, string | null>()
		const ap = new Set<string>()
		let time = 0

		const dfs = (u: string) => {
			let children = 0
			disc.set(u, ++time)
			low.set(u, time)

			const node = nodes.get(u)
			if (!node) return

			// We treat the graph as undirected for bridge detection (connectivity is what matters)
			const neighbors = new Set([
				...(node.imports
					.map((i) => this.resolver.resolveImportToNodeId(node.path, i, nodes))
					.filter(Boolean) as string[]),
				...node.dependents,
			])

			for (const v of neighbors) {
				if (!disc.has(v)) {
					children++
					parent.set(v, u)
					dfs(v)

					const lowU = low.get(u) ?? 0
					const lowV = low.get(v) ?? 0
					low.set(u, Math.min(lowU, lowV))

					if (parent.get(u) === null && children > 1) ap.add(u)
					if (parent.get(u) !== null && lowV >= (disc.get(u) ?? 0)) ap.add(u)
				} else if (v !== parent.get(u)) {
					low.set(u, Math.min(low.get(u) ?? 0, disc.get(v) ?? 0))
				}
			}
		}

		for (const id of nodeIds) {
			if (!disc.has(id)) {
				parent.set(id, null)
				dfs(id)
			}
		}

		return Array.from(ap)
	}
	/**
	 * V215: Symbol Resonance Detection.
	 * Identifies symbols with the same name but significantly different logic signatures.
	 * High resonance indicates potential logic duplication or naming collisions.
	 */
	public detectSymbolResonance(nodes: Map<string, SpiderNode>): string[] {
		const resonanceViolations: string[] = []
		const symbolsByName = new Map<string, SpiderNode[]>()

		for (const node of nodes.values()) {
			for (const symbol of node.exports) {
				if (!symbolsByName.has(symbol)) {
					symbolsByName.set(symbol, [])
				}
				symbolsByName.get(symbol)?.push(node)
			}
		}

		for (const [name, nodesArray] of symbolsByName.entries()) {
			if (nodesArray.length > 1) {
				const baseNode = nodesArray[0]
				for (let i = 1; i < nodesArray.length; i++) {
					const targetNode = nodesArray[i]
					const complexityDiff = Math.abs(baseNode.astComplexity - targetNode.astComplexity)
					const densityDiff = Math.abs(baseNode.logicDensity - targetNode.logicDensity)

					if (complexityDiff > 500 || densityDiff > 0.1) {
						resonanceViolations.push(
							`[SPI-106] SYMBOL RESONANCE: '${name}' is exported from both ${path.basename(baseNode.path)} and ${path.basename(targetNode.path)} with diverging logic. Possible naming collision or duplication.`,
						)
					}
				}
			}
		}

		return resonanceViolations
	}

	/**
	 * V215: Implicit Interface Recognition.
	 * Identifies structural duplication where multiple classes share identical
	 * method signatures without a formal abstraction.
	 */
	public findImplicitInterfaces(nodes: Map<string, SpiderNode>): string[] {
		const interfaceViolations: string[] = []
		const signatureMap = new Map<string, string[]>()

		for (const node of nodes.values()) {
			if (node.exports.length > 2) {
				const signature = [...node.exports].sort().join("|")
				if (!signatureMap.has(signature)) {
					signatureMap.set(signature, [])
				}
				signatureMap.get(signature)?.push(node.path)
			}
		}

		for (const [sig, paths] of signatureMap.entries()) {
			if (paths.length > 1) {
				const sampleNames = sig.split("|").slice(0, 3).join(", ")
				interfaceViolations.push(
					`[SPI-107] IMPLICIT INTERFACE: ${paths.length} modules share an identical structural signature (${sampleNames}${sig.split("|").length > 3 ? "..." : ""}). Consider formalizing a shared interface.`,
				)
			}
		}

		return interfaceViolations
	}

	/**
	 * V215: Implicit Contract Audit.
	 * Identifies asymmetric abstractions (e.g., init without dispose).
	 */
	public auditImplicitContracts(nodes: Map<string, SpiderNode>): string[] {
		const contractViolations: string[] = []
		const pairs = [
			["initialize", "dispose"],
			["open", "close"],
			["start", "stop"],
			["subscribe", "unsubscribe"],
			["load", "save"],
		]

		for (const node of nodes.values()) {
			for (const [pos, neg] of pairs) {
				const hasPos = node.exports.some((e) => e.toLowerCase().includes(pos))
				const hasNeg = node.exports.some((e) => e.toLowerCase().includes(neg))

				if (hasPos && !hasNeg) {
					contractViolations.push(
						`[SPI-110] ASYMMETRIC CONTRACT: ${path.basename(node.path)} defines '${pos}' but lacks a matching '${neg}' implementation.`,
					)
				}
			}
		}

		return contractViolations
	}

	/**
	 * V215: Logic De-Duplication.
	 * Identifies 'Silent Clones' where logic has been copy-pasted.
	 */
	public findLogicClones(nodes: Map<string, SpiderNode>): string[] {
		const clones: string[] = []
		const nodesArray = Array.from(nodes.values())

		for (let i = 0; i < nodesArray.length; i++) {
			for (let j = i + 1; j < nodesArray.length; j++) {
				const nodeA = nodesArray[i]
				const nodeB = nodesArray[j]

				// High similarity in multiple structural metrics
				const complexityMatch = Math.abs(nodeA.astComplexity - nodeB.astComplexity) < 5
				const densityMatch = Math.abs(nodeA.logicDensity - nodeB.logicDensity) < 0.01
				const symbolCountMatch = nodeA.exports.length === nodeB.exports.length

				if (complexityMatch && densityMatch && symbolCountMatch && nodeA.astComplexity > 100) {
					clones.push(
						`[SPI-109] SILENT CLONE: ${path.basename(nodeA.path)} and ${path.basename(nodeB.path)} share near-identical logical signatures. Possible copy-pasted logic.`,
					)
				}
			}
		}

		return clones
	}

	public getImportedSymbols(sourceFile: ts.SourceFile): { specifier: string; symbols: string[] }[] {
		const imports: { specifier: string; symbols: string[] }[] = []
		ts.forEachChild(sourceFile, (n) => {
			if (ts.isImportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
				const specifier = n.moduleSpecifier.text
				const symbols: string[] = []
				if (n.importClause) {
					if (n.importClause.name) symbols.push(n.importClause.name.text)
					if (n.importClause.namedBindings) {
						if (ts.isNamedImports(n.importClause.namedBindings)) {
							for (const e of n.importClause.namedBindings.elements) {
								symbols.push(e.name.text)
							}
						} else if (ts.isNamespaceImport(n.importClause.namedBindings)) {
							symbols.push("*")
						}
					}
				}
				imports.push({ specifier, symbols })
			}
		})
		return imports
	}

	/**
	 * V140: Forensic Realism - 100% Accurate AST-based Export Sensing.
	 */
	public getExportedSymbolsFull(sourceFile: ts.SourceFile): Set<string> {
		const exports = new Set<string>()
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isExportDeclaration(node)) {
				if (node.exportClause && ts.isNamedExports(node.exportClause)) {
					for (const element of node.exportClause.elements) {
						exports.add(element.name.text)
					}
				}
			} else if (
				ts.isClassDeclaration(node) ||
				ts.isFunctionDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node) ||
				ts.isEnumDeclaration(node)
			) {
				const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
				if (isExported && node.name) {
					exports.add(node.name.text)
					const isDefault = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
					if (isDefault) exports.add("default")
				}
			} else if (ts.isVariableStatement(node)) {
				const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
				if (isExported) {
					for (const decl of node.declarationList.declarations) {
						if (ts.isIdentifier(decl.name)) {
							exports.add(decl.name.text)
						}
					}
				}
			} else if (ts.isExportAssignment(node)) {
				exports.add("default")
			}
		})
		return exports
	}
}
