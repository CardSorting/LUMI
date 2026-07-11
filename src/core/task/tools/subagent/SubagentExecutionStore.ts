import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { Logger } from "@shared/services/Logger"
import type { SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { SUBAGENT_EXECUTIONS_DIR, SWARM_ENVELOPE_SCHEMA_VERSION } from "@shared/subagent/executionEnvelope"
import type { GovernedExecutionPathMetrics } from "@shared/subagent/governedExecution"
import { reuseSwarmValidationSnapshot, type SwarmValidationSnapshot, validateSwarmEnvelope } from "./executionValidation"
import { computeSwarmArtifactChecksum } from "./ResumeSwarmFromArtifact"

const artifactWriteQueues = new Map<string, Promise<void>>()

async function atomicReplace(filePath: string, contents: string): Promise<void> {
	const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
	try {
		await fs.writeFile(tempPath, contents, { encoding: "utf8", flag: "wx" })
		await fs.rename(tempPath, filePath)
	} catch (error) {
		await fs.unlink(tempPath).catch(() => undefined)
		throw error
	}
}

/** Preserve invocation order for one swarm while allowing different swarms to persist concurrently. */
async function persistInOrder(queueKey: string, operation: () => Promise<void>): Promise<void> {
	const predecessor = artifactWriteQueues.get(queueKey) ?? Promise.resolve()
	const write = predecessor.catch(() => undefined).then(operation)
	artifactWriteQueues.set(queueKey, write)
	try {
		await write
	} finally {
		if (artifactWriteQueues.get(queueKey) === write) {
			artifactWriteQueues.delete(queueKey)
		}
	}
}

async function getExecutionsDir(taskId: string): Promise<string> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const executionsDir = path.join(taskDir, SUBAGENT_EXECUTIONS_DIR)
	await fs.mkdir(executionsDir, { recursive: true })
	return executionsDir
}

export async function persistSwarmEnvelope(
	taskId: string,
	envelope: SwarmExecutionEnvelope,
	options?: { validationSnapshot?: SwarmValidationSnapshot; metrics?: GovernedExecutionPathMetrics },
): Promise<string> {
	const queueKey = `${taskId}\0${envelope.swarmId}`
	const artifactPath = path.join(SUBAGENT_EXECUTIONS_DIR, `${envelope.swarmId}.json`)
	const basePayload: SwarmExecutionEnvelope = {
		...envelope,
		schemaVersion: SWARM_ENVELOPE_SCHEMA_VERSION,
		artifactPath,
	}
	const executionChecksum = computeSwarmArtifactChecksum(basePayload)
	const validation =
		reuseSwarmValidationSnapshot(options?.validationSnapshot, executionChecksum, options?.metrics) ??
		validateSwarmEnvelope(basePayload)
	if (!options?.validationSnapshot || options.validationSnapshot.executionChecksum !== executionChecksum) {
		if (options?.metrics) {
			options.metrics.envelopeValidationCalls++
		}
	}
	const declaredViolations = envelope.invariants?.violations ?? []
	const payload: SwarmExecutionEnvelope = {
		...basePayload,
		invariants: {
			validated: validation.validated && declaredViolations.length === 0,
			violations: [...new Set([...declaredViolations, ...validation.violations])],
			advisoryWarnings: [
				...new Set([...(envelope.invariants?.advisoryWarnings ?? []), ...(validation.advisoryWarnings ?? [])]),
			],
		},
		checksum: executionChecksum,
	}
	const serialized = JSON.stringify(payload, null, 2)

	try {
		await persistInOrder(queueKey, async () => {
			const executionsDir = await getExecutionsDir(taskId)
			const filePath = path.join(executionsDir, `${envelope.swarmId}.json`)
			await atomicReplace(filePath, serialized)
			if (options?.metrics) {
				options.metrics.envelopePersistenceWrites++
			}
		})
		return artifactPath
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
