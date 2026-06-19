import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { formatWatchSteeringLine } from "./RoadmapAgentSteering"
import { AUTO_GOVERNANCE } from "./RoadmapAutoGovernance"
import { getRoadmapConfig } from "./RoadmapConfig"
import { recommendNextAction } from "./RoadmapOperator"

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
		return scanProgressTailForLastError()
	}
}

const ERROR_RECOVERY: Record<string, Record<string, string>> = {
	"validate.failed": {
		operator_action: "Repair ROADMAP.md schema — validation runs automatically at attempt_completion",
		retry_command: "roadmap(action='cockpit')",
		diagnostic_command: "/roadmap explain-gate",
		suggested_slash_command: "/roadmap explain-gate",
	},
	"roadmap.file_mutated": {
		operator_action: AUTO_GOVERNANCE.writeMutationFollowup,
		retry_command: "continue task",
		diagnostic_command: "/roadmap explain-gate",
		suggested_slash_command: "/roadmap cockpit",
	},
	"tool.error": {
		operator_action: "roadmap(action='guide') or /roadmap doctor",
		retry_command: "roadmap(action='guide')",
		diagnostic_command: "/roadmap doctor",
		suggested_slash_command: "/roadmap cockpit",
	},
}

function enrichProgressError(event: Record<string, unknown>, code: string): Record<string, unknown> {
	const recovery = ERROR_RECOVERY[code] || ERROR_RECOVERY["tool.error"]
	const payload = (event.payload || {}) as Record<string, unknown>
	return {
		phase: event.phase,
		action: event.action,
		workspace: event.workspace,
		payload,
		ts_iso: event.ts_iso,
		string_code: code,
		safe_to_retry: true,
		...recovery,
		validation: payload.validation,
		error: payload.error,
		message: payload.error || recovery.operator_action,
	}
}

export async function scanProgressTailForLastError(): Promise<Record<string, unknown> | null> {
	const events = await readProgressTail(100)
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i]
		const validation = ((event.payload as Record<string, unknown>) || {}).validation as Record<string, unknown> | undefined
		if (validation?.valid === false) {
			return enrichProgressError(event, "validate.failed")
		}
		if (event.phase === "roadmap.file_mutated") {
			return enrichProgressError(event, "roadmap.file_mutated")
		}
		if (event.success === false) {
			const payload = (event.payload || {}) as Record<string, unknown>
			const code = payload.error ? String(payload.error) : "tool.error"
			return enrichProgressError(event, code in ERROR_RECOVERY ? code : "tool.error")
		}
	}
	return null
}

export function summarizeRecentEvents(events: Record<string, unknown>[], last = 5): Record<string, unknown>[] {
	return events.slice(-last).map((event) => ({
		ts_iso: event.ts_iso,
		phase: event.phase,
		action: event.action,
		success: event.success,
		workspace: event.workspace,
	}))
}

export async function formatProgressReport(params: {
	workspace: string
	timeline?: boolean
	tail?: boolean
	currentSnapshot?: boolean
	last?: number
	snapshot?: Record<string, unknown>
}): Promise<string> {
	const last = params.last ?? 5

	if (params.currentSnapshot && params.snapshot) {
		return JSON.stringify(params.snapshot, null, 2)
	}

	if (params.tail) {
		return JSON.stringify(await readProgressTail(last), null, 2)
	}

	const current = await readCurrentProgress()
	const snap = params.snapshot || {}
	if (!current) {
		const nextRec = (snap.recommended_next_action || {}) as Record<string, unknown>
		const brief = snap.steering_brief || snap.steering_identity || snap.project_identity_line
		const lines = ["🗺️ Roadmap progress: idle (no roadmap tool activity this session)"]
		if (brief) lines.push(`Project: ${brief}`)
		if (nextRec.command) lines.push(`Next: ${nextRec.command}`)
		const digest = (snap.project_steering_digest || {}) as Record<string, unknown>
		const remaining = digest.bootstrap_remaining
		if (remaining && Number(remaining) > 0) {
			lines.push(`Bootstrap fill: ${remaining} phrase(s) — ${AUTO_GOVERNANCE.bootstrapAtCompletion}`)
		}
		return lines.join("\n")
	}

	const phase = current.phase || "idle"
	const action = current.action || "—"
	const mark = current.success === false ? "✕" : "✓"
	const lines = [`🗺️ Roadmap progress ${mark}`, `Phase: ${phase} | action: ${action}`]
	if (current.workspace) lines.push(`Workspace: ${current.workspace}`)

	const payload = (current.payload || {}) as Record<string, unknown>
	if (payload.phase) lines.push(`Roadmap phase: ${payload.phase}`)
	if (payload.stale != null) lines.push(`Checkpoint stale: ${payload.stale}`)
	if (payload.valid === false) lines.push("Schema: invalid — /roadmap explain-gate")

	const nextRec = (snap.recommended_next_action || {}) as Record<string, unknown>
	if (nextRec.command) lines.push(`Next: ${nextRec.command}`)

	const digest = (snap.project_steering_digest || {}) as Record<string, unknown>
	if (digest.identity_line) lines.push(`Project: ${digest.identity_line}`)
	const remaining = digest.bootstrap_remaining
	if (remaining && Number(remaining) > 0) {
		lines.push(`Bootstrap fill: ${remaining} phrase(s) — ${AUTO_GOVERNANCE.bootstrapAtCompletion}`)
	}
	if (snap.kanban_complete_allowed === false) lines.push("⚠️  attempt_completion blocked")

	if (params.timeline) {
		lines.push("", "Timeline:")
		for (const event of summarizeRecentEvents(await readProgressTail(Math.max(last, 10)), last)) {
			lines.push(`  • ${event.ts_iso} ${event.phase} action=${event.action} success=${event.success}`)
		}
	}

	lines.push("")
	lines.push("Live: /roadmap watch | progress --current | progress --timeline | explain-gate")
	return lines.join("\n")
}

export async function buildProgressSnapshot(workspace: string): Promise<Record<string, unknown>> {
	const { buildSteeringContext } = await import("./RoadmapSteeringContext")
	const { isBootstrapIncomplete } = await import("./RoadmapOperator")
	const { RoadmapService } = await import("./RoadmapService")

	const steering = await buildSteeringContext(workspace)
	const current = await readCurrentProgress()
	const status = await RoadmapService.getInstance().getOperationalStatus(workspace, "", "light")
	const gate = (status.roadmap_gate || {}) as Record<string, unknown>
	const wsState = (status.workspace_state || {}) as Record<string, unknown>
	const lastErr = (await readLastError()) || null
	const bootstrapInc = isBootstrapIncomplete({
		roadmap_exists: !!status.roadmap_exists,
		bootstrap_complete: status.bootstrap_complete,
		bootstrap_placeholder_count: status.bootstrap_placeholder_count,
		workspace_state: wsState,
	})
	const nextRec =
		(status.recommended_next_action as { command?: string; detail?: string }) ||
		recommendNextAction({
			phase: String(wsState.phase || status.phase || ""),
			roadmap_exists: !!status.roadmap_exists,
			schema_valid: status.schema_valid,
			stale: !!gate.checkpoint_stale,
			validation_pending: !!status.validation_pending,
			bootstrap_incomplete: bootstrapInc,
			last_error: lastErr,
		})

	return {
		success: true,
		ok: true,
		workspace,
		roadmap_path: steering.roadmap_path || path.join(workspace, "ROADMAP.md"),
		bootstrap_complete: steering.bootstrap_complete ?? status.bootstrap_complete,
		bootstrap_placeholder_count: steering.bootstrap_placeholder_count ?? status.bootstrap_placeholder_count,
		current: current || null,
		current_path: progressCurrentPath(),
		jsonl_path: progressJsonlPath(),
		current_exists: current != null,
		workspace_state: wsState || null,
		roadmap_gate: gate,
		kanban_complete_allowed: status.kanban_complete_allowed,
		recommended_next_action: nextRec,
		steering_identity: steering.steering_identity,
		steering_brief: steering.steering_brief || status.steering_brief,
		project_archetype: steering.project_archetype || status.project_archetype,
		stack_summary: steering.stack_summary || status.stack_summary,
		project_identity_line: status.project_identity_line,
		project_steering_digest: status.project_steering_digest,
		last_error: lastErr,
		recent_events: summarizeRecentEvents(await readProgressTail(5)),
		phase: status.phase,
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
