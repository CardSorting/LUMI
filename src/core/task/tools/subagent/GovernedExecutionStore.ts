import * as fs from "node:fs/promises"
import * as path from "node:path"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { Logger } from "@shared/services/Logger"
import { SUBAGENT_EXECUTIONS_DIR } from "@shared/subagent/executionEnvelope"
import type { GovernedRetryHistoryEntry, GovernedSwarmReceipt } from "@shared/subagent/governedExecution"
import { GOVERNED_RECEIPT_SCHEMA_VERSION } from "@shared/subagent/governedExecution"

export interface GovernedReceiptValidation {
	valid: boolean
	corrupted: boolean
	violations: string[]
}

export function buildGovernedArtifactRelativePath(swarmId: string, attemptId?: string): string {
	if (attemptId) {
		return `${SUBAGENT_EXECUTIONS_DIR}/${swarmId}.governed.${attemptId}.json`
	}
	return `${SUBAGENT_EXECUTIONS_DIR}/${swarmId}.governed.json`
}

export function validateGovernedReceipt(raw: unknown): GovernedReceiptValidation {
	const violations: string[] = []
	if (!raw || typeof raw !== "object") {
		return { valid: false, corrupted: true, violations: ["receipt is not an object"] }
	}
	const receipt = raw as Partial<GovernedSwarmReceipt>
	if (receipt.schemaVersion !== GOVERNED_RECEIPT_SCHEMA_VERSION) {
		violations.push(`schema version mismatch: expected ${GOVERNED_RECEIPT_SCHEMA_VERSION}`)
	}
	if (!receipt.swarmId || !receipt.taskId || !receipt.attemptId) {
		violations.push("missing swarmId, taskId, or attemptId")
	}
	if (!Array.isArray(receipt.laneReceipts)) {
		violations.push("laneReceipts is not an array")
	}
	if (!receipt.mergeGate || typeof receipt.mergeGate.passed !== "boolean") {
		violations.push("mergeGate missing or invalid")
	}
	return { valid: violations.length === 0, corrupted: violations.length > 0, violations }
}

function shouldUpdateLatestPointer(existing: GovernedSwarmReceipt | null, incoming: GovernedSwarmReceipt): boolean {
	if (!existing) {
		return true
	}
	if (existing.sealed && existing.mergeGate.passed && !incoming.sealed) {
		return false
	}
	return true
}

export async function persistGovernedReceipt(
	taskId: string,
	receipt: GovernedSwarmReceipt,
	options?: { existingLatest?: GovernedSwarmReceipt | null },
): Promise<string> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const executionsDir = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR)
	await fs.mkdir(executionsDir, { recursive: true })

	const attemptPath = path.join(executionsDir, `${receipt.swarmId}.governed.${receipt.attemptId}.json`)
	const latestPath = path.join(executionsDir, `${receipt.swarmId}.governed.json`)

	const payload: GovernedSwarmReceipt = {
		...receipt,
		schemaVersion: GOVERNED_RECEIPT_SCHEMA_VERSION,
		governedArtifactPath: buildGovernedArtifactRelativePath(receipt.swarmId, receipt.attemptId),
	}

	const validation = validateGovernedReceipt(payload)
	if (!validation.valid) {
		throw new Error(`Refusing to persist corrupted governed receipt: ${validation.violations.join("; ")}`)
	}

	try {
		await fs.writeFile(attemptPath, JSON.stringify(payload, null, 2), "utf8")
		const existingLatest =
			options?.existingLatest !== undefined ? options.existingLatest : await loadGovernedReceipt(taskId, receipt.swarmId)
		if (shouldUpdateLatestPointer(existingLatest, payload)) {
			await fs.writeFile(latestPath, JSON.stringify(payload, null, 2), "utf8")
		}
		await appendReceiptHistory(taskId, receipt)
		return payload.governedArtifactPath
	} catch (error) {
		Logger.error("[GovernedExecutionStore] Failed to persist governed receipt:", error)
		throw error
	}
}

async function appendReceiptHistory(taskId: string, receipt: GovernedSwarmReceipt): Promise<void> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const historyPath = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR, `${receipt.swarmId}.governed.history.jsonl`)
	const existing = await listGovernedReceiptHistory(taskId, receipt.swarmId)
	if (existing.some((entry) => entry.attemptId === receipt.attemptId)) {
		return
	}
	const entry = JSON.stringify({
		attemptId: receipt.attemptId,
		artifactPath: receipt.governedArtifactPath,
		sealedAt: Date.now(),
		sealed: receipt.sealed,
		mergePassed: receipt.mergeGate.passed,
		parentAttemptId: receipt.parentAttemptId,
		retryReason: receipt.retryReason,
	})
	await fs.appendFile(historyPath, `${entry}\n`, "utf8")
}

export async function listGovernedReceiptHistory(taskId: string, swarmId: string): Promise<GovernedRetryHistoryEntry[]> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const historyPath = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR, `${swarmId}.governed.history.jsonl`)

	try {
		const raw = await fs.readFile(historyPath, "utf8")
		return raw
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as GovernedRetryHistoryEntry & { sealedAt: number })
			.map((entry) => ({
				attemptId: entry.attemptId,
				parentAttemptId: entry.parentAttemptId,
				sealed: entry.sealed ?? false,
				mergePassed: entry.mergePassed ?? false,
				timestamp: entry.timestamp ?? entry.sealedAt,
				retryReason: entry.retryReason,
			}))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return []
		}
		throw error
	}
}

export async function loadAuthoritativeGovernedReceipt(taskId: string, swarmId: string): Promise<GovernedSwarmReceipt | null> {
	const ctx = await loadSealReceiptContext(taskId, swarmId)
	return ctx.authoritative ?? ctx.latestPointer
}

export interface SealReceiptContext {
	history: GovernedRetryHistoryEntry[]
	latestPointer: GovernedSwarmReceipt | null
	authoritative: GovernedSwarmReceipt | null
}

/** Single history read + parallel receipt loads — avoids duplicate filesystem scans at seal. */
export async function loadSealReceiptContext(taskId: string, swarmId: string): Promise<SealReceiptContext> {
	const history = await listGovernedReceiptHistory(taskId, swarmId)
	const authoritativeEntry = [...history].reverse().find((entry) => entry.sealed && entry.mergePassed)

	const latestPromise = loadGovernedReceipt(taskId, swarmId)
	const authoritativePromise = authoritativeEntry
		? loadGovernedReceiptAttempt(taskId, swarmId, authoritativeEntry.attemptId)
		: Promise.resolve(null)

	const [latestPointer, authoritativeFromHistory] = await Promise.all([latestPromise, authoritativePromise])
	const authoritative =
		authoritativeFromHistory ?? (latestPointer?.sealed && latestPointer.mergeGate.passed ? latestPointer : null)

	return { history, latestPointer, authoritative }
}

export async function loadGovernedReceipt(taskId: string, swarmId: string): Promise<GovernedSwarmReceipt | null> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const filePath = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR, `${swarmId}.governed.json`)

	try {
		const raw = await fs.readFile(filePath, "utf8")
		const parsed = JSON.parse(raw) as GovernedSwarmReceipt
		const validation = validateGovernedReceipt(parsed)
		if (!validation.valid) {
			Logger.warn("[GovernedExecutionStore] Latest governed receipt failed validation:", validation.violations)
		}
		return parsed
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null
		}
		Logger.error("[GovernedExecutionStore] Failed to load governed receipt:", error)
		throw error
	}
}

export async function loadGovernedReceiptAttempt(
	taskId: string,
	swarmId: string,
	attemptId: string,
): Promise<GovernedSwarmReceipt | null> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const filePath = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR, `${swarmId}.governed.${attemptId}.json`)

	try {
		const raw = await fs.readFile(filePath, "utf8")
		return JSON.parse(raw) as GovernedSwarmReceipt
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null
		}
		throw error
	}
}

export async function listGovernedReceiptAttempts(taskId: string, swarmId: string): Promise<string[]> {
	const history = await listGovernedReceiptHistory(taskId, swarmId)
	return history.map((entry) => entry.attemptId)
}
