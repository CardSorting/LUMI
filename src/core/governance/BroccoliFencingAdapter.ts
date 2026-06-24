import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface BroccoliFenceRecord {
	ownerId: string
	resourceKey: string
	fencingToken: number
	claimedAt: number
	pid: number
}

const STALE_MS = 600_000

function fencePath(workspace: string, resourceKey: string): string {
	const dir = path.join(workspace, ".broccolidb", "governed", "fencing")
	return path.join(dir, `${createHash("sha256").update(resourceKey).digest("hex")}.json`)
}

/** Durable fencing-token store — BroccoliDB MutexService semantics without process coupling. */
export async function acquireBroccoliFence(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const filePath = fencePath(workspace, resourceKey)
	await fs.mkdir(path.dirname(filePath), { recursive: true })

	try {
		const record: BroccoliFenceRecord = {
			ownerId,
			resourceKey,
			fencingToken,
			claimedAt: Date.now(),
			pid: process.pid,
		}
		const handle = await fs.open(filePath, "wx")
		await handle.writeFile(JSON.stringify(record), "utf8")
		await handle.close()
		return { ok: true }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error
		}
		try {
			const existing = JSON.parse(await fs.readFile(filePath, "utf8")) as BroccoliFenceRecord
			if (Date.now() - existing.claimedAt > STALE_MS) {
				await fs.unlink(filePath)
				return acquireBroccoliFence(workspace, resourceKey, ownerId, fencingToken)
			}
			if (existing.ownerId === ownerId && existing.fencingToken === fencingToken) {
				return { ok: true }
			}
			return { ok: false, error: `Broccoli fence held by '${existing.ownerId}' (token ${existing.fencingToken}).` }
		} catch {
			return { ok: false, error: `Broccoli fence ambiguous for '${resourceKey}'.` }
		}
	}
}

export async function releaseBroccoliFence(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const filePath = fencePath(workspace, resourceKey)
	try {
		const existing = JSON.parse(await fs.readFile(filePath, "utf8")) as BroccoliFenceRecord
		if (existing.ownerId !== ownerId) {
			return { ok: false, error: `Release owner mismatch: expected '${existing.ownerId}', got '${ownerId}'.` }
		}
		if (existing.fencingToken !== fencingToken) {
			return { ok: false, error: `Release fencing token mismatch on '${resourceKey}'.` }
		}
		await fs.unlink(filePath)
		return { ok: true }
	} catch {
		return { ok: false, error: `No broccoli fence found for '${resourceKey}'.` }
	}
}

export async function recoverStaleBroccoliFences(workspace: string, resourcePrefix?: string): Promise<string[]> {
	const dir = path.join(workspace, ".broccolidb", "governed", "fencing")
	const recovered: string[] = []
	const now = Date.now()

	try {
		for (const entry of await fs.readdir(dir)) {
			if (!entry.endsWith(".json")) {
				continue
			}
			const filePath = path.join(dir, entry)
			try {
				const record = JSON.parse(await fs.readFile(filePath, "utf8")) as BroccoliFenceRecord
				if (resourcePrefix && !record.resourceKey.startsWith(resourcePrefix)) {
					continue
				}
				if (now - record.claimedAt > STALE_MS) {
					await fs.unlink(filePath)
					recovered.push(record.resourceKey)
				}
			} catch {
				await fs.unlink(filePath).catch(() => undefined)
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

export async function verifyBroccoliFence(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: number,
): Promise<{ valid: boolean; reason?: string }> {
	const filePath = fencePath(workspace, resourceKey)
	try {
		const existing = JSON.parse(await fs.readFile(filePath, "utf8")) as BroccoliFenceRecord
		if (existing.ownerId !== ownerId || existing.fencingToken !== fencingToken) {
			return { valid: false, reason: "split_brain" }
		}
		return { valid: true }
	} catch {
		return { valid: false, reason: "orphaned" }
	}
}
