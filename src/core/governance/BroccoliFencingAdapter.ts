import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { CoordinationAuthorityMode } from "@shared/governance/lockTypes"

export interface BroccoliFenceRecord {
	ownerId: string
	resourceKey: string
	fencingToken: string
	leaseEpoch: string
	claimedAt: number
	pid: number
	workspaceId: string
	swarmId: string
	laneId?: string
	expiresAt: number
	authorityMode: CoordinationAuthorityMode
}

const STALE_MS = 600_000

export function broccoliFencePath(workspace: string, resourceKey: string): string {
	const dir = path.join(workspace, ".broccolidb", "governed", "fencing")
	return path.join(dir, `${createHash("sha256").update(resourceKey).digest("hex")}.json`)
}

export type BroccoliFenceReadResult =
	| { status: "present"; path: string; record: BroccoliFenceRecord }
	| { status: "missing"; path: string }
	| { status: "corrupt"; path: string; reason: string }

export async function readBroccoliFence(workspace: string, resourceKey: string): Promise<BroccoliFenceReadResult> {
	const filePath = broccoliFencePath(workspace, resourceKey)
	let raw: string
	try {
		raw = await fs.readFile(filePath, "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", path: filePath }
		return { status: "corrupt", path: filePath, reason: `read_failed:${String(error)}` }
	}
	let record: Partial<BroccoliFenceRecord>
	try {
		record = JSON.parse(raw) as Partial<BroccoliFenceRecord>
	} catch {
		return { status: "corrupt", path: filePath, reason: "invalid_json" }
	}
	if (
		typeof record.ownerId !== "string" ||
		record.resourceKey !== resourceKey ||
		typeof record.fencingToken !== "string" ||
		!/^\d+$/.test(record.fencingToken) ||
		typeof record.leaseEpoch !== "string" ||
		!/^\d+$/.test(record.leaseEpoch) ||
		!Number.isFinite(record.claimedAt) ||
		!Number.isFinite(record.expiresAt) ||
		(record.expiresAt as number) < (record.claimedAt as number) ||
		(record.authorityMode !== "sqlite" && record.authorityMode !== "local_test")
	) {
		return { status: "corrupt", path: filePath, reason: "invalid_record" }
	}
	return { status: "present", path: filePath, record: record as BroccoliFenceRecord }
}

/** Durable fencing-token store — BroccoliDB MutexService semantics without process coupling. */
export async function acquireBroccoliFence(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: string | number,
	leaseEpoch: string | number = "1",
	swarmId = "default",
	laneId?: string,
	authorityMode: CoordinationAuthorityMode = "sqlite",
): Promise<{ ok: true } | { ok: false; error: string }> {
	const filePath = broccoliFencePath(workspace, resourceKey)
	await fs.mkdir(path.dirname(filePath), { recursive: true })

	const claimedAt = Date.now()
	const tokenStr = String(fencingToken)
	const epochStr = String(leaseEpoch)
	try {
		const record: BroccoliFenceRecord = {
			ownerId,
			resourceKey,
			fencingToken: tokenStr,
			leaseEpoch: epochStr,
			claimedAt,
			pid: process.pid,
			workspaceId: workspace,
			swarmId,
			laneId,
			expiresAt: claimedAt + STALE_MS,
			authorityMode,
		}
		const handle = await fs.open(filePath, "wx")
		await handle.writeFile(JSON.stringify(record), "utf8")
		await handle.close()
		return { ok: true }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error
		}
		const existing = await readBroccoliFence(workspace, resourceKey)
		if (existing.status !== "present") {
			return { ok: false, error: `Broccoli fence ${existing.status} for '${resourceKey}'.` }
		}
		if (existing.record.authorityMode !== authorityMode) {
			return { ok: false, error: `Broccoli authority mode mismatch for '${resourceKey}'.` }
		}
		if (Date.now() > existing.record.expiresAt) {
			const released = await releaseBroccoliFence(
				workspace,
				resourceKey,
				existing.record.ownerId,
				existing.record.fencingToken,
				existing.record.leaseEpoch,
				existing.record.authorityMode,
			)
			if (!released.ok) return released
			return acquireBroccoliFence(workspace, resourceKey, ownerId, fencingToken, leaseEpoch, swarmId, laneId, authorityMode)
		}
		if (
			existing.record.ownerId === ownerId &&
			existing.record.fencingToken === tokenStr &&
			existing.record.leaseEpoch === epochStr
		)
			return { ok: true }
		return {
			ok: false,
			error: `Broccoli fence held by '${existing.record.ownerId}' (token ${existing.record.fencingToken}, epoch ${existing.record.leaseEpoch}).`,
		}
	}
}

export async function releaseBroccoliFence(
	workspace: string,
	resourceKey: string,
	ownerId: string,
	fencingToken: string,
	leaseEpoch?: string,
	authorityMode?: CoordinationAuthorityMode,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const existing = await readBroccoliFence(workspace, resourceKey)
	if (existing.status !== "present") return { ok: false, error: `Broccoli fence ${existing.status} for '${resourceKey}'.` }
	try {
		if (existing.record.ownerId !== ownerId) {
			return { ok: false, error: `Release owner mismatch: expected '${existing.record.ownerId}', got '${ownerId}'.` }
		}
		if (existing.record.fencingToken !== fencingToken) {
			return { ok: false, error: `Release fencing token mismatch on '${resourceKey}'.` }
		}
		if (leaseEpoch !== undefined && existing.record.leaseEpoch !== leaseEpoch) {
			return { ok: false, error: `Release lease epoch mismatch on '${resourceKey}'.` }
		}
		if (authorityMode !== undefined && existing.record.authorityMode !== authorityMode) {
			return { ok: false, error: `Release authority mode mismatch on '${resourceKey}'.` }
		}
		await fs.unlink(existing.path)
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
				const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<BroccoliFenceRecord>
				if (
					typeof parsed.resourceKey !== "string" ||
					typeof parsed.ownerId !== "string" ||
					typeof parsed.fencingToken !== "string" ||
					typeof parsed.leaseEpoch !== "string" ||
					!Number.isFinite(parsed.expiresAt) ||
					(parsed.authorityMode !== "sqlite" && parsed.authorityMode !== "local_test")
				)
					continue
				const record = parsed as BroccoliFenceRecord
				if (resourcePrefix && !record.resourceKey.startsWith(resourcePrefix)) {
					continue
				}
				if (now > record.expiresAt) {
					await fs.unlink(filePath)
					recovered.push(record.resourceKey)
				}
			} catch {}
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
	fencingToken: string,
	leaseEpoch?: string,
	authorityMode: CoordinationAuthorityMode = "sqlite",
): Promise<{ valid: boolean; reason?: string }> {
	const existing = await readBroccoliFence(workspace, resourceKey)
	if (existing.status !== "present") return { valid: false, reason: existing.status }
	try {
		if (existing.record.authorityMode !== authorityMode) return { valid: false, reason: "authority_mode_mismatch" }
		if (existing.record.ownerId !== ownerId || existing.record.fencingToken !== fencingToken) {
			return { valid: false, reason: "split_brain" }
		}
		if (leaseEpoch !== undefined && existing.record.leaseEpoch !== leaseEpoch) {
			return { valid: false, reason: "split_brain" }
		}
		return { valid: true }
	} catch {
		return { valid: false, reason: "orphaned" }
	}
}
