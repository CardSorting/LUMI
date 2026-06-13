/**
 * [LAYER: CORE]
 */

import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import * as v8 from "v8"
import { Logger } from "../../shared/services/Logger.js"
import { SafeNumber } from "../../shared/utils/SafeNumber.js"
import { ForensicEngine } from "./spider/ForensicEngine.js"
import { MetricsEngine } from "./spider/MetricsEngine.js"
import { PathResolver } from "./spider/PathResolver.js"
import { PersistenceManager } from "./spider/PersistenceManager.js"
import { SpiderEntropyReport, SpiderNode, SpiderRegistryPayload, SpiderSnapshot, SpiderViolation } from "./spider/types.js"
import { SymbolRegistry } from "./spider/SymbolRegistry.js"

export type { SpiderNode, SpiderEntropyReport, SpiderViolation, SpiderSnapshot, SpiderRegistryPayload }

// Stubs for integrity services not present in BroccoliDB
type AnomalyRegistry = any
type StabilityMonitor = any

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
	cognitiveComplexity: number
}

const MAX_INDEX_FILE_BYTES = 1_500_000

const finiteNodeNumber = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback

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
	private sessionBuffer: Map<string, string> = new Map() 
	private stabilityLock: string | null = null 
	private stabilityLockId: string | null = null 
	private stabilityHeartbeat: NodeJS.Timeout | null = null 
	private substrateCheckpoint: Buffer | null = null 
	private checkpointTimestamp: string | null = null 
	private registry: SymbolRegistry

	private reachabilityTimeout: NodeJS.Timeout | null = null
	constructor(public cwd: string) {
		this.resolver = new PathResolver(cwd, SpiderEngine.getGlobalAliases())
		this.metrics = new MetricsEngine(cwd, this.resolver)
		this.persistence = new PersistenceManager(this.metrics)
		this.forensic = new ForensicEngine(cwd, this.resolver)
		this.registry = new SymbolRegistry()
	}

	/**
	 * V200: Structural Resilience.
	 */
	public createCheckpoint(): void {
		const stats = v8.getHeapStatistics()
		const available = stats.heap_size_limit - stats.used_heap_size
		if (available < 100 * 1024 * 1024) {
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
	 */
	public rollbackSubstrate(): boolean {
		if (!this.substrateCheckpoint) {
			Logger.error("[SpiderEngine] Rollback failed: No substrate checkpoint found.")
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
			this.substrateCheckpoint = null 
			return true
		} catch (e) {
			Logger.error("[SpiderEngine] Critical failure during substrate rollback:", e)
			return false
		}
	}

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
		}, 60000) 

		return lockId
	}

	public releaseStabilityLock(owner: string, lockId: string): void {
		if (this.stabilityLock === owner && this.stabilityLockId === lockId) {
			this.stabilityLock = null
			this.stabilityLockId = null
			this.clearStabilityHeartbeat()
		}
	}

	public computeActivityPressure(monitor?: StabilityMonitor): number {
		const used = process.memoryUsage().heapUsed
		const limit = v8.getHeapStatistics().heap_size_limit
		const memPressure = used / limit

		const graphDensity = this.nodes.size / 15000 
		const physicalPressure = memPressure * 0.8 + Math.min(graphDensity, 1.0) * 0.2

		if (monitor && typeof monitor.getStabilityStats === 'function') {
			const stats = monitor.getStabilityStats()
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

	public dispose(): void {
		this.clearStabilityHeartbeat()
		if (this.reachabilityTimeout) {
			clearTimeout(this.reachabilityTimeout)
			this.reachabilityTimeout = null
		}
		this.forensic.dispose()
		this.resolver.dispose()
		this.persistence.dispose() 
		this.nodes.clear()
		this.ghosts.clear()
		this.sessionBuffer.clear()
		this.substrateCheckpoint = null
		Logger.info("[SpiderEngine] Industrial Disposal Complete. Memory Substrate Released.")
	}

	public [Symbol.dispose](): void {
		this.dispose()
	}

	public getForensicEngine(): ForensicEngine {
		return this.forensic
	}

	public getRegistry(): SymbolRegistry {
		return this.registry
	}

	public removeNode(filePath: string) {
		const normalizedPath = this.resolver.normalizePath(filePath)
		if (this.nodes.has(normalizedPath)) {
			this.nodes.delete(normalizedPath)
			this.registry.unregisterFile(normalizedPath)
			this.version++
			this.graphRevision++
			this.resolver.clearFileFromCache(normalizedPath)
			this.scheduleReachability()
		}
	}

	public recycleProject() {
		this.resolver.clearCaches()
		this.sessionBuffer.clear()
		if (global.gc) global.gc()
	}

	public getDiagnostics(filePath: string): { message: string, line?: number }[] {
		const normPath = this.resolver.normalizePath(filePath)
		const node = this.nodes.get(normPath)
		if (!node) return []
		
		const violations = this.getIntegrityAdvisories(filePath)
		return violations.map(v => ({ message: v.message }))
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
		this.sessionBuffer.clear() 
		this.metrics.computeCouplingMetrics(this.nodes)
		this.metrics.computeReachability(this.nodes)
		this.recalculateHazardScores(this.nodes)
		this.resolver.clearCaches()
	}

	public updateNode(filePath: string, content: string, skipResolution = false) {
		const normalizedPath = this.resolver.normalizePath(filePath)
		this.checkStabilityPressure()

		const absolutePath = path.resolve(this.cwd, filePath)
		const layer = this.resolver.resolveLayer(filePath)

		const stats = fs.existsSync(absolutePath) ? fs.statSync(absolutePath) : null
		const isMassive = stats && stats.size > 500 * 1024

		const hash = crypto.createHash("md5").update(content).digest("hex")

		const oldNode = this.nodes.get(normalizedPath)
		if (oldNode && oldNode.hash === hash) return

		this.graphRevision++
		this.resolver.clearCaches()

		let sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)
		const analysis = this.analyzeStructuralData(sourceFile)
		const metrics = isMassive ? this.getDefaultMetrics() : analysis.metrics
		const imports = analysis.imports.map((i) => i.specifier)
		const { symbols: exportedSymbols, reExports: reExportSpecifiers } = analysis.exports

		// Register symbols in the registry
		this.registry.unregisterFile(normalizedPath)
		for (const symbol of exportedSymbols) {
			this.registry.register({
				symbolName: symbol,
				filePath: normalizedPath,
				type: 'FUNCTION', // Simplified for now
				footprint: `${normalizedPath}:${symbol}`
			})
		}

		const reExports = reExportSpecifiers
			.map((spec) => this.resolver.resolveImportToNodeId(normalizedPath, spec, this.nodes))
			.filter(Boolean) as string[]

		const consumptions: Record<string, string[]> = {}
		const resolvedImports = new Map<string, string>()
		if (!skipResolution) {
			for (const { specifier, symbols } of analysis.imports) {
				const targetId = this.resolver.resolveImportToNodeId(normalizedPath, specifier, this.nodes)
				if (targetId) {
					consumptions[targetId] = (consumptions[targetId] || []).concat(symbols)
					resolvedImports.set(specifier, targetId)
				}
			}
		}

		const namingScore = analysis.namingScore

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
			reExports,
			consumptions,
			resolvedImports,
			mtime: fs.statSync(absolutePath).mtimeMs,
			namingScore,
			symbolDensity: content.length > 0 ? exportedSymbols.length / (content.length / 100) : 0,
			blastRadius: 0,
			isFragile: false,
			cognitiveComplexity: analysis.cognitiveComplexity,
			isHotspot: oldNode?.isHotspot || false,
			anyDensity: metrics.anyDensity,
			churnIntensity: (oldNode?.churnIntensity || 0) + 1,
			semanticDrift: (oldNode?.semanticDrift || 0) + (oldNode && oldNode.layer !== layer ? 1 : 0),
			lastLayer: oldNode?.layer,
			hazardScore: 0, 
		}

		this.nodes.set(normalizedPath, newNode)
		this.version++

		if (newNode.afferentCoupling > 0 || (oldNode && oldNode.afferentCoupling > 0)) {
			try {
				const fragility = this.forensic.computeFragility(this.nodes)
				for (const [id, stats] of fragility.entries()) {
					const n = this.nodes.get(id)
					if (n) {
						n.blastRadius = stats.blastRadius
						n.isFragile = stats.isFragile
						n.isHotspot = n.isFragile && (n.cognitiveComplexity > 0.4 || n.anyDensity > 0.3)
						n.hazardScore = finiteNodeNumber(this.forensic.calculateHazardScore(n, this.nodes), 0)
					}
				}
			} catch (err: any) {
				Logger.error(`[SpiderEngine] Incremental recalibration failed: ${err.message || 'Unknown error'}. Rolling back.`)
				this.rollbackSubstrate()
				throw err
			}
		}

		if (!oldNode || JSON.stringify(oldNode.imports) !== JSON.stringify(newNode.imports)) {
			this.updateIncrementalCoupling(normalizedPath, oldNode?.imports || [], newNode.imports)
			this.resolver.clearFileFromCache(normalizedPath)
			this.scheduleReachability()
		}
	}

	private analyzeStructuralData(sourceFile: ts.SourceFile): { 
		metrics: {
			anyDensity: number,
			logicDensity: number,
			symbolDensity: number,
			astComplexity: number,
			ioEntropy: number,
			logicCohesion: number
		},
		imports: { specifier: string; symbols: string[] }[],
		exports: { symbols: string[]; reExports: string[] },
		namingScore: number,
		cognitiveComplexity: number
	} {
		const ctx = {
			anyCasts: 0,
			logicDensity: 0,
			symbolDensity: 0,
			internalReferenceCount: 0,
			imports: [] as { specifier: string; symbols: string[] }[],
			exports: { symbols: [] as string[], reExports: [] as string[] },
			names: [] as string[]
		}

		const visit = (node: ts.Node, depth: number) => {
			const kind = node.kind

			// Metrics logic
			if (ts.isAsExpression(node)) {
				if (node.type.kind === ts.SyntaxKind.AnyKeyword) {
					ctx.anyCasts++
				}
			}
			if (ts.isTypeNode(node)) this.checkDeepAny(node as ts.TypeNode, ctx)
			if (ts.isIdentifier(node) && node.parent && !ts.isPropertyAccessExpression(node.parent)) {
				ctx.internalReferenceCount++
				ctx.names.push(node.text)
			}

			// Exports logic
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
						if (ts.isIdentifier(decl.name)) ctx.exports.symbols.push(decl.name.text)
					}
				} else if ((node as any).name && ts.isIdentifier((node as any).name)) {
					ctx.exports.symbols.push((node as any).name.text)
				}
			} else if (ts.isExportDeclaration(node)) {
				if (node.exportClause && ts.isNamedExports(node.exportClause)) {
					for (const element of node.exportClause.elements) {
						ctx.exports.symbols.push(element.name.text)
					}
				} else if (!node.exportClause && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
					ctx.exports.reExports.push(node.moduleSpecifier.text)
				}
			}

			// Imports logic
			if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				const specifier = node.moduleSpecifier.text
				const symbols: string[] = []
				if (node.importClause) {
					if (node.importClause.name) symbols.push(node.importClause.name.text)
					if (node.importClause.namedBindings) {
						if (ts.isNamedImports(node.importClause.namedBindings)) {
							for (const element of node.importClause.namedBindings.elements) {
								symbols.push(element.name.text)
							}
						} else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
							symbols.push("*")
						}
					}
				}
				ctx.imports.push({ specifier, symbols })
			}

			ts.forEachChild(node, (child) => visit(child, depth + 1))
		}

		visit(sourceFile, 0)

		const contentLen = sourceFile.text.length || 1
		return {
			metrics: {
				anyDensity: ctx.anyCasts / (contentLen / 500),
				logicDensity: ctx.internalReferenceCount / (contentLen / 100),
				symbolDensity: ctx.exports.symbols.length / (contentLen / 1000),
				astComplexity: sourceFile.statements.length, // Simplified for consolidation
				ioEntropy: ctx.imports.length > 0 ? ctx.imports.filter(i => !i.specifier.startsWith(".") && !i.specifier.startsWith("@/")).length / ctx.imports.length : 0,
				logicCohesion: ctx.internalReferenceCount > 0 ? (ctx.names.length / ctx.internalReferenceCount) : 0.5
			},
			imports: ctx.imports,
			exports: {
				symbols: Array.from(new Set(ctx.exports.symbols)),
				reExports: Array.from(new Set(ctx.exports.reExports)),
			},
			namingScore: ctx.names.filter(n => n.length > 3).length / Math.max(1, ctx.names.length),
			cognitiveComplexity: this.metrics.calculateCognitiveComplexity(sourceFile)
		}
	}

	private extractDetailedImports(sourceFile: ts.SourceFile): { specifier: string; symbols: string[] }[] {
		const imports: { specifier: string; symbols: string[] }[] = []
		ts.forEachChild(sourceFile, (node) => this.visitDetailedImports(node, imports))
		return imports
	}

	private visitDetailedImports(node: ts.Node, imports: { specifier: string; symbols: string[] }[]) {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			if (node.importClause?.isTypeOnly) return

			const specifier = node.moduleSpecifier.text
			const symbols: string[] = []
			if (node.importClause) {
				if (node.importClause.name) symbols.push("default")
				if (node.importClause.namedBindings) {
					if (ts.isNamedImports(node.importClause.namedBindings)) {
						for (const n of node.importClause.namedBindings.elements) {
							if (n.isTypeOnly) continue
							symbols.push(n.name.text)
						}
					} else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
						symbols.push("*")
					}
				}
			}
			if (symbols.length > 0 || !node.importClause) {
				imports.push({ specifier, symbols })
			}
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
			imports.push({ specifier: (node.arguments[0] as ts.StringLiteral).text, symbols: ["*"] })
		}
		ts.forEachChild(node, (child) => this.visitDetailedImports(child, imports))
	}

	private getDefaultMetrics(): ExtractedMetrics {
		return {
			logicDensity: 0,
			ioEntropy: 0,
			astComplexity: 0,
			symbolDensity: 0,
			logicCohesion: 0,
			anyDensity: 0,
			cognitiveComplexity: 0,
		}
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
			cognitiveComplexity: 0,
		}
		ts.forEachChild(sourceFile, (node) => this.visitMetrics(node, ctx, 0))
		return {
			logicDensity: ctx.totalNodes > 0 ? ctx.logicNodes / ctx.totalNodes : 0,
			ioEntropy: ctx.totalImports > 0 ? ctx.ioImports / ctx.totalImports : 0,
			astComplexity: ctx.totalNodes,
			symbolDensity: ctx.totalNodes > 0 ? ctx.exportCount / ctx.totalNodes : 0,
			logicCohesion: ctx.totalNodes > 0 ? ctx.internalReferenceCount / ctx.totalNodes : 0,
			anyDensity: ctx.totalNodes > 0 ? Math.min(1.0, ctx.anyCasts / (Math.sqrt(ctx.totalNodes) * 2)) : 0,
			cognitiveComplexity: ctx.cognitiveComplexity,
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
			cognitiveComplexity: number
		},
		depth: number,
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
			kind === ts.SyntaxKind.SwitchStatement ||
			kind === ts.SyntaxKind.ConditionalExpression ||
			kind === ts.SyntaxKind.BinaryExpression
		) {
			ctx.logicNodes++
			ctx.cognitiveComplexity += 1 + depth
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

		ts.forEachChild(node, (child) => {
			const isNesting =
				kind === ts.SyntaxKind.IfStatement ||
				kind === ts.SyntaxKind.ForStatement ||
				kind === ts.SyntaxKind.WhileStatement ||
				kind === ts.SyntaxKind.SwitchStatement ||
				kind === ts.SyntaxKind.ArrowFunction ||
				kind === ts.SyntaxKind.FunctionDeclaration ||
				kind === ts.SyntaxKind.MethodDeclaration

			this.visitMetrics(child, ctx, isNesting ? depth + 1 : depth)
		})
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
		const nodeIds = new Set(this.nodes.keys())

		const oldResolved = oldImports
			.map((imp) => this.resolver.resolveImportToNodeId(nodeId, imp, nodeIds))
			.filter(Boolean) as string[]

		const newResolved = newImports
			.map((imp) => this.resolver.resolveImportToNodeId(nodeId, imp, nodeIds))
			.filter(Boolean) as string[]

		const removed = oldResolved.filter((o) => !newResolved.includes(o))
		const added = newResolved.filter((n) => !oldResolved.includes(n))

		for (const targetId of removed) {
			const target = this.nodes.get(targetId)
			if (target) {
				target.dependents = target.dependents.filter((d) => d !== nodeId)
				target.afferentCoupling = target.dependents.length
			}
		}
		for (const targetId of added) {
			const target = this.nodes.get(targetId)
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
				`[SpiderEngine] CRITICAL Activity Pressure (${SafeNumber.format(usedPercent, 1)}%). Triggering ABSOLUTE SWEEP.`,
			)
			this.resolver.dispose()
			this.sessionBuffer.clear()
			if (!this.isIndexing) this.substrateCheckpoint = null
			this.ghosts.clear()
			if (global.gc) global.gc()
			return
		}

		if (usedPercent > 80) {
			Logger.warn(
				`[SpiderEngine] High Activity Pressure detected (${SafeNumber.format(usedPercent, 1)}%). Triggering Selective Sweep.`,
			)
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

	public getViolations(monitor?: StabilityMonitor): SpiderViolation[] {
		this.pruneDeadNodes()
		const violations: SpiderViolation[] = []

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

		for (const node of this.nodes.values()) {
			if ((node.blastRadius || 0) > 0.6) {
				violations.push({
					id: "SPI-202",
					severity: "WARN",
					path: node.path,
					message: `SYSTEMIC RISK: This file has a high blast radius (${Math.round(node.blastRadius * 100)}%). A change here may destabilize the substrate.`,
					remediation: "Decouple this module or extract stable interfaces.",
				})
			}

			if (node.afferentCoupling > 30 && (node.astComplexity || 0) > 5000) {
				violations.push({
					id: "SPI-203",
					severity: "ERROR",
					path: node.path,
					message: `STRUCTURAL LOAD: Monolith detected (Coupling: ${node.afferentCoupling}, Complexity: ${node.astComplexity}).`,
					remediation: "Perform structural decomposition.",
				})
			}

			if (node.orphaned && node.layer !== "plumbing") {
				violations.push({
					id: "SPI-204",
					severity: "WARN",
					path: node.path,
					message: "ORPHANED MODULE: This file is not reachable from the project core or UI entry points.",
					remediation: "Either integrate this module or prune it.",
				})
			}
		}

		for (const node of this.nodes.values()) {
			const imports = node.imports || []
			for (const imp of imports) {
				const targetId = this.resolver.resolveImportToNodeId(node.path, imp, this.nodes)
				const targetNode = targetId ? this.nodes.get(targetId) : null
				if (!targetNode) continue

				if ((node.layer === "infrastructure" || node.layer === "plumbing") && targetNode.layer === "domain") {
					violations.push({
						id: "SPI-206",
						severity: "ERROR",
						path: node.path,
						message: `AXIOMATIC VIOLATION: Layer Leakage detected. '${node.layer}' is not permitted to import 'domain' logic (${targetNode.path}).`,
						remediation: "Invert the dependency using an interface.",
					})
				}
			}
		}

		const resonance = this.forensic.detectSymbolResonance(this.nodes)
		for (const r of resonance) {
			violations.push({
				id: "SPI-106",
				severity: "WARN",
				path: "SUBSTRATE",
				message: r,
				remediation: "Rename symbols or unify logic.",
			})
		}

		const bridges = this.forensic.detectStructuralBridges(this.nodes)
		for (const b of bridges) {
			const node = this.nodes.get(b)
			if (node && node.layer !== "plumbing") {
				violations.push({
					id: "SPI-207",
					severity: "WARN",
					path: node.path,
					message: `STRUCTURAL BRIDGE: This file is an 'Articulated Point' in the graph. Sole connection between clusters.`,
					remediation: "Add redundant paths or decouple.",
				})
			}
		}

		const snapshotHistory = this.getSnapshotHistory()
		const entanglements = this.metrics.detectEntangledDependencies(snapshotHistory)
		for (const e of entanglements) {
			violations.push({
				id: "SPI-108",
				severity: "WARN",
				path: "SUBSTRATE",
				message: e,
				remediation: "Investigate shared logic.",
			})
		}

		const contracts = this.forensic.auditImplicitContracts(this.nodes)
		for (const c of contracts) {
			violations.push({
				id: "SPI-110",
				severity: "WARN",
				path: "SUBSTRATE",
				message: c,
				remediation: "Implement missing architectural contract half.",
			})
		}

		const rippleMap = this.forensic.calculateRippleProbability(this.nodes)
		for (const node of this.nodes.values()) {
			const ripple = rippleMap.get(node.id) || 0
			if (ripple > 0.8) {
				violations.push({
					id: "SPI-300",
					severity: "WARN",
					path: node.path,
					message: `SUBSTRATE PROPHECY: High Ripple Probability (${Math.round(ripple * 100)}%).`,
					remediation: "Decouple hub or extract interfaces.",
				})
			}

			const drift = this.forensic.detectDomainDrift(node, snapshotHistory)
			if (drift) {
				violations.push({
					id: "SPI-301",
					severity: "INFO",
					path: node.path,
					message: drift,
					remediation: "Audit new vocabulary.",
				})
			}

			if (monitor && typeof monitor.getPressureMap === 'function') {
				const pressure = monitor.getPressureMap().get(node.id) || 0
				if (this.metrics.detectRefactoringFatigue(node, pressure, snapshotHistory)) {
					violations.push({
						id: "SPI-302",
						severity: "WARN",
						path: node.path,
						message: `REFACTORING FATIGUE: High churn in ${path.basename(node.path)} with zero improvement.`,
						remediation: "Fundamental rethink required.",
					})
				}
			}
		}

		if (monitor && typeof monitor.getStabilityStrategy === 'function') {
			const response = monitor.getStabilityStrategy()
			if (response.strategy === "STABILIZE") {
				violations.push({
					id: "SPI-205",
					severity: "WARN",
					path: "PROJECT_ROOT",
					message: `STRATEGIC ADVISORY (STABILIZE): Project metabolic pressure (${response.pressure}) is high.`,
					remediation: "Focus on stabilization.",
				})
			}
		}

		return violations.filter((v) => !this.suppressions.has(`${v.id}:${v.path}:${v.message}`))
	}

	public getIntegrityAdvisories(filePath?: string): SpiderViolation[] {
		const advisories: SpiderViolation[] = []
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
				message: `Circular dependency detected: ${cycleStr}.`,
			})
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


	public findGlobalProviders(symbol: string): string[] {
		const providers: string[] = []
		for (const node of this.nodes.values()) {
			if (node.exports.includes(symbol)) {
				providers.push(node.path)
			}
		}
		return providers
	}

	public findSimilarSymbols(symbol: string, limit = 3): string[] {
		const allSymbols = new Set<string>()
		for (const node of this.nodes.values()) {
			for (const exp of node.exports) allSymbols.add(exp)
		}

		const lev = (a: string, b: string): number => {
			if (Math.abs(a.length - b.length) > 3) return 99 
			if (a.length === 0) return b.length
			if (b.length === 0) return a.length

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
			.filter((item) => item.distance <= 3) 
			.sort((a, b) => a.distance - b.distance)
			.slice(0, limit)
			.map((item) => item.symbol)
	}


	public async loadRegistry(data?: Buffer | string): Promise<boolean> {
		if (data) {
			try {
				if (typeof data === "string") {
					const parsed = JSON.parse(data)
					this.nodes = new Map(parsed)
				} else {
					const payload = this.persistence.deserialize(data)
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

	public computeMerkleRoot(): string {
		const hashes = Array.from(this.nodes.values())
			.map((n) => n.hash)
			.sort()
		return crypto.createHash("sha256").update(hashes.join("")).digest("hex")
	}

	private isIndexing = false
	private activeRebuildPromise: Promise<void> | null = null
	public async rebuildRegistry(
		onProgress?: (processed: number, total: number, currentFile: string) => void | Promise<void>,
		options: RebuildRegistryOptions = {},
	): Promise<void> {
		if (this.activeRebuildPromise) {
			Logger.warn("[SpiderEngine] Rebuild already in progress.")
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
			throw new Error("Audit cancelled")
		}
	}

	private async performRegistryRebuild(
		onProgress?: (processed: number, total: number, currentFile: string) => void | Promise<void>,
		options: RebuildRegistryOptions = {},
	): Promise<void> {
		this.throwIfCancelled(options.isCancelled)
		const currentPressure = this.computeActivityPressure()
		if (this.nodes.size > 0 && currentPressure < 0.65) {
			this.createCheckpoint()
		} else {
			this.substrateCheckpoint = null
		}
		this.isIndexing = true

		const previousRegistry = new Map(this.nodes)
		const tempRegistry = new Map<string, SpiderNode>()

		if (this.computeActivityPressure() > 0.7) {
			this.nodes.clear()
			this.resolver.clearCaches() 
		}

		try {
			this.throwIfCancelled(options.isCancelled)
			const files = this.resolver.scanProject()

			let BATCH_SIZE = 250
			for (let i = 0; i < files.length; i += BATCH_SIZE) {
				this.throwIfCancelled(options.isCancelled)
				const pressure = this.computeActivityPressure()
				if (pressure > 0.9) {
					this.resolver.clearCaches() 
					if (global.gc) global.gc()
					await new Promise((resolve) => setTimeout(resolve, 1000)) 
					BATCH_SIZE = 10
				}

				const batch = files.slice(i, i + BATCH_SIZE)
				for (const f of batch) {
					this.throwIfCancelled(options.isCancelled)
					try {
						const absolutePath = path.resolve(this.cwd, f)
						if (!fs.existsSync(absolutePath)) continue
						const fileStats = await fs.promises.stat(absolutePath)
						if (fileStats.size > MAX_INDEX_FILE_BYTES) continue

						const content = await fs.promises.readFile(absolutePath, "utf-8")
						const hash = crypto.createHash("md5").update(content).digest("hex")
						const layer = this.resolver.resolveLayer(f)
						const oldNode = previousRegistry.get(f)

						let sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)
						const analysis = this.analyzeStructuralData(sourceFile)
						const metrics = analysis.metrics
						const namingScore = analysis.namingScore
						const importsData = analysis.imports
						const exportsData = analysis.exports

						const node: SpiderNode = {
							id: f,
							path: f,
							layer,
							imports: importsData.map((i) => i.specifier),
							dependents: [],
							depth: f.split("/").length - 1,
							orphaned: false,
							afferentCoupling: 0,
							...metrics,
							hash,
							isInterface: this.detectInterface(f, sourceFile),
							exports: exportsData.symbols,
							reExports: exportsData.reExports, 
							consumptions: {}, 
							resolvedImports: new Map(),
							mtime: fileStats.mtimeMs,
							namingScore,
							symbolDensity: content.length > 0 ? exportsData.symbols.length / (content.length / 100) : 0,
							blastRadius: 0,
							isFragile: false,
							cognitiveComplexity: analysis.cognitiveComplexity,
							isHotspot: false,
							anyDensity: finiteNodeNumber(metrics.anyDensity, 0),
							churnIntensity: (oldNode?.churnIntensity || 0) + (oldNode && oldNode.hash !== hash ? 1 : 0),
							semanticDrift: (oldNode?.semanticDrift || 0) + (oldNode && oldNode.layer !== layer ? 1 : 0),
							lastLayer: oldNode?.layer,
							hazardScore: 0,
						}
						tempRegistry.set(f, node)

						if (onProgress) {
							await onProgress(i + batch.indexOf(f) + 1, files.length, f)
						}
						;(sourceFile as any) = null
					} catch (e) {}
				}
				await new Promise((resolve) => setTimeout(resolve, 10))
			}

			this.throwIfCancelled(options.isCancelled)
			this.resolver.clearCaches() 

			for (const node of tempRegistry.values()) {
				const specifiers = node.reExports 
				node.reExports = specifiers
					.map((spec) => this.resolver.resolveImportToNodeId(node.path, spec, tempRegistry))
					.filter(Boolean) as string[]
			}

			this.metrics.computeCouplingMetrics(tempRegistry)
			this.metrics.computeReachability(tempRegistry)

			const fragility = this.forensic.computeFragility(tempRegistry, options.pressureMap)
			for (const [id, stats] of fragility.entries()) {
				const n = tempRegistry.get(id)
				if (n) {
					n.blastRadius = stats.blastRadius
					n.isFragile = stats.isFragile
					n.isHotspot = n.isFragile && (n.cognitiveComplexity > 0.4 || n.anyDensity > 0.3)
				}
			}
			this.recalculateHazardScores(tempRegistry)

			this.nodes = tempRegistry
			this.version++
			Logger.info(`[SpiderEngine] Substrate Immortalized: ${this.nodes.size} nodes indexed.`)
		} catch (error) {
			Logger.error("[SpiderEngine] Critical failure during registry rebuild:", error)
			throw error
		} finally {
			this.isIndexing = false
			this.resolver.clearCaches()
		}
	}

	public async synchronizeRegistry(pressureMap: Map<string, number> = new Map()): Promise<void> {
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
			this.metrics.computeCouplingMetrics(this.nodes)
			this.metrics.computeReachability(this.nodes)
			this.recalculateHazardScores(this.nodes)
		}
		this.sessionBuffer.clear()
	}

	public pruneDeadNodes(): void {
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
		this.recalculateHazardScores(this.nodes)
	}

	public getEntropy(): SpiderEntropyReport {
		return this.metrics.computeEntropy(this.nodes)
	}

	public async takeSnapshot(): Promise<SpiderSnapshot> {
		return this.persistence.takeSnapshot(this.nodes)
	}

	public getLatestSnapshot(): SpiderSnapshot | null {
		const history = this.persistence.getSnapshotHistory()
		return history[history.length - 1] || null
	}

	public getSnapshotHistory(limit: number = 5): SpiderSnapshot[] {
		const history = this.persistence.getSnapshotHistory()
		return history.slice(-limit)
	}

	public compareWith(checkpoint: Buffer): string[] {
		return this.persistence.compareToCheckpoint(this.nodes, checkpoint)
	}

	private recalculateHazardScores(nodes: Map<string, SpiderNode>): void {
		for (const node of nodes.values()) {
			node.hazardScore = finiteNodeNumber(this.forensic.calculateHazardScore(node, nodes), 0)
		}
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
			const id = this.resolver.resolveImportToNodeId(pathOrSource, specifier, this.nodes)
			return id ? this.nodes.get(id)?.layer || null : null
		}
		return this.resolver.resolveLayer(pathOrSource)
	}

	public toMermaid(scope?: Set<string>): string {
		let graph = "graph TD\n"
		const nodesToRender = scope ? Array.from(this.nodes.values()).filter(n => scope.has(n.id)) : Array.from(this.nodes.values())
		
		for (const node of nodesToRender) {
			const label = path.basename(node.path)
			const id = node.id.replace(/\W/g, "_")
			graph += `  ${id}["${label}"]\n`
			for (const imp of node.imports) {
				const depNodeId = this.resolver.resolveImportToNodeId(node.id, imp, this.nodes)
				if (depNodeId && (!scope || scope.has(depNodeId))) {
					graph += `  ${id} --> ${depNodeId.replace(/\W/g, "_")}\n`
				}
			}
		}
		return graph
	}

	/**
	 * V250: Localized Structural Scoping.
	 * Returns a set of Node IDs within a specific N-depth radius of the target file.
	 */
	public getNeighborhood(filePath: string, depth: number = 1): Set<string> {
		const normPath = this.resolver.normalizePath(filePath)
		const result = new Set<string>([normPath])
		if (depth <= 0) return result

		let currentLevel = new Set<string>([normPath])
		for (let i = 0; i < depth; i++) {
			const nextLevel = new Set<string>()
			for (const id of currentLevel) {
				const node = this.nodes.get(id)
				if (node) {
					// Outgoing (Imports)
					for (const imp of node.imports) {
						const resolved = this.resolver.resolveImportToNodeId(id, imp, this.nodes)
						if (resolved) nextLevel.add(resolved)
					}
					// Incoming (Dependents)
					for (const dep of node.dependents) {
						nextLevel.add(dep)
					}
				}
			}
			for (const id of nextLevel) result.add(id)
			currentLevel = nextLevel
		}
		return result
	}

	private calculateNamingScore(sourceFile: ts.SourceFile): number {
		let total = 0
		let valid = 0

		const check = (name: string, regex: RegExp) => {
			total++
			if (regex.test(name)) {
				const isAmbiguous = /(Manager|Helper|Utils|Data|Info|Common|Base)$|^[A-Z]?[a-z]{1,2}$/.test(name)
				if (isAmbiguous) valid += 0.5 
				else valid++
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
				const processName = (nameNode: ts.BindingName) => {
					if (ts.isIdentifier(nameNode)) {
						const name = nameNode.text
						const isConst = (node.parent.flags & ts.NodeFlags.Const) !== 0
						const isTopLevel = node.parent?.parent && ts.isSourceFile(node.parent.parent.parent)

						if (isConst && isTopLevel && (/^[A-Z][A-Z0-9_]*$/.test(name) || /^[a-z][a-zA-Z0-9]*$/.test(name))) {
							total++; valid++
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
