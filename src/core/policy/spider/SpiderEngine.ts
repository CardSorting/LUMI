/**
 * [LAYER: CORE]
 */

import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import * as v8 from "v8"
import { Logger } from "../../../shared/services/Logger.js"
import { ForensicEngine } from "./ForensicEngine.js"
import { MetricsEngine } from "./MetricsEngine.js"
import { PathResolver } from "./PathResolver.js"
import { PersistenceManager } from "./PersistenceManager.js"
import { SpiderEntropyReport, SpiderNode, SpiderRegistryPayload, SpiderSnapshot, SpiderViolation } from "./types.js"

export type { SpiderNode, SpiderEntropyReport, SpiderViolation, SpiderSnapshot, SpiderRegistryPayload }

import { MetabolicMonitor } from "../../integrity/MetabolicMonitor.js"
import { PathogenStore } from "../../integrity/PathogenStore.js"
import { SovereignPolicy } from "../SovereignPolicy.js"

/**
 * SpiderEngine: The Facade orchestrating structural graph analysis,
 * entropy scoring, and evolution tracking.
 */
export class SpiderEngine {
	public nodes: Map<string, SpiderNode> = new Map()
	public ghosts: Set<string> = new Set()
	public version = 0
	public isRecovering = false // Track if the last operation improved project health

	/**
	 * V9: Centralized source of truth for architectural aliases.
	 * Synchronizes ForensicEngine, TspPolicyPlugin, and FluidPolicyEngine.
	 */
	public static getGlobalAliases(): Record<string, string> {
		return {
			"@/": "src/",
			"@domain/": "src/domain/",
			"@core/": "src/core/",
			"@infrastructure/": "src/infrastructure/",
			"@plumbing/": "src/plumbing/",
			"@ui/": "src/ui/",
			"@api/": "src/core/api/",
			"@generated/": "src/generated/",
			"@services/": "src/services/",
			"@integrations/": "src/integrations/",
			"@packages/": "src/packages/",
			"@hosts/": "src/hosts/",
			"@shared/": "src/shared/",
			"@utils/": "src/utils/",
			"@frontend/": "webview-ui/src/",
			"@shared-utils/": "src/shared/utils/",
		}
	}

	private resolver: PathResolver
	private forensics: ForensicEngine
	private metrics: MetricsEngine
	private persistence: PersistenceManager

	private reachabilityTimeout: NodeJS.Timeout | null = null
	private registryFile: string
	private snapshotDir: string

	constructor(public cwd: string) {
		this.registryFile = path.join(cwd, ".spider", "registry.json")
		this.snapshotDir = path.join(cwd, ".spider", "snapshots")

		this.resolver = new PathResolver(cwd)
		this.forensics = new ForensicEngine(cwd, this.resolver)
		this.metrics = new MetricsEngine(cwd, this.resolver)
		this.persistence = new PersistenceManager(cwd, this.registryFile, this.snapshotDir, this.metrics)
	}

	public async warmUp(entryPoints: string[] = ["src/main.ts", "src/index.ts"]) {
		for (const entry of entryPoints) {
			const absPath = path.resolve(this.cwd, entry)
			if (fs.existsSync(absPath)) {
				const content = await fs.promises.readFile(absPath, "utf-8")
				this.updateNode(entry, content)
			}
		}
		await this.synchronizeRegistry()
	}

	public buildGraph(files: { filePath: string; content: string }[]): void {
		this.nodes.clear()
		for (const file of files) {
			this.updateNode(file.filePath, file.content)
		}
		this.metrics.computeCouplingMetrics(this.nodes)
		this.metrics.computeReachability(this.nodes)
		this.resolver.clearCaches()
	}

	public updateNode(filePath: string, content: string) {
		const normalizedPath = this.resolver.normalizePath(filePath)
		this.checkMetabolicPressure()

		const absolutePath = path.resolve(this.cwd, filePath)
		const layer = this.resolver.resolveLayer(filePath)
		const hash = crypto.createHash("md5").update(content).digest("hex")

		const oldNode = this.nodes.get(normalizedPath)
		if (oldNode && oldNode.hash === hash) return

		const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)
		const importData = this.extractDetailedImports(sourceFile)
		const imports = importData.map((i) => i.specifier)
		const exports = this.extractExports(sourceFile)
		const metrics = this.extractMetrics(sourceFile)

		const consumptions: Record<string, string[]> = {}
		for (const { specifier, symbols } of importData) {
			const targetId = this.resolver.resolveImportToNodeId(normalizedPath, specifier, new Set(this.nodes.keys()))
			if (targetId) {
				consumptions[targetId] = (consumptions[targetId] || []).concat(symbols)
			}
		}

		const newNode: SpiderNode = {
			id: normalizedPath,
			path: normalizedPath,
			layer,
			imports: Array.from(imports),
			dependents: oldNode?.dependents || [],
			depth: normalizedPath.split("/").length - 1,
			orphaned: false,
			afferentCoupling: oldNode?.afferentCoupling || 0,
			...metrics,
			hash,
			isInterface: this.detectInterface(normalizedPath, sourceFile),
			exports,
			consumptions,
			mtime: fs.statSync(absolutePath).mtimeMs,
		}

		this.nodes.set(normalizedPath, newNode)
		this.version++

		if (!oldNode || JSON.stringify(oldNode.imports) !== JSON.stringify(newNode.imports)) {
			this.updateIncrementalCoupling(normalizedPath, oldNode?.imports || [], newNode.imports)
			this.resolver.clearFileFromCache(normalizedPath)
			this.scheduleReachability()
		}

		// V20: Non-blocking background save to prevent I/O latency blocks
		this.persistence.saveRegistry(this.nodes).catch((e) => Logger.error("[SpiderEngine] Registry persistence failed:", e))
	}

	private extractExports(sourceFile: ts.SourceFile): string[] {
		const exports: string[] = []
		const visit = (node: ts.Node) => {
			if (
				(ts.isClassDeclaration(node) ||
					ts.isFunctionDeclaration(node) ||
					ts.isInterfaceDeclaration(node) ||
					ts.isTypeAliasDeclaration(node) ||
					ts.isEnumDeclaration(node) ||
					ts.isVariableStatement(node)) &&
				node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
			) {
				if (ts.isVariableStatement(node)) {
					for (const decl of node.declarationList.declarations) {
						if (ts.isIdentifier(decl.name)) exports.push(decl.name.text)
					}
				} else if (node.name && ts.isIdentifier(node.name)) {
					exports.push(node.name.text)
				}
			} else if (ts.isExportDeclaration(node)) {
				if (node.exportClause && ts.isNamedExports(node.exportClause)) {
					for (const element of node.exportClause.elements) {
						exports.push(element.name.text)
					}
				}
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)
		return Array.from(new Set(exports))
	}

	/**
	 * V16: Detailed import extraction including symbols.
	 */
	private extractDetailedImports(sourceFile: ts.SourceFile): { specifier: string; symbols: string[] }[] {
		const imports: { specifier: string; symbols: string[] }[] = []
		sourceFile.forEachChild((node) => {
			if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
				const specifier = node.moduleSpecifier.text
				const symbols: string[] = []
				if (node.importClause) {
					if (node.importClause.name) {
						symbols.push("default")
					}
					if (node.importClause.namedBindings) {
						if (ts.isNamedImports(node.importClause.namedBindings)) {
							for (const n of node.importClause.namedBindings.elements) {
								symbols.push(n.name.text)
							}
						} else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
							symbols.push("*")
						}
					}
				}
				imports.push({ specifier, symbols })
			} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				const specifier = node.moduleSpecifier.text
				const symbols: string[] = []
				if (node.exportClause && ts.isNamedExports(node.exportClause)) {
					for (const n of node.exportClause.elements) {
						symbols.push(n.name.text)
					}
				} else {
					symbols.push("*")
				}
				imports.push({ specifier, symbols })
			}
		})
		return imports
	}

	private extractMetrics(sourceFile: ts.SourceFile) {
		let totalNodes = 0
		let logicNodes = 0
		let ioImports = 0
		let totalImports = 0

		const visit = (node: ts.Node) => {
			totalNodes++
			const kind = node.kind
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
			if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
				totalImports++
				const text = node.moduleSpecifier.text
				if (!text.startsWith(".") && !text.startsWith("@/")) ioImports++
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)

		return {
			logicDensity: totalNodes > 0 ? logicNodes / totalNodes : 0,
			ioEntropy: totalImports > 0 ? ioImports / totalImports : 0,
			astComplexity: totalNodes,
		}
	}

	private detectInterface(path: string, sourceFile: ts.SourceFile): boolean {
		let hasConcrete = false
		const visit = (node: ts.Node) => {
			if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) {
				const hasBody =
					(ts.isFunctionDeclaration(node) && node.body) ||
					(ts.isClassDeclaration(node) && node.members.length > 0) ||
					ts.isVariableDeclaration(node)
				if (hasBody) hasConcrete = true
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)
		return !hasConcrete || path.includes("/interfaces/") || path.includes("/types/") || path.endsWith(".d.ts")
	}

	private updateIncrementalCoupling(nodeId: string, oldImports: string[], newImports: string[]) {
		const removed = oldImports.filter((o) => !newImports.includes(o))
		const added = newImports.filter((n) => !oldImports.includes(n))

		for (const imp of removed) {
			const targetId = this.resolver.resolveImportToNodeId(nodeId, imp, new Set(this.nodes.keys()))
			const target = targetId ? this.nodes.get(targetId) : null
			if (target) {
				target.dependents = target.dependents.filter((d) => d !== nodeId)
				target.afferentCoupling = target.dependents.length
			}
		}
		for (const imp of added) {
			const targetId = this.resolver.resolveImportToNodeId(nodeId, imp, new Set(this.nodes.keys()))
			const target = targetId ? this.nodes.get(targetId) : null
			if (target && !target.dependents.includes(nodeId)) {
				target.dependents.push(nodeId)
				target.afferentCoupling = target.dependents.length
			}
		}
	}

	private scheduleReachability() {
		if (this.reachabilityTimeout) return
		this.reachabilityTimeout = setTimeout(() => {
			this.metrics.computeReachability(this.nodes)
			this.reachabilityTimeout = null
		}, 100)
	}

	private checkMetabolicPressure() {
		const stats = v8.getHeapStatistics()
		const usedPercent = (stats.used_heap_size / stats.heap_size_limit) * 100
		if (usedPercent > 80) {
			this.resolver.clearCaches()
			if (global.gc) global.gc()
		}
	}

	public computeEntropy(): SpiderEntropyReport {
		return this.metrics.computeEntropy(this.nodes)
	}

	public computeCouplingMetrics() {
		return this.metrics.computeCouplingMetrics(this.nodes)
	}

	public computeReachability() {
		return this.metrics.computeReachability(this.nodes)
	}

	public detectCycles(): string[][] {
		return this.metrics.detectCycles(this.nodes)
	}

	public getViolations(): SpiderViolation[] {
		this.pruneDeadNodes()
		const violations: SpiderViolation[] = []
		const policy = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()

		for (const node of this.nodes.values()) {
			if (node.depth > policy.maxPathDepth) {
				violations.push({
					id: "SPI-001",
					severity: "ERROR",
					message: `Path depth (${node.depth}) exceeds limit.`,
					path: node.id,
				})
			}
			if (node.orphaned) {
				violations.push({ id: "SPI-003", severity: "WARN", message: `Node is orphaned: ${node.id}`, path: node.id })
			}
		}

		const cycles = this.metrics.detectCycles(this.nodes)
		for (const cycle of cycles) {
			const formattedPath = [...cycle, cycle[0]].map((p) => path.basename(p)).join(" -> ")
			violations.push({
				id: "SPI-004",
				severity: "ERROR",
				message: `Circular dependency detected: ${formattedPath}`,
				path: cycle[0],
			})
		}

		// V21: Barrel Sovereignty - Detect sub-system bypasses
		const barrelBreaches = this.findBarrelBreaches()
		violations.push(...barrelBreaches)

		this.ghosts = this.forensics.findGhosts(this.nodes)
		for (const ghost of this.ghosts) {
			const [sourcePath, symbol] = ghost.split(" -> ")
			const providers = this.findSymbolProviders(symbol)
			let remediation: string | undefined

			if (providers.length > 0) {
				const bestProvider = providers[0]
				const relPath = path
					.relative(path.dirname(sourcePath), bestProvider)
					.replace(/\.tsx?$/, "")
					.replace(/\\/g, "/")
				const specifier = relPath.startsWith(".") ? relPath : `./${relPath}`
				remediation = `Suggested Import: import { ${symbol} } from '${specifier}'`
			}

			violations.push({
				id: "SPI-005",
				severity: "WARN",
				message: `Ghost import: ${ghost}`,
				path: sourcePath,
				remediation,
			})
		}

		const unused = this.forensics.findUnusedExports(this.nodes)
		for (const v of unused) {
			violations.push({ id: "SPI-103", severity: "INFO", message: v, path: v.split(" -> ")[0].split(": ")[1] })
		}

		return violations
	}

	public getViolationHotspots(): string[] {
		const violations = this.getViolations()
		return Array.from(new Set(violations.map((v) => v.path)))
	}

	public getFilesByPath(dir: string): string[] {
		return Array.from(this.nodes.keys()).filter((p) => p.startsWith(dir))
	}

	public async takeSnapshot(): Promise<string> {
		return this.persistence.takeSnapshot(this.nodes)
	}

	public async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
		return this.persistence.getLatestSnapshot()
	}

	public async loadRegistry(): Promise<boolean> {
		const binFile = this.registryFile.replace(".json", ".spiderbin")
		const fileToLoad = fs.existsSync(binFile) ? binFile : fs.existsSync(this.registryFile) ? this.registryFile : null
		if (!fileToLoad) return false

		try {
			const data = await fs.promises.readFile(fileToLoad)
			if (fileToLoad.endsWith(".json")) {
				this.nodes = new Map(JSON.parse(data.toString("utf-8")))
			} else {
				const payload = this.persistence.deserialize(data)
				this.nodes = new Map(payload.nodes)
				// Merkle healing logic could go here or remain in Facade
			}
			this.metrics.computeCouplingMetrics(this.nodes)
			this.metrics.computeReachability(this.nodes)
			await this.synchronizeRegistry()
			return true
		} catch (e) {
			Logger.error("[SpiderEngine] Registry load failed:", e)
			return false
		}
	}

	/**
	 * V20: Synchronizes the in-memory registry with the physical disk (Merkle Healing).
	 * Prunes missing files and automatically re-indexes stale files based on mtime.
	 */
	public async synchronizeRegistry(): Promise<void> {
		let pruned = 0
		let reindexed = 0

		for (const [id, node] of this.nodes.entries()) {
			const absPath = path.resolve(this.cwd, node.path)
			if (!fs.existsSync(absPath)) {
				this.nodes.delete(id)
				pruned++
			} else {
				const stats = fs.statSync(absPath)
				if (stats.mtimeMs > (node.mtime || 0)) {
					const content = await fs.promises.readFile(absPath, "utf-8")
					this.updateNode(node.path, content)
					reindexed++
				}
			}
		}

		if (pruned > 0 || reindexed > 0) {
			this.version++
			Logger.info(`[SpiderEngine] Registry Synchronized: Pruned ${pruned}, Re-indexed ${reindexed}.`)
			this.metrics.computeCouplingMetrics(this.nodes)
			this.metrics.computeReachability(this.nodes)
		}
	}

	public pruneDeadNodes(): void {
		// Legacy alias for synchronizeRegistry (Sync)
		let pruned = 0
		for (const [id, node] of this.nodes.entries()) {
			const absPath = path.resolve(this.cwd, node.path)
			if (!fs.existsSync(absPath)) {
				this.nodes.delete(id)
				pruned++
			}
		}
		if (pruned > 0) {
			this.version++
			this.metrics.computeCouplingMetrics(this.nodes)
			this.metrics.computeReachability(this.nodes)
		}
	}

	public clone(): SpiderEngine {
		const clone = new SpiderEngine(this.cwd)
		clone.nodes = new Map(Array.from(this.nodes.entries()).map(([k, v]) => [k, { ...v }]))
		clone.version = this.version
		return clone
	}

	public serialize(): Buffer {
		return this.persistence.serialize(this.nodes)
	}

	public deserialize(data: Buffer) {
		const payload = this.persistence.deserialize(data)
		this.nodes = new Map(payload.nodes)
		this.metrics.computeCouplingMetrics(this.nodes)
		this.metrics.computeReachability(this.nodes)
	}

	public computeAllLayerFingerprints(): Record<string, string> {
		return this.persistence.computeAllLayerFingerprints(this.nodes)
	}

	public normalizePath(filePath: string): string {
		return this.resolver.normalizePath(filePath)
	}

	public resolveLayer(pathOrSource: string, specifier?: string): string | null {
		if (specifier) {
			const id = this.resolver.resolveImportToNodeId(pathOrSource, specifier, new Set(this.nodes.keys()))
			return id ? this.nodes.get(id)?.layer || null : null
		}
		return this.resolver.resolveLayer(pathOrSource)
	}

	public forecastEntropy(files: { path: string; content: string }[]): {
		predictedScore: number
		components: SpiderEntropyReport["components"]
	} {
		const clone = this.clone()
		for (const file of files) {
			clone.updateNode(file.path, file.content)
		}
		const report = clone.computeEntropy()
		return { predictedScore: report.score, components: report.components }
	}

	public compareWith(snapshot: SpiderSnapshot): number {
		const current = this.computeEntropy()
		return Math.abs(current.score - snapshot.entropyScore)
	}

	public resolveImportLayer(sourcePath: string, specifier: string): string | null {
		const id = this.resolver.resolveImportToNodeId(sourcePath, specifier, new Set(this.nodes.keys()))
		return id ? this.nodes.get(id)?.layer || null : null
	}

	public isNodeLibrary(specifier: string): boolean {
		return !specifier.startsWith(".") && !specifier.startsWith("@/")
	}

	public resolveImportToNodeId(sourceId: string, specifier: string): string | null {
		return this.resolver.resolveImportToNodeId(sourceId, specifier, new Set(this.nodes.keys()))
	}

	/**
	 * V17: Searches the global export registry for nodes that provide a specific symbol.
	 */
	public findSymbolProviders(symbol: string): string[] {
		const providers: string[] = []
		for (const node of this.nodes.values()) {
			if (node.exports.includes(symbol)) {
				providers.push(node.path)
			}
		}
		return providers
	}

	public computeCCI(filePath: string, pathogens: PathogenStore, monitor: MetabolicMonitor): number {
		const node = this.nodes.get(this.resolver.normalizePath(filePath))
		if (!node) return 0
		const couplingLoad = Math.min(node.afferentCoupling / 20, 1.0)
		const complexityLoad = Math.min(node.astComplexity / 2000, 1.0)
		const structuralWeight = ((couplingLoad + complexityLoad) / 2) * 0.4
		const prediction = pathogens.predictFailure(filePath)
		const historicalRisk = prediction.likely ? 0.4 : 0
		const infection = monitor.isMetabolicallyInflamed(filePath)
		const metabolicPressure = infection.inflamed ? 0.2 : 0
		return structuralWeight + historicalRisk + metabolicPressure
	}

	public toMermaid(): string {
		let graph = "graph TD\n"
		for (const node of this.nodes.values()) {
			const label = path.basename(node.path)
			const id = node.id.replace(/\W/g, "_")
			graph += `  ${id}["${label}"]\n`
			for (const imp of node.imports) {
				const depNodeId = this.resolver.resolveImportToNodeId(node.id, imp, new Set(this.nodes.keys()))
				if (depNodeId) {
					graph += `  ${id} --> ${depNodeId.replace(/\W/g, "_")}\n`
				}
			}
		}
		return graph
	}

	/**
	 * V21: Identifies imports that bypass a local index.ts/js (Barrel Breach).
	 */
	private findBarrelBreaches(): import("./types.js").SpiderViolation[] {
		const breaches: import("./types.js").SpiderViolation[] = []
		const barrels = Array.from(this.nodes.keys()).filter((p) => p.endsWith("/index.ts") || p.endsWith("/index.js"))

		for (const node of this.nodes.values()) {
			for (const imp of node.imports) {
				const targetId = this.resolver.resolveImportToNodeId(node.id, imp, new Set(this.nodes.keys()))
				if (!targetId || targetId === node.id) continue

				const targetDir = path.dirname(targetId)
				const localBarrel = barrels.find((b) => path.dirname(b) === targetDir && b !== targetId)

				if (localBarrel && targetId !== localBarrel) {
					// We are importing a file directly, but a barrel exists in its directory.
					// Heuristic: If we are not in the same directory, we should use the barrel.
					if (path.dirname(node.id) !== targetDir) {
						breaches.push({
							id: "SPI-104",
							severity: "WARN",
							message: `BARREL BREACH: Importing ${path.basename(targetId)} directly. Use sub-system entry point: ${path.basename(targetDir)}/index.ts.`,
							path: node.id,
							remediation: `Suggested: Import from ${path.dirname(targetId)} instead of ${targetId}.`,
						})
					}
				}
			}
		}
		return breaches
	}
}
