import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface GovernedFileLockRecord {
	ownerId: string
	resourceKey: string
	claimedAt: number
	pid: number
	fencingToken: number
}

const DEFAULT_STALE_MS = 600_000

export function governedLockPath(workspace: string, resourceKey: string): string {
	const lockDir = path.join(workspace, ".broccolidb", "governed", "locks")
	return path.join(lockDir, `${createHash("sha256").update(resourceKey).digest("hex")}.lock`)
}

export async function acquireGovernedFileLock(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: number,
	staleMs = DEFAULT_STALE_MS,
): Promise<{ ok: true } | { ok: false; reason: "collision" | "stale"; error: string }> {
	const lockPath = governedLockPath(workspace, resourceKey)
	await fs.mkdir(path.dirname(lockPath), { recursive: true })

	try {
		const handle = await fs.open(lockPath, "wx")
		const record: GovernedFileLockRecord = {
			ownerId,
			resourceKey,
			claimedAt: Date.now(),
			pid: process.pid,
			fencingToken,
		}
		await handle.writeFile(JSON.stringify(record), "utf8")
		await handle.close()
		return { ok: true }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error
		}

		try {
			const existing = JSON.parse(await fs.readFile(lockPath, "utf8")) as GovernedFileLockRecord
			if (Date.now() - existing.claimedAt > staleMs) {
				await fs.unlink(lockPath)
				return acquireGovernedFileLock(workspace, resourceKey, ownerId, fencingToken, staleMs)
			}
			if (existing.ownerId === ownerId) {
				return { ok: true }
			}
			return {
				ok: false,
				reason: "collision",
				error: `File lock held by '${existing.ownerId}' (pid ${existing.pid}).`,
			}
		} catch {
			return { ok: false, reason: "collision", error: `File lock exists for '${resourceKey}'.` }
		}
	}
}

export async function releaseGovernedFileLock(workspace: string, resourceKey: string, ownerId: string): Promise<void> {
	const lockPath = governedLockPath(workspace, resourceKey)
	try {
		const existing = JSON.parse(await fs.readFile(lockPath, "utf8")) as GovernedFileLockRecord
		if (existing.ownerId === ownerId) {
			await fs.unlink(lockPath)
		}
	} catch {
		// lock already gone
	}
}

export async function recoverStaleGovernedFileLocks(
	workspace: string,
	resourcePrefix?: string,
	staleMs = DEFAULT_STALE_MS,
): Promise<string[]> {
	const lockDir = path.join(workspace, ".broccolidb", "governed", "locks")
	const recovered: string[] = []

	try {
		const entries = await fs.readdir(lockDir)
		const now = Date.now()
		for (const entry of entries) {
			if (!entry.endsWith(".lock")) {
				continue
			}
			const lockPath = path.join(lockDir, entry)
			try {
				const record = JSON.parse(await fs.readFile(lockPath, "utf8")) as GovernedFileLockRecord
				if (resourcePrefix && !record.resourceKey.startsWith(resourcePrefix)) {
					continue
				}
				if (now - record.claimedAt > staleMs) {
					await fs.unlink(lockPath)
					recovered.push(record.resourceKey)
				}
			} catch {
				await fs.unlink(lockPath).catch(() => undefined)
				recovered.push(entry)
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	}

	return recovered
}

export async function verifyGovernedFileLock(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: number,
): Promise<{ valid: boolean; reason?: string }> {
	const lockPath = governedLockPath(workspace, resourceKey)
	try {
		const record = JSON.parse(await fs.readFile(lockPath, "utf8")) as GovernedFileLockRecord
		if (record.ownerId !== ownerId) {
			return { valid: false, reason: "split_brain" }
		}
		if (record.fencingToken !== fencingToken) {
			return { valid: false, reason: "stale" }
		}
		return { valid: true }
	} catch {
		return { valid: false, reason: "orphaned" }
	}
}
