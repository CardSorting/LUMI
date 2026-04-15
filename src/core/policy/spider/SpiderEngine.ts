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
		const imports = this.extractImports(sourceFile)
		const metrics = this.extractMetrics(sourceFile)

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
		}

		this.nodes.set(normalizedPath, newNode)
		this.version++

		if (!oldNode || JSON.stringify(oldNode.imports) !== JSON.stringify(newNode.imports)) {
			this.updateIncrementalCoupling(normalizedPath, oldNode?.imports || [], newNode.imports)
			this.resolver.clearFileFromCache(normalizedPath)
			this.scheduleReachability()
		}
		this.persistence.saveRegistry(this.nodes).catch((e) => Logger.error("[SpiderEngine] Save failed:", e))
	}

	private extractImports(sourceFile: ts.SourceFile): Set<string> {
		const imports = new Set<string>()
		const visit = (node: ts.Node) => {
			if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
				imports.add(node.moduleSpecifier.text)
			} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				imports.add(node.moduleSpecifier.text)
			} else if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword &&
				node.arguments.length > 0
			) {
				const arg = node.arguments[0]
				if (ts.isStringLiteral(arg)) imports.add(arg.text)
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)
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
			violations.push({
				id: "SPI-004",
				severity: "ERROR",
				message: `Circular dependency: ${cycle.join(" -> ")}`,
				path: cycle[0],
			})
		}

		this.ghosts = this.forensics.findGhosts(this.nodes)
		for (const ghost of this.ghosts) {
			violations.push({ id: "SPI-005", severity: "WARN", message: `Ghost import: ${ghost}`, path: ghost.split(" -> ")[0] })
		}

		return violations
	}

	public getViolationHotspots(): string[] {
		const violations = this.getViolations()
		return Array.from(new Set(violations.map((v) => v.path)))
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
			return true
		} catch (e) {
			Logger.error("[SpiderEngine] Registry load failed:", e)
			return false
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

	public forecastEntropy(files: { path: string; content: string }[]): { predictedScore: number; components: any } {
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

	public computeCCI(filePath: string, pathogens: PathogenStore, monitor: MetabolicMonitor): number {
		const node = this.nodes.get(this.resolver.normalizePath(filePath))
		if (!node) return 0
		const couplingLoad = Math.min(node.afferentCoupling / 20, 1.0)
		const complexityLoad = Math.min(node.astComplexity / 2000, 1.0)
		const structuralWeight = ((couplingLoad + complexityLoad) / 2) * 0.4
		const prediction = pathogens.predictFailure(filePath)
		const historicalRisk = prediction.likely ? 0.4 : 0
		const infection = monitor.isInflamed(filePath)
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
}
