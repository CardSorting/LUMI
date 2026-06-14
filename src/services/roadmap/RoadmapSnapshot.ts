import * as fs from "fs/promises"
import * as path from "path"
import { getRoadmapConfig } from "./RoadmapConfig"
import type { RoadmapValidation } from "./RoadmapSchema"

export type EvidenceTier = "light" | "standard" | "full"

export interface WorkspaceSnapshot {
	workspace: string
	roadmapPath: string
	roadmapMtimeMs: number | null
	tier: EvidenceTier
	evidence: Record<string, unknown>
	validation: RoadmapValidation | null
	gateState: Record<string, unknown>
	cachedAt: number
}

const snapshotCache = new Map<string, WorkspaceSnapshot>()

function cacheKey(workspace: string, tier: EvidenceTier, roadmapMtimeMs: number | null): string {
	return `${path.resolve(workspace)}::${tier}::${roadmapMtimeMs ?? "none"}`
}

async function roadmapMtime(roadmapPath: string): Promise<number | null> {
	try {
		const stat = await fs.stat(roadmapPath)
		return stat.mtimeMs
	} catch {
		return null
	}
}

export async function getCachedSnapshotKey(workspace: string, tier: EvidenceTier): Promise<string> {
	const roadmapPath = path.join(workspace, "ROADMAP.md")
	const mtime = await roadmapMtime(roadmapPath)
	return cacheKey(workspace, tier, mtime)
}

export function getSnapshotFromCache(key: string): WorkspaceSnapshot | undefined {
	const entry = snapshotCache.get(key)
	if (!entry) return undefined
	const ttlMs = getRoadmapConfig().evidence_cache_ttl_seconds * 1000
	if (Date.now() - entry.cachedAt > ttlMs) {
		snapshotCache.delete(key)
		return undefined
	}
	return entry
}

export function setSnapshotCache(key: string, snapshot: WorkspaceSnapshot): void {
	snapshotCache.set(key, snapshot)
}

export function invalidateSnapshotCache(workspace?: string): void {
	if (!workspace) {
		snapshotCache.clear()
		return
	}
	const prefix = `${path.resolve(workspace)}::`
	for (const key of snapshotCache.keys()) {
		if (key.startsWith(prefix)) {
			snapshotCache.delete(key)
		}
	}
}

export async function buildSnapshotKey(
	workspace: string,
	tier: EvidenceTier,
): Promise<{ key: string; roadmapPath: string; mtime: number | null }> {
	const roadmapPath = path.join(workspace, "ROADMAP.md")
	const mtime = await roadmapMtime(roadmapPath)
	return { key: cacheKey(workspace, tier, mtime), roadmapPath, mtime }
}
