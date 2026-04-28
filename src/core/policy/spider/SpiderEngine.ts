/**
 * [LAYER: CORE]
 */

import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import * as v8 from "v8"
import { Logger } from "../../../shared/services/Logger.js"
import { SafeNumber } from "../../../shared/utils/SafeNumber"
import { ForensicEngine } from "./ForensicEngine.js"
import { MetricsEngine } from "./MetricsEngine.js"
import { PathResolver } from "./PathResolver.js"
import { PersistenceManager } from "./PersistenceManager.js"
import { SpiderEntropyReport, SpiderNode, SpiderRegistryPayload, SpiderSnapshot, SpiderViolation } from "./types.js"

export type { SpiderNode, SpiderEntropyReport, SpiderViolation, SpiderSnapshot, SpiderRegistryPayload }

export interface RebuildRegistryOptions {
	isCancelled?: () => boolean
	pressureMap?: Map<string, number>
}

type ExtractedMetrics = {
	logicDensity: number
	ioEntropy: number
	astComplexity: number
	symbolDensity: number
	logicCohesion: number
	anyDensity: number
}

const MAX_INDEX_FILE_BYTES = 1_500_000

const finiteNodeNumber = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback

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
	public metrics: MetricsEngine
	private persistence: PersistenceManager
	public forensic: ForensicEngine
	private suppressions: Set<string> = new Set()
	private graphRevision = 0
	private lastCycleRevision = -1
	private cachedCycles: string[][] = []
	// V45: Forensic Suppression List
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
		// V215: Memory-Safe Checkpointing
		// Check available heap before attempting massive binary serialization.
		const stats = v8.getHeapStatistics()
		const available = stats.heap_size_limit - stats.used_heap_size
		if (available < 100 * 1024 * 1024) {
			// 100MB Safety Floor
			Logger.warn("[SpiderEngine] Skipping substrate checkpoint: Memory pressure too high for binary persistence.")
			this.substrateCheckpoint = null
			return
		}

		try {
			this.substrateCheckpoint = this.persistence.serialize(this.nodes, {
				timestamp: new Date().toISOString(),
				version: this.version,
			})
			this.checkpointTimestamp = new Date().toISOString()
			Logger.info(`[SpiderEngine] Substrate Checkpoint Created: ${this.checkpointTimestamp}`)
		} catch (e) {
			Logger.error("[SpiderEngine] Failed to create substrate checkpoint:", e)
			this.substrateCheckpoint = null
		}
	}

	/**
	 * V200: Structural Resilience.
	 * Reverts the substrate to the last valid checkpoint.
	 */
	public rollbackSubstrate(): boolean {
		if (!this.substrateCheckpoint) {
			Logger.error("[SpiderEngine] Rollback failed: No substrate checkpoint found.")
			return false
		}

		if (!this.substrateCheckpoint) {
			Logger.warn("[SpiderEngine] Rollback aborted: No valid checkpoint found in the structural substrate.")
			return false
		}

		try {
			const payload = this.persistence.deserialize(this.substrateCheckpoint)
			if (!payload || !payload.nodes) {
				throw new Error("Deserialization produced a hollow or corrupted structural payload.")
			}
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

	/**
	 * V215: Dynamic Metabolic Pressure.
	 * Calculates pressure by combining physical memory usage, graph density,
	 * and behavioral activity (churn/doubt) from the MetabolicMonitor.
	 */
	public computeMetabolicPressure(monitor?: import("../../integrity/MetabolicMonitor").MetabolicMonitor): number {
		const used = process.memoryUsage().heapUsed
		const limit = v8.getHeapStatistics().heap_size_limit
		const memPressure = used / limit

		const graphDensity = this.nodes.size / 15000 // Normalized to 15k nodes (V215)
		const physicalPressure = memPressure * 0.8 + Math.min(graphDensity, 1.0) * 0.2

		if (monitor) {
			const stats = monitor.getStabilityStats()
			// Factor in average churn and doubt signal (investigative thrashing)
			const behavioralPressure = Math.min(1.0, stats.avgPressure / 10 + stats.avgDoubtSignal / 50)
			return Number((physicalPressure * 0.7 + behavioralPressure * 0.3).toFixed(2))
		}

		return Number(physicalPressure.toFixed(2))
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

	public updateNode(filePath: string, content: string, skipResolution = false) {
		const normalizedPath = this.resolver.normalizePath(filePath)
		this.checkStabilityPressure()

		const absolutePath = path.resolve(this.cwd, filePath)
		const layer = this.resolver.resolveLayer(filePath)
		const hash = crypto.createHash("md5").update(content).digest("hex")

		const oldNode = this.nodes.get(normalizedPath)
		if (oldNode && oldNode.hash === hash) return

		this.graphRevision++
		this.resolver.clearCaches()

		let sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)
		let importData = this.extractDetailedImports(sourceFile)
		const imports = importData.map((i) => i.specifier)
		let { symbols: exportedSymbols, reExports: reExportSpecifiers } = this.extractExports(sourceFile)
		// Resolve re-exports immediately for incremental updates (since most of the graph already exists)
		const reExports = reExportSpecifiers
			.map((spec) => this.resolver.resolveImportToNodeId(normalizedPath, spec, this.nodes))
			.filter(Boolean) as string[]
		let metrics = this.extractMetrics(sourceFile)

		const consumptions: Record<string, string[]> = {}
		if (!skipResolution) {
			for (const { specifier, symbols } of importData) {
				const targetId = this.resolver.resolveImportToNodeId(normalizedPath, specifier, this.nodes)
				if (targetId) {
					consumptions[targetId] = (consumptions[targetId] || []).concat(symbols)
				}
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
			exports: exportedSymbols,
			consumptions,
			mtime: fs.existsSync(absolutePath) ? fs.statSync(absolutePath).mtimeMs : Date.now(),
			namingScore,
			symbolDensity: content.length > 0 ? exportedSymbols.length / (content.length / 100) : 0,
			logicCohesion: 0.5,
			blastRadius: oldNode?.blastRadius || 0, // Preserve until re-computed
			isFragile: oldNode?.isFragile || false,
			cognitiveComplexity: this.metrics.calculateCognitiveComplexity(sourceFile),
			isHotspot: oldNode?.isHotspot || false,
			anyDensity: metrics.anyDensity,
			reExports,
		}

		this.nodes.set(normalizedPath, newNode)
		this.version++

		// V215: Incremental Structural Re-calibration
		// If the node has dependents, a change might shift the project's gravity.
		// We use a temporary map for calibration to keep the main registry stable during computation.
		if (newNode.afferentCoupling > 0 || (oldNode && oldNode.afferentCoupling > 0)) {
			try {
				const fragility = this.forensic.computeFragility(this.nodes)
				for (const [id, stats] of fragility.entries()) {
					const n = this.nodes.get(id)
					if (n) {
						n.blastRadius = stats.blastRadius
						n.isFragile = stats.isFragile
						n.isHotspot = n.isFragile && (n.cognitiveComplexity > 0.4 || n.anyDensity > 0.3)
					}
				}
			} catch (err) {
				Logger.error(`[SpiderEngine] Incremental recalibration failed: ${err.message}. Rolling back.`)
				this.rollbackSubstrate()
				throw err
			}
		}

		if (!oldNode || JSON.stringify(oldNode.imports) !== JSON.stringify(newNode.imports)) {
			this.updateIncrementalCoupling(normalizedPath, oldNode?.imports || [], newNode.imports)
			this.resolver.clearFileFromCache(normalizedPath)
			this.scheduleReachability()
		}
		// V200: Forensic Closure Hygiene - Forcefully destroy large visitor scopes
		;(sourceFile as unknown) = null
		;(importData as unknown) = null
		;(exportedSymbols as unknown) = null
		;(metrics as unknown) = null
	}

	private extractExports(sourceFile: ts.SourceFile): { symbols: string[]; reExports: string[] } {
		const result = { symbols: [] as string[], reExports: [] as string[] }
		ts.forEachChild(sourceFile, (node) => this.visitExports(node, result))
		return {
			symbols: Array.from(new Set(result.symbols)),
			reExports: Array.from(new Set(result.reExports)),
		}
	}

	private visitExports(node: ts.Node, result: { symbols: string[]; reExports: string[] }) {
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
					if (ts.isIdentifier(decl.name)) result.symbols.push(decl.name.text)
				}
			} else if (node.name && ts.isIdentifier(node.name)) {
				result.symbols.push(node.name.text)
			}
		} else if (ts.isExportDeclaration(node)) {
			if (node.exportClause && ts.isNamedExports(node.exportClause)) {
				for (const element of node.exportClause.elements) {
					result.symbols.push(element.name.text)
				}
			} else if (!node.exportClause && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				// export * from '...'
				result.reExports.push(node.moduleSpecifier.text)
			}
		}
		ts.forEachChild(node, (child) => this.visitExports(child, result))
	}

	private extractDetailedImports(sourceFile: ts.SourceFile): { specifier: string; symbols: string[] }[] {
		const imports: { specifier: string; symbols: string[] }[] = []
		ts.forEachChild(sourceFile, (node) => this.visitDetailedImports(node, imports))
		return imports
	}

	private visitDetailedImports(node: ts.Node, imports: { specifier: string; symbols: string[] }[]) {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const specifier = node.moduleSpecifier.text
			const symbols: string[] = []
			if (node.importClause) {
				if (node.importClause.name) symbols.push("default")
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
		} else if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
			node.arguments.length > 0 &&
			ts.isStringLiteral(node.arguments[0])
		) {
			// V215: Dynamic Dependency Sensing (import() and require())
			imports.push({ specifier: (node.arguments[0] as ts.StringLiteral).text, symbols: ["*"] })
		}
		ts.forEachChild(node, (child) => this.visitDetailedImports(child, imports))
	}

	private extractMetrics(sourceFile: ts.SourceFile) {
		const ctx = {
			totalNodes: 0,
			logicNodes: 0,
			ioImports: 0,
			totalImports: 0,
			exportCount: 0,
			internalReferenceCount: 0,
			anyCasts: 0,
		}
		ts.forEachChild(sourceFile, (node) => this.visitMetrics(node, ctx))
		return {
			logicDensity: ctx.totalNodes > 0 ? ctx.logicNodes / ctx.totalNodes : 0,
			ioEntropy: ctx.totalImports > 0 ? ctx.ioImports / ctx.totalImports : 0,
			astComplexity: ctx.totalNodes,
			symbolDensity: ctx.totalNodes > 0 ? ctx.exportCount / ctx.totalNodes : 0,
			logicCohesion: ctx.totalNodes > 0 ? ctx.internalReferenceCount / ctx.totalNodes : 0,
			// V215: Calibrated anyDensity weighting (Logarithmic scaling)
			// Prevents massive spikes in small files. Increased divisor to Math.sqrt(ctx.totalNodes) * 2 for lower sensitivity.
			anyDensity: ctx.totalNodes > 0 ? Math.min(1.0, ctx.anyCasts / (Math.sqrt(ctx.totalNodes) * 2)) : 0,
		}
	}

	private visitMetrics(
		node: ts.Node,
		ctx: {
			totalNodes: number
			logicNodes: number
			ioImports: number
			totalImports: number
			exportCount: number
			internalReferenceCount: number
			anyCasts: number
		},
	) {
		ctx.totalNodes++
		const kind = node.kind

		if (ts.isAsExpression(node)) {
			this.checkDeepAny(node.type, ctx)
		} else if (ts.isTypeAssertionExpression(node)) {
			this.checkDeepAny(node.type, ctx)
		} else if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) {
			this.checkDeepAny(node.type, ctx)
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
			ctx.logicNodes++
		}
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			ctx.totalImports++
			const text = node.moduleSpecifier.text
			if (!text.startsWith(".") && !text.startsWith("@/")) ctx.ioImports++
		}

		if (
			(ts.isClassDeclaration(node) ||
				ts.isFunctionDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node) ||
				ts.isVariableStatement(node)) &&
			node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
		) {
			ctx.exportCount++
		}

		if (ts.isIdentifier(node) && node.parent && !ts.isPropertyAccessExpression(node.parent)) {
			ctx.internalReferenceCount++
		}

		ts.forEachChild(node, (child) => this.visitMetrics(child, ctx))
	}

	private checkDeepAny(typeNode: ts.TypeNode | undefined, ctx: { anyCasts: number }) {
		if (!typeNode) return
		if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
			ctx.anyCasts++
			return
		}
		ts.forEachChild(typeNode, (child) => {
			if (ts.isTypeNode(child)) this.checkDeepAny(child, ctx)
		})
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
		const nodeIds = new Set(this.nodes.keys())

		for (const imp of removed) {
			const targetId = this.resolver.resolveImportToNodeId(nodeId, imp, nodeIds)
			const target = targetId ? this.nodes.get(targetId) : null
			if (target) {
				target.dependents = target.dependents.filter((d) => d !== nodeId)
				target.afferentCoupling = target.dependents.length
			}
		}
		for (const imp of added) {
			const targetId = this.resolver.resolveImportToNodeId(nodeId, imp, nodeIds)
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

	/**
	 * V200: Merkle Verification.
	 * Compares the in-memory Merkle Root with a fresh physical scan
	 * to detect stealth drift or external modifications.
	 */
	public async verifySubstrateIntegrity(): Promise<{ synchronized: boolean; drift: number }> {
		const currentMerkle = this.computeMerkleRoot()
		const previousSize = this.nodes.size

		await this.synchronizeRegistry()
		const freshMerkle = this.computeMerkleRoot()

		if (currentMerkle !== freshMerkle) {
			const drift = this.nodes.size - previousSize
			Logger.warn(
				`[SpiderEngine] Substrate Drift Detected! Merkle ${currentMerkle.substring(0, 8)} -> ${freshMerkle.substring(0, 8)}`,
			)
			return { synchronized: false, drift }
		}

		return { synchronized: true, drift: 0 }
	}

	private checkStabilityPressure() {
		const stats = v8.getHeapStatistics()
		const usedPercent = (stats.used_heap_size / stats.heap_size_limit) * 100

		if (usedPercent > 90) {
			Logger.error(
				`[SpiderEngine] CRITICAL Metabolic Pressure (${SafeNumber.format(usedPercent, 1)}%). Triggering ABSOLUTE SWEEP.`,
			)
			this.resolver.dispose()
			this.sessionBuffer.clear()
			// PRODUCTION HARDENING: Do not nullify checkpoint if an index is in progress,
			// as it will cause a crash during rollbackSubstrate.
			if (!this.isIndexing) this.substrateCheckpoint = null
			this.ghosts.clear()
			if (global.gc) global.gc()
			return
		}

		// V200: Node Immortality - Protect hotspots even during high pressure
		if (usedPercent > 80) {
			Logger.warn(
				`[SpiderEngine] High Metabolic Pressure detected (${SafeNumber.format(usedPercent, 1)}%). Triggering Selective Sweep.`,
			)
			// Protective sweep: Keep hotspots, only clear legacy caches
			this.resolver.clearCaches()
			this.sessionBuffer.clear()
			if (global.gc) global.gc()
		}
	}

	public computeEntropy(): SpiderEntropyReport {
		const history = this.persistence.getHistory()
		return this.metrics.computeEntropy(this.nodes, history)
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

	public getViolations(monitor?: import("../../integrity/MetabolicMonitor").MetabolicMonitor): SpiderViolation[] {
		this.pruneDeadNodes()
		const violations: SpiderViolation[] = []

		// 1. SPI-201: Circular Dependencies
		const cycles = this.detectCycles()
		for (const cycle of cycles) {
			violations.push({
				id: "SPI-201",
				severity: "ERROR",
				path: cycle[0],
				message: `CIRCULAR DEPENDENCY: A structural loop detected: ${cycle.join(" -> ")}`,
				remediation: "Break the cycle by extracting common logic or using interfaces.",
			})
		}

		// 2. SPI-202: Systemic Risk (Blast Radius)
		for (const node of this.nodes.values()) {
			if ((node.blastRadius || 0) > 0.6) {
				violations.push({
					id: "SPI-202",
					severity: "WARN",
					path: node.path,
					message: `SYSTEMIC RISK: This file has a high blast radius (${Math.round(node.blastRadius * 100)}%). A change here may destabilize the substrate.`,
					remediation: "Decouple this module or extract stable sub-modules.",
				})
			}

			// 3. SPI-203: Metabolic Pressure (God Modules)
			// V215: Significantly increased thresholds to focus on truly massive modules.
			if (node.afferentCoupling > 30 && (node.astComplexity || 0) > 5000) {
				violations.push({
					id: "SPI-203",
					severity: "ERROR",
					path: node.path,
					message: `METABOLIC PRESSURE: God Module detected (Coupling: ${node.afferentCoupling}, Complexity: ${node.astComplexity}).`,
					remediation: "Perform metabolic fission using the SovereignDecomposer.",
				})
			}

			// 4. SPI-204: Orphaned Modules
			if (node.orphaned && node.layer !== "plumbing") {
				violations.push({
					id: "SPI-204",
					severity: "WARN",
					path: node.path,
					message: "ORPHANED MODULE: This file is not reachable from the project core or UI entry points.",
					remediation: "Either integrate this module or prune it if it is legacy wood.",
				})
			}
		}

		// 5. SPI-206: Axiomatic Violations (Layer Leakage)
		for (const node of this.nodes.values()) {
			const imports = node.imports || []
			for (const imp of imports) {
				const targetId = this.resolver.resolveImportToNodeId(node.path, imp, this.nodes)
				const targetNode = targetId ? this.nodes.get(targetId) : null
				if (!targetNode) continue

				// Axiom 1: Infrastructure/Plumbing cannot import Domain
				if ((node.layer === "infrastructure" || node.layer === "plumbing") && targetNode.layer === "domain") {
					violations.push({
						id: "SPI-206",
						severity: "ERROR",
						path: node.path,
						message: `AXIOMATIC VIOLATION: Layer Leakage detected. '${node.layer}' is not permitted to import 'domain' logic (${targetNode.path}).`,
						remediation: "Invert the dependency using an interface or move the shared logic to 'core'.",
					})
				}

				// Axiom 2: Plumbing cannot import Core
				if (node.layer === "plumbing" && targetNode.layer === "core") {
					violations.push({
						id: "SPI-206",
						severity: "WARN",
						path: node.path,
						message: `AXIOMATIC VIOLATION: Plumbing module should not depend on project 'core' (${targetNode.path}).`,
						remediation: "Ensure 'plumbing' remains stateless and decoupled from business logic.",
					})
				}
			}
		}
		// 6. SPI-106: Symbol Resonance (Naming Collisions)
		const resonance = this.forensic.detectSymbolResonance(this.nodes)
		for (const r of resonance) {
			violations.push({
				id: "SPI-106",
				severity: "WARN",
				path: "SUBSTRATE",
				message: r,
				remediation: "Rename one of the symbols or unify the logic if they represent the same intent.",
			})
		}

		// 7. SPI-207: Structural Bridges (Single Points of Failure)
		const bridges = this.forensic.detectStructuralBridges(this.nodes)
		for (const b of bridges) {
			const node = this.nodes.get(b)
			if (node && node.layer !== "plumbing") {
				violations.push({
					id: "SPI-207",
					severity: "WARN",
					path: node.path,
					message: `STRUCTURAL BRIDGE: This file is an 'Articulated Point' in the graph. It is the sole connection between module clusters. A change here has extreme systemic risk.`,
					remediation: "Add redundant paths or decouple the clusters to remove this single point of failure.",
				})
			}
		}

		// 8. SPI-108: Ghost Coupling (Entangled Dependencies)
		const entanglements = this.metrics.detectEntangledDependencies(
			this.persistence.getSnapshots().map((s) => v8.deserialize(s)),
		)
		for (const e of entanglements) {
			violations.push({
				id: "SPI-108",
				severity: "WARN",
				path: "SUBSTRATE",
				message: e,
				remediation: "Investigate why these files are changing together. Formalize a shared dependency if necessary.",
			})
		}

		// 9. SPI-110: Asymmetric Contracts
		const contracts = this.forensic.auditImplicitContracts(this.nodes)
		for (const c of contracts) {
			violations.push({
				id: "SPI-110",
				severity: "WARN",
				path: "SUBSTRATE",
				message: c,
				remediation: "Ensure structural balance by implementing the missing half of the architectural contract.",
			})
		}

		// 11. SPI-300: Forensic Prophecy (Level 10)
		const snapshots = this.persistence.getSnapshots().map((s) => v8.deserialize(s))
		const rippleMap = this.forensic.calculateRippleProbability(this.nodes)

		for (const node of this.nodes.values()) {
			const ripple = rippleMap.get(node.id) || 0
			if (ripple > 0.8) {
				violations.push({
					id: "SPI-300",
					severity: "WARN",
					path: node.path,
					message: `SUBSTRATE PROPHECY: This module has a ${Math.round(ripple * 100)}% Ripple Probability. A change here is statistically guaranteed to fracture transitive dependents.`,
					remediation: "Decouple this hub or extract stable interfaces to reduce ripple probability.",
				})
			}

			// Domain Drift
			const drift = this.forensic.detectDomainDrift(node, snapshots)
			if (drift) {
				violations.push({
					id: "SPI-301",
					severity: "INFO",
					path: node.path,
					message: drift,
					remediation:
						"Audit the new vocabulary. If these symbols represent a new domain, consider a domain-level fission.",
				})
			}

			// Refactoring Fatigue
			const pressure = monitor?.getPressureMap().get(node.id) || 0
			if (this.metrics.detectRefactoringFatigue(node, pressure, snapshots)) {
				violations.push({
					id: "SPI-302",
					severity: "WARN",
					path: node.path,
					message: `REFACTORING FATIGUE: High churn detected in ${path.basename(node.path)} with zero structural improvement. The current abstraction may be repelling the logic.`,
					remediation:
						"Fundamental Rethink Required: The current module design is resisting changes. Consider a complete architectural redesign of this component.",
				})
			}
		}

		// 12. SPI-205: Immune Response Strategy (V215 Behavioral Sensing)
		if (monitor) {
			const response = monitor.getImmuneResponse()
			if (response.strategy === "STABILIZE") {
				violations.push({
					id: "SPI-205",
					severity: "WARN",
					path: "PROJECT_ROOT",
					message: `STRATEGIC ADVISORY (STABILIZE): Project metabolic pressure (${response.pressure}) or investigative doubt (${response.doubt}) is high.`,
					remediation: "Focus on stabilizing existing modules rather than adding new features.",
				})
			} else if (response.strategy === "PURGE") {
				violations.push({
					id: "SPI-205",
					severity: "WARN",
					path: "PROJECT_ROOT",
					message: "STRATEGIC ADVISORY (PURGE): Stagnant substrate detected. High volume of unused files identified.",
					remediation: "Consider a cleanup turn to remove legacy wood and legacy re-exports.",
				})
			}
		}

		return violations.filter((v) => !this.suppressions.has(`${v.id}:${v.path}:${v.message}`))
	}

	/**
	 * V204: Non-Blocking Integrity Advisories (TIA).
	 * Provides structural guidance without triggering a policy block or metabolic spiral.
	 */
	public getIntegrityAdvisories(filePath?: string): SpiderViolation[] {
		const advisories: SpiderViolation[] = []

		// V204: Filter nodes if a specific path is requested
		let nodesToScan = this.nodes
		if (filePath) {
			const normPath = this.resolver.normalizePath(filePath)
			const node = this.nodes.get(normPath)
			if (node) {
				nodesToScan = new Map([[normPath, node]])
			} else {
				return []
			}
		}

		const ghosts = this.forensic.findGhosts(nodesToScan, this.sessionBuffer)
		for (const ghostMsg of ghosts) {
			const id = ghostMsg.includes("GHOST FILE") ? "SPI-101" : "SPI-102"
			const pathMatch = ghostMsg.match(/GHOST (?:FILE|SYMBOL): (.*?) ->/)
			const path = pathMatch ? pathMatch[1] : "unknown"

			// V215: Fuzzy Enrichment (Path-Aware Throttling)
			// Only perform expensive lexicographical similarity checks during single-file advisories.
			// Project-wide fuzzy sensing is a major metabolic sink.
			let enrichedMessage = ghostMsg
			if (id === "SPI-102" && filePath) {
				const symbol = ghostMsg.match(/SYMBOL: (.*?) ->/)?.[1]
				if (symbol) {
					const providers = this.findGlobalProviders(symbol)
					if (providers.length > 0) {
						const bestProvider = providers[0]
						const alias = this.getBestAlias(bestProvider)
						enrichedMessage += ` (Found in: \`${alias}\`. Suggestion: \`import { ${symbol} } from "${alias}"\`)`
					} else {
						const similarities = this.findSimilarSymbols(symbol)
						if (similarities.length > 0) {
							enrichedMessage += ` (Did you mean: ${similarities.join(", ")}?)`
						}
					}
				}
			}

			advisories.push({
				id,
				severity: "WARN",
				path,
				message: enrichedMessage,
			})
		}

		// V16: Identification of Deadwood (Unused Exports)
		// PRODUCTION HARDENING: Move to advisory to prevent metabolic spirals.
		const unused = this.forensic.findUnusedExports(nodesToScan)
		for (const u of unused) {
			const pathMatch = u.match(/UNUSED EXPORT: (.*?) ->/)
			const path = pathMatch ? pathMatch[1] : "unknown"
			advisories.push({
				id: "SPI-103",
				severity: "INFO",
				path,
				message: u,
			})
		}
		// V204: Circular Dependency Detection.
		// Identify cycles involving the target file to prevent substrate instability.
		if (this.lastCycleRevision !== this.graphRevision) {
			this.cachedCycles = this.metrics.detectCycles(this.nodes)
			this.lastCycleRevision = this.graphRevision
		}

		for (const cycle of this.cachedCycles) {
			if (filePath && !cycle.includes(this.resolver.normalizePath(filePath))) continue

			const cycleStr = cycle.map((p) => path.basename(p)).join(" -> ")
			advisories.push({
				id: "SPI-104",
				severity: "WARN",
				path: cycle[0],
				message: `Circular dependency detected: ${cycleStr}. Cycles lead to runtime 'undefined' symbols and fragile logic.`,
			})
		}

		// V204: Substrate Vibration Detection.
		// Warn about breaking changes in high-coupling nodes.
		if (filePath) {
			const normPath = this.resolver.normalizePath(filePath)
			const node = this.nodes.get(normPath)
			if (node && node.afferentCoupling > 5) {
				// We check the session buffer for the NEW content if available
				const newContent = this.sessionBuffer.get(normPath)
				if (newContent) {
					const sourceFile = ts.createSourceFile(normPath, newContent, ts.ScriptTarget.Latest, true)
					const newExports = this.extractExports(sourceFile)
					const removed = node.exports.filter((e) => !newExports.symbols.includes(e))

					if (removed.length > 0) {
						const sampleDependents = node.dependents.slice(0, 3).map((d) => path.basename(d))
						const dependentList =
							sampleDependents.length > 0
								? ` Sample affected files: ${sampleDependents.join(", ")}${node.dependents.length > 3 ? "..." : ""}`
								: ""

						advisories.push({
							id: "SPI-105",
							severity: "WARN",
							path: normPath,
							message: `SUBSTRATE VIBRATION: You are removing/renaming ${removed.length} export(s) in a high-coupling file (${node.afferentCoupling} dependents). This WILL break dependents project-wide.${dependentList}`,
						})
					}
				}
			}
		}

		return advisories
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

	/**
	 * V204: Fuzzy Forensic Sensing.
	 * Finds symbols in the substrate that are lexicographically similar to the target.
	 */
	/**
	 * V204: Global Forensic Mapping.
	 * Locates all files that export a specific symbol.
	 */
	public findGlobalProviders(symbol: string): string[] {
		const providers: string[] = []
		for (const node of this.nodes.values()) {
			if (node.exports.includes(symbol)) {
				providers.push(node.path)
			}
		}
		return providers
	}

	/**
	 * V204: Fuzzy Forensic Sensing.
	 * Finds symbols in the substrate that are lexicographically similar to the target.
	 */
	public findSimilarSymbols(symbol: string, limit = 3): string[] {
		// V215: Optimized Fuzzy Sensing
		const allSymbols = new Set<string>()
		for (const node of this.nodes.values()) {
			for (const exp of node.exports) allSymbols.add(exp)
		}

		const lev = (a: string, b: string): number => {
			if (Math.abs(a.length - b.length) > 3) return 99 // Fast bailout
			if (a.length === 0) return b.length
			if (b.length === 0) return a.length

			// Linear-space Levenshtein optimization
			let prev = Array.from({ length: a.length + 1 }, (_, i) => i)
			for (let i = 1; i <= b.length; i++) {
				const current = [i]
				for (let j = 1; j <= a.length; j++) {
					current[j] = b[i - 1] === a[j - 1] ? prev[j - 1] : Math.min(prev[j - 1] + 1, prev[j] + 1, current[j - 1] + 1)
				}
				prev = current
			}
			return prev[a.length]
		}

		return Array.from(allSymbols)
			.map((s) => ({ symbol: s, distance: lev(symbol, s) }))
			.filter((item) => item.distance <= 3) // Only suggest close matches
			.sort((a, b) => a.distance - b.distance)
			.slice(0, limit)
			.map((item) => item.symbol)
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
					const parsed = JSON.parse(data)
					if (!Array.isArray(parsed)) throw new Error("Invalid string substrate format.")
					this.nodes = new Map(parsed)
				} else {
					const payload = this.persistence.deserialize(data)
					if (!payload || !payload.nodes) throw new Error("Invalid binary substrate payload.")
					this.nodes = new Map(payload.nodes)
				}
				if (this.nodes.size > 0) {
					this.metrics.computeCouplingMetrics(this.nodes)
					this.metrics.computeReachability(this.nodes)
				}
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
	private isIndexing = false
	private activeRebuildPromise: Promise<void> | null = null
	public async rebuildRegistry(
		onProgress?: (processed: number, total: number, currentFile: string) => void | Promise<void>,
		options: RebuildRegistryOptions = {},
	): Promise<void> {
		if (this.activeRebuildPromise) {
			Logger.warn("[SpiderEngine] Rebuild already in progress. Awaiting active rebuild instead of starting a duplicate.")
			return this.activeRebuildPromise
		}

		this.activeRebuildPromise = this.performRegistryRebuild(onProgress, options)
		try {
			await this.activeRebuildPromise
		} finally {
			this.activeRebuildPromise = null
		}
	}

	private throwIfCancelled(isCancelled?: () => boolean): void {
		if (isCancelled?.()) {
			throw new Error("JoyZoning audit cancelled")
		}
	}

	private async performRegistryRebuild(
		onProgress?: (processed: number, total: number, currentFile: string) => void | Promise<void>,
		options: RebuildRegistryOptions = {},
	): Promise<void> {
		if (this.isIndexing) {
			Logger.warn("[SpiderEngine] Rebuild already marked in progress. Awaiting existing operation.")
			return
		}

		this.throwIfCancelled(options.isCancelled)
		const currentPressure = this.computeMetabolicPressure()
		if (this.nodes.size > 0 && currentPressure < 0.65) {
			this.createCheckpoint()
		} else {
			this.substrateCheckpoint = null
			if (currentPressure >= 0.65) {
				Logger.warn(`[SpiderEngine] Skipping checkpoint: Metabolic pressure too high (${currentPressure}).`)
			}
		}
		this.isIndexing = true

		// V215: Swap-on-Success Strategy
		// We build into a temporary registry to prevent zeroing out the main state during a failure.
		const tempRegistry = new Map<string, SpiderNode>()
		const originalRegistrySize = this.nodes.size

		// V215: Metabolic Resident Purge
		// If pressure is already high, we clear the active map (checkpointed) to free heap space for tempRegistry.
		if (this.computeMetabolicPressure() > 0.7) {
			Logger.warn("[SpiderEngine] High Pressure Indexing: Purging active substrate (Checkpointed) to free heap.")
			this.nodes.clear()
			this.resolver.clearCaches() // Flush resolver to reclaim nested map memory
		}

		try {
			Logger.info("[SpiderEngine] Rebuilding project registry (Throttled Indexing)...")
			this.throwIfCancelled(options.isCancelled)
			const files = this.resolver.scanProject()

			if (originalRegistrySize > 50 && files.length === 0) {
				throw new Error(`Unexpected file count drop (${originalRegistrySize} -> 0). Aborting rebuild.`)
			}

			let BATCH_SIZE = 250
			for (let i = 0; i < files.length; i += BATCH_SIZE) {
				this.throwIfCancelled(options.isCancelled)
				const pressure = this.computeMetabolicPressure()
				if (pressure > 0.9) {
					Logger.error(`[SpiderEngine] CRITICAL METABOLIC PRESSURE (${pressure}). Indexing paused.`)
					this.resolver.clearCaches() // Emergency cache flush
					if (global.gc) global.gc()
					await new Promise((resolve) => setTimeout(resolve, 1000)) // 1s cool-off
					BATCH_SIZE = 10
				} else if (pressure > 0.8) {
					BATCH_SIZE = 50
					this.resolver.clearCaches() // Proactive cache flush
				} else if (pressure > 0.5) {
					BATCH_SIZE = 100
				}

				const batch = files.slice(i, i + BATCH_SIZE)
				for (const f of batch) {
					this.throwIfCancelled(options.isCancelled)
					try {
						const absolutePath = path.resolve(this.cwd, f)
						if (!fs.existsSync(absolutePath)) continue
						const fileStats = await fs.promises.stat(absolutePath)
						if (fileStats.size > MAX_INDEX_FILE_BYTES) {
							Logger.warn(`[SpiderEngine] Skipping oversized file during index: ${f} (${fileStats.size} bytes).`)
							continue
						}

						const content = await fs.promises.readFile(absolutePath, "utf-8")
						const hash = crypto.createHash("md5").update(content).digest("hex")
						const layer = this.resolver.resolveLayer(f)

						// Manually create nodes for the temp registry
						let sourceFile: ts.SourceFile | null = ts.createSourceFile(
							absolutePath,
							content,
							ts.ScriptTarget.Latest,
							true,
						)
						let importData: { specifier: string; symbols: string[] }[] | null =
							this.extractDetailedImports(sourceFile)
						const exportsData = this.extractExports(sourceFile)
						let exports: string[] | null = exportsData.symbols
						const reExportSpecifiers = exportsData.reExports // Temporary storage for post-pass resolution
						let metrics: ExtractedMetrics | null = this.extractMetrics(sourceFile)
						let namingScore: number | null = this.calculateNamingScore(sourceFile)
						const anyDensity = finiteNodeNumber(metrics.anyDensity, 0)
						const astComplexity = finiteNodeNumber(metrics.astComplexity, 0)

						const node: SpiderNode = {
							id: f,
							path: f,
							layer,
							imports: importData.map((i) => i.specifier),
							dependents: [],
							depth: f.split("/").length - 1,
							orphaned: false,
							afferentCoupling: 0,
							...metrics,
							astComplexity,
							hash,
							isInterface: this.detectInterface(f, sourceFile),
							exports,
							reExports: reExportSpecifiers, // Store specifiers temporarily
							consumptions: {}, // Will be filled in coupling pass
							mtime: fileStats.mtimeMs,
							namingScore,
							symbolDensity: content.length > 0 ? exports.length / (content.length / 100) : 0,
							logicCohesion: 0.5,
							blastRadius: 0,
							isFragile: false,
							cognitiveComplexity: this.metrics.calculateCognitiveComplexity(sourceFile),
							isHotspot: false,
							anyDensity: anyDensity * 0.8,
						}
						tempRegistry.set(f, node)

						if (onProgress) {
							const progressResult = onProgress(i + batch.indexOf(f) + 1, files.length, f)
							if (progressResult instanceof Promise) await progressResult
						}

						// V200: Forensic Closure Hygiene - Forcefully destroy large visitor scopes
						sourceFile = null
						importData = null
						exports = null
						metrics = null
						namingScore = null
					} catch (e: unknown) {
						Logger.warn(`[SpiderEngine] Failed to index ${f}: ${(e as Error).message}`)
					}
				}
				// Throttling
				await new Promise((resolve) => setTimeout(resolve, 10))
			}

			// Finalizing Pass (Re-export Resolution, Coupling & Fragility)
			this.throwIfCancelled(options.isCancelled)
			this.resolver.clearCaches() // Clear before expensive resolution pass

			for (const node of tempRegistry.values()) {
				// V215: Order-Independent Re-export Resolution
				// Now that ALL nodes are in the tempRegistry, we can resolve specifiers to IDs safely.
				const specifiers = node.reExports // Currently contains raw specifiers from rebuildRegistry pass
				node.reExports = specifiers
					.map((spec) => this.resolver.resolveImportToNodeId(node.path, spec, tempRegistry))
					.filter(Boolean) as string[]
			}

			this.throwIfCancelled(options.isCancelled)
			this.metrics.computeCouplingMetrics(tempRegistry)
			this.throwIfCancelled(options.isCancelled)
			this.metrics.computeReachability(tempRegistry)
			this.throwIfCancelled(options.isCancelled)

			// V215: Cognitive Blast Radius Adjustment.
			// Monolithic projects (High Gini) get stricter penalties for hub files.
			const projectStats = this.metrics.getProjectStatistics(tempRegistry)
			const giniPenalty = projectStats.giniCoefficient > 0.7 ? 1.5 : 1.0

			const fragility = this.forensic.computeFragility(tempRegistry, options.pressureMap)
			for (const [id, stats] of fragility.entries()) {
				const n = tempRegistry.get(id)
				if (n) {
					n.blastRadius = Math.min(1.0, stats.blastRadius * giniPenalty)
					n.isFragile = stats.isFragile || n.blastRadius > 0.6
					n.isHotspot = n.isFragile && (n.cognitiveComplexity > 0.4 || n.anyDensity > 0.3)
				}
			}

			// Swap!
			this.nodes = tempRegistry
			this.substrateCheckpoint = null
			this.version++
			Logger.info(`[SpiderEngine] Substrate Immortalized: ${this.nodes.size} nodes indexed.`)
		} catch (error) {
			Logger.error("[SpiderEngine] Critical failure during registry rebuild:", error)
			if (!options.isCancelled?.()) {
				await this.rollbackSubstrate()
			}
			throw error
		} finally {
			this.isIndexing = false
			this.substrateCheckpoint = null
			this.resolver.clearCaches()
			if (this.nodes !== tempRegistry) tempRegistry.clear()
		}
	}

	/**
	 * V20: Synchronizes the in-memory registry with the physical disk (Merkle Healing).
	 * Prunes missing files and automatically re-indexes stale files based on mtime.
	 */
	public async synchronizeRegistry(pressureMap: Map<string, number> = new Map()): Promise<void> {
		let pruned = 0
		let reindexed = 0

		for (const [id, node] of this.nodes.entries()) {
			const absPath = path.resolve(this.cwd, node.path)
			if (!fs.existsSync(absPath)) {
				this.nodes.delete(id)
				pruned++
			} else {
				if (fs.existsSync(absPath)) {
					const stats = fs.statSync(absPath)
					if (stats.mtimeMs > (node.mtime || 0)) {
						const content = await fs.promises.readFile(absPath, "utf-8")
						this.updateNode(node.path, content)
						reindexed++
					}
				}
			}
		}

		if (pruned > 0 || reindexed > 0) {
			this.version++
			Logger.info(`[SpiderEngine] Registry Synchronized: Pruned ${pruned}, Re-indexed ${reindexed}.`)
			this.metrics.computeCouplingMetrics(this.nodes)
			this.metrics.computeReachability(this.nodes)
			const fragility = this.forensic.computeFragility(this.nodes, pressureMap)
			for (const [id, stats] of fragility.entries()) {
				const n = this.nodes.get(id)
				if (n) {
					n.blastRadius = stats.blastRadius
					n.isFragile = stats.isFragile
					n.isHotspot = n.isFragile && (n.cognitiveComplexity > 0.4 || n.anyDensity > 0.3)
				}
			}

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
		clone.nodes = new Map(this.nodes)
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

	public getBestAlias(filePath: string): string {
		return this.resolver.getBestAlias(filePath)
	}

	public resolveImportToNodeId(sourcePath: string, specifier: string): string | null {
		return this.resolver.resolveImportToNodeId(sourcePath, specifier, this.nodes)
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

	/**
	 * V215: Incremental Cache Purge.
	 * Removes all cached resolutions originating from a specific file.
	 */
	public clearFileFromCache(filePath: string) {
		this.resolver.clearFileFromCache(filePath)
	}

	public resolveImportLayer(sourcePath: string, specifier: string): string | null {
		const id = this.resolver.resolveImportToNodeId(sourcePath, specifier, new Set(this.nodes.keys()))
		return id ? this.nodes.get(id)?.layer || null : null
	}

	public isNodeLibrary(specifier: string): boolean {
		return !specifier.startsWith(".") && !specifier.startsWith("@/")
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

		// V215: Project-Graph Cross-Reference (Apothecary Scope Sensing)
		const exportToPath = new Map<string, string>()
		for (const node of this.nodes.values()) {
			for (const e of node.exports) {
				// We prefer the shortest path (likely the primary definition or barrel)
				const existingPath = exportToPath.get(e)
				if (!existingPath || node.path.length < existingPath.length) {
					exportToPath.set(e, node.path)
				}
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
					(ts.isMethodDeclaration(parent) && parent.name === node) ||
					(ts.isJsxAttribute(parent) && parent.name === node)

				const isJsxTag = (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === node
				const isMeaningfulUse = (!isDeclaration && !isPropertyKey) || isJsxTag

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

		return Array.from(used)
			.filter((s) => !declared.has(s) && !imported.has(s) && !globals.has(s) && exportToPath.has(s))
			.map((s) => `${s} (from ${exportToPath.get(s)})`)
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
			if (regex.test(name)) {
				// V215: Ambiguity Penalty
				const isAmbiguous = /(Manager|Helper|Utils|Data|Info|Common|Base)$|^[A-Z]?[a-z]{1,2}$/.test(name)
				if (isAmbiguous) {
					valid += 0.5 // 50% penalty for generic naming
				} else {
					valid++
				}
			}
		}

		const visit = (node: ts.Node) => {
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
				if (name && !name.startsWith("[")) {
					const isReact = sourceFile.fileName.endsWith(".tsx") && /^[A-Z]/.test(name)
					if (isReact) check(name, /^[A-Z][a-zA-Z0-9]*$/)
					else check(name, /^[a-z][a-zA-Z0-9]*$/)
				}
			} else if (ts.isVariableDeclaration(node)) {
				// V215: Recursive Binding Pattern Support (Destructuring)
				const processName = (nameNode: ts.BindingName) => {
					if (ts.isIdentifier(nameNode)) {
						const name = nameNode.text
						const isConst = (node.parent.flags & ts.NodeFlags.Const) !== 0
						// V215: Safe Top-Level Sensing
						const isTopLevel = node.parent?.parent && ts.isSourceFile(node.parent.parent.parent)

						if (isConst && isTopLevel && (/^[A-Z][A-Z0-9_]*$/.test(name) || /^[a-z][a-zA-Z0-9]*$/.test(name))) {
							total++
							valid++ // Allowed top-level naming
						} else {
							check(name, /^[a-z][a-zA-Z0-9]*$/)
						}
					} else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
						for (const element of nameNode.elements) {
							if (!ts.isOmittedExpression(element)) {
								processName(element.name)
							}
						}
					}
				}
				processName(node.name)
			}
			ts.forEachChild(node, visit)
		}

		ts.forEachChild(sourceFile, visit)

		return total === 0 ? 1.0 : valid / total
	}
}
