import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { Logger } from "@shared/services/Logger"
import { buildTranscriptArtifactPath } from "@shared/subagent/executionEnvelope"
import {
	computeTranscriptLineChecksum,
	type SubagentTranscriptEvent,
	type SubagentTranscriptEventKind,
	type SubagentTranscriptMeta,
	TRANSCRIPT_MAX_BYTES,
	TRANSCRIPT_MAX_EVENTS,
	TRANSCRIPT_SCHEMA_VERSION,
	type TranscriptContentKind,
} from "@shared/subagent/transcript"

export interface TranscriptRecorderContext {
	swarmId: string
	agentId: string
	taskId: string
	executionId: string
}

export class SubagentTranscriptRecorder {
	private sequence = 0
	private byteSize = 0
	private eventCount = 0
	private readonly events: SubagentTranscriptEvent[] = []
	private filePath?: string
	private flushedLines = 0

	constructor(private readonly context: TranscriptRecorderContext) {}

	async init(): Promise<string> {
		const taskDir = await ensureTaskDirectoryExists(this.context.taskId)
		const relativePath = buildTranscriptArtifactPath(this.context.swarmId, this.context.agentId)
		this.filePath = path.join(taskDir, relativePath)
		await fs.mkdir(path.dirname(this.filePath), { recursive: true })
		return relativePath
	}

	getMeta(relativePath: string): SubagentTranscriptMeta {
		return {
			swarmId: this.context.swarmId,
			agentId: this.context.agentId,
			taskId: this.context.taskId,
			executionId: this.context.executionId,
			eventCount: this.eventCount,
			byteSize: this.byteSize,
			lineChecksum: this.computeFileChecksum(),
			artifactPath: relativePath,
			schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
		}
	}

	append(
		kind: SubagentTranscriptEventKind,
		payload: Record<string, unknown>,
		contentKind: TranscriptContentKind = "raw",
	): SubagentTranscriptEvent {
		if (this.eventCount >= TRANSCRIPT_MAX_EVENTS) {
			throw new Error(`Transcript event limit exceeded (${TRANSCRIPT_MAX_EVENTS})`)
		}

		const event: SubagentTranscriptEvent = {
			id: `${this.context.executionId}_${this.sequence}`,
			sequence: this.sequence,
			timestamp: Date.now(),
			kind,
			contentKind,
			swarmId: this.context.swarmId,
			agentId: this.context.agentId,
			taskId: this.context.taskId,
			executionId: this.context.executionId,
			payload,
			checksum: "",
		}
		const serialized = JSON.stringify(event)
		event.checksum = computeTranscriptLineChecksum(serialized)

		const nextByteSize = this.byteSize + Buffer.byteLength(JSON.stringify(event), "utf8")
		if (nextByteSize > TRANSCRIPT_MAX_BYTES) {
			throw new Error(`Transcript byte limit exceeded (${TRANSCRIPT_MAX_BYTES})`)
		}

		this.sequence += 1
		this.eventCount += 1
		this.byteSize = nextByteSize
		this.events.push(event)
		return event
	}

	async flush(): Promise<void> {
		if (!this.filePath) {
			throw new Error("Transcript recorder not initialized")
		}

		const pending = this.events.slice(this.flushedLines)
		if (pending.length === 0) {
			return
		}

		const lines = pending.map((event) => `${JSON.stringify(event)}\n`).join("")
		await fs.appendFile(this.filePath, lines, "utf8")
		this.flushedLines = this.events.length
	}

	getEvents(): SubagentTranscriptEvent[] {
		return [...this.events]
	}

	getLastSequence(): number {
		return this.sequence > 0 ? this.sequence - 1 : -1
	}

	private computeFileChecksum(): string {
		const body = this.events.map((event) => JSON.stringify(event)).join("\n")
		return createHash("sha256").update(body).digest("hex").slice(0, 16)
	}
}

export async function loadTranscriptEvents(
	taskId: string,
	swarmId: string,
	agentId: string,
): Promise<{ events: SubagentTranscriptEvent[]; meta?: SubagentTranscriptMeta; corruption?: string }> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const relativePath = buildTranscriptArtifactPath(swarmId, agentId)
	const filePath = path.join(taskDir, relativePath)

	try {
		const raw = await fs.readFile(filePath, "utf8")
		const lines = raw.split("\n").filter((line) => line.trim().length > 0)
		const events: SubagentTranscriptEvent[] = []
		let byteSize = 0

		for (const [index, line] of lines.entries()) {
			let parsed: SubagentTranscriptEvent
			try {
				parsed = JSON.parse(line) as SubagentTranscriptEvent
			} catch {
				return { events: [], corruption: `invalid json at line ${index + 1}` }
			}

			const withoutChecksum = { ...parsed, checksum: "" }
			const expected = computeTranscriptLineChecksum(JSON.stringify(withoutChecksum))
			if (parsed.checksum !== expected) {
				return { events: [], corruption: `checksum mismatch at line ${index + 1}` }
			}

			byteSize += Buffer.byteLength(line, "utf8")
			events.push(parsed)
		}

		const meta: SubagentTranscriptMeta = {
			swarmId,
			agentId,
			taskId,
			executionId: events[0]?.executionId || "",
			eventCount: events.length,
			byteSize,
			lineChecksum: createHash("sha256").update(raw).digest("hex").slice(0, 16),
			artifactPath: relativePath,
			schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
		}

		return { events, meta }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { events: [] }
		}
		Logger.error("[SubagentTranscriptRecorder] Failed to load transcript:", error)
		throw error
	}
}
