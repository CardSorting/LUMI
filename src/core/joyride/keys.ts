/**
 * [LAYER: CORE]
 * Stable JoyRide cache key and fingerprint helpers.
 */

import { createHash } from "node:crypto"

type Jsonish = null | boolean | number | string | Jsonish[] | { [key: string]: Jsonish }

export interface JoyRideKeyMaterial {
	key: string
	fingerprint: string
	namespace: string
	parts: Record<string, unknown>
}

export function stableStringify(value: unknown): string {
	const seen = new WeakSet<object>()
	const normalize = (input: unknown): Jsonish => {
		if (input === null) {
			return null
		}
		if (input === undefined) {
			return "__undefined__"
		}
		if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
			return input
		}
		if (typeof input === "bigint") {
			return input.toString()
		}
		if (Array.isArray(input)) {
			return input.map((item) => normalize(item))
		}
		if (typeof input === "object") {
			if (seen.has(input)) {
				return "__circular__"
			}
			seen.add(input)
			const out: Record<string, Jsonish> = {}
			for (const key of Object.keys(input as Record<string, unknown>).sort()) {
				out[key] = normalize((input as Record<string, unknown>)[key])
			}
			return out
		}
		return String(input)
	}

	return JSON.stringify(normalize(value))
}

export function createJoyRideFingerprint(value: unknown): string {
	return createHash("sha256").update(stableStringify(value), "utf8").digest("hex")
}

export function createJoyRideKey(namespace: string, parts: Record<string, unknown>): JoyRideKeyMaterial {
	const fingerprint = createJoyRideFingerprint({ namespace, parts })
	return {
		key: `joyride:${namespace}:${fingerprint}`,
		fingerprint,
		namespace,
		parts,
	}
}

export function createCommandResultCacheKey(input: {
	command: string
	cwd: string
	environmentFingerprint: string
	relevantFileHashes?: Record<string, string>
	dependencyFingerprint?: string
	gitHead?: string
	runtimeVersion?: string
	toolVersion?: string
}): JoyRideKeyMaterial {
	return createJoyRideKey("command-result", input)
}

export function createGrepResultCacheKey(input: {
	query: string
	includeGlobs?: string[]
	excludeGlobs?: string[]
	workspaceFingerprint: string
	changedFileGeneration: number
}): JoyRideKeyMaterial {
	return createJoyRideKey("grep-result", input)
}

export function createFileMetadataCacheKey(input: {
	absolutePath: string
	fileHash: string
	mtimeGeneration: number
	workspaceFingerprint: string
}): JoyRideKeyMaterial {
	return createJoyRideKey("file-metadata", input)
}

export function createVerificationCacheKey(input: {
	command: string
	cwd: string
	dependencyFingerprint: string
	lockfileFingerprint: string
	relevantFileHashes: Record<string, string>
	environmentFingerprint: string
	approvalBoundaryId: string
	gitHead: string
	runtimeVersion?: string
	toolVersion?: string
}): JoyRideKeyMaterial {
	return createJoyRideKey("verification", input)
}

export function createDiffCacheKey(input: {
	baseHash: string
	targetHash: string
	filePath: string
	taskId: string
}): JoyRideKeyMaterial {
	return createJoyRideKey("diff", input)
}

export function createScratchArtifactCacheKey(input: {
	taskId: string
	artifactKind: string
	contentHash: string
	generation: number
	cleanupPolicy: string
}): JoyRideKeyMaterial {
	return createJoyRideKey("scratch-artifact", input)
}
