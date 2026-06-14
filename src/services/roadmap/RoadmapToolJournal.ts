import { getRoadmapConfig } from "./RoadmapConfig"
import { emitProgress } from "./RoadmapProgress"

export const ROADMAP_EVENT_BY_ACTION: Record<string, string> = {
	guide: "guide",
	status: "status",
	checkpoint: "checkpoint_brief",
	validate: "validated",
	doctor: "doctor",
	cockpit: "cockpit",
	template: "template",
	apply_bootstrap_fill: "apply_bootstrap_fill",
	evidence: "evidence",
	explain_gate: "explain_gate",
	"explain-gate": "explain_gate",
	explain_stale: "explain_stale",
	"explain-stale": "explain_stale",
	progress: "progress",
	watch: "watch",
	last_error: "last_error",
}

export function parseRoadmapToolAction(args: Record<string, unknown> | undefined): string {
	if (!args) return ""
	return String(args.action || "")
		.trim()
		.toLowerCase()
}

export function parseRoadmapToolResult(result: unknown): { parsed: Record<string, unknown>; success: boolean } {
	let parsed: Record<string, unknown> = {}
	if (typeof result === "string") {
		try {
			const loaded = JSON.parse(result)
			if (typeof loaded === "object" && loaded !== null) {
				parsed = loaded as Record<string, unknown>
			}
		} catch {
			return { parsed: { result }, success: false }
		}
	} else if (typeof result === "object" && result !== null) {
		parsed = result as Record<string, unknown>
	}

	const action = String(parsed.action || "")
	let success = parsed.success !== false && parsed.ok !== false
	if (action === "validate") {
		success = Boolean((parsed.validation as Record<string, unknown>)?.valid ?? parsed.valid)
	} else if (action === "doctor") {
		success = Boolean(parsed.ok ?? parsed.success)
	}

	return { parsed, success }
}

export async function journalRoadmapToolCall(action: string, workspace: string, result: unknown, taskId?: string): Promise<void> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled || !cfg.progress_enabled) return

	const { parsed, success } = parseRoadmapToolResult(result)
	const event = ROADMAP_EVENT_BY_ACTION[action] || "tool_call"
	const digest = (parsed.project_steering_digest || {}) as Record<string, unknown>

	await emitProgress(`roadmap.${event}`, {
		action,
		workspace: String(parsed.workspace || workspace),
		success,
		payload: {
			taskId,
			phase: parsed.phase,
			valid: (parsed.validation as Record<string, unknown>)?.valid,
			stale: (parsed.checkpoint_freshness as Record<string, unknown>)?.stale ?? parsed.checkpoint_stale,
			steering_brief: parsed.steering_brief,
			project_archetype: parsed.project_archetype,
			project_identity_line: parsed.project_identity_line || digest.identity_line,
			verification_commands: digest.verification_commands,
			bootstrap_applied_count: (parsed.bootstrap_autofill_applied as Record<string, unknown>)?.applied_count,
		},
	})
}

export async function journalRoadmapFileMutation(params: {
	toolName: string
	path: string
	workspace: string
	allowed: boolean
	expectedPath?: string
	error?: string
	bootstrapIncomplete?: boolean
}): Promise<void> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled || !cfg.progress_enabled) return

	const followup = params.bootstrapIncomplete
		? "roadmap(action='apply_bootstrap_fill', context='write') then roadmap(action='validate')"
		: "roadmap(action='validate')"

	await emitProgress(params.allowed ? "roadmap.file_mutated" : "roadmap.write_rejected", {
		action: "file_mutated",
		workspace: params.workspace,
		success: params.allowed,
		payload: {
			tool: params.toolName,
			path: params.path,
			followup,
			write_allowed: params.allowed,
			expected_path: params.expectedPath,
			bootstrap_incomplete: params.bootstrapIncomplete,
			error: params.error,
		},
	})
}
