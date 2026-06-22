import * as fs from "node:fs/promises"
import * as path from "node:path"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { Logger } from "@shared/services/Logger"
import type { SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { SUBAGENT_EXECUTIONS_DIR, SWARM_ENVELOPE_SCHEMA_VERSION } from "@shared/subagent/executionEnvelope"
import { validateSwarmEnvelope } from "./executionValidation"
import { computeSwarmArtifactChecksum } from "./ResumeSwarmFromArtifact"

async function getExecutionsDir(taskId: string): Promise<string> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const executionsDir = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR)
	await fs.mkdir(executionsDir, { recursive: true })
	return executionsDir
}

export async function persistSwarmEnvelope(taskId: string, envelope: SwarmExecutionEnvelope): Promise<string> {
	const executionsDir = await getExecutionsDir(taskId)
	const filePath = path.join(executionsDir, `${envelope.swarmId}.json`)
	const invariants = validateSwarmEnvelope(envelope)
	const payload: SwarmExecutionEnvelope = {
		...envelope,
		schemaVersion: SWARM_ENVELOPE_SCHEMA_VERSION,
		invariants,
		artifactPath: path.relative(await ensureTaskDirectoryExists(taskId), filePath),
	}
	payload.checksum = computeSwarmArtifactChecksum(payload)

	try {
		await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8")
		return payload.artifactPath
	} catch (error) {
		Logger.error("[SubagentExecutionStore] Failed to persist swarm envelope:", error)
		throw error
	}
}

export async function loadSwarmEnvelope(taskId: string, swarmId: string): Promise<SwarmExecutionEnvelope | null> {
	const executionsDir = await getExecutionsDir(taskId)
	const filePath = path.join(executionsDir, `${swarmId}.json`)

	try {
		const raw = await fs.readFile(filePath, "utf8")
		return JSON.parse(raw) as SwarmExecutionEnvelope
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null
		}
		Logger.error("[SubagentExecutionStore] Failed to load swarm envelope:", error)
		throw error
	}
}

export async function listSwarmEnvelopeIds(taskId: string): Promise<string[]> {
	const executionsDir = await getExecutionsDir(taskId)

	try {
		const entries = await fs.readdir(executionsDir)
		return entries.filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return []
		}
		Logger.error("[SubagentExecutionStore] Failed to list swarm envelopes:", error)
		throw error
	}
}

export async function reconstructSwarmFromArtifact(taskId: string, swarmId: string): Promise<SwarmExecutionEnvelope> {
	const envelope = await loadSwarmEnvelope(taskId, swarmId)
	if (!envelope) {
		throw new Error(`Swarm execution artifact not found: ${swarmId}`)
	}
	return envelope
}
