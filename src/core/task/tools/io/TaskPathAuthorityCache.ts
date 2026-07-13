import fs from "node:fs/promises"
import path from "node:path"
import { parseWorkspaceInlinePath } from "@core/workspace/utils/parseWorkspaceInlinePath"

export interface PathAuthorityIgnorePolicy {
	getPolicyGeneration(): number
	validateAccess(filePath: string): boolean
}

export interface PathAuthorityWorkspaceRoot {
	path: string
	name?: string
}

export interface PathAuthorityInput {
	path?: string
	absolutePath?: string
	/** Explicit hint takes precedence over an inline @name:path hint. */
	workspaceHint?: string
}

export type PathAuthorityObservationName =
	| "request"
	| "cache_hit"
	| "cache_miss"
	| "singleflight_waiter"
	| "path_normalized"
	| "realpath_requested"
	| "containment_verified"
	| "ignore_policy_evaluated"
	| "ignore_policy_resolved"
	| "cancelled"
	| "stale_generation_discarded"

export interface PathAuthorityObservation {
	name: PathAuthorityObservationName
	originalInput?: string
	filesystemGeneration?: number
	policyGeneration?: number
	workspaceGeneration?: number
}

export interface PathAuthorityStats {
	requests: number
	cacheHits: number
	cacheMisses: number
	coalescedWaiters: number
	evidenceCacheHits: number
	workspaceRootCacheHits: number
	realpathCalls: number
	realpathCacheHits: number
	nearestAncestorSteps: number
	ignorePolicyEvaluations: number
	cancellations: number
	staleGenerationDiscards: number
	entries: number
	inFlight: number
}

export interface PathAuthorityRecord {
	originalInput: string
	inputSource: "path" | "absolutePath"
	workspaceHint?: string
	workspaceHintMatched: boolean
	normalizedInput: string
	displayPath: string
	normalizedWorkspaceRelativePath: string
	canonicalWorkspaceRelativePath?: string
	absolutePath: string
	canonicalTarget: string
	nearestExistingAncestor: string
	targetExists: boolean
	selectedWorkspaceRoot: PathAuthorityWorkspaceRoot
	canonicalSelectedWorkspaceRoot: string
	containingWorkspaceRoot?: PathAuthorityWorkspaceRoot
	canonicalWorkspaceRoots: ReadonlyArray<PathAuthorityWorkspaceRoot>
	workspaceIdentity: string
	lexicallyContained: boolean
	contained: boolean
	external: boolean
	ignoreApplicable: boolean
	ignoreAllowed: boolean
	filesystemGeneration: number
	policyGeneration: number
	workspaceGeneration: number
}

export interface TaskPathAuthorityCacheOptions {
	cwd: string
	ignorePolicy: PathAuthorityIgnorePolicy
	getFilesystemGeneration: () => number
	getWorkspaceRoots?: () => readonly PathAuthorityWorkspaceRoot[]
	getWorkspaceGeneration?: () => number
	maxEntries?: number
	realpath?: (target: string) => Promise<string>
	observe?: (observation: PathAuthorityObservation) => void
}

type NormalizedRoot = Required<PathAuthorityWorkspaceRoot>

type ResolutionMaterial = {
	input: PathAuthorityInput
	originalInput: string
	inputSource: "path" | "absolutePath"
	workspaceHint?: string
	workspaceHintMatched: boolean
	normalizedInput: string
	absolutePath: string
	selectedRoot: NormalizedRoot
	roots: NormalizedRoot[]
	lexicallyContainingRoot?: NormalizedRoot
	lexicalWorkspaceIdentity: string
	filesystemGeneration: number
	policyGeneration: number
	workspaceGeneration: number
	cacheEpoch: number
	evidenceKey: string
	decisionKey: string
}

type CanonicalRoot = NormalizedRoot & { canonicalPath: string }

type PathEvidence = {
	canonicalTarget: string
	nearestExistingAncestor: string
	targetExists: boolean
	canonicalRoots: CanonicalRoot[]
	canonicalSelectedRoot: CanonicalRoot
	containingRoot?: CanonicalRoot
	workspaceIdentity: string
	contained: boolean
}

type InFlightEntry<T> = {
	promise: Promise<T>
}

const DEFAULT_MAX_ENTRIES = 256
const MAX_STALE_RETRIES = 4
const MAX_ROOT_REALPATH_CONCURRENCY = 4

/**
 * Task-owned, generation-scoped path and static-authority evidence.
 *
 * The cache deliberately excludes approval and credential decisions. Filesystem
 * evidence is separated from the policy overlay so a .dietcodeignore reload can
 * reuse canonical paths while still re-evaluating the new policy generation.
 */
export class TaskPathAuthorityCache {
	private readonly cwd: string
	private readonly ignorePolicy: PathAuthorityIgnorePolicy
	private readonly getFilesystemGeneration: () => number
	private readonly getWorkspaceRoots: () => readonly PathAuthorityWorkspaceRoot[]
	private readonly getWorkspaceGeneration: () => number
	private readonly maxEntries: number
	private readonly realpath: (target: string) => Promise<string>
	private readonly observe?: (observation: PathAuthorityObservation) => void

	private readonly decisions = new Map<string, PathAuthorityRecord>()
	private readonly evidence = new Map<string, PathEvidence>()
	private readonly canonicalRootSets = new Map<string, CanonicalRoot[]>()
	private readonly canonicalPaths = new Map<string, string>()
	private readonly decisionInFlight = new Map<string, InFlightEntry<PathAuthorityRecord>>()
	private readonly evidenceInFlight = new Map<string, InFlightEntry<PathEvidence>>()
	private readonly rootSetInFlight = new Map<string, InFlightEntry<CanonicalRoot[]>>()
	private readonly canonicalPathInFlight = new Map<string, InFlightEntry<string>>()
	private cacheEpoch = 0
	private disposed = false

	private readonly counters = {
		requests: 0,
		cacheHits: 0,
		cacheMisses: 0,
		coalescedWaiters: 0,
		evidenceCacheHits: 0,
		workspaceRootCacheHits: 0,
		realpathCalls: 0,
		realpathCacheHits: 0,
		nearestAncestorSteps: 0,
		ignorePolicyEvaluations: 0,
		cancellations: 0,
		staleGenerationDiscards: 0,
	}

	constructor(options: TaskPathAuthorityCacheOptions) {
		this.cwd = path.resolve(options.cwd)
		this.ignorePolicy = options.ignorePolicy
		this.getFilesystemGeneration = options.getFilesystemGeneration
		this.getWorkspaceRoots = options.getWorkspaceRoots ?? (() => [{ path: this.cwd, name: path.basename(this.cwd) }])
		this.getWorkspaceGeneration = options.getWorkspaceGeneration ?? (() => 0)
		this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
		this.realpath = options.realpath ?? ((target) => fs.realpath(target))
		this.observe = options.observe
	}

	async resolve(input: PathAuthorityInput, signal?: AbortSignal): Promise<PathAuthorityRecord> {
		if (this.disposed) throw new Error("Path authority cache has been disposed")
		signal?.throwIfAborted()
		this.counters.requests++
		this.emit("request")
		const resolution = this.resolveAttempt(input, 0)
		const record = await this.waitForResolution(resolution, signal)
		signal?.throwIfAborted()
		return record
	}

	/** Exact-input, current-generation lookup for scheduler-side dependency construction. */
	peek(input: PathAuthorityInput): PathAuthorityRecord | undefined {
		if (this.disposed) return undefined
		const material = this.materialize(input)
		return this.getLru(this.decisions, material.decisionKey)
	}

	getStats(): PathAuthorityStats {
		return {
			...this.counters,
			entries: this.decisions.size,
			inFlight:
				this.decisionInFlight.size +
				this.evidenceInFlight.size +
				this.rootSetInFlight.size +
				this.canonicalPathInFlight.size,
		}
	}

	clear(): void {
		this.cacheEpoch++
		this.decisions.clear()
		this.evidence.clear()
		this.canonicalRootSets.clear()
		this.canonicalPaths.clear()
		// In-flight filesystem calls are not detached or cancelled here. Their
		// generation checks prevent late cache admission.
	}

	dispose(): void {
		this.disposed = true
		this.clear()
		this.decisionInFlight.clear()
		this.evidenceInFlight.clear()
		this.rootSetInFlight.clear()
		this.canonicalPathInFlight.clear()
	}

	private async resolveAttempt(input: PathAuthorityInput, staleRetry: number): Promise<PathAuthorityRecord> {
		if (this.disposed) throw new Error("Path authority cache has been disposed")
		const material = this.materialize(input)
		const cached = this.getLru(this.decisions, material.decisionKey)
		if (cached) {
			this.counters.cacheHits++
			this.emit("cache_hit", material)
			return cached
		}

		const existing = this.decisionInFlight.get(material.decisionKey)
		if (existing) {
			this.counters.coalescedWaiters++
			this.emit("singleflight_waiter", material)
			return existing.promise
		}

		this.counters.cacheMisses++
		this.emit("cache_miss", material)
		const promise = this.resolveFresh(material, staleRetry).finally(() => {
			this.decisionInFlight.delete(material.decisionKey)
		})
		this.decisionInFlight.set(material.decisionKey, { promise })
		return promise
	}

	private async resolveFresh(material: ResolutionMaterial, staleRetry: number): Promise<PathAuthorityRecord> {
		const evidence = await this.getPathEvidence(material)
		if (!this.isCurrent(material)) {
			return this.retryStale(material.input, material, staleRetry)
		}

		let ignoreAllowed = true
		const lexicallyContained = material.lexicallyContainingRoot !== undefined
		const ignoreApplicable = lexicallyContained || evidence.contained
		if (lexicallyContained) {
			this.counters.ignorePolicyEvaluations++
			this.emit("ignore_policy_evaluated", material)
			ignoreAllowed = this.ignorePolicy.validateAccess(material.absolutePath)
		}
		if (
			ignoreAllowed &&
			evidence.contained &&
			(!lexicallyContained || !pathEquals(evidence.canonicalTarget, material.absolutePath))
		) {
			this.counters.ignorePolicyEvaluations++
			this.emit("ignore_policy_evaluated", material)
			ignoreAllowed = this.ignorePolicy.validateAccess(evidence.canonicalTarget)
		}
		this.emit("ignore_policy_resolved", material)

		// Ignore evaluation is synchronous. No workspace-root update can interleave
		// here, but a policy implementation may synchronously rotate its generation.
		if (!this.areGenerationsCurrent(material) || !this.isPolicyCurrent(material)) {
			return this.retryStale(material.input, material, staleRetry)
		}

		const canonicalWorkspaceRelativePath = evidence.containingRoot
			? toPosix(path.relative(evidence.containingRoot.canonicalPath, evidence.canonicalTarget))
			: undefined
		const normalizedWorkspaceRelativePath = toPosix(path.relative(material.selectedRoot.path, material.absolutePath))
		const displayPath = this.buildDisplayPath(material, normalizedWorkspaceRelativePath)
		const record: PathAuthorityRecord = Object.freeze({
			originalInput: material.originalInput,
			inputSource: material.inputSource,
			workspaceHint: material.workspaceHint,
			workspaceHintMatched: material.workspaceHintMatched,
			normalizedInput: material.normalizedInput,
			displayPath,
			normalizedWorkspaceRelativePath,
			canonicalWorkspaceRelativePath,
			absolutePath: material.absolutePath,
			canonicalTarget: evidence.canonicalTarget,
			nearestExistingAncestor: evidence.nearestExistingAncestor,
			targetExists: evidence.targetExists,
			selectedWorkspaceRoot: freezeRoot(material.selectedRoot),
			canonicalSelectedWorkspaceRoot: evidence.canonicalSelectedRoot.canonicalPath,
			containingWorkspaceRoot: evidence.containingRoot ? freezeRoot(evidence.containingRoot) : undefined,
			canonicalWorkspaceRoots: Object.freeze(
				evidence.canonicalRoots.map((root) => Object.freeze({ path: root.canonicalPath, name: root.name })),
			),
			workspaceIdentity: evidence.workspaceIdentity,
			lexicallyContained: material.lexicallyContainingRoot !== undefined,
			contained: evidence.contained,
			external: !evidence.contained,
			ignoreApplicable,
			ignoreAllowed,
			filesystemGeneration: material.filesystemGeneration,
			policyGeneration: material.policyGeneration,
			workspaceGeneration: material.workspaceGeneration,
		})

		this.setLru(this.decisions, material.decisionKey, record)
		return record
	}

	private async getPathEvidence(material: ResolutionMaterial): Promise<PathEvidence> {
		const cached = this.getLru(this.evidence, material.evidenceKey)
		if (cached) {
			this.counters.evidenceCacheHits++
			return cached
		}

		const existing = this.evidenceInFlight.get(material.evidenceKey)
		if (existing) {
			this.counters.coalescedWaiters++
			this.emit("singleflight_waiter", material)
			return existing.promise
		}

		const promise = this.buildPathEvidence(material)
			.then((value) => {
				if (this.areGenerationsCurrent(material)) {
					this.setLru(this.evidence, material.evidenceKey, value)
				}
				return value
			})
			.finally(() => {
				this.evidenceInFlight.delete(material.evidenceKey)
			})
		this.evidenceInFlight.set(material.evidenceKey, { promise })
		return promise
	}

	private async buildPathEvidence(material: ResolutionMaterial): Promise<PathEvidence> {
		this.emit("path_normalized", material)
		const targetIsSelectedRoot = pathEquals(material.absolutePath, material.selectedRoot.path)
		const [canonicalRoots, independentlyCanonicalizedTarget] = await Promise.all([
			this.getCanonicalRoots(material),
			targetIsSelectedRoot ? Promise.resolve(undefined) : this.canonicalizeTarget(material.absolutePath, material),
		])
		const selectedIndex = material.roots.findIndex((root) => rootsEqual(root, material.selectedRoot))
		const canonicalSelectedRoot = canonicalRoots[Math.max(0, selectedIndex)] ?? canonicalRoots[0]

		let canonicalizedTarget: Awaited<ReturnType<TaskPathAuthorityCache["canonicalizeTarget"]>>
		if (targetIsSelectedRoot) {
			canonicalizedTarget = {
				canonicalTarget: canonicalSelectedRoot.canonicalPath,
				nearestExistingAncestor: canonicalSelectedRoot.canonicalPath,
				targetExists: true,
			}
		} else {
			canonicalizedTarget = independentlyCanonicalizedTarget!
		}

		const containingRoot = [...canonicalRoots]
			.sort((a, b) => b.canonicalPath.length - a.canonicalPath.length)
			.find((root) => isWithin(root.canonicalPath, canonicalizedTarget.canonicalTarget))
		const workspaceIdentity = JSON.stringify(
			canonicalRoots.map((root) => ({ name: root.name, path: normalizeForIdentity(root.canonicalPath) })),
		)
		this.emit("containment_verified", material)

		return {
			...canonicalizedTarget,
			canonicalRoots,
			canonicalSelectedRoot,
			containingRoot,
			workspaceIdentity,
			contained: containingRoot !== undefined,
		}
	}

	private async getCanonicalRoots(material: ResolutionMaterial): Promise<CanonicalRoot[]> {
		const rootSetKey = JSON.stringify([
			material.lexicalWorkspaceIdentity,
			material.filesystemGeneration,
			material.workspaceGeneration,
		])
		const cached = this.getLru(this.canonicalRootSets, rootSetKey)
		if (cached) {
			this.counters.workspaceRootCacheHits++
			return cached
		}
		const existing = this.rootSetInFlight.get(rootSetKey)
		if (existing) {
			this.counters.coalescedWaiters++
			return existing.promise
		}

		const promise = mapBounded(material.roots, MAX_ROOT_REALPATH_CONCURRENCY, async (root): Promise<CanonicalRoot> => {
			const canonical = await this.canonicalizeTarget(root.path, material)
			return { ...root, canonicalPath: canonical.canonicalTarget }
		})
			.then((roots) => {
				if (this.areGenerationsCurrent(material)) {
					this.setLru(this.canonicalRootSets, rootSetKey, roots)
				}
				return roots
			})
			.finally(() => {
				this.rootSetInFlight.delete(rootSetKey)
			})
		this.rootSetInFlight.set(rootSetKey, { promise })
		return promise
	}

	private async canonicalizeTarget(
		absolutePath: string,
		material: ResolutionMaterial,
	): Promise<{ canonicalTarget: string; nearestExistingAncestor: string; targetExists: boolean }> {
		let current = absolutePath
		let targetExists = true
		while (true) {
			try {
				const canonicalAncestor = await this.resolveCanonicalPath(current, material)
				const suffix = path.relative(current, absolutePath)
				return {
					canonicalTarget: suffix ? path.resolve(canonicalAncestor, suffix) : canonicalAncestor,
					nearestExistingAncestor: canonicalAncestor,
					targetExists,
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw error
				}
				targetExists = false
				const parent = path.dirname(current)
				if (parent === current) {
					throw error
				}
				this.counters.nearestAncestorSteps++
				current = parent
			}
		}
	}

	private resolveCanonicalPath(target: string, material: ResolutionMaterial): Promise<string> {
		const key = JSON.stringify([
			normalizeForIdentity(target),
			material.lexicalWorkspaceIdentity,
			material.filesystemGeneration,
			material.workspaceGeneration,
			material.cacheEpoch,
		])
		const cached = this.getLru(this.canonicalPaths, key)
		if (cached !== undefined) {
			this.counters.realpathCacheHits++
			return Promise.resolve(cached)
		}
		const existing = this.canonicalPathInFlight.get(key)
		if (existing) {
			this.counters.coalescedWaiters++
			this.emit("singleflight_waiter", material)
			return existing.promise
		}

		this.counters.realpathCalls++
		this.emit("realpath_requested", material)
		const promise = this.realpath(target)
			.then((canonicalPath) => {
				if (this.areGenerationsCurrent(material)) {
					this.setLru(this.canonicalPaths, key, canonicalPath)
				}
				return canonicalPath
			})
			.finally(() => {
				this.canonicalPathInFlight.delete(key)
			})
		this.canonicalPathInFlight.set(key, { promise })
		return promise
	}

	private materialize(input: PathAuthorityInput): ResolutionMaterial {
		const hasPath = typeof input.path === "string" && input.path.length > 0
		const hasAbsolutePath = typeof input.absolutePath === "string" && input.absolutePath.length > 0
		if (!hasPath && !hasAbsolutePath) {
			throw new Error("Path authority resolution requires path or absolutePath")
		}

		const inputSource = hasPath ? "path" : "absolutePath"
		const originalInput = (hasPath ? input.path : input.absolutePath) as string
		const parsed = parseWorkspaceInlinePath(originalInput)
		const workspaceHint = input.workspaceHint ?? parsed.workspaceHint
		const roots = this.normalizedRoots()
		const { root: selectedRoot, matched: workspaceHintMatched } = this.selectRoot(roots, parsed.relPath, workspaceHint)
		const normalizedInput = path.normalize(parsed.relPath || ".")
		const absolutePath = path.isAbsolute(parsed.relPath)
			? path.resolve(parsed.relPath)
			: path.resolve(selectedRoot.path, parsed.relPath || ".")
		const lexicallyContainingRoot = [...roots]
			.sort((a, b) => b.path.length - a.path.length)
			.find((root) => isWithin(root.path, absolutePath))
		const filesystemGeneration = this.getFilesystemGeneration()
		const policyGeneration = this.ignorePolicy.getPolicyGeneration()
		const workspaceGeneration = this.getWorkspaceGeneration()
		const lexicalWorkspaceIdentity = JSON.stringify(
			roots.map((root) => ({ name: root.name, path: normalizeForIdentity(root.path) })),
		)
		const inputIdentity = JSON.stringify([inputSource, originalInput, workspaceHint ?? ""])
		const evidenceKey = JSON.stringify([
			inputIdentity,
			lexicalWorkspaceIdentity,
			filesystemGeneration,
			workspaceGeneration,
			this.cacheEpoch,
		])
		const decisionKey = JSON.stringify([evidenceKey, policyGeneration])

		return {
			input: { ...input },
			originalInput,
			inputSource,
			workspaceHint,
			workspaceHintMatched,
			normalizedInput,
			absolutePath,
			selectedRoot,
			roots,
			lexicallyContainingRoot,
			lexicalWorkspaceIdentity,
			filesystemGeneration,
			policyGeneration,
			workspaceGeneration,
			cacheEpoch: this.cacheEpoch,
			evidenceKey,
			decisionKey,
		}
	}

	private normalizedRoots(): NormalizedRoot[] {
		const provided = this.getWorkspaceRoots()
		const source = provided.length > 0 ? provided : [{ path: this.cwd, name: path.basename(this.cwd) }]
		const seen = new Set<string>()
		const roots: NormalizedRoot[] = []
		for (const root of source) {
			const normalizedPath = path.resolve(root.path)
			const identity = normalizeForIdentity(normalizedPath)
			if (seen.has(identity)) continue
			seen.add(identity)
			roots.push({ path: normalizedPath, name: root.name || path.basename(normalizedPath) })
		}
		return roots
	}

	private selectRoot(
		roots: NormalizedRoot[],
		parsedPath: string,
		workspaceHint?: string,
	): { root: NormalizedRoot; matched: boolean } {
		if (workspaceHint) {
			const normalizedHint = normalizeForIdentity(workspaceHint)
			const hinted = roots.find((root) => root.name === workspaceHint || normalizeForIdentity(root.path) === normalizedHint)
			if (hinted) return { root: hinted, matched: true }
		}
		if (path.isAbsolute(parsedPath)) {
			const absolute = path.resolve(parsedPath)
			const containing = [...roots]
				.sort((a, b) => b.path.length - a.path.length)
				.find((root) => isWithin(root.path, absolute))
			if (containing) return { root: containing, matched: workspaceHint === undefined }
		}
		return { root: roots[0], matched: workspaceHint === undefined }
	}

	private buildDisplayPath(material: ResolutionMaterial, workspaceRelativePath: string): string {
		if (material.workspaceHint) {
			return `@${material.workspaceHint}:${workspaceRelativePath}`
		}
		if (material.lexicallyContainingRoot) {
			return workspaceRelativePath || material.selectedRoot.name
		}
		return toPosix(material.absolutePath)
	}

	private isCurrent(material: ResolutionMaterial): boolean {
		return this.isFilesystemAndWorkspaceCurrent(material) && this.isPolicyCurrent(material)
	}

	private isFilesystemAndWorkspaceCurrent(material: ResolutionMaterial): boolean {
		return this.areGenerationsCurrent(material) && this.normalizedWorkspaceIdentity() === material.lexicalWorkspaceIdentity
	}

	private areGenerationsCurrent(material: ResolutionMaterial): boolean {
		return (
			!this.disposed &&
			material.cacheEpoch === this.cacheEpoch &&
			this.getFilesystemGeneration() === material.filesystemGeneration &&
			this.getWorkspaceGeneration() === material.workspaceGeneration
		)
	}

	private isPolicyCurrent(material: ResolutionMaterial): boolean {
		return this.ignorePolicy.getPolicyGeneration() === material.policyGeneration
	}

	private normalizedWorkspaceIdentity(): string {
		return JSON.stringify(this.normalizedRoots().map((root) => ({ name: root.name, path: normalizeForIdentity(root.path) })))
	}

	private retryStale(
		input: PathAuthorityInput,
		material: ResolutionMaterial,
		staleRetry: number,
	): Promise<PathAuthorityRecord> {
		this.counters.staleGenerationDiscards++
		this.emit("stale_generation_discarded", material)
		if (staleRetry >= MAX_STALE_RETRIES) {
			throw new Error("Path authority generations changed repeatedly during resolution")
		}
		return this.resolveAttempt(input, staleRetry + 1)
	}

	private waitForResolution(resolution: Promise<PathAuthorityRecord>, signal?: AbortSignal): Promise<PathAuthorityRecord> {
		if (!signal) return resolution
		if (signal.aborted) return Promise.reject(abortReason(signal))

		return new Promise<PathAuthorityRecord>((resolve, reject) => {
			const onAbort = () => {
				this.counters.cancellations++
				this.emit("cancelled")
				reject(abortReason(signal))
			}
			signal.addEventListener("abort", onAbort, { once: true })
			resolution.then(
				(record) => {
					signal.removeEventListener("abort", onAbort)
					resolve(record)
				},
				(error) => {
					signal.removeEventListener("abort", onAbort)
					reject(error)
				},
			)
		})
	}

	private emit(name: PathAuthorityObservationName, material?: Partial<ResolutionMaterial>): void {
		try {
			this.observe?.({
				name,
				originalInput: material?.originalInput,
				filesystemGeneration: material?.filesystemGeneration,
				policyGeneration: material?.policyGeneration,
				workspaceGeneration: material?.workspaceGeneration,
			})
		} catch {
			// Advisory instrumentation must never gate authority resolution.
		}
	}

	private getLru<K, V>(cache: Map<K, V>, key: K): V | undefined {
		const value = cache.get(key)
		if (value === undefined) return undefined
		cache.delete(key)
		cache.set(key, value)
		return value
	}

	private setLru<K, V>(cache: Map<K, V>, key: K, value: V): void {
		cache.delete(key)
		cache.set(key, value)
		while (cache.size > this.maxEntries) {
			const oldest = cache.keys().next().value
			if (oldest === undefined) break
			cache.delete(oldest)
		}
	}
}

function isWithin(root: string, target: string): boolean {
	const relative = path.relative(root, target)
	return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function pathEquals(left: string, right: string): boolean {
	const normalizedLeft = path.normalize(left)
	const normalizedRight = path.normalize(right)
	return process.platform === "win32"
		? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
		: normalizedLeft === normalizedRight
}

function rootsEqual(left: NormalizedRoot, right: NormalizedRoot): boolean {
	return left.name === right.name && pathEquals(left.path, right.path)
}

function normalizeForIdentity(value: string): string {
	const normalized = path.normalize(value)
	return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function toPosix(value: string): string {
	return value.replace(/\\/g, "/")
}

function freezeRoot(root: PathAuthorityWorkspaceRoot): PathAuthorityWorkspaceRoot {
	return Object.freeze({ path: root.path, name: root.name })
}

function abortReason(signal: AbortSignal): unknown {
	if (signal.reason !== undefined) return signal.reason
	const error = new Error("Path authority resolution was cancelled")
	error.name = "AbortError"
	return error
}

async function mapBounded<T, R>(items: readonly T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length)
	let cursor = 0
	const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++
			results[index] = await map(items[index])
		}
	})
	await Promise.all(workers)
	return results
}
