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
	private metrics: MetricsEngine
	private persistence: PersistenceManager
	private forensic: ForensicEngine
	private suppressions: Set<string> = new Set() // V45: Forensic Suppression List
	private sessionBuffer: Map<string, string> = new Map() // V71: Virtual Session Sensing
	private stabilityLock: string | null = null // V190: Lock owner
	private stabilityLockId: string | null = null // V200: Session-specific lock ID
	private stabilityHeartbeat: NodeJS.Timeout | null = null // V190: Lock expiration timer
	private substrateCheckpoint: Buffer | null = null // V200: Resilience Snapshot
	private checkpointTimestamp: string | null = null // V200: Snapshot metadata

	private reachabilityTimeout: NodeJS.Timeout | null = null
	constructor(public cwd: string) {
		this.resolver = new PathResolver(cwd, SpiderEngine.getGlobalAliases())
		this.metrics = new MetricsEngine(cwd, this.resolver)
		this.persistence = new PersistenceManager(this.metrics)
		this.forensic = new ForensicEngine(cwd, this.resolver)
	}

	/**
	 * V200: Structural Resilience.
	 * Captures a binary snapshot of the current structural truth.
	 */
	public createCheckpoint(): void {
		this.substrateCheckpoint = this.persistence.serialize(this.nodes)
		this.checkpointTimestamp = new Date().toISOString()
		Logger.info(`[SpiderEngine] Substrate Checkpoint Created: ${this.checkpointTimestamp}`)
	}

	/**
	 * V200: Structural Resilience.
	 * Reverts the substrate to the last valid checkpoint.
	 */
	public async rollbackSubstrate(): Promise<boolean> {
		if (!this.substrateCheckpoint) {
			Logger.error("[SpiderEngine] Rollback failed: No substrate checkpoint found.")
			return false
		}

		try {
			const payload = this.persistence.deserialize(this.substrateCheckpoint)
			this.nodes = new Map(payload.nodes)
			this.version++
			Logger.info(`[SpiderEngine] Substrate successfully rolled back to checkpoint: ${this.checkpointTimestamp}`)
			this.substrateCheckpoint = null // Clear after successful rollback
			return true
		} catch (e) {
			Logger.error("[SpiderEngine] Critical failure during substrate rollback:", e)
			return false
		}
	}

	/**
	 * V190: Stability Sovereignty.
	 * Acquires a mutual exclusion lock to prevent structural corruption during
	 * concurrent or multi-step refactoring operations.
	 */
	public async acquireStabilityLock(owner: string, sessionId?: string): Promise<string | null> {
		const lockId = sessionId || crypto.randomUUID()
		if (this.stabilityLock && this.stabilityLock !== owner) {
			Logger.warn(`[SpiderEngine] Stability Lock collision: ${owner} denied by ${this.stabilityLock}`)
			return null
		}

		this.stabilityLock = owner
		this.stabilityLockId = lockId
		this.clearStabilityHeartbeat()
		this.stabilityHeartbeat = setTimeout(() => {
			Logger.error(`[SpiderEngine] Stability Lease EXPIRED for ${owner} (${lockId}). Forcefully releasing lock.`)
			this.releaseStabilityLock(owner, lockId)
		}, 60000) // 1 minute lease

		return lockId
	}

	public releaseStabilityLock(owner: string, lockId: string): void {
		if (this.stabilityLock === owner && this.stabilityLockId === lockId) {
			this.stabilityLock = null
			this.stabilityLockId = null
			this.clearStabilityHeartbeat()
		}
	}

	private clearStabilityHeartbeat(): void {
		if (this.stabilityHeartbeat) {
			clearTimeout(this.stabilityHeartbeat)
			this.stabilityHeartbeat = null
		}
	}

	/**
	 * V200: Metabolic Hygiene (Disposal).
	 * Forcefully releases all persistent memory and timers to prevent leaks.
	 */
	public dispose(): void {
		this.clearStabilityHeartbeat()
		if (this.reachabilityTimeout) {
			clearTimeout(this.reachabilityTimeout)
			this.reachabilityTimeout = null
		}
		this.forensic.dispose()
		this.resolver.dispose()
		this.persistence.dispose() // V200: Memory-Resident Pure Purge
		this.nodes.clear()
		this.ghosts.clear()
		this.sessionBuffer.clear()
		this.substrateCheckpoint = null
		Logger.info("[SpiderEngine] Industrial Disposal Complete. Memory Substrate Released.")
	}

	/**
	 * V200: TC39 Disposability Standard.
	 */
	public [Symbol.dispose](): void {
		this.dispose()
	}

	public getForensicEngine(): ForensicEngine {
		return this.forensic
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
		this.sessionBuffer.clear() // V200: Memory-Resident Residual Purge
		this.metrics.computeCouplingMetrics(this.nodes)
		this.metrics.computeReachability(this.nodes)
		this.resolver.clearCaches()
	}

	public updateNode(filePath: string, content: string) {
		const normalizedPath = this.resolver.normalizePath(filePath)
		this.checkStabilityPressure()

		const absolutePath = path.resolve(this.cwd, filePath)
		const layer = this.resolver.resolveLayer(filePath)
		const hash = crypto.createHash("md5").update(content).digest("hex")

		const oldNode = this.nodes.get(normalizedPath)
		if (oldNode && oldNode.hash === hash) return

		let sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)
		let importData = this.extractDetailedImports(sourceFile)
		const imports = importData.map((i) => i.specifier)
		let exports = this.extractExports(sourceFile)
		let metrics = this.extractMetrics(sourceFile)

		const consumptions: Record<string, string[]> = {}
		for (const { specifier, symbols } of importData) {
			const targetId = this.resolver.resolveImportToNodeId(normalizedPath, specifier, this.nodes)
			if (targetId) {
				consumptions[targetId] = (consumptions[targetId] || []).concat(symbols)
			}
		}

		const namingScore = this.calculateNamingScore(sourceFile)

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
			namingScore,
			symbolDensity: content.length > 0 ? exports.length / (content.length / 100) : 0,
			logicCohesion: 0.5,
			blastRadius: 0, // Computed project-wide
			isFragile: false,
			cognitiveComplexity: this.metrics.calculateCognitiveComplexity(sourceFile),
			isHotspot: false, // Computed project-wide
		}

		this.nodes.set(normalizedPath, newNode)
		this.version++

		if (!oldNode || JSON.stringify(oldNode.imports) !== JSON.stringify(newNode.imports)) {
			this.updateIncrementalCoupling(normalizedPath, oldNode?.imports || [], newNode.imports)
			this.resolver.clearFileFromCache(normalizedPath)
			this.scheduleReachability()
		}
		// V200: Forensic Closure Hygiene - Forcefully destroy visitor scopes
		;(sourceFile as unknown) = null
		;(importData as unknown) = null
		;(exports as unknown) = null
		;(metrics as unknown) = null
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
		let exportCount = 0
		let internalReferenceCount = 0

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

			// V160: Forensic Depth - Identifying exports for density calculation
			if (
				(ts.isClassDeclaration(node) ||
					ts.isFunctionDeclaration(node) ||
					ts.isInterfaceDeclaration(node) ||
					ts.isTypeAliasDeclaration(node) ||
					ts.isVariableStatement(node)) &&
				node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
			) {
				exportCount++
			}

			// V160: Forensic Depth - Simple Cohesion (Internal identifier re-use)
			if (ts.isIdentifier(node) && node.parent && !ts.isPropertyAccessExpression(node.parent)) {
				internalReferenceCount++
			}

			ts.forEachChild(node, visit)
		}
		visit(sourceFile)

		return {
			logicDensity: totalNodes > 0 ? logicNodes / totalNodes : 0,
			ioEntropy: totalImports > 0 ? ioImports / totalImports : 0,
			astComplexity: totalNodes,
			symbolDensity: totalNodes > 0 ? exportCount / totalNodes : 0,
			logicCohesion: totalNodes > 0 ? internalReferenceCount / totalNodes : 0,
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

	private checkStabilityPressure() {
		const stats = v8.getHeapStatistics()
		const usedPercent = (stats.used_heap_size / stats.heap_size_limit) * 100

		if (usedPercent > 90) {
			Logger.error(`[SpiderEngine] CRITICAL Metabolic Pressure (${usedPercent.toFixed(1)}%). Triggering ABSOLUTE SWEEP.`)
			this.resolver.dispose()
			this.sessionBuffer.clear()
			this.substrateCheckpoint = null
			this.ghosts.clear()
			if (global.gc) global.gc()
			return
		}

		if (usedPercent > 80) {
			Logger.warn(
				`[SpiderEngine] High Metabolic Pressure detected (${usedPercent.toFixed(1)}%). Triggering Substrate Sweep.`,
			)
			this.resolver.clearCaches()
			this.sessionBuffer.clear()
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

		// V140: Forensic Realism - 'Ghost' or 'Predictive' violations have been removed.
		// The substrate now relies 100% on physical build/lint diagnostics to trigger heals.
		// This prevents agentic spiraling from hypothetical errors.

		// V45: Forensic Pruning (Filter out suppressed false positives)

		// V45: Forensic Pruning (Filter out suppressed false positives)
		return violations.filter((v) => !this.suppressions.has(`${v.id}:${v.path}:${v.message}`))
	}

	public addSuppression(violationId: string, path: string, message: string) {
		this.suppressions.add(`${violationId}:${path}:${message}`)
	}

	public clearSuppressions() {
		this.suppressions.clear()
	}

	public setSessionBuffer(buffer: Map<string, string>) {
		this.sessionBuffer = buffer
	}

	public getSessionBuffer(): Map<string, string> {
		return this.sessionBuffer
	}

	public getViolationHotspots(): string[] {
		const violations = this.getViolations()
		return Array.from(new Set(violations.map((v) => v.path)))
	}

	public getFilesByPath(dir: string): string[] {
		return Array.from(this.nodes.keys()).filter((p) => p.startsWith(dir))
	}

	public async takeSnapshot(): Promise<SpiderSnapshot> {
		return this.persistence.takeSnapshot(this.nodes)
	}

	public async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
		return this.persistence.getLatestSnapshot()
	}

	/**
	 * V150: Memory-Only Substrate.
	 * Explicitly loads the registry from a provided buffer or string.
	 * If no data is provided, it triggers a fast project scan.
	 */
	public async loadRegistry(data?: Buffer | string): Promise<boolean> {
		if (data) {
			try {
				if (typeof data === "string") {
					this.nodes = new Map(JSON.parse(data))
				} else {
					const payload = this.persistence.deserialize(data)
					this.nodes = new Map(payload.nodes)
				}
				this.metrics.computeCouplingMetrics(this.nodes)
				this.metrics.computeReachability(this.nodes)
				return true
			} catch (e) {
				Logger.error("[SpiderEngine] Failed to deserialize substrate data:", e)
			}
		}

		await this.rebuildRegistry()
		return true
	}

	/**
	 * V150: Computes an aggregate Merkle Root for the entire substrate.
	 */
	public computeMerkleRoot(): string {
		const hashes = Array.from(this.nodes.values())
			.map((n) => n.hash)
			.sort()
		return crypto.createHash("sha256").update(hashes.join("")).digest("hex")
	}

	/**
	 * V160: Industrial Hardening - Batch Rebuild.
	 * Autonomously rebuilds the graph with throttling to prevent event loop starvation.
	 */
	public async rebuildRegistry(): Promise<void> {
		Logger.info("[SpiderEngine] Rebuilding project registry (Throttled Indexing)...")
		this.nodes.clear()
		const files = this.resolver.scanProject()

		const BATCH_SIZE = 250
		for (let i = 0; i < files.length; i += BATCH_SIZE) {
			const batch = files.slice(i, i + BATCH_SIZE)
			for (const f of batch) {
				try {
					const content = fs.readFileSync(path.resolve(this.cwd, f), "utf-8")
					this.updateNode(f, content)
				} catch (_e) {
					// Skip unreachable files
				}
			}

			// V200: Metabolic Pulse - Emergency reclamation between batches
			this.checkStabilityPressure()

			// V160: Relinquish control to the event loop between batches
			if (i + BATCH_SIZE < files.length) {
				await new Promise((resolve) => setTimeout(resolve, 0))
			}
		}

		this.metrics.computeCouplingMetrics(this.nodes)
		this.metrics.computeReachability(this.nodes)

		// 10. Compute Fragility & Hotspots (V200)
		const fragility = this.forensic.computeFragility(this.nodes)
		for (const [id, stats] of fragility.entries()) {
			const n = this.nodes.get(id)
			if (n) {
				n.blastRadius = stats.blastRadius
				n.isFragile = stats.isFragile
				n.isHotspot = n.isFragile && n.cognitiveComplexity > 0.6
			}
		}

		Logger.info(`[SpiderEngine] Substrate Immortalized: ${this.nodes.size} nodes indexed.`)
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

			for (const g of this.ghosts) {
				if (!this.nodes.has(g)) this.ghosts.delete(g)
			}
		}

		// V200: Industrial Session Flush
		this.sessionBuffer.clear()
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
		const activity = monitor.isHighlyActive(filePath)
		const activityPressure = activity.active ? 0.2 : 0
		return structuralWeight + historicalRisk + activityPressure
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
	 * V100: Predictive Ghosting.
	 * Identifies symbols used in the source but neither declared nor imported locally.
	 */
	public predictMissingImports(filePath: string, content: string): string[] {
		const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)
		const declared = new Set<string>()
		const imported = new Set<string>()
		const used = new Set<string>()

		// V110: Project-Graph Cross-Reference (Forensic calibration)
		const allProjectExports = new Set<string>()
		for (const node of this.nodes.values()) {
			for (const e of node.exports) {
				allProjectExports.add(e)
			}
		}

		const visit = (node: ts.Node) => {
			if (ts.isImportDeclaration(node)) {
				if (node.importClause) {
					if (node.importClause.name) imported.add(node.importClause.name.text)
					if (node.importClause.namedBindings) {
						if (ts.isNamedImports(node.importClause.namedBindings)) {
							for (const e of node.importClause.namedBindings.elements) {
								imported.add(e.name.text)
							}
						} else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
							imported.add(node.importClause.namedBindings.name.text)
						}
					}
				}
				return
			}

			// V110: More surgical declaration tracking (Apothecary Scope Sensing)
			if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declared.add(node.name.text)
			if (ts.isFunctionDeclaration(node) && node.name) declared.add(node.name.text)
			if (ts.isClassDeclaration(node) && node.name) declared.add(node.name.text)
			if (ts.isInterfaceDeclaration(node) && node.name) declared.add(node.name.text)
			if (ts.isTypeAliasDeclaration(node) && node.name) declared.add(node.name.text)
			if (ts.isEnumDeclaration(node) && node.name) declared.add(node.name.text)
			if (ts.isParameter(node) && ts.isIdentifier(node.name)) declared.add(node.name.text)
			if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) declared.add(node.name.text)
			if (ts.isTypeParameterDeclaration(node)) declared.add(node.name.text)

			if (ts.isIdentifier(node)) {
				const parent = node.parent
				const name = node.text

				// V110: Strict Identifier Filtering
				const isDeclaration =
					(ts.isVariableDeclaration(parent) && parent.name === node) ||
					(ts.isFunctionDeclaration(parent) && parent.name === node) ||
					(ts.isClassDeclaration(parent) && parent.name === node) ||
					(ts.isInterfaceDeclaration(parent) && parent.name === node) ||
					(ts.isEnumDeclaration(parent) && parent.name === node) ||
					(ts.isParameter(parent) && parent.name === node) ||
					(ts.isBindingElement(parent) && parent.name === node)

				const isPropertyKey =
					(ts.isPropertyAssignment(parent) && parent.name === node) ||
					(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
					(ts.isMethodDeclaration(parent) && parent.name === node)

				const isMeaningfulUse = !isDeclaration && !isPropertyKey

				if (isMeaningfulUse && name.length > 2 && !/^[A-Z_]+$/.test(name)) {
					used.add(name)
				}
			}

			ts.forEachChild(node, visit)
		}

		visit(sourceFile)

		// V110: Exhaustive Globals (Node, Browser, TS Built-ins)
		const globals = new Set([
			"console",
			"process",
			"require",
			"module",
			"exports",
			"__dirname",
			"__filename",
			"JSON",
			"Math",
			"Date",
			"Error",
			"Set",
			"Map",
			"Promise",
			"Array",
			"Object",
			"String",
			"Number",
			"Boolean",
			"Partial",
			"Required",
			"ReadOnly",
			"Pick",
			"Record",
			"Omit",
			"Exclude",
			"Extract",
			"NonNullable",
			"Parameters",
			"ConstructorParameters",
			"ReturnType",
			"InstanceType",
			"Buffer",
			"NodeJS",
			"Timeout",
			"Interval",
			"Immediate",
			"Uint8Array",
			"Int32Array",
			"Float64Array",
			"Event",
			"Window",
			"Document",
			"HTMLElement",
			"HTMLDivElement",
			"MutationObserver",
			"Request",
			"Response",
			"Fetch",
			"Header",
		])

		return Array.from(used).filter(
			(s) => !declared.has(s) && !imported.has(s) && !globals.has(s) && allProjectExports.has(s), // V110: The Provable Provision check
		)
	}

	/**
	 * V140: Industrial Naming Forensics.
	 * Audits identifier casing across the module to produce a 0-1.0 integrity score.
	 */
	private calculateNamingScore(sourceFile: ts.SourceFile): number {
		let total = 0
		let valid = 0

		const check = (name: string, regex: RegExp) => {
			total++
			if (regex.test(name)) valid++
		}

		ts.forEachChild(sourceFile, function visit(node: ts.Node) {
			if (
				ts.isClassDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node) ||
				ts.isEnumDeclaration(node)
			) {
				const name = node.name?.text
				if (name) check(name, /^[A-Z][a-zA-Z0-9]*$/)
			} else if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
				const name = node.name?.getText(sourceFile)
				if (name && !name.startsWith("[")) check(name, /^[a-z][a-zA-Z0-9]*$/)
			} else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
				const name = node.name.text
				const isConst = (node.parent.flags & ts.NodeFlags.Const) !== 0
				const isTopLevel = ts.isSourceFile(node.parent.parent.parent)

				if (isConst && isTopLevel) {
					// Allow SCREAMING_SNAKE_CASE or camelCase for top-level constants
					if (/^[A-Z][A-Z0-9_]*$/.test(name) || /^[a-z][a-zA-Z0-9]*$/.test(name)) {
						total++
						valid++
					} else {
						total++
					}
				} else {
					check(name, /^[a-z][a-zA-Z0-9]*$/)
				}
			}
			ts.forEachChild(node, visit)
		})

		return total === 0 ? 1.0 : valid / total
	}
}
