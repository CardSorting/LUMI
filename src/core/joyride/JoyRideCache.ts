/**
 * [LAYER: CORE]
 * Bounded, invalidation-aware in-process execution cache for active agent hot paths.
 */

import { Buffer } from "node:buffer"
import {
	JOYRIDE_CACHE_KINDS,
	type JoyRideBudgetConfig,
	type JoyRideCacheEntry,
	type JoyRideCacheKind,
	type JoyRideCacheStats,
	type JoyRideCleanupHandler,
	type JoyRideExplainResult,
	type JoyRideInvalidateTarget,
	type JoyRideInvalidationReason,
	type JoyRideSetMetadata,
	type JoyRideSetResult,
	type JoyRideTrimResult,
	type JoyRideValidationFingerprint,
} from "./types"

const MiB = 1024 * 1024

const DEFAULT_PER_KIND_BUDGET: Record<JoyRideCacheKind, number> = {
	hotExecution: 4 * MiB,
	taskLocal: 8 * MiB,
	workspaceIndex: 12 * MiB,
	verification: 8 * MiB,
	scratchArtifact: 8 * MiB,
}

const DEFAULT_BUDGET: JoyRideBudgetConfig = {
	maxTotalBytes: 32 * MiB,
	maxEntryBytes: 512 * 1024,
	maxPerTaskBytes: 8 * MiB,
	maxArtifactCount: 128,
	maxArtifactBytes: 1024 * 1024,
	perKindBudgetBytes: DEFAULT_PER_KIND_BUDGET,
	emergencyTargetRatio: 0.35,
}

const NOOP_CLEANUP: JoyRideCleanupHandler = () => {}

const SECRET_VALUE_PATTERNS: RegExp[] = [
	/sk-ant-api03-[a-zA-Z0-9\-_]{80,}/,
	/sk-[a-zA-Z0-9]{32,}/,
	/AIza[a-zA-Z0-9\-_]{30,}/,
	/gh[pousr]_[a-zA-Z0-9_]{30,}/,
	/xox[abp]-[a-zA-Z0-9-]{40,}/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bBearer\s+[a-zA-Z0-9_\-.]{20,}\b/i,
	/\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|npm[_-]?token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-./+=]{8,}/i,
]

const SECRET_KEY_PATTERN = /\b(apiKey|api_key|secret|token|authorization|password|privateKey|sshKey|clientSecret)\b/i

export class JoyRideCache {
	private readonly budget: JoyRideBudgetConfig
	private readonly entries = new Map<string, JoyRideCacheEntry<unknown>>()
	private totalBytes = 0
	private readonly bytesByKind = this.createZeroKindRecord()
	private readonly bytesByTask = new Map<string, number>()
	private artifactCount = 0

	private hitCount = 0
	private missCount = 0
	private evictionCount = 0
	private staleInvalidationCount = 0
	private verificationCacheReuseCount = 0
	private pressureTrimEvents = 0
	private emergencyTrimEvents = 0
	private rejectedAdmissionCount = 0
	private rejectedUnsafeEntryCount = 0
	private rejectedOversizedEntryCount = 0
	private staleReusePreventionCount = 0
	private taskCleanupCount = 0
	private scratchCleanupCount = 0
	private spillCount = 0
	private cacheValidationFailureCount = 0
	private duplicateArtifactDeduplicationCount = 0

	constructor(config: Partial<JoyRideBudgetConfig> = {}) {
		this.budget = {
			...DEFAULT_BUDGET,
			...config,
			perKindBudgetBytes: {
				...DEFAULT_PER_KIND_BUDGET,
				...(config.perKindBudgetBytes ?? {}),
			},
		}
	}

	get<T = unknown>(key: string, validation?: JoyRideValidationFingerprint): T | undefined {
		const entry = this.entries.get(key)
		if (!entry) {
			this.missCount++
			return undefined
		}

		if (this.isExpired(entry)) {
			this.markStale(key, "ttl_expired")
			this.missCount++
			this.staleReusePreventionCount++
			return undefined
		}

		if (entry.staleReason) {
			this.missCount++
			this.staleReusePreventionCount++
			return undefined
		}

		if (entry.cacheKind === "verification" && !validation) {
			this.markStale(key, "validation_required")
			this.missCount++
			this.staleReusePreventionCount++
			this.cacheValidationFailureCount++
			return undefined
		}

		if (validation && !this.validateEntry(entry, validation)) {
			this.markStale(key, "validation_failed")
			this.missCount++
			this.staleReusePreventionCount++
			this.cacheValidationFailureCount++
			return undefined
		}

		this.hitCount++
		if (entry.cacheKind === "verification") {
			this.verificationCacheReuseCount++
		}
		this.touchEntry(entry)
		return entry.value as T
	}

	has(key: string, validation?: JoyRideValidationFingerprint): boolean {
		const entry = this.entries.get(key)
		if (!entry || entry.staleReason || this.isExpired(entry)) {
			return false
		}
		return validation ? this.validateEntry(entry, validation) : entry.cacheKind !== "verification"
	}

	set(key: string, value: unknown, metadata: JoyRideSetMetadata): JoyRideSetResult {
		const estimatedBytes = metadata.estimatedBytes ?? this.estimateValueBytes(value)
		const admission = this.admit(key, value, metadata, estimatedBytes)
		if (!admission.accepted) {
			this.rejectedAdmissionCount++
			if (admission.reason.includes("unsafe")) {
				this.rejectedUnsafeEntryCount++
			}
			if (admission.reason.includes("size") || admission.reason.includes("budget")) {
				this.rejectedOversizedEntryCount++
			}
			return admission
		}

		const existing = this.entries.get(key)
		if (existing && !existing.staleReason && existing.fingerprint === metadata.fingerprint) {
			this.duplicateArtifactDeduplicationCount++
			this.touchEntry(existing)
			return {
				accepted: true,
				key,
				reason: "deduplicated_existing_entry",
				entry: existing,
			}
		}

		if (existing) {
			this.deleteEntry(key, "entry_replaced", false)
		}

		const now = Date.now()
		const entry: JoyRideCacheEntry<unknown> = {
			key,
			value,
			cacheKind: metadata.cacheKind,
			scope: metadata.scope,
			ownerTaskId: metadata.ownerTaskId,
			createdAt: now,
			lastAccessedAt: now,
			ttl: metadata.ttlMs,
			estimatedBytes,
			fingerprint: metadata.fingerprint,
			workspaceFingerprint: metadata.workspaceFingerprint,
			approvalBoundaryId: metadata.approvalBoundaryId,
			durability: metadata.durability ?? "memoryOnly",
			invalidationReason: [...metadata.invalidationReason],
			cleanupHandler: metadata.cleanupHandler ?? NOOP_CLEANUP,
			admissionReason: metadata.admissionReason,
			accessCount: 0,
			generation: metadata.generation,
			safetyClassification: metadata.safetyClassification,
			dependencyFingerprint: metadata.dependencyFingerprint,
			lockfileFingerprint: metadata.lockfileFingerprint,
			gitHead: metadata.gitHead,
			environmentFingerprint: metadata.environmentFingerprint,
			runtimeVersion: metadata.runtimeVersion,
			toolVersion: metadata.toolVersion,
			relevantFileHashes: metadata.relevantFileHashes ? { ...metadata.relevantFileHashes } : undefined,
		}

		this.entries.set(key, entry)
		this.accountAdd(entry)
		this.trimToBudget()

		if (!this.entries.has(key)) {
			return {
				accepted: false,
				key,
				reason: "evicted_during_pressure_trim",
			}
		}

		return {
			accepted: true,
			key,
			reason: "admitted",
			entry,
		}
	}

	invalidate(target: JoyRideInvalidateTarget): number {
		let count = 0
		const reason = target.reason ?? "manual_stale_mark"
		for (const entry of this.entries.values()) {
			if (this.matchesTarget(entry, target)) {
				if (!entry.staleReason) {
					entry.staleReason = reason
					entry.invalidationReason = this.appendReason(entry.invalidationReason, reason)
					this.staleInvalidationCount++
					count++
				}
			}
		}
		return count
	}

	flush(target: JoyRideInvalidateTarget = { reason: "manual_flush" }): number {
		const keys = [...this.entries.values()].filter((entry) => this.matchesTarget(entry, target)).map((entry) => entry.key)
		for (const key of keys) {
			this.deleteEntry(key, target.reason ?? "manual_flush", false)
		}
		return keys.length
	}

	flushTask(taskId: string, reason: JoyRideInvalidationReason = "task_completed"): number {
		const count = this.flush({ ownerTaskId: taskId, reason })
		if (count > 0) {
			this.taskCleanupCount++
		}
		return count
	}

	flushWorkspace(workspaceId: string, reason: JoyRideInvalidationReason = "workspace_closed"): number {
		return this.flush({ scope: { type: "workspace", id: workspaceId }, reason })
	}

	estimateSize(): number {
		return this.totalBytes
	}

	trimToBudget(): JoyRideTrimResult {
		const before = this.totalBytes
		let trimmedEntries = 0

		for (const entry of [...this.entries.values()]) {
			if (this.isExpired(entry)) {
				this.deleteEntry(entry.key, "ttl_expired", true)
				trimmedEntries++
			}
		}

		while (!this.isWithinBudget() && this.entries.size > 0) {
			const candidate = this.selectEvictionCandidate()
			if (!candidate) {
				break
			}
			this.deleteEntry(candidate.key, "memory_pressure", true)
			trimmedEntries++
		}

		if (trimmedEntries > 0) {
			this.pressureTrimEvents++
		}

		return {
			trimmedEntries,
			freedBytes: before - this.totalBytes,
			reason: "memory_pressure",
		}
	}

	emergencyTrim(reason: JoyRideInvalidationReason = "emergency_pressure"): JoyRideTrimResult {
		this.emergencyTrimEvents++
		const before = this.totalBytes
		let trimmedEntries = 0
		const targetBytes = Math.max(0, Math.floor(this.budget.maxTotalBytes * this.budget.emergencyTargetRatio))

		for (const entry of [...this.entries.values()].sort(this.compareEvictionCandidates)) {
			if (this.totalBytes <= targetBytes) {
				break
			}
			this.deleteEntry(entry.key, reason, true)
			trimmedEntries++
		}

		return {
			trimmedEntries,
			freedBytes: before - this.totalBytes,
			reason,
		}
	}

	getStats(): JoyRideCacheStats {
		const requestCount = this.hitCount + this.missCount
		const now = Date.now()
		const summaries = [...this.entries.values()].map((entry) => ({
			key: entry.key,
			cacheKind: entry.cacheKind,
			estimatedBytes: entry.estimatedBytes,
			ownerTaskId: entry.ownerTaskId,
			accessCount: entry.accessCount,
			ageMs: now - entry.createdAt,
		}))
		const averageEntryAgeMs = summaries.length ? summaries.reduce((sum, entry) => sum + entry.ageMs, 0) / summaries.length : 0

		return {
			hitCount: this.hitCount,
			missCount: this.missCount,
			hitRate: requestCount ? this.hitCount / requestCount : 0,
			missRate: requestCount ? this.missCount / requestCount : 0,
			evictionCount: this.evictionCount,
			staleInvalidationCount: this.staleInvalidationCount,
			memoryUsageEstimate: this.totalBytes,
			perCacheMemoryEstimate: { ...this.bytesByKind },
			perTaskMemoryEstimate: Object.fromEntries(this.bytesByTask.entries()),
			artifactCount: this.artifactCount,
			verificationCacheReuseCount: this.verificationCacheReuseCount,
			pressureTrimEvents: this.pressureTrimEvents,
			emergencyTrimEvents: this.emergencyTrimEvents,
			rejectedAdmissionCount: this.rejectedAdmissionCount,
			rejectedUnsafeEntryCount: this.rejectedUnsafeEntryCount,
			rejectedOversizedEntryCount: this.rejectedOversizedEntryCount,
			averageEntryAgeMs,
			largestEntries: [...summaries].sort((a, b) => b.estimatedBytes - a.estimatedBytes).slice(0, 5),
			hottestKeys: [...summaries].sort((a, b) => b.accessCount - a.accessCount).slice(0, 5),
			staleReusePreventionCount: this.staleReusePreventionCount,
			taskCleanupCount: this.taskCleanupCount,
			scratchCleanupCount: this.scratchCleanupCount,
			spillCount: this.spillCount,
			cacheValidationFailureCount: this.cacheValidationFailureCount,
			duplicateArtifactDeduplicationCount: this.duplicateArtifactDeduplicationCount,
			entryCount: this.entries.size,
		}
	}

	markStale(key: string, reason: JoyRideInvalidationReason | string): boolean {
		const entry = this.entries.get(key)
		if (!entry) {
			return false
		}
		if (!entry.staleReason) {
			entry.staleReason = reason
			entry.invalidationReason = this.appendReason(entry.invalidationReason, reason)
			this.staleInvalidationCount++
		}
		return true
	}

	validate(entryOrKey: JoyRideCacheEntry<unknown> | string, fingerprint: JoyRideValidationFingerprint): boolean {
		const entry = typeof entryOrKey === "string" ? this.entries.get(entryOrKey) : entryOrKey
		return entry ? this.validateEntry(entry, fingerprint) : false
	}

	touch(key: string): boolean {
		const entry = this.entries.get(key)
		if (!entry) {
			return false
		}
		this.touchEntry(entry)
		return true
	}

	dispose(entryOrKey: JoyRideCacheEntry<unknown> | string): boolean {
		const key = typeof entryOrKey === "string" ? entryOrKey : entryOrKey.key
		return this.deleteEntry(key, "manual_flush", false)
	}

	explain(key: string): JoyRideExplainResult {
		const entry = this.entries.get(key)
		if (!entry) {
			return {
				exists: false,
				key,
				validity: "missing",
			}
		}

		const now = Date.now()
		const expired = this.isExpired(entry)
		const validity = expired ? "expired" : entry.staleReason ? "stale" : "valid"
		return {
			exists: true,
			key,
			cacheKind: entry.cacheKind,
			ownerTaskId: entry.ownerTaskId,
			scope: entry.scope,
			admissionReason: entry.admissionReason,
			validity,
			staleReason: entry.staleReason,
			createdAt: entry.createdAt,
			lastAccessedAt: entry.lastAccessedAt,
			expiresAt: entry.createdAt + entry.ttl,
			ttlMs: entry.ttl,
			ageMs: now - entry.createdAt,
			estimatedBytes: entry.estimatedBytes,
			canEvict: true,
			durability: entry.durability,
			safetyClassification: entry.safetyClassification,
			invalidationReason: [...entry.invalidationReason],
			workspaceFingerprint: entry.workspaceFingerprint,
			approvalBoundaryId: entry.approvalBoundaryId,
			generation: entry.generation,
			fingerprint: entry.fingerprint,
			accessCount: entry.accessCount,
		}
	}

	runPeriodicMaintenance(): JoyRideTrimResult {
		return this.trimToBudget()
	}

	private admit(key: string, value: unknown, metadata: JoyRideSetMetadata, estimatedBytes: number): JoyRideSetResult {
		if (!key || !key.startsWith("joyride:") || key.split(":").length < 3) {
			return this.reject(key, "weak_or_unscoped_key")
		}
		if (!metadata.ownerTaskId || !metadata.scope?.id || !metadata.scope.type) {
			return this.reject(key, "missing_owner_or_scope")
		}
		if (!Number.isFinite(metadata.ttlMs) || metadata.ttlMs <= 0) {
			return this.reject(key, "missing_or_invalid_ttl")
		}
		if (!metadata.fingerprint || !metadata.workspaceFingerprint || !metadata.approvalBoundaryId) {
			return this.reject(key, "missing_validation_fingerprint")
		}
		if (!metadata.admissionReason || metadata.invalidationReason.length === 0) {
			return this.reject(key, "missing_admission_or_invalidation_policy")
		}
		if (metadata.safetyClassification === "unsafe" || this.containsUnsafeMaterial(value)) {
			return this.reject(key, "unsafe_or_secret_bearing_entry")
		}
		if (estimatedBytes <= 0 || estimatedBytes > this.budget.maxEntryBytes) {
			return this.reject(key, "entry_size_budget_exceeded")
		}
		if (estimatedBytes > this.budget.perKindBudgetBytes[metadata.cacheKind]) {
			return this.reject(key, "per_cache_budget_exceeded")
		}
		if (estimatedBytes > this.budget.maxPerTaskBytes) {
			return this.reject(key, "per_task_budget_exceeded")
		}
		if (metadata.cacheKind === "scratchArtifact") {
			if (!metadata.cleanupHandler) {
				return this.reject(key, "scratch_artifact_missing_cleanup_handler")
			}
			if (estimatedBytes > this.budget.maxArtifactBytes) {
				return this.reject(key, "artifact_size_budget_exceeded")
			}
			if (this.artifactCount >= this.budget.maxArtifactCount) {
				this.trimToBudget()
				if (this.artifactCount >= this.budget.maxArtifactCount) {
					return this.reject(key, "artifact_count_budget_exceeded")
				}
			}
		}
		return {
			accepted: true,
			key,
			reason: "accepted_by_admission_policy",
		}
	}

	private reject(key: string, reason: string): JoyRideSetResult {
		return {
			accepted: false,
			key,
			reason,
		}
	}

	private isExpired(entry: JoyRideCacheEntry<unknown>): boolean {
		return Date.now() - entry.createdAt >= entry.ttl
	}

	private touchEntry(entry: JoyRideCacheEntry<unknown>): void {
		entry.lastAccessedAt = Date.now()
		entry.accessCount++
		this.entries.delete(entry.key)
		this.entries.set(entry.key, entry)
	}

	private validateEntry(entry: JoyRideCacheEntry<unknown>, fingerprint: JoyRideValidationFingerprint): boolean {
		if (entry.staleReason || this.isExpired(entry)) {
			return false
		}
		if (fingerprint.fingerprint !== undefined && fingerprint.fingerprint !== entry.fingerprint) {
			return false
		}
		if (fingerprint.workspaceFingerprint !== undefined && fingerprint.workspaceFingerprint !== entry.workspaceFingerprint) {
			return false
		}
		if (fingerprint.approvalBoundaryId !== undefined && fingerprint.approvalBoundaryId !== entry.approvalBoundaryId) {
			return false
		}
		if (fingerprint.generation !== undefined && fingerprint.generation !== entry.generation) {
			return false
		}
		if (
			fingerprint.dependencyFingerprint !== undefined &&
			fingerprint.dependencyFingerprint !== entry.dependencyFingerprint
		) {
			return false
		}
		if (fingerprint.lockfileFingerprint !== undefined && fingerprint.lockfileFingerprint !== entry.lockfileFingerprint) {
			return false
		}
		if (fingerprint.gitHead !== undefined && fingerprint.gitHead !== entry.gitHead) {
			return false
		}
		if (
			fingerprint.environmentFingerprint !== undefined &&
			fingerprint.environmentFingerprint !== entry.environmentFingerprint
		) {
			return false
		}
		if (fingerprint.runtimeVersion !== undefined && fingerprint.runtimeVersion !== entry.runtimeVersion) {
			return false
		}
		if (fingerprint.toolVersion !== undefined && fingerprint.toolVersion !== entry.toolVersion) {
			return false
		}
		if (
			fingerprint.relevantFileHashes !== undefined &&
			!this.sameRecord(fingerprint.relevantFileHashes, entry.relevantFileHashes ?? {})
		) {
			return false
		}
		return true
	}

	private sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
		const aKeys = Object.keys(a).sort()
		const bKeys = Object.keys(b).sort()
		if (aKeys.length !== bKeys.length) {
			return false
		}
		return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key])
	}

	private containsUnsafeMaterial(value: unknown): boolean {
		const seen = new WeakSet<object>()
		let inspected = 0
		const inspect = (input: unknown, keyName?: string): boolean => {
			inspected++
			if (inspected > 1_000) {
				return false
			}
			if (typeof input === "string") {
				if (keyName && SECRET_KEY_PATTERN.test(keyName) && input.trim().length > 0) {
					return true
				}
				return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(input))
			}
			if (!input || typeof input !== "object") {
				return false
			}
			if (seen.has(input)) {
				return false
			}
			seen.add(input)
			if (Array.isArray(input)) {
				return input.some((item) => inspect(item))
			}
			for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
				if (inspect(item, key)) {
					return true
				}
			}
			return false
		}

		return inspect(value)
	}

	private estimateValueBytes(value: unknown, seen = new WeakSet<object>(), depth = 0): number {
		if (value === null || value === undefined) {
			return 0
		}
		if (typeof value === "string") {
			return Buffer.byteLength(value, "utf8")
		}
		if (typeof value === "number" || typeof value === "bigint") {
			return 8
		}
		if (typeof value === "boolean") {
			return 4
		}
		if (Buffer.isBuffer(value)) {
			return value.byteLength
		}
		if (typeof value !== "object") {
			return 64
		}
		if (seen.has(value)) {
			return 64
		}
		if (depth > 8) {
			return 512
		}
		seen.add(value)
		if (Array.isArray(value)) {
			return value.reduce((sum, item) => sum + this.estimateValueBytes(item, seen, depth + 1), 24)
		}
		return Object.entries(value as Record<string, unknown>).reduce(
			(sum, [key, item]) => sum + Buffer.byteLength(key, "utf8") + this.estimateValueBytes(item, seen, depth + 1),
			32,
		)
	}

	private matchesTarget(entry: JoyRideCacheEntry<unknown>, target: JoyRideInvalidateTarget): boolean {
		if (target.cacheKind && entry.cacheKind !== target.cacheKind) {
			return false
		}
		if (target.ownerTaskId && entry.ownerTaskId !== target.ownerTaskId) {
			return false
		}
		if (target.workspaceFingerprint && entry.workspaceFingerprint !== target.workspaceFingerprint) {
			return false
		}
		if (target.approvalBoundaryId && entry.approvalBoundaryId !== target.approvalBoundaryId) {
			return false
		}
		if (target.scope && (entry.scope.type !== target.scope.type || entry.scope.id !== target.scope.id)) {
			return false
		}
		return target.predicate ? target.predicate(entry) : true
	}

	private isWithinBudget(): boolean {
		if (this.totalBytes > this.budget.maxTotalBytes) {
			return false
		}
		if (this.artifactCount > this.budget.maxArtifactCount) {
			return false
		}
		for (const kind of JOYRIDE_CACHE_KINDS) {
			if (this.bytesByKind[kind] > this.budget.perKindBudgetBytes[kind]) {
				return false
			}
		}
		for (const bytes of this.bytesByTask.values()) {
			if (bytes > this.budget.maxPerTaskBytes) {
				return false
			}
		}
		return true
	}

	private selectEvictionCandidate(): JoyRideCacheEntry<unknown> | undefined {
		return [...this.entries.values()].sort(this.compareEvictionCandidates)[0]
	}

	private compareEvictionCandidates = (a: JoyRideCacheEntry<unknown>, b: JoyRideCacheEntry<unknown>): number => {
		const aStale = a.staleReason || this.isExpired(a) ? 0 : 1
		const bStale = b.staleReason || this.isExpired(b) ? 0 : 1
		if (aStale !== bStale) {
			return aStale - bStale
		}
		const aKind = this.kindEvictionRank(a.cacheKind)
		const bKind = this.kindEvictionRank(b.cacheKind)
		if (aKind !== bKind) {
			return aKind - bKind
		}
		if (a.accessCount !== b.accessCount) {
			return a.accessCount - b.accessCount
		}
		if (a.lastAccessedAt !== b.lastAccessedAt) {
			return a.lastAccessedAt - b.lastAccessedAt
		}
		return b.estimatedBytes - a.estimatedBytes
	}

	private kindEvictionRank(kind: JoyRideCacheKind): number {
		switch (kind) {
			case "hotExecution":
				return 0
			case "scratchArtifact":
				return 1
			case "taskLocal":
				return 2
			case "verification":
				return 3
			case "workspaceIndex":
				return 4
		}
	}

	private accountAdd(entry: JoyRideCacheEntry<unknown>): void {
		this.totalBytes += entry.estimatedBytes
		this.bytesByKind[entry.cacheKind] += entry.estimatedBytes
		this.bytesByTask.set(entry.ownerTaskId, (this.bytesByTask.get(entry.ownerTaskId) ?? 0) + entry.estimatedBytes)
		if (entry.cacheKind === "scratchArtifact") {
			this.artifactCount++
		}
	}

	private accountRemove(entry: JoyRideCacheEntry<unknown>): void {
		this.totalBytes = Math.max(0, this.totalBytes - entry.estimatedBytes)
		this.bytesByKind[entry.cacheKind] = Math.max(0, this.bytesByKind[entry.cacheKind] - entry.estimatedBytes)
		const nextTaskBytes = Math.max(0, (this.bytesByTask.get(entry.ownerTaskId) ?? 0) - entry.estimatedBytes)
		if (nextTaskBytes === 0) {
			this.bytesByTask.delete(entry.ownerTaskId)
		} else {
			this.bytesByTask.set(entry.ownerTaskId, nextTaskBytes)
		}
		if (entry.cacheKind === "scratchArtifact") {
			this.artifactCount = Math.max(0, this.artifactCount - 1)
			this.scratchCleanupCount++
		}
	}

	private deleteEntry(key: string, reason: JoyRideInvalidationReason, countAsEviction: boolean): boolean {
		const entry = this.entries.get(key)
		if (!entry) {
			return false
		}
		this.entries.delete(key)
		entry.staleReason = reason
		entry.invalidationReason = this.appendReason(entry.invalidationReason, reason)
		this.accountRemove(entry)
		if (countAsEviction) {
			this.evictionCount++
		}
		this.invokeCleanup(entry)
		return true
	}

	private invokeCleanup(entry: JoyRideCacheEntry<unknown>): void {
		try {
			const result = entry.cleanupHandler(entry)
			if (result && typeof (result as Promise<void>).catch === "function") {
				void (result as Promise<void>).catch(() => {})
			}
		} catch {
			// Cleanup must never threaten the active session.
		}
	}

	private appendReason(
		reasons: JoyRideInvalidationReason[],
		reason: JoyRideInvalidationReason | string,
	): JoyRideInvalidationReason[] {
		if (!this.isKnownReason(reason)) {
			return reasons
		}
		return reasons.includes(reason) ? reasons : [...reasons, reason]
	}

	private isKnownReason(reason: JoyRideInvalidationReason | string): reason is JoyRideInvalidationReason {
		return [
			"ttl_expired",
			"task_boundary_changed",
			"task_completed",
			"task_cancelled",
			"task_scope_changed",
			"workspace_closed",
			"workspace_drift",
			"workspace_generation_changed",
			"workspace_fingerprint_changed",
			"file_hash_changed",
			"git_head_changed",
			"dependency_fingerprint_changed",
			"lockfile_fingerprint_changed",
			"command_environment_changed",
			"approval_boundary_changed",
			"runtime_version_changed",
			"tool_version_changed",
			"config_changed",
			"security_policy_changed",
			"manual_flush",
			"manual_stale_mark",
			"validation_required",
			"validation_failed",
			"memory_pressure",
			"emergency_pressure",
			"entry_replaced",
		].includes(reason)
	}

	private createZeroKindRecord(): Record<JoyRideCacheKind, number> {
		return {
			hotExecution: 0,
			taskLocal: 0,
			workspaceIndex: 0,
			verification: 0,
			scratchArtifact: 0,
		}
	}
}
