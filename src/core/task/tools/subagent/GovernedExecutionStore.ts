import * as fs from "node:fs/promises"
import * as path from "node:path"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { Logger } from "@shared/services/Logger"
import { SUBAGENT_EXECUTIONS_DIR } from "@shared/subagent/executionEnvelope"
import type { GovernedRetryHistoryEntry, GovernedSwarmReceipt } from "@shared/subagent/governedExecution"
import { GOVERNED_RECEIPT_SCHEMA_VERSION } from "@shared/subagent/governedExecution"

export function buildGovernedArtifactRelativePath(swarmId: string, attemptId?: string): string {
	if (attemptId) {
		return `${SUBAGENT_EXECUTIONS_DIR}/${swarmId}.governed.${attemptId}.json`
	}
	return `${SUBAGENT_EXECUTIONS_DIR}/${swarmId}.governed.json`
}

export async function persistGovernedReceipt(taskId: string, receipt: GovernedSwarmReceipt): Promise<string> {
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

	try {
		await fs.writeFile(attemptPath, JSON.stringify(payload, null, 2), "utf8")
		await fs.writeFile(latestPath, JSON.stringify(payload, null, 2), "utf8")
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
	const entry = JSON.stringify({
		attemptId: receipt.attemptId,
		artifactPath: receipt.governedArtifactPath,
		sealedAt: Date.now(),
		sealed: receipt.sealed,
		mergePassed: receipt.mergeGate.passed,
		parentAttemptId: receipt.parentAttemptId,
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
			}))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return []
		}
		throw error
	}
}

export async function loadGovernedReceipt(taskId: string, swarmId: string): Promise<GovernedSwarmReceipt | null> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const filePath = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR, `${swarmId}.governed.json`)

	try {
		const raw = await fs.readFile(filePath, "utf8")
		return JSON.parse(raw) as GovernedSwarmReceipt
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
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const historyPath = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR, `${swarmId}.governed.history.jsonl`)

	try {
		const raw = await fs.readFile(historyPath, "utf8")
		return raw
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { attemptId: string })
			.map((entry) => entry.attemptId)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return []
		}
		throw error
	}
}
