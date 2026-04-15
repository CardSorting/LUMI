/**
 * [LAYER: CORE]
 */

import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import * as v8 from "v8"
import { Logger } from "@/shared/services/Logger"
import { writeAtomic } from "@/utils/fs"
import { getLayer, Layer } from "@/utils/joy-zoning"
import "@/utils/path"
import { SovereignPolicy } from "./SovereignPolicy"

export interface SpiderNode {
	id: string
	path: string
	layer: Layer
	imports: string[]
	dependents: string[]
	depth: number
	orphaned: boolean
	afferentCoupling: number
	logicDensity: number
	ioEntropy: number
	astComplexity: number
	hash: string
	isInterface: boolean
}

export interface SpiderSnapshot {
	timestamp: string
	entropyScore: number
	nodes: SpiderNode[]
	components: {
		depthScore: number
		namingScore: number
		orphanScore: number
		couplingScore: number
	}
}

export interface SpiderEntropyReport {
	score: number
	components: {
		depthScore: number
		namingScore: number
		orphanScore: number
		couplingScore: number
	}
}

export interface SpiderViolation {
	id: string
	severity: "ERROR" | "WARN" | "INFO"
	message: string
	path: string
	remediation?: string
}

/**
 * SpiderEngine: Implements structural graph analysis, entropy scoring,
 * and evolution tracking (snapshots).
 */
export class SpiderEngine {
	public nodes: Map<string, SpiderNode> = new Map()
	public ghosts: Set<string> = new Set()
	public version = 0
	private reachabilityTimeout: NodeJS.Timeout | null = null
	private snapshotDir: string
	private registryFile: string
	private resolutionCache: Map<string, string | null> = new Map()
	private negativeCache: Map<string, boolean> = new Map()
	private saveTimeout: NodeJS.Timeout | null = null
	private cachedEntropy: SpiderEntropyReport | null = null
	private lastEntropyVersion = -1

	constructor(public cwd: string) {
		this.snapshotDir = path.join(cwd, ".spider", "snapshots")
		this.registryFile = path.join(cwd, ".spider", "registry.json")
	}

	/**
	 * Warm up the graph by scanning known entry points proactively.
	 */
	public async warmUp(entryPoints: string[] = ["src/main.ts", "src/index.ts"]) {
		for (const entry of entryPoints) {
			const absPath = path.resolve(this.cwd, entry)
			if (fs.existsSync(absPath)) {
				const content = await fs.promises.readFile(absPath, "utf-8")
				this.updateNode(entry, content)
			}
		}
	}

	/**
	 * Incrementally updates or adds a single file to the structural graph.
	 */
	public updateNode(filePath: string, content: string) {
		const normalizedPath = this.normalizePath(filePath)
		// SMART INVALIDATION: Only clear negative cache if the update could resolve a ghost
		if (!this.nodes.has(normalizedPath)) {
			this.negativeCache.clear()
		}
		this.checkMetabolicPressure()
		const absolutePath = path.resolve(this.cwd, filePath)
		const layer = getLayer(absolutePath)
		const hash = crypto.createHash("md5").update(content).digest("hex")

		const oldNode = this.nodes.get(normalizedPath)
		if (oldNode && oldNode.hash === hash) {
			// HIGH-PERFORMANCE SKIP: Content is identical, skip AST processing
			return
		}

		const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)
		const imports: Set<string> = new Set()

		// Single-pass AST metrics & imports
		let totalNodes = 0
		let logicNodes = 0
		let ioImports = 0
		let totalImports = 0
		let hasConcreteDefinition = false

		const visit = (node: ts.Node) => {
			totalNodes++
			const kind = node.kind

			if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) {
				// Rough heuristic: if it has a body and isn't just a type/interface, it's concrete
				if ((node as any).body || ts.isVariableDeclaration(node)) {
					hasConcreteDefinition = true
				}
			}

			// Logic Density Analysis
			if (
				kind === ts.SyntaxKind.IfStatement ||
				kind === ts.SyntaxKind.ForStatement ||
				kind === ts.SyntaxKind.ForInStatement ||
				kind === ts.SyntaxKind.ForOfStatement ||
				kind === ts.SyntaxKind.WhileStatement ||
				kind === ts.SyntaxKind.DoStatement ||
				kind === ts.SyntaxKind.SwitchStatement
			) {
				logicNodes++
			}

			if (ts.isImportDeclaration(node)) {
				totalImports++
				const moduleSpecifier = node.moduleSpecifier
				if (ts.isStringLiteral(moduleSpecifier)) {
					const text = moduleSpecifier.text
					imports.add(text)
					// IO Entropy Analysis
					if (!text.startsWith(".") && !text.startsWith("@/")) {
						ioImports++
					}
				}
			} else if (ts.isExportDeclaration(node)) {
				// DEEP HARDEING: Track re-exports (export * from '...') which act as imports
				const moduleSpecifier = node.moduleSpecifier
				if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
					const text = moduleSpecifier.text
					imports.add(text)
					totalImports++
				}
			} else if (ts.isCallExpression(node)) {
				const expression = node.expression
				if (expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
					const arg = node.arguments[0]
					if (ts.isStringLiteral(arg)) {
						imports.add(arg.text)
					}
				}
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)

		const oldImports = oldNode?.imports || []
		const importsList = Array.from(imports)
		const importsChanged = !oldNode || JSON.stringify(oldImports) !== JSON.stringify(importsList)

		const metrics = {
			logicDensity: totalNodes > 0 ? logicNodes / totalNodes : 0,
			ioEntropy: totalImports > 0 ? ioImports / totalImports : 0,
			astComplexity: totalNodes,
		}

		const newNode: SpiderNode = {
			id: normalizedPath,
			path: normalizedPath,
			layer,
			imports: importsList,
			dependents: oldNode?.dependents || [],
			depth: normalizedPath.split("/").length - 1,
			orphaned: false,
			afferentCoupling: oldNode?.afferentCoupling || 0,
			...metrics,
			hash,
			isInterface:
				!hasConcreteDefinition ||
				normalizedPath.includes("/interfaces/") ||
				normalizedPath.includes("/types/") ||
				normalizedPath.endsWith(".d.ts"),
		}

		this.nodes.set(normalizedPath, newNode)
		this.version++

		if (importsChanged) {
			this.updateIncrementalCoupling(normalizedPath, oldImports, importsList)
			// Granular Cache Invalidation: Only clear entries for this file
			for (const key of this.resolutionCache.keys()) {
				if (key.startsWith(`${normalizedPath}:`)) {
					this.resolutionCache.delete(key)
				}
			}
			this.scheduleReachability()
		}
		this.saveRegistry().catch((e) => Logger.error("[SpiderEngine] Auto-save (atomic) failed:", e))
	}

	/**
	 * Debounced reachability updates to prevent scaling issues during batch updates.
	 */
	private scheduleReachability() {
		if (this.reachabilityTimeout) return
		this.reachabilityTimeout = setTimeout(() => {
			this.computeReachability()
			this.reachabilityTimeout = null
		}, 100)
	}

	/**
	 * Metabolic Pressure Valve: Monitors V8 heap usage.
	 * If memory pressure is too high (>80%), flushes resolution caches and triggers recycling.
	 */
	private checkMetabolicPressure() {
		const stats = v8.getHeapStatistics()
		const usedPercent = (stats.used_heap_size / stats.heap_size_limit) * 100

		if (usedPercent > 80) {
			Logger.warn(`[SpiderEngine] Metabolic Pressure Critical (${usedPercent.toFixed(1)}%). Flushing caches.`)
			this.resolutionCache.clear()
			this.cachedEntropy = null
			// Garbage collection hint if available
			if (global.gc) global.gc()
		}
	}

	/**
	 * Atomic, incremental update of the coupling graph.
	 * Only updates affected nodes to maintain O(1) propagation.
	 */
	private updateIncrementalCoupling(nodeId: string, oldImports: string[], newImports: string[]) {
		const removed = oldImports.filter((i) => !newImports.includes(i))
		const added = newImports.filter((i) => !oldImports.includes(i))

		// 1. Process removals
		for (const imp of removed) {
			const targetId = this.resolveImportToNodeId(nodeId, imp)
			if (targetId && this.nodes.has(targetId)) {
				const target = this.nodes.get(targetId)!
				target.dependents = target.dependents.filter((d) => d !== nodeId)
				target.afferentCoupling = target.dependents.length
			}
		}

		// 2. Process additions
		for (const imp of added) {
			const targetId = this.resolveImportToNodeId(nodeId, imp)
			if (targetId && this.nodes.has(targetId)) {
				const target = this.nodes.get(targetId)!
				if (!target.dependents.includes(nodeId)) {
					target.dependents.push(nodeId)
					target.afferentCoupling = target.dependents.length
				}
			}
		}
	}

	/**
	 * Removes a node from the structural graph.
	 */
	public removeNode(filePath: string) {
		const absolutePath = path.resolve(this.cwd, filePath)
		const relativePath = path.relative(this.cwd, absolutePath)
		const normalizedPath = relativePath.replace(/\\/g, "/")

		this.nodes.delete(normalizedPath)
		this.resolutionCache.clear()
		this.computeReachability()
		this.cachedEntropy = null // Invalidate cache
		this.version++
	}

	/**
	 * Clears all nodes from the structural graph and the underlying project.
	 */
	public clearNodes() {
		this.nodes.clear()
		this.resolutionCache.clear()
		this.version++
	}

	/**
	 * Builds a structural graph of the provided files.
	 */
	public buildGraph(files: { filePath: string; content: string }[]): void {
		this.nodes.clear()

		for (const file of files) {
			const absolutePath = path.resolve(this.cwd, file.filePath)
			const relativePath = path.relative(this.cwd, absolutePath)
			const normalizedPath = relativePath.replace(/\\/g, "/")
			const layer = getLayer(absolutePath)
			const hash = crypto.createHash("md5").update(file.content).digest("hex")

			const sourceFile = ts.createSourceFile(absolutePath, file.content, ts.ScriptTarget.Latest, true)
			const imports: Set<string> = new Set()

			let totalNodes = 0
			let logicNodes = 0
			let ioImports = 0
			let totalImports = 0
			let hasConcreteDefinition = false

			const visit = (node: ts.Node) => {
				totalNodes++
				const kind = node.kind

				if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) {
					if ((node as any).body || ts.isVariableDeclaration(node)) {
						hasConcreteDefinition = true
					}
				}

				if (
					kind === ts.SyntaxKind.IfStatement ||
					kind === ts.SyntaxKind.ForStatement ||
					kind === ts.SyntaxKind.ForInStatement ||
					kind === ts.SyntaxKind.ForOfStatement ||
					kind === ts.SyntaxKind.WhileStatement ||
					kind === ts.SyntaxKind.DoStatement ||
					kind === ts.SyntaxKind.SwitchStatement
				) {
					logicNodes++
				}

				if (ts.isImportDeclaration(node)) {
					totalImports++
					const moduleSpecifier = node.moduleSpecifier
					if (ts.isStringLiteral(moduleSpecifier)) {
						const text = moduleSpecifier.text
						imports.add(text)
						if (!text.startsWith(".") && !text.startsWith("@/")) {
							ioImports++
						}
					}
				} else if (ts.isCallExpression(node)) {
					const expression = node.expression
					if (expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
						const arg = node.arguments[0]
						if (ts.isStringLiteral(arg)) {
							imports.add(arg.text)
						}
					}
				}
				ts.forEachChild(node, visit)
			}
			visit(sourceFile)

			this.nodes.set(normalizedPath, {
				id: normalizedPath,
				path: normalizedPath,
				layer,
				imports: Array.from(imports),
				dependents: [],
				depth: normalizedPath.split("/").length - 1,
				orphaned: false,
				afferentCoupling: 0,
				logicDensity: totalNodes > 0 ? logicNodes / totalNodes : 0,
				ioEntropy: totalImports > 0 ? ioImports / totalImports : 0,
				astComplexity: totalNodes,
				hash,
				isInterface:
					!hasConcreteDefinition ||
					normalizedPath.includes("/interfaces/") ||
					normalizedPath.includes("/types/") ||
					normalizedPath.endsWith(".d.ts"),
			})
		}

		this.resolutionCache.clear()
		this.computeCouplingMetrics()
		this.computeReachability()
		this.cachedEntropy = null
	}

	/**
	 * Computes Afferent (Ca) and Efferent (Ce) coupling metrics.
	 * Ca = number of incoming dependencies.
	 */
	public computeCouplingMetrics() {
		const couplingMap = new Map<string, number>()

		// Initialize counts
		for (const id of this.nodes.keys()) {
			couplingMap.set(id, 0)
		}

		// Count incoming edges
		for (const node of this.nodes.values()) {
			node.dependents = [] // Reset
			for (const imp of node.imports) {
				const resolved = this.resolveImportToNodeId(node.path, imp)
				if (resolved && couplingMap.has(resolved)) {
					couplingMap.set(resolved, (couplingMap.get(resolved) || 0) + 1)
					const targetNode = this.nodes.get(resolved)
					if (targetNode && !targetNode.dependents.includes(node.id)) {
						targetNode.dependents.push(node.id)
					}
				}
			}
		}

		// Update nodes
		for (const [id, count] of couplingMap.entries()) {
			const node = this.nodes.get(id)
			if (node) {
				node.afferentCoupling = count
			}
		}
	}

	/**
	 * Computes reachability from "root" layers.
	 */
	private computeReachability() {
		const roots = Array.from(this.nodes.values()).filter(
			(n) => n.layer === "ui" || n.layer === "core" || n.path.includes("main.") || n.path.includes("index."),
		)

		const reachable = new Set<string>()
		const queue = roots.map((r) => r.id)
		for (const id of queue) reachable.add(id)

		let head = 0
		while (head < queue.length) {
			const currentId = queue[head++]
			if (!currentId) continue
			const node = this.nodes.get(currentId)
			if (node) {
				for (const imp of node.imports) {
					const resolved = this.resolveImportToNodeId(node.path, imp)
					if (resolved && this.nodes.has(resolved) && !reachable.has(resolved)) {
						reachable.add(resolved)
						queue.push(resolved)
					}
				}
			}
		}

		for (const node of this.nodes.values()) {
			node.orphaned = !reachable.has(node.id)
		}
		this.findGhosts()
		this.version++
	}

	/**
	 * Detects "Ghost Files" — files that are imported but do not exist in the graph.
	 */
	/**
	 * Detects "Ghost Files" — files that are imported but do not exist in the graph.
	 * REALITY CHECK: Also verifies existence on disk to prevent false positives for unindexed files.
	 */
	public findGhosts() {
		this.ghosts.clear()
		for (const node of this.nodes.values()) {
			for (const imp of node.imports) {
				const resolved = this.resolveImportToNodeId(node.path, imp)
				// If not in graph, check if it exists on disk before calling it a ghost
				if (!resolved || !this.nodes.has(resolved)) {
					if (this.isNodeLibrary(imp)) continue

					// Deep disk check (expensive but prevents spirals)
					const diskExists = this.verifyOnDisk(node.path, imp)
					if (!diskExists) {
						this.ghosts.add(`${node.path} -> ${imp}`)
					}
				}
			}
		}
	}

	/**
	 * Performs a physical existence check on disk for a given import specifier.
	 */
	private verifyOnDisk(sourcePath: string, specifier: string): boolean {
		const cacheKey = `${sourcePath}:${specifier}`
		if (this.negativeCache.has(cacheKey)) return false

		try {
			let absPath = ""
			if (specifier.startsWith(".")) {
				absPath = path.resolve(this.cwd, path.dirname(sourcePath), specifier)
			} else if (specifier.startsWith("@/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@/", "src/"))
			} else if (specifier.startsWith("@api/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@api/", "src/core/api/"))
			} else if (specifier.startsWith("@core/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@core/", "src/core/"))
			} else if (specifier.startsWith("@generated/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@generated/", "src/generated/"))
			} else if (specifier.startsWith("@hosts/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@hosts/", "src/hosts/"))
			} else if (specifier.startsWith("@integrations/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@integrations/", "src/integrations/"))
			} else if (specifier.startsWith("@packages/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@packages/", "src/packages/"))
			} else if (specifier.startsWith("@services/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@services/", "src/services/"))
			} else if (specifier.startsWith("@shared/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@shared/", "src/shared/"))
			} else if (specifier.startsWith("@utils/")) {
				absPath = path.resolve(this.cwd, specifier.replace("@utils/", "src/utils/"))
			} else {
				return true // Assume external libraries exist
			}

			// Check common extensions
			const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]
			for (const ext of extensions) {
				if (fs.existsSync(absPath + ext)) return true
			}

			this.negativeCache.set(cacheKey, true)
			return false
		} catch {
			this.negativeCache.set(cacheKey, true)
			return false
		}
	}

	private isNodeLibrary(specifier: string): boolean {
		const builtins = [
			"assert",
			"async_hooks",
			"buffer",
			"child_process",
			"cluster",
			"console",
			"constants",
			"crypto",
			"dgram",
			"dns",
			"domain",
			"events",
			"fs",
			"fs/promises",
			"http",
			"http2",
			"https",
			"inspector",
			"module",
			"net",
			"os",
			"path",
			"perf_hooks",
			"process",
			"punycode",
			"querystring",
			"readline",
			"repl",
			"stream",
			"string_decoder",
			"timers",
			"tls",
			"trace_events",
			"tty",
			"url",
			"util",
			"v8",
			"vm",
			"worker_threads",
			"zlib",
			"typescript",
			"diagnostics_channel",
			"wasi",
			"test",
			"inspector",
		]
		// Handle node: prefix and common external library scopes to prevent false positive ghost detection
		const normalizedSpecifier = specifier.startsWith("node:") ? specifier.slice(5) : specifier
		const isBuiltin = builtins.includes(normalizedSpecifier)
		const isExternal =
			!specifier.startsWith(".") &&
			!specifier.startsWith("@/") &&
			!specifier.startsWith("@api/") &&
			!specifier.startsWith("@core/") &&
			!specifier.startsWith("@infrastructure/") &&
			!specifier.startsWith("@shared/") &&
			!specifier.startsWith("@utils/") &&
			!specifier.startsWith("@frontend/") &&
			!specifier.startsWith("@shared-utils/")

		return isBuiltin || isExternal
	}

	/**
	 * Computes entropy score.
	 */
	public computeEntropy(): SpiderEntropyReport {
		if (this.cachedEntropy && this.version === this.lastEntropyVersion) {
			return this.cachedEntropy
		}

		const totalNodes = this.nodes.size
		if (totalNodes === 0) {
			return { score: 0, components: { depthScore: 0, namingScore: 0, orphanScore: 0, couplingScore: 0 } }
		}

		const avgDepth = Array.from(this.nodes.values()).reduce((acc, n) => acc + n.depth, 0) / totalNodes
		const depthScore = Math.min(avgDepth / 4, 1.0)

		const policy = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()
		const namingScore = 0 // kebab-case enforcement removed per user request

		const orphans = Array.from(this.nodes.values()).filter((n) => n.orphaned).length
		const orphanScore = orphans / totalNodes

		let crossLayerEdges = 0
		let totalEdges = 0
		for (const node of this.nodes.values()) {
			for (const imp of node.imports) {
				totalEdges++
				const targetLayer = this.resolveLayer(node.id, imp)
				if (targetLayer && targetLayer !== node.layer && targetLayer !== "plumbing") {
					crossLayerEdges++
				}
			}
		}
		const couplingScore = totalEdges > 0 ? crossLayerEdges / totalEdges : 0

		// CYCLE DETECTION: Circular dependencies are architectural rot
		const cycles = this.detectCycles()
		const cyclePenalty = cycles.length > 0 ? Math.min(0.2, cycles.length * 0.05) : 0

		const score = Math.max(0, depthScore * 0.3 + namingScore * 0.2 + orphanScore * 0.2 + couplingScore * 0.3 - cyclePenalty)
		const report = { score, components: { depthScore, namingScore, orphanScore, couplingScore, cycles: cycles.length } }

		this.cachedEntropy = report
		this.lastEntropyVersion = this.version
		return report
	}

	/**
	 * Detects circular dependencies in the import graph using DFS.
	 */
	public detectCycles(): string[][] {
		const cycles: string[][] = []
		const visited = new Set<string>()
		const visiting = new Set<string>()
		const stack: string[] = []

		const dfs = (nodeId: string) => {
			visited.add(nodeId)
			visiting.add(nodeId)
			stack.push(nodeId)

			const node = this.nodes.get(nodeId)
			if (node) {
				for (const imp of node.imports) {
					const targetId = this.resolveImportToNodeId(nodeId, imp)
					if (!targetId || !this.nodes.has(targetId)) continue

					if (visiting.has(targetId)) {
						// Found a cycle
						const cycleStart = stack.indexOf(targetId)
						cycles.push(stack.slice(cycleStart))
					} else if (!visited.has(targetId)) {
						dfs(targetId)
					}
				}
			}

			visiting.delete(nodeId)
			stack.pop()
		}

		for (const nodeId of this.nodes.keys()) {
			if (!visited.has(nodeId)) {
				dfs(nodeId)
			}
		}

		return cycles
	}

	/**
	 * Resolves violations.
	 */
	public getViolations(): SpiderViolation[] {
		const violations: SpiderViolation[] = []
		const policy = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()

		for (const node of this.nodes.values()) {
			if (node.depth > policy.maxPathDepth) {
				violations.push({
					id: "SPI-001",
					severity: "ERROR",
					message: `Path depth (${node.depth}) exceeds limit (${policy.maxPathDepth}).`,
					path: node.id,
					remediation: "Flatten the directory structure or move this module closer to the source root.",
				})
			}
			if (node.orphaned) {
				violations.push({
					id: "SPI-003",
					severity: "WARN",
					message: "Node is orphaned (unreachable from roots).",
					path: node.id,
					remediation: "Import this file from a CORE or UI module, or delete it if it is dead code.",
				})
			}
		}

		// SPI-004: Circular Dependency Detection
		const cycles = this.detectCycles()
		for (const cycle of cycles) {
			violations.push({
				id: "SPI-004",
				severity: "ERROR",
				message: `Circular Dependency Detected: ${cycle.join(" -> ")} -> ${cycle[0]}`,
				path: cycle[0],
				remediation: "Break the cycle by extracting shared logic to a lower layer or using interfaces.",
			})
		}

		// Proactive Ghost Intelligence
		this.findGhosts()
		for (const ghost of this.ghosts) {
			violations.push({
				id: "SPI-005",
				severity: "WARN",
				message: `Ghost Import: ${ghost}`,
				path: ghost.split(" -> ")[0],
				remediation: "Dangling import discovered. Check if the file was deleted or the path is incorrect.",
			})
		}

		return violations
	}

	public toMermaid(): string {
		let mermaid = "graph TD\n"
		for (const node of this.nodes.values()) {
			for (const imp of node.imports) {
				const resolved = this.resolveImportToNodeId(node.id, imp)
				if (resolved && this.nodes.has(resolved)) {
					mermaid += `  ${path.basename(node.id).replace(/\./g, "_")} --> ${path.basename(resolved).replace(/\./g, "_")}\n`
				}
			}
		}
		return mermaid
	}

	async takeSnapshot(): Promise<string> {
		const report = this.computeEntropy()
		const snapshot: SpiderSnapshot = {
			timestamp: new Date().toISOString(),
			entropyScore: report.score,
			nodes: Array.from(this.nodes.values()),
			components: report.components,
		}
		if (!fs.existsSync(this.snapshotDir)) await fs.promises.mkdir(this.snapshotDir, { recursive: true })
		const filePath = path.join(this.snapshotDir, `${Date.now()}.json`)
		// PRODUCTION HARDENING: Atomic write to prevent corruption
		await writeAtomic(filePath, JSON.stringify(snapshot, null, 2))
		return filePath
	}

	compareWith(snapshot: SpiderSnapshot): number {
		return this.computeEntropy().score - snapshot.entropyScore
	}

	async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
		if (!fs.existsSync(this.snapshotDir)) return null
		const files = await fs.promises.readdir(this.snapshotDir)
		if (files.length === 0) return null
		const latest = files.sort().reverse()[0]
		if (!latest) return null
		const content = await fs.promises.readFile(path.join(this.snapshotDir, latest), "utf-8")
		return JSON.parse(content)
	}

	public resolveImportToNodeId(sourcePath: string, specifier: string): string | null {
		const cacheKey = `${sourcePath}:${specifier}`
		if (this.resolutionCache.has(cacheKey)) return this.resolutionCache.get(cacheKey) ?? null

		let result: string | null = null
		if (specifier.startsWith(".")) {
			const abs = path.resolve(this.cwd, path.dirname(sourcePath), specifier)
			const rel = path.relative(this.cwd, abs).replace(/\\/g, "/")
			if (this.nodes.has(rel)) result = rel
			else if (this.nodes.has(`${rel}.ts`)) result = `${rel}.ts`
			else if (this.nodes.has(`${rel}.tsx`)) result = `${rel}.tsx`
			else {
				// Handle directory index files
				const indexTs = path.join(rel, "index.ts").replace(/\\/g, "/")
				if (this.nodes.has(indexTs)) result = indexTs
				else {
					const indexTsx = path.join(rel, "index.tsx").replace(/\\/g, "/")
					if (this.nodes.has(indexTsx)) result = indexTsx
				}
			}
		} else if (specifier.startsWith("@/")) {
			const rel = specifier.replace("@/", "src/").replace(/\\/g, "/")
			if (this.nodes.has(rel)) result = rel
			else if (this.nodes.has(`${rel}.ts`)) result = `${rel}.ts`
			else if (this.nodes.has(`${rel}.tsx`)) result = `${rel}.tsx`
			else {
				// Handle directory index files for aliases
				const indexTs = path.join(rel, "index.ts").toPosix()
				if (this.nodes.has(indexTs)) result = indexTs
				else {
					const indexTsx = path.join(rel, "index.tsx").toPosix()
					if (this.nodes.has(indexTsx)) result = indexTsx
				}
			}
		}
		this.resolutionCache.set(cacheKey, result)
		return result
	}

	public serialize(): Buffer {
		return v8.serialize(Array.from(this.nodes.entries()))
	}

	public deserialize(data: Buffer) {
		try {
			const entries = v8.deserialize(data)
			this.nodes = new Map(entries)
			this.version++
		} catch (e) {
			Logger.error("[SpiderEngine] Binary deserialization failed:", e)
		}
	}

	/**
	 * Fast, in-memory clone of the structural graph.
	 * Avoids JSON serialization overhead for simulation work.
	 */
	public clone(): SpiderEngine {
		const clone = new SpiderEngine(this.cwd)
		// Shallow clone of the map and a shallow clone of each node object
		clone.nodes = new Map(Array.from(this.nodes.entries()).map(([k, v]) => [k, { ...v }]))
		clone.version = this.version
		return clone
	}

	public async saveRegistry(): Promise<void> {
		if (this.saveTimeout) return

		this.saveTimeout = setTimeout(async () => {
			const data = this.serialize()
			const dir = path.dirname(this.registryFile)
			const binFile = this.registryFile.replace(".json", ".spiderbin")
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

			// PRODUCTION HARDENING: Atomic binary write
			await writeAtomic(binFile, data)
			this.saveTimeout = null
		}, 500)
	}

	public async loadRegistry(): Promise<boolean> {
		const binFile = this.registryFile.replace(".json", ".spiderbin")
		const fileToLoad = fs.existsSync(binFile) ? binFile : fs.existsSync(this.registryFile) ? this.registryFile : null

		if (!fileToLoad) return false

		try {
			const data = await fs.promises.readFile(fileToLoad)
			if (fileToLoad.endsWith(".json")) {
				const entries = JSON.parse(data.toString("utf-8"))
				this.nodes = new Map(entries)
			} else {
				this.deserialize(data)
			}
			this.computeCouplingMetrics()
			this.computeReachability()
			return true
		} catch (e) {
			Logger.error("[SpiderEngine] Registry load failed:", e)
			return false
		}
	}

	private normalizePath(filePath: string): string {
		try {
			const absolutePath = path.resolve(this.cwd, filePath)
			const relativePath = path.relative(this.cwd, absolutePath)
			return relativePath.replace(/\\/g, "/")
		} catch {
			return filePath.replace(/\\/g, "/")
		}
	}

	public resolveLayer(sourcePath: string, specifier: string): Layer | null {
		const id = this.resolveImportToNodeId(sourcePath, specifier)
		return id ? this.nodes.get(id)?.layer || null : null
	}
}
