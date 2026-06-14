import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { formatWatchSteeringLine } from "./RoadmapAgentSteering"
import { getRoadmapConfig } from "./RoadmapConfig"

const MAX_LOG_BYTES = 1024 * 1024
const MAX_LOG_LINES = 2000

function sessionDir(): string {
	const raw = process.env.DIETCODE_SESSION_DIR?.trim()
	return raw ? path.resolve(raw) : path.join(os.homedir(), ".dietcode", "session")
}

export function progressJsonlPath(): string {
	return path.join(sessionDir(), "roadmap-progress.jsonl")
}

export function progressCurrentPath(): string {
	return path.join(sessionDir(), "roadmap-progress-current.json")
}

export function lastErrorPath(): string {
	return path.join(sessionDir(), "roadmap-last-error.json")
}

async function trimJsonl(filePath: string): Promise<void> {
	try {
		const stat = await fs.stat(filePath)
		if (stat.size <= MAX_LOG_BYTES) return
		const text = await fs.readFile(filePath, "utf8")
		const lines = text.split(/\r?\n/).filter(Boolean)
		if (lines.length <= MAX_LOG_LINES) return
		await fs.writeFile(filePath, `${lines.slice(-MAX_LOG_LINES).join("\n")}\n`, "utf8")
	} catch {
		// non-fatal
	}
}

export async function emitProgress(
	phase: string,
	params: {
		action?: string
		workspace?: string
		payload?: Record<string, unknown>
		success?: boolean
	},
): Promise<Record<string, unknown>> {
	const cfg = getRoadmapConfig()
	if (!cfg.progress_enabled) {
		return {}
	}

	const event = {
		event_id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		ts_iso: new Date().toISOString(),
		phase,
		action: params.action || null,
		workspace: params.workspace || null,
		success: params.success ?? true,
		payload: params.payload || {},
	}

	const line = JSON.stringify(event)
	const jsonl = progressJsonlPath()
	const current = progressCurrentPath()

	await fs.mkdir(path.dirname(jsonl), { recursive: true })
	await fs.appendFile(jsonl, `${line}\n`, "utf8")
	await trimJsonl(jsonl)
	await fs.writeFile(current, JSON.stringify(event, null, 2), "utf8")
	return event
}

export async function readCurrentProgress(): Promise<Record<string, unknown> | null> {
	try {
		const text = await fs.readFile(progressCurrentPath(), "utf8")
		return JSON.parse(text)
	} catch {
		return null
	}
}

export async function readProgressTail(limit = 20): Promise<Record<string, unknown>[]> {
	try {
		const text = await fs.readFile(progressJsonlPath(), "utf8")
		const lines = text.split(/\r?\n/).filter(Boolean)
		return lines.slice(-limit).map((line) => JSON.parse(line))
	} catch {
		return []
	}
}

export async function recordLastError(error: Record<string, unknown>): Promise<void> {
	try {
		await fs.mkdir(sessionDir(), { recursive: true })
		await fs.writeFile(lastErrorPath(), JSON.stringify({ ...error, recorded_at: new Date().toISOString() }, null, 2), "utf8")
	} catch {
		// non-fatal
	}
}

export async function readLastError(): Promise<Record<string, unknown> | null> {
	try {
		const text = await fs.readFile(lastErrorPath(), "utf8")
		return JSON.parse(text)
	} catch {
		return null
	}
}

export async function clearLastError(): Promise<void> {
	try {
		await fs.unlink(lastErrorPath())
	} catch {
		// non-fatal
	}
}

export function formatWatchReport(
	current: Record<string, unknown> | null,
	lastError: Record<string, unknown> | null,
	brief?: Record<string, unknown> | null,
): string {
	if (lastError) {
		return `Roadmap last error: ${lastError.message || lastError.error} → ${lastError.retry_command || "roadmap(action='guide')"}`
	}
	if (brief) {
		return formatWatchSteeringLine(brief)
	}
	if (!current) {
		return "Roadmap: no recent activity — roadmap(action='guide')"
	}
	const action = current.action || "unknown"
	const phase = current.phase || "unknown"
	const ws = current.workspace || "(workspace)"
	const payload = (current.payload || {}) as Record<string, unknown>
	const identity = payload.project_identity_line ? ` · ${payload.project_identity_line}` : ""
	return `Roadmap watch: ${action} @ ${phase} (${ws})${identity} — ${current.success === false ? "failed" : "ok"}`
}
