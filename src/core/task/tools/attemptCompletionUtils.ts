import { createHash } from "node:crypto"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { telemetryService } from "@services/telemetry"
import { findLastIndex } from "@shared/array"
import {
	COMPLETION_GATE_BLOCK_HISTORY_MAX,
	COMPLETION_GATE_ESCALATION_REMAINING,
	COMPLETION_GATE_STATUS_SCHEMA_VERSION,
	COMPLETION_GATE_WARN_THRESHOLD,
	COMPLETION_RESULT_MAX_LENGTH,
	COMPLETION_RESULT_MIN_LENGTH,
	COMPLETION_RETRY_COOLDOWN_MS,
	COMPLETION_RETRY_MAX_COOLDOWN_MS,
	DEFAULT_MAX_CONSECUTIVE_MISTAKES,
	MAX_COMPLETION_GATE_BLOCK_COUNT,
} from "@shared/audit/gatePolicy"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { DietCodeDefaultTool } from "@shared/tools"
import { parseFocusChainListCounts } from "../focus-chain/utils"
import type { TaskConfig } from "./types/TaskConfig"
import type { ToolResponse } from "./types/ToolContracts"

export type CompletionPreflightReason =
	| "empty_result"
	| "unfinished_markers"
	| "invalid_tone"
	| "duplicate_submission"
	| "retry_cooldown"
	| "focus_chain_incomplete"
	| "task_progress_required"
	| "task_progress_incomplete"
	| "task_progress_align"
	| "circuit_breaker"
	| "roadmap_gate"
	| "audit_gate"
	| "double_check"
	| "result_too_brief"
	| "result_too_long"
	| "checklist_in_result"
	| "audit_error"
	| "invalid_demo_command"

/** Ordered preflight stages — documents the gate pipeline for agents and observability. */
export const COMPLETION_PREFLIGHT_STAGES = [
	"circuit_breaker",
	"quality",
	"checklist_in_result",
	"min_length",
	"max_length",
	"task_progress_required",
	"task_progress_complete",
	"task_progress_align",
	"focus_chain",
	"cooldown",
	"duplicate",
	"demo_command",
	"roadmap",
	"audit",
	"double_check",
] as const

export type CompletionPreflightStage = (typeof COMPLETION_PREFLIGHT_STAGES)[number]

/** Throttle-only blocks — do not consume circuit-breaker budget (mirrors HTTP 429 vs 4xx). */
export const COMPLETION_SOFT_BLOCK_REASONS = new Set<CompletionPreflightReason>(["retry_cooldown"])

export function isCompletionSoftBlockReason(reason: CompletionPreflightReason): boolean {
	return COMPLETION_SOFT_BLOCK_REASONS.has(reason)
}

export type CompletionGateRetryStatus = "blocked" | "wait" | "ready"

export type CompletionGateBlockHistoryEntry = {
	reason: CompletionPreflightReason
	stage: CompletionPreflightStage
	at: number
	soft: boolean
	blockCount: number
}

/** Exponential backoff delay — base * 2^(blocks-1), capped (mirrors AWS/Azure retry policies). */
export function getCompletionRetryCooldownMs(blockCount: number): number {
	if (blockCount <= 0) {
		return 0
	}
	const exponential = COMPLETION_RETRY_COOLDOWN_MS * 2 ** (blockCount - 1)
	return Math.min(exponential, COMPLETION_RETRY_MAX_COOLDOWN_MS)
}

export function getCompletionCooldownRemainingMs(config: TaskConfig): number {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	if (blockCount === 0) {
		return 0
	}
	const lastAttempt = config.taskState.lastCompletionAttemptAt
	if (!lastAttempt) {
		return 0
	}
	const cooldownMs = getCompletionRetryCooldownMs(blockCount)
	const elapsed = Date.now() - lastAttempt
	return Math.max(0, cooldownMs - elapsed)
}

/** Latest workspace checkpoint hash — used to invalidate duplicate guards after edits. */
export function getLatestCheckpointHashFromMessages(config: TaskConfig): string | undefined {
	if (!config.messageState?.getDietCodeMessages) {
		return undefined
	}
	const messages = config.messageState.getDietCodeMessages()
	const index = findLastIndex(messages, (message: DietCodeMessage) => Boolean(message.lastCheckpointHash))
	if (index === -1) {
		return undefined
	}
	return messages[index]?.lastCheckpointHash
}

export function canonicalizeAttemptCompletionParams(block: ToolUse): boolean {
	if (block.name === DietCodeDefaultTool.ATTEMPT && !block.params?.result && typeof block.params?.response === "string") {
		block.params.result = block.params.response
		return true
	}

	return false
}

export function canonicalizeAttemptCompletionResultParams(params: Record<string, unknown> | undefined): boolean {
	if (!params?.result && typeof params?.response === "string") {
		params.result = params.response
		return true
	}

	return false
}

export function shouldRejectDoubleCheckCompletion(doubleCheckEnabled: boolean, doubleCheckCompletionPending: boolean): boolean {
	return doubleCheckEnabled && !doubleCheckCompletionPending
}

/** Unfinished-work markers — mirrors act_mode_respond advisory triggers. */
export const COMPLETION_QUALITY_BLOCK_PATTERN = /\b(TODO|FIXME|not implemented|placeholder|coming soon|WIP)\b/i

/** Engagement-bait endings — mirrors system prompt "NEVER end attempt_completion with a question". */
const COMPLETION_QUESTION_ENDING_PATTERN = /\?\s*["']?\s*$/

const COMPLETION_ENGAGEMENT_BAIT_PATTERN =
	/\b(let me know if|would you like|should i|do you want|can i help|is there anything else|need anything else)\b/i

export function validateCompletionResultTone(result: string): string | null {
	const trimmed = result.trim()
	if (COMPLETION_QUESTION_ENDING_PATTERN.test(trimmed)) {
		return (
			"Completion rejected: result ends with a question. " +
			"Provide a definitive completion summary — the user responds via the completion UI, not inline chat."
		)
	}

	const lastLine = trimmed.split("\n").filter(Boolean).pop() ?? ""
	if (COMPLETION_ENGAGEMENT_BAIT_PATTERN.test(lastLine)) {
		return (
			"Completion rejected: result solicits further conversation. " +
			"State what was done definitively; do not ask follow-up questions in attempt_completion."
		)
	}

	return null
}

export function hashCompletionResult(result: string): string {
	return createHash("sha256").update(result.trim()).digest("hex").slice(0, 16)
}

export function validateCompletionResultQuality(result: string): string | null {
	const trimmed = result.trim()
	if (!trimmed) {
		return "Completion rejected: result is empty after trimming whitespace."
	}
	if (COMPLETION_QUALITY_BLOCK_PATTERN.test(trimmed)) {
		return (
			"Completion rejected: result contains unfinished markers (TODO/FIXME/placeholder). " +
			"Resolve these in the workspace before calling attempt_completion."
		)
	}
	return validateCompletionResultTone(trimmed)
}

/** Bundled quality gate — use when a single validateQuality callback is required. */
export function validateCompletionPreflightQualityBundle(result: string): string | null {
	return (
		validateCompletionResultQuality(result) ??
		validateCompletionResultExcludesChecklist(result) ??
		validateCompletionResultMinLength(result)
	)
}

/** Demo commands that only print text — blocked per attempt_completion tool spec. */
const COMPLETION_DEMO_COMMAND_BLOCK_PATTERN = /^\s*(echo|cat|printf|type)\b/i

export function validateCompletionDemoCommand(command: string | undefined): string | null {
	const trimmed = command?.trim()
	if (!trimmed) {
		return null
	}
	if (COMPLETION_DEMO_COMMAND_BLOCK_PATTERN.test(trimmed)) {
		return (
			"Completion rejected: demo command must showcase live output — echo/cat/printf/type are not allowed. " +
			"Use a command that starts a server, opens a UI, or runs a meaningful demo."
		)
	}
	return null
}

/** Markdown checklist lines — result summary should not duplicate task_progress. */
const COMPLETION_CHECKLIST_IN_RESULT_PATTERN = /^\s*-\s*\[[ xX]\]/m

export function extractFocusChainItemLabels(checklist: string): string[] {
	return checklist
		.split("\n")
		.map((line) => line.replace(/^\s*-\s*\[[ xX]\]\s*/i, "").trim())
		.filter(Boolean)
}

export function recordCompletionBlockReason(config: TaskConfig, reason: CompletionPreflightReason): void {
	config.taskState.lastCompletionBlockReason = reason
	config.taskState.lastCompletionFailedStage = mapCompletionReasonToPreflightStage(reason)
	config.taskState.completionGatePressureLevel = getCompletionGatePressureLevel(config)
	appendCompletionGateBlockHistory(config, reason)
	syncCompletionGateObservabilityCache(config)
}

/** Ring-buffer gate block events — mirrors CI run attempt history / event sourcing. */
export function appendCompletionGateBlockHistory(config: TaskConfig, reason: CompletionPreflightReason): void {
	const entry: CompletionGateBlockHistoryEntry = {
		reason,
		stage: mapCompletionReasonToPreflightStage(reason),
		at: Date.now(),
		soft: isCompletionSoftBlockReason(reason),
		blockCount: config.taskState.completionGateBlockCount ?? 0,
	}
	const history = config.taskState.completionGateBlockHistory ?? []
	history.push(entry)
	if (history.length > COMPLETION_GATE_BLOCK_HISTORY_MAX) {
		history.splice(0, history.length - COMPLETION_GATE_BLOCK_HISTORY_MAX)
	}
	config.taskState.completionGateBlockHistory = history
}

/** Persists the latest envelope on task state — avoids recomputation at subagent spawn. */
export function syncCompletionGateObservabilityCache(config: TaskConfig): void {
	config.taskState.completionGateObservabilityEnvelope = buildCompletionGateObservabilityEnvelope(config)
}

export function clearCompletionGateObservabilityState(config: TaskConfig): void {
	config.taskState.lastCompletionBlockReason = undefined
	config.taskState.lastCompletionFailedStage = undefined
	config.taskState.completionGatePressureLevel = undefined
	config.taskState.completionGateObservabilityEnvelope = undefined
}

export function clearCompletionGateBlockHistory(config: TaskConfig): void {
	config.taskState.completionGateBlockHistory = undefined
}

/** OpenTelemetry-style dimensions for gate block telemetry. */
export function getCompletionGateTelemetryContext(config: TaskConfig): {
	pressureLevel: CompletionGatePressureLevel
	retryStatus: CompletionGateRetryStatus
	failedStage?: CompletionPreflightStage
	historyLength: number
	sessionId?: string
} {
	const reason = config.taskState.lastCompletionBlockReason as CompletionPreflightReason | undefined
	const retryStatus = reason ? getCompletionGateRetryPolicy(reason, config).retryStatus : "ready"
	return {
		pressureLevel: getCompletionGatePressureLevel(config),
		retryStatus,
		failedStage: config.taskState.lastCompletionFailedStage as CompletionPreflightStage | undefined,
		historyLength: config.taskState.completionGateBlockHistory?.length ?? 0,
		sessionId: config.taskState.completionGateSessionId,
	}
}

export function validateCompletionResultExcludesChecklist(result: string): string | null {
	if (COMPLETION_CHECKLIST_IN_RESULT_PATTERN.test(result)) {
		return (
			"Completion rejected: result must not contain checklist items. " +
			"Put the completed checklist in task_progress, not in result."
		)
	}
	return null
}

export function validateTaskProgressAlignsWithFocusChain(config: TaskConfig, taskProgress: string | undefined): string | null {
	if (!config.focusChainSettings?.enabled) {
		return null
	}

	const focusChecklist = config.taskState.currentFocusChainChecklist
	if (!focusChecklist?.trim() || !taskProgress?.trim()) {
		return null
	}

	const focusLabels = extractFocusChainItemLabels(focusChecklist)
	const progressLabels = extractFocusChainItemLabels(taskProgress)
	if (focusLabels.length === 0) {
		return null
	}

	if (progressLabels.length < focusLabels.length) {
		return (
			`Completion rejected: task_progress has ${progressLabels.length} item(s) but focus chain has ${focusLabels.length}. ` +
			"Include every focus chain item in task_progress, all marked [x]."
		)
	}

	return null
}

export function validateCompletionResultMinLength(result: string): string | null {
	const trimmed = result.trim()
	if (trimmed.length < COMPLETION_RESULT_MIN_LENGTH) {
		return (
			`Completion rejected: result is too brief (${trimmed.length} chars, minimum ${COMPLETION_RESULT_MIN_LENGTH}). ` +
			"Provide a 1–2 paragraph summary of what was done."
		)
	}
	return null
}

export function validateCompletionResultMaxLength(result: string): string | null {
	const trimmed = result.trim()
	if (trimmed.length > COMPLETION_RESULT_MAX_LENGTH) {
		return (
			`Completion rejected: result exceeds maximum length (${trimmed.length} chars, maximum ${COMPLETION_RESULT_MAX_LENGTH}). ` +
			"Shorten to a 1–2 paragraph summary; move checklists to task_progress."
		)
	}
	return null
}

export function mapCompletionReasonToPreflightStage(reason: CompletionPreflightReason): CompletionPreflightStage {
	switch (reason) {
		case "circuit_breaker":
			return "circuit_breaker"
		case "empty_result":
		case "unfinished_markers":
		case "invalid_tone":
			return "quality"
		case "result_too_brief":
			return "min_length"
		case "result_too_long":
			return "max_length"
		case "checklist_in_result":
			return "checklist_in_result"
		case "task_progress_required":
			return "task_progress_required"
		case "task_progress_incomplete":
			return "task_progress_complete"
		case "task_progress_align":
			return "task_progress_align"
		case "focus_chain_incomplete":
			return "focus_chain"
		case "retry_cooldown":
			return "cooldown"
		case "duplicate_submission":
			return "duplicate"
		case "invalid_demo_command":
			return "demo_command"
		case "roadmap_gate":
			return "roadmap"
		case "audit_gate":
		case "audit_error":
			return "audit"
		case "double_check":
			return "double_check"
	}
}

/** HTTP status analogue — mirrors API gateway error classification for agents. */
export function mapCompletionReasonToHttpStatus(reason: CompletionPreflightReason): number {
	switch (reason) {
		case "retry_cooldown":
			return 429
		case "duplicate_submission":
			return 409
		case "circuit_breaker":
			return 403
		case "audit_error":
			return 503
		case "double_check":
			return 428
		default:
			return 422
	}
}

const COMPLETION_GATE_PLAYBOOK_STEPS: Partial<Record<CompletionPreflightReason, readonly string[]>> = {
	empty_result: [
		"Write a 1–2 paragraph summary of completed work and outcomes.",
		"Keep checklists in task_progress, not in result.",
		"Retry attempt_completion with the updated result.",
	],
	result_too_brief: [
		"Expand result to cover what changed, why, and verification outcomes.",
		"Aim for at least 40 characters — typically 1–2 paragraphs.",
		"Retry attempt_completion without re-submitting an unchanged summary.",
	],
	result_too_long: [
		"Trim result to a concise 1–2 paragraph executive summary.",
		"Move detailed checklists and file lists to task_progress.",
		"Retry attempt_completion with the shortened result.",
	],
	checklist_in_result: [
		"Remove markdown checklist lines (- [ ] / - [x]) from result.",
		"Pass the full completed checklist in task_progress instead.",
		"Keep result as a prose summary only.",
	],
	unfinished_markers: [
		"Search the workspace for TODO/FIXME/placeholder markers and resolve them.",
		"Run tests or verification commands to confirm work is finished.",
		"Retry with a summary that reflects completed — not pending — work.",
	],
	invalid_tone: [
		"Rewrite the result as a definitive completion statement.",
		"Remove questions, hedging, or 'let me know if' phrasing.",
		"Retry attempt_completion with the revised tone.",
	],
	duplicate_submission: [
		"Make substantive fixes in the workspace — do not retry the same summary.",
		"Verify changes with git status or tests before retrying.",
		"Wait for cooldown to expire if no workspace changes are possible yet.",
	],
	retry_cooldown: [
		"Use the cooldown window to fix violations listed above.",
		"Run verification commands and update scratchpad.md with fixes.",
		"Retry attempt_completion after cooldown_remaining_ms reaches 0.",
	],
	focus_chain_incomplete: [
		"Open the focus chain checklist and mark every item [x].",
		"Use update_todo_list if items need status updates.",
		"Retry attempt_completion with matching task_progress.",
	],
	task_progress_required: [
		"Pass task_progress with the full focus chain checklist.",
		"Mark every item [x] before completing.",
		"Retry attempt_completion with both result and task_progress.",
	],
	task_progress_incomplete: [
		"Pass task_progress with every focus chain item marked [x].",
		"Ensure task_progress item count matches the focus chain.",
		"Keep result as a summary only — no checklist lines.",
	],
	task_progress_align: [
		"Include every focus chain item in task_progress, in the same order.",
		"Mark all items [x] in task_progress.",
		"Retry attempt_completion with aligned task_progress.",
	],
	invalid_demo_command: [
		"Replace echo/cat/printf/type with a command that demonstrates real behavior.",
		"Examples: start a dev server, run tests with output, or open a UI.",
		"Retry attempt_completion with the live demo command.",
	],
	roadmap_gate: [
		"Roadmap gates auto-remediate at attempt_completion (bootstrap fill, validate, checkpoint date stamp).",
		"Do not call roadmap(action='validate') or MCP — edit ROADMAP.md per the <roadmap_governance_recovery> block.",
		"Retry attempt_completion after ROADMAP.md issues are resolved.",
	],
	audit_gate: [
		"Read critical audit violations and fix root causes in code.",
		"Run tests and re-verify behavior changed.",
		"Retry with an updated result summary reflecting fixes.",
	],
	audit_error: [
		"Verify workspace state manually (git status, tests).",
		"Wait for audit services to recover if infrastructure failed.",
		"Retry attempt_completion after confirming stability.",
	],
	double_check: [
		"Re-read the verification checklist in the block message.",
		"Confirm each item against the actual workspace state.",
		"Call attempt_completion again after verification.",
	],
	circuit_breaker: [
		"Stop calling attempt_completion — further calls fail until you start a new task.",
		"Review audit artifacts and fix underlying violations in the workspace.",
		"Document changes in scratchpad.md before starting fresh.",
	],
}

export function getCompletionGatePlaybookSteps(reason: CompletionPreflightReason): readonly string[] {
	return COMPLETION_GATE_PLAYBOOK_STEPS[reason] ?? []
}

/** Machine-parseable playbook — mirrors structured CI remediation blocks. */
export function buildCompletionGatePlaybookBlock(reason: CompletionPreflightReason): string {
	const steps = getCompletionGatePlaybookSteps(reason)
	if (steps.length === 0) {
		return ""
	}

	const stepElements = steps
		.map((step, index) => `<step order="${index + 1}">${escapeCompletionGateXmlText(step)}</step>`)
		.join("")
	return `<completion_gate_playbook reason="${reason}">${stepElements}</completion_gate_playbook>`
}

/** Numbered runbook steps per block reason — mirrors SRE incident playbooks. */
export function buildCompletionGatePlaybook(reason: CompletionPreflightReason): string {
	const steps = getCompletionGatePlaybookSteps(reason)
	if (steps.length === 0) {
		return ""
	}

	return `**Recovery playbook:**\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`
}

/** Pipeline stage reference for proactive agent guidance. */
export function buildCompletionGatePipelineBrief(failedStage?: CompletionPreflightStage): string {
	const stageList = COMPLETION_PREFLIGHT_STAGES.join(" → ")
	const failedHint = failedStage ? ` Failed at: \`${failedStage}\`.` : ""
	const stageGuide = failedStage ? COMPLETION_PREFLIGHT_STAGE_HINTS[failedStage] : undefined
	const guideHint = stageGuide ? ` Hint: ${stageGuide}.` : ""
	return `**Gate pipeline:** ${stageList}.${failedHint}${guideHint}`
}

/** Returns stages that run after a failure — helps agents prioritize remaining work. */
export function getRemainingCompletionGateStages(failedStage: CompletionPreflightStage): CompletionPreflightStage[] {
	const index = COMPLETION_PREFLIGHT_STAGES.indexOf(failedStage)
	if (index === -1 || index >= COMPLETION_PREFLIGHT_STAGES.length - 1) {
		return []
	}
	return COMPLETION_PREFLIGHT_STAGES.slice(index + 1)
}

/** Short agent hints per pipeline stage — mirrors CI job descriptions. */
export const COMPLETION_PREFLIGHT_STAGE_HINTS: Partial<Record<CompletionPreflightStage, string>> = {
	circuit_breaker: "Hard stop — do not call attempt_completion until a new task",
	quality: "Substantive prose summary; no TODOs, placeholders, or engagement bait",
	checklist_in_result: "Keep checklists in task_progress, not in result",
	min_length: "Result must be at least 40 characters (1–2 paragraphs)",
	max_length: "Trim result to 6000 chars; move detail to task_progress",
	task_progress_required: "Pass task_progress when focus chain exists",
	task_progress_complete: "Every task_progress item must be [x]",
	task_progress_align: "task_progress must mirror every focus chain item",
	focus_chain: "Mark all focus chain items [x] via update_todo_list",
	cooldown: "Wait for backoff before retrying after a gate block",
	duplicate: "Change result or workspace before re-submitting",
	demo_command: "Demo must run real behavior — not echo/cat",
	roadmap: "Edit ROADMAP.md — validate/bootstrap/checkpoint auto-run at attempt_completion",
	audit: "Fix critical audit violations and re-verify",
	double_check: "Re-verify checklist, then call attempt_completion again",
}

export type CompletionGateOperationalState = "ready" | "wait" | "blocked" | "tripped"

/** Unified operational state — mirrors API gateway routing (ready/wait/blocked/tripped). */
export function getCompletionGateOperationalState(config: TaskConfig): CompletionGateOperationalState {
	const blocks = config.taskState.completionGateBlockCount ?? 0
	if (blocks >= MAX_COMPLETION_GATE_BLOCK_COUNT) {
		return "tripped"
	}
	if (getCompletionCooldownRemainingMs(config) > 0) {
		return "wait"
	}
	const reason = config.taskState.lastCompletionBlockReason as CompletionPreflightReason | undefined
	if (reason) {
		const policy = getCompletionGateRetryPolicy(reason, config)
		if (policy.retryStatus === "wait") {
			return "wait"
		}
		if (policy.retryStatus === "blocked") {
			return "blocked"
		}
	}
	return "ready"
}

export function isCompletionGateCircuitBreakerTripped(config: TaskConfig): boolean {
	return (config.taskState.completionGateBlockCount ?? 0) >= MAX_COMPLETION_GATE_BLOCK_COUNT
}

export type CompletionGatePressureLevel = "stable" | "elevated" | "critical" | "tripped"

/** Gate pressure tier — mirrors SLO burn-rate alerting (stable → tripped). */
export function getCompletionGatePressureLevel(config: TaskConfig): CompletionGatePressureLevel {
	const blocks = config.taskState.completionGateBlockCount ?? 0
	if (blocks >= MAX_COMPLETION_GATE_BLOCK_COUNT) {
		return "tripped"
	}
	if (blocks >= COMPLETION_GATE_WARN_THRESHOLD) {
		return "critical"
	}
	if (blocks >= 2) {
		return "elevated"
	}
	return "stable"
}

/** CI-style stage progress — shows passed/failed/pending per pipeline stage. */
export function buildCompletionGateStageProgressBlock(failedStage?: CompletionPreflightStage): string {
	const failedIndex = failedStage ? COMPLETION_PREFLIGHT_STAGES.indexOf(failedStage) : -1
	const stageElements = COMPLETION_PREFLIGHT_STAGES.map((stage, index) => {
		let status: "passed" | "failed" | "pending" | "skipped" = "pending"
		if (failedIndex === -1) {
			status = "pending"
		} else if (index < failedIndex) {
			status = "passed"
		} else if (index === failedIndex) {
			status = "failed"
		} else {
			status = "skipped"
		}
		return `<stage name="${stage}" status="${status}" order="${index + 1}" />`
	}).join("")
	return (
		`<completion_gate_stages schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}">` +
		`${stageElements}</completion_gate_stages>`
	)
}

/** All stages passed — success path observability (mirrors green CI pipeline view). */
export function buildCompletionGateStageProgressPassedBlock(): string {
	const stageElements = COMPLETION_PREFLIGHT_STAGES.map(
		(stage, index) => `<stage name="${stage}" status="passed" order="${index + 1}" />`,
	).join("")
	return (
		`<completion_gate_stages schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" outcome="passed">` +
		`${stageElements}</completion_gate_stages>`
	)
}

/** Aggregate health snapshot — single parse target for dashboards and agent routing. */
export function buildCompletionGateHealthBlock(config: TaskConfig): string {
	const blocks = config.taskState.completionGateBlockCount ?? 0
	const remaining = Math.max(0, MAX_COMPLETION_GATE_BLOCK_COUNT - blocks)
	const level = getCompletionGatePressureLevel(config)
	const attempt = config.taskState.completionAttemptCount ?? 0
	const lastReason = config.taskState.lastCompletionBlockReason ?? "none"
	const failedStage = config.taskState.lastCompletionFailedStage ?? "none"
	const retryPolicy =
		lastReason === "none"
			? { retryStatus: "ready" as const }
			: getCompletionGateRetryPolicy(lastReason as CompletionPreflightReason, config)
	const softLast = lastReason !== "none" && isCompletionSoftBlockReason(lastReason as CompletionPreflightReason)
	return (
		`<completion_gate_health schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" level="${level}" ` +
		`blocks="${blocks}" remaining="${remaining}" attempt="${attempt}" last_reason="${lastReason}" ` +
		`failed_stage="${failedStage}" retry_status="${retryPolicy.retryStatus}" ` +
		`soft_last="${softLast ? "true" : "false"}" />`
	)
}

/** Explicit operational state block — primary routing target for agent state machines. */
export function buildCompletionGateStateBlock(config: TaskConfig): string {
	const state = getCompletionGateOperationalState(config)
	const reason = config.taskState.lastCompletionBlockReason ?? "none"
	const sessionId = config.taskState.completionGateSessionId ?? getOrCreateCompletionGateSessionId(config)
	return (
		`<completion_gate_state schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" state="${state}" ` +
		`reason="${reason}" session_id="${sessionId}" />`
	)
}

/** Structured remaining stages — machine-parseable alternative to comma-separated status. */
export function buildCompletionGateNextStagesBlock(config: TaskConfig, failedStage?: CompletionPreflightStage): string {
	const stage = failedStage ?? (config.taskState.lastCompletionFailedStage as CompletionPreflightStage | undefined)
	if (!stage) {
		return ""
	}
	const remaining = getRemainingCompletionGateStages(stage)
	if (remaining.length === 0) {
		return ""
	}
	const stageElements = remaining
		.map(
			(name, index) =>
				`<stage name="${name}" order="${index + 1}" hint="${escapeCompletionGateXmlAttribute(COMPLETION_PREFLIGHT_STAGE_HINTS[name] ?? "")}" />`,
		)
		.join("")
	return (
		`<completion_gate_next_stages schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" failed_at="${stage}">` +
		`${stageElements}</completion_gate_next_stages>`
	)
}

/** Focus chain completion snapshot — surfaces todo alignment before completion. */
export function buildCompletionGateFocusBlock(config: TaskConfig): string {
	if (!config.focusChainSettings?.enabled) {
		return ""
	}
	const checklist = config.taskState.currentFocusChainChecklist
	if (!checklist?.trim()) {
		return ""
	}
	const { totalItems, completedItems } = parseFocusChainListCounts(checklist)
	if (totalItems === 0) {
		return ""
	}
	return (
		`<completion_gate_focus schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" total="${totalItems}" ` +
		`completed="${completedItems}" complete="${completedItems >= totalItems ? "true" : "false"}" />`
	)
}

/** Dry-run readiness issues — non-mutating preflight report for proactive hints. */
export function buildCompletionGateReadinessBlock(
	issues: ReadonlyArray<{ stage: CompletionPreflightStage; message: string }>,
): string {
	if (issues.length === 0) {
		return `<completion_gate_readiness schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" ready="true" count="0" />`
	}
	const issueElements = issues
		.map(
			(issue) =>
				`<issue stage="${issue.stage}" http_status="${mapCompletionReasonToHttpStatus(classifyCompletionPreflightReason(issue.message))}">` +
				`${escapeCompletionGateXmlText(issue.message)}</issue>`,
		)
		.join("")
	return (
		`<completion_gate_readiness schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" ready="false" count="${issues.length}">` +
		`${issueElements}</completion_gate_readiness>`
	)
}

/** Compact routing digest — single attribute-heavy block for agent decision trees. */
export function buildCompletionGateDigestBlock(config: TaskConfig, reason?: CompletionPreflightReason): string {
	const resolvedReason =
		reason ??
		(config.taskState.lastCompletionBlockReason as CompletionPreflightReason | undefined) ??
		(undefined as CompletionPreflightReason | undefined)
	const operationalState = getCompletionGateOperationalState(config)
	if (!resolvedReason) {
		const blocks = config.taskState.completionGateBlockCount ?? 0
		const remaining = Math.max(0, MAX_COMPLETION_GATE_BLOCK_COUNT - blocks)
		return (
			`<completion_gate_digest schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" ` +
			`blocks="${blocks}" remaining="${remaining}" pressure="${getCompletionGatePressureLevel(config)}" ` +
			`operational_state="${operationalState}" retry_status="ready" />`
		)
	}
	const stage = mapCompletionReasonToPreflightStage(resolvedReason)
	const policy = getCompletionGateRetryPolicy(resolvedReason, config)
	const blocks = config.taskState.completionGateBlockCount ?? 0
	const remaining = Math.max(0, MAX_COMPLETION_GATE_BLOCK_COUNT - blocks)
	return (
		`<completion_gate_digest schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" reason="${resolvedReason}" ` +
		`stage="${stage}" blocks="${blocks}" remaining="${remaining}" pressure="${getCompletionGatePressureLevel(config)}" ` +
		`operational_state="${operationalState}" ` +
		`http_status="${mapCompletionReasonToHttpStatus(resolvedReason)}" session_id="${getOrCreateCompletionGateSessionId(config)}" ` +
		`retry_status="${policy.retryStatus}" soft="${isCompletionSoftBlockReason(resolvedReason) ? "true" : "false"}" />`
	)
}

/** Recent gate block events — mirrors CI run attempt history for agent forensics. */
export function buildCompletionGateHistoryBlock(config: TaskConfig): string {
	const history = config.taskState.completionGateBlockHistory ?? []
	if (history.length === 0) {
		return ""
	}
	const events = history
		.map(
			(entry, index) =>
				`<event index="${index + 1}" reason="${entry.reason}" stage="${entry.stage}" soft="${entry.soft ? "true" : "false"}" ` +
				`blocks="${entry.blockCount}" at="${entry.at}" />`,
		)
		.join("")
	return (
		`<completion_gate_history schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" count="${history.length}">` +
		`${events}</completion_gate_history>`
	)
}

/** Rate-limit snapshot — mirrors X-RateLimit-* / Retry-After response headers. */
export function buildCompletionGateRateLimitBlock(config: TaskConfig): string {
	const blocks = config.taskState.completionGateBlockCount ?? 0
	if (blocks === 0) {
		return ""
	}
	const limit = MAX_COMPLETION_GATE_BLOCK_COUNT
	const remaining = Math.max(0, limit - blocks)
	const resetMs = getCompletionCooldownRemainingMs(config)
	return (
		`<completion_gate_rate_limit schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" limit="${limit}" ` +
		`remaining="${remaining}" reset_ms="${resetMs}" backoff_ms="${getCompletionRetryCooldownMs(blocks)}" />`
	)
}

/** Workspace checkpoint delta — invalidates duplicate guards when disk state changed. */
export function buildCompletionGateWorkspaceBlock(config: TaskConfig): string {
	const currentHash = getLatestCheckpointHashFromMessages(config)
	const priorHash = config.taskState.lastGateBlockCheckpointHash
	if (!currentHash && !priorHash) {
		return ""
	}
	const changed = hasWorkspaceChangedSinceGateBlock(config, currentHash)
	return (
		`<completion_gate_workspace schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" ` +
		`prior_hash="${priorHash ?? ""}" current_hash="${currentHash ?? ""}" changed="${changed ? "true" : "false"}" />`
	)
}

/** One-line human summary — scannable routing hint above the machine envelope. */
export function buildCompletionGateHumanBrief(config: TaskConfig, reason?: CompletionPreflightReason): string {
	const resolvedReason =
		reason ??
		(config.taskState.lastCompletionBlockReason as CompletionPreflightReason | undefined) ??
		(undefined as CompletionPreflightReason | undefined)
	if (!resolvedReason) {
		return ""
	}
	const stage = mapCompletionReasonToPreflightStage(resolvedReason)
	const blocks = config.taskState.completionGateBlockCount ?? 0
	const remaining = Math.max(0, MAX_COMPLETION_GATE_BLOCK_COUNT - blocks)
	const policy = getCompletionGateRetryPolicy(resolvedReason, config)
	const action = buildCompletionPreflightRecoveryHint(resolvedReason) ?? "Fix violations before retrying."
	const httpStatus = mapCompletionReasonToHttpStatus(resolvedReason)
	return (
		`**Gate block** \`${resolvedReason}\` at \`${stage}\` ` +
		`(${blocks}/${MAX_COMPLETION_GATE_BLOCK_COUNT}, ${remaining} left, HTTP ${httpStatus}, retry: ${policy.retryStatus}) — ${action}`
	)
}

/** Wraps machine-parseable gate blocks — mirrors nested API error envelopes. */
export function buildCompletionGateAgentEnvelope(blocks: string[]): string {
	const inner = blocks.filter(Boolean).join("")
	if (!inner) {
		return ""
	}
	return `<completion_gate_envelope schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}">${inner}</completion_gate_envelope>`
}

/** All structured gate blocks for errors, breathers, and subagent handoff. */
export function buildCompletionGateStructuredContext(
	message: string,
	config: TaskConfig,
	options?: { result?: string; extraBlocks?: string[] },
): string {
	const reason = resolveCompletionBlockReason(message, config)
	const failedStage = mapCompletionReasonToPreflightStage(reason)
	return buildCompletionGateAgentEnvelope([
		buildCompletionGateDigestBlock(config, reason),
		buildCompletionGateStateBlock(config),
		buildCompletionGateHealthBlock(config),
		buildCompletionGateHistoryBlock(config),
		buildCompletionGateRateLimitBlock(config),
		buildCompletionGateWorkspaceBlock(config),
		buildCompletionGateFocusBlock(config),
		buildCompletionGateStageProgressBlock(failedStage),
		buildCompletionGateNextStagesBlock(config, failedStage),
		buildCompletionGateProblemBlock(reason, message, config),
		buildCompletionGateStatusBrief(config, options),
		buildCompletionGateActionBlock(reason, config),
		buildCompletionGateRecoveryBlock(reason),
		buildCompletionGatePlaybookBlock(reason),
		...(options?.extraBlocks ?? []),
	])
}

/** Observability envelope for proactive hints when only task state is available. */
export function buildCompletionGateObservabilityEnvelope(config: TaskConfig): string {
	const lastReason = config.taskState.lastCompletionBlockReason as CompletionPreflightReason | undefined
	if (!lastReason) {
		return buildCompletionGateAgentEnvelope([
			buildCompletionGateDigestBlock(config),
			buildCompletionGateStateBlock(config),
			buildCompletionGateHealthBlock(config),
			buildCompletionGateFocusBlock(config),
			buildCompletionGateStatusBrief(config),
		])
	}
	const failedStage = mapCompletionReasonToPreflightStage(lastReason)
	const detail = buildCompletionPreflightRecoveryHint(lastReason) ?? "Completion gate blocked"
	return buildCompletionGateAgentEnvelope([
		buildCompletionGateDigestBlock(config, lastReason),
		buildCompletionGateStateBlock(config),
		buildCompletionGateHealthBlock(config),
		buildCompletionGateHistoryBlock(config),
		buildCompletionGateRateLimitBlock(config),
		buildCompletionGateWorkspaceBlock(config),
		buildCompletionGateFocusBlock(config),
		buildCompletionGateStageProgressBlock(failedStage),
		buildCompletionGateNextStagesBlock(config, failedStage),
		buildCompletionGateProblemBlock(lastReason, detail, config),
		buildCompletionGateStatusBrief(config),
		buildCompletionGateActionBlock(lastReason, config),
		buildCompletionGateRecoveryBlock(lastReason),
		buildCompletionGatePlaybookBlock(lastReason),
	])
}

/** Retry policy — mirrors Retry-After / Stripe idempotency semantics. */
export function getCompletionGateRetryPolicy(
	reason: CompletionPreflightReason,
	config: TaskConfig,
): { retryable: boolean; retryAfterMs: number; retryStatus: CompletionGateRetryStatus } {
	if (reason === "circuit_breaker") {
		return { retryable: false, retryAfterMs: 0, retryStatus: "blocked" }
	}

	const retryAfterMs = getCompletionCooldownRemainingMs(config)
	if (retryAfterMs > 0) {
		return { retryable: false, retryAfterMs, retryStatus: "wait" }
	}

	return { retryable: true, retryAfterMs: 0, retryStatus: "ready" }
}

/** Prefer recorded block reason over message classification (avoids audit message misclassification). */
export function resolveCompletionBlockReason(message: string, config: TaskConfig): CompletionPreflightReason {
	const recorded = config.taskState.lastCompletionBlockReason
	if (recorded) {
		return recorded as CompletionPreflightReason
	}
	return classifyCompletionPreflightReason(message)
}

export function shouldEmitProactiveCompletionGuidance(config: TaskConfig): boolean {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	if (blockCount < COMPLETION_GATE_WARN_THRESHOLD - 1 || blockCount >= MAX_COMPLETION_GATE_BLOCK_COUNT) {
		return false
	}
	return config.taskState.lastProactiveGuidanceBlockCount !== blockCount
}

export function markProactiveCompletionGuidanceEmitted(config: TaskConfig): void {
	config.taskState.lastProactiveGuidanceBlockCount = config.taskState.completionGateBlockCount ?? 0
	syncCompletionGateObservabilityCache(config)
}

export function shouldEmitPreflightReadinessHint(config: TaskConfig): boolean {
	if (config.taskState.preflightReadinessHintEmitted) {
		return false
	}
	if ((config.taskState.completionGateBlockCount ?? 0) > 0) {
		return false
	}

	const hasFocusChain = config.focusChainSettings?.enabled && Boolean(config.taskState.currentFocusChainChecklist?.trim())
	const hasAuditPreview = config.auditCompletionGateEnabled && Boolean(config.taskState.lastAdvisoryAudit)
	return hasFocusChain || hasAuditPreview
}

export function markPreflightReadinessHintEmitted(config: TaskConfig): void {
	config.taskState.preflightReadinessHintEmitted = true
	syncCompletionGateObservabilityCache(config)
}

/** First-attempt readiness — proactive checklist before the first completion try. */
export function buildCompletionPreflightReadinessBrief(config: TaskConfig): string {
	const parts = [
		"📋 **Pre-completion readiness** — verify these before calling attempt_completion:",
		buildCompletionGatePipelineBrief(),
	]

	if (config.focusChainSettings?.enabled && config.taskState.currentFocusChainChecklist?.trim()) {
		parts.push("- Focus chain: mark every item [x] via update_todo_list and pass task_progress")
	}

	if (config.auditCompletionGateEnabled) {
		parts.push("- Audit gate: address critical violations; run tests before completing")
	}

	parts.push("- Result: 1–2 paragraph summary in result; checklist only in task_progress")
	parts.push(
		buildCompletionGateAgentEnvelope([
			buildCompletionGateDigestBlock(config),
			buildCompletionGateStateBlock(config),
			buildCompletionGateHealthBlock(config),
			buildCompletionGateFocusBlock(config),
			buildCompletionGateStageProgressBlock(),
		]),
	)
	return parts.join("\n\n")
}

export function buildProactiveCompletionGuidance(config: TaskConfig): string {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	const remaining = MAX_COMPLETION_GATE_BLOCK_COUNT - blockCount
	const lastReason = config.taskState.lastCompletionBlockReason as CompletionPreflightReason | undefined
	const failedStage = lastReason ? mapCompletionReasonToPreflightStage(lastReason) : undefined
	const breatherHint = buildCompletionBreatherHint(config)
	const escalationBrief = buildCompletionGateEscalationBrief(config)
	const parts = [
		`⚠️ **Completion gate advisory (${blockCount}/${MAX_COMPLETION_GATE_BLOCK_COUNT})** — ${remaining} attempt(s) before hard stop.`,
		buildCompletionGateObservabilityEnvelope(config),
		buildCompletionGatePipelineBrief(failedStage),
	]
	if (breatherHint) {
		parts.push(breatherHint)
	}
	if (escalationBrief) {
		parts.push(escalationBrief)
	}
	return parts.join("\n\n")
}

export function classifyCompletionPreflightReason(message: string): CompletionPreflightReason {
	if (message.includes("result is empty")) return "empty_result"
	if (message.includes("result is too brief")) return "result_too_brief"
	if (message.includes("exceeds maximum length")) return "result_too_long"
	if (message.includes("must not contain checklist")) return "checklist_in_result"
	if (message.includes("demo command must showcase")) return "invalid_demo_command"
	if (message.includes("unfinished markers")) return "unfinished_markers"
	if (message.includes("ends with a question") || message.includes("solicits further conversation")) return "invalid_tone"
	if (message.includes("Duplicate completion submission")) return "duplicate_submission"
	if (message.includes("Completion throttled")) return "retry_cooldown"
	if (message.includes("but focus chain has")) return "task_progress_align"
	if (message.includes("focus chain has")) return "focus_chain_incomplete"
	if (message.includes("task_progress is required")) return "task_progress_required"
	if (message.includes("task_progress has")) return "task_progress_incomplete"
	if (message.includes("maximum completion gate retries")) return "circuit_breaker"
	if (message.includes("re-verify your work")) return "double_check"
	if (message.includes("Roadmap") || message.includes("roadmap")) return "roadmap_gate"
	if (message.includes("hardening audit evaluation failed")) return "audit_error"
	if (message.includes("hardening audit") || message.includes("Completion Gate") || message.includes("violations")) {
		return "audit_gate"
	}
	if (message.includes("Completion rejected:")) {
		return "empty_result"
	}
	return "audit_gate"
}

/** Correlation ID for the current completion cycle — spans all gate blocks until finish. */
export function getOrCreateCompletionGateSessionId(config: TaskConfig): string {
	if (!config.taskState.completionGateSessionId) {
		config.taskState.completionGateSessionId = createHash("sha256")
			.update(`${config.taskId}:${Date.now()}:${Math.random()}`)
			.digest("hex")
			.slice(0, 12)
	}
	return config.taskState.completionGateSessionId
}

export function recordCompletionAttemptTime(config: TaskConfig): void {
	getOrCreateCompletionGateSessionId(config)
	config.taskState.completionAttemptCount = (config.taskState.completionAttemptCount ?? 0) + 1
}

export function recordGateBlockCheckpointHash(config: TaskConfig, checkpointHash?: string): void {
	if (checkpointHash) {
		config.taskState.lastGateBlockCheckpointHash = checkpointHash
	}
}

export function hasWorkspaceChangedSinceGateBlock(config: TaskConfig, currentCheckpointHash?: string): boolean {
	const priorHash = config.taskState.lastGateBlockCheckpointHash
	if (!priorHash || !currentCheckpointHash) {
		return false
	}
	return priorHash !== currentCheckpointHash
}

export function validateCompletionAttemptCooldown(config: TaskConfig): string | null {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	if (blockCount === 0) {
		return null
	}

	const lastAttempt = config.taskState.lastCompletionAttemptAt
	if (!lastAttempt) {
		return null
	}

	const elapsed = Date.now() - lastAttempt
	const cooldownMs = getCompletionRetryCooldownMs(blockCount)
	if (elapsed >= cooldownMs) {
		return null
	}

	const waitSeconds = Math.ceil((cooldownMs - elapsed) / 1000)
	return (
		`Completion throttled: wait ${waitSeconds}s before retrying after a gate block (backoff ${Math.round(cooldownMs / 1000)}s). ` +
		"Use this time to fix violations in the workspace."
	)
}

export function validateCompletionTaskProgressRequired(config: TaskConfig, taskProgress: string | undefined): string | null {
	if (!config.focusChainSettings?.enabled) {
		return null
	}

	const checklist = config.taskState.currentFocusChainChecklist
	if (!checklist?.trim()) {
		return null
	}

	const { totalItems } = parseFocusChainListCounts(checklist)
	if (totalItems === 0) {
		return null
	}

	if (!taskProgress?.trim()) {
		return (
			"Completion rejected: task_progress is required when a focus chain checklist exists. " +
			"Pass the full checklist with all items marked [x]."
		)
	}

	return null
}

export function validateFocusChainComplete(config: TaskConfig): string | null {
	if (!config.focusChainSettings?.enabled) {
		return null
	}

	const checklist = config.taskState.currentFocusChainChecklist
	if (!checklist?.trim()) {
		return null
	}

	const { totalItems, completedItems } = parseFocusChainListCounts(checklist)
	if (totalItems > 0 && completedItems < totalItems) {
		const incomplete = totalItems - completedItems
		return (
			`Completion rejected: focus chain has ${incomplete} incomplete item(s). ` +
			"Mark all items [x] or update the list before attempt_completion."
		)
	}

	return null
}

export function validateCompletionTaskProgress(taskProgress: string | undefined): string | null {
	if (!taskProgress?.trim()) {
		return null
	}

	const { totalItems, completedItems } = parseFocusChainListCounts(taskProgress)
	if (totalItems > 0 && completedItems < totalItems) {
		const incomplete = totalItems - completedItems
		return (
			`Completion rejected: task_progress has ${incomplete} incomplete item(s). ` +
			"Mark all checklist items [x] in task_progress before completing."
		)
	}

	return null
}

/**
 * Structured gate status for agent parsing — mirrors CI/deployment status blocks.
 */
export function buildCompletionGateStatusBrief(config: TaskConfig, options?: { result?: string }): string {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	const remaining = Math.max(0, MAX_COMPLETION_GATE_BLOCK_COUNT - blockCount)
	const doubleCheck = config.taskState.doubleCheckCompletionPending ? "verified" : "pending"
	const mistakes = config.taskState.consecutiveMistakeCount
	const attempt = config.taskState.completionAttemptCount ?? 0
	const cooldownRemaining = getCompletionCooldownRemainingMs(config)
	const backoffMs = getCompletionRetryCooldownMs(blockCount)
	const lastReason = config.taskState.lastCompletionBlockReason ?? "none"
	const failedStage =
		lastReason === "none" ? "none" : mapCompletionReasonToPreflightStage(lastReason as CompletionPreflightReason)
	const retryPolicy =
		lastReason === "none"
			? { retryable: true, retryAfterMs: 0, retryStatus: "ready" as const }
			: getCompletionGateRetryPolicy(lastReason as CompletionPreflightReason, config)
	const pressureLevel = getCompletionGatePressureLevel(config)
	const nextAction =
		lastReason === "none" ? "none" : (buildCompletionPreflightRecoveryHint(lastReason as CompletionPreflightReason) ?? "none")
	const remainingStages =
		failedStage === "none" ? "" : getRemainingCompletionGateStages(failedStage as CompletionPreflightStage).join(",")
	const resultFingerprint = options?.result ? hashCompletionResult(options.result) : ""
	const currentHash = getLatestCheckpointHashFromMessages(config)
	const workspaceChanged = hasWorkspaceChangedSinceGateBlock(config, currentHash)
	const attemptKey = `${attempt}:${blockCount}:${failedStage}`
	const sessionId = getOrCreateCompletionGateSessionId(config)
	const operationalState = getCompletionGateOperationalState(config)

	return (
		`<completion_gate_status schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" blocks="${blockCount}" remaining="${remaining}" ` +
		`double_check="${doubleCheck}" consecutive_mistakes="${mistakes}" attempt="${attempt}" attempt_key="${attemptKey}" session_id="${sessionId}" ` +
		`operational_state="${operationalState}" cooldown_remaining_ms="${cooldownRemaining}" backoff_ms="${backoffMs}" last_reason="${lastReason}" ` +
		`failed_stage="${failedStage}" pressure_level="${pressureLevel}" workspace_changed="${workspaceChanged ? "true" : "false"}" ` +
		`retryable="${retryPolicy.retryable ? "true" : "false"}" retry_after_ms="${retryPolicy.retryAfterMs}" ` +
		`retry_status="${retryPolicy.retryStatus}" remaining_stages="${remainingStages}" result_fingerprint="${resultFingerprint}" ` +
		`next_action="${escapeCompletionGateXmlAttribute(nextAction)}" />`
	)
}

/** Success status block — confirms gates cleared before completion is emitted. */
export function buildCompletionGatePassedBrief(config: TaskConfig, score?: number): string {
	const attempt = config.taskState.completionAttemptCount ?? 0
	const priorBlocks = config.taskState.completionGateBlockCount ?? 0
	const scoreAttr = score !== undefined ? ` score="${score}"` : ""
	return (
		`<completion_gate_status schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" passed="true" attempt="${attempt}" prior_blocks="${priorBlocks}"` +
		`${scoreAttr} retryable="false" retry_after_ms="0" retry_status="ready" />`
	)
}

/** Success envelope — all stages passed with health snapshot (mirrors green CI run). */
export function buildCompletionGatePassedEnvelope(config: TaskConfig, score?: number): string {
	return buildCompletionGateAgentEnvelope([
		buildCompletionGateDigestBlock(config),
		buildCompletionGateStateBlock(config),
		buildCompletionGateHealthBlock(config),
		buildCompletionGateStageProgressPassedBlock(),
		buildCompletionGatePassedBrief(config, score),
	])
}

/** Dedicated action block — primary parse target for agent next steps (mirrors CI annotations). */
export function buildCompletionGateActionBlock(reason: CompletionPreflightReason, config: TaskConfig): string {
	const action = buildCompletionPreflightRecoveryHint(reason)
	if (!action) {
		return ""
	}
	const retryPolicy = getCompletionGateRetryPolicy(reason, config)
	return (
		`<completion_gate_action schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" reason="${reason}" ` +
		`retry_status="${retryPolicy.retryStatus}" retryable="${retryPolicy.retryable ? "true" : "false"}" ` +
		`retry_after_ms="${retryPolicy.retryAfterMs}">${escapeCompletionGateXmlText(action)}</completion_gate_action>`
	)
}

/** RFC 7807-style problem block — structured type/title/detail for agent parsing. */
export function buildCompletionGateProblemBlock(reason: CompletionPreflightReason, detail: string, config?: TaskConfig): string {
	const stage = mapCompletionReasonToPreflightStage(reason)
	const title = buildCompletionPreflightRecoveryHint(reason) ?? "Completion gate blocked"
	const trimmedDetail = detail.trim().slice(0, 500)
	const retryPolicy = config ? getCompletionGateRetryPolicy(reason, config) : { retryStatus: "ready" as const }
	const soft = isCompletionSoftBlockReason(reason)
	const httpStatus = mapCompletionReasonToHttpStatus(reason)
	return (
		`<completion_gate_problem schema_version="${COMPLETION_GATE_STATUS_SCHEMA_VERSION}" type="${reason}" stage="${stage}" ` +
		`instance="completion-gate/${stage}" http_status="${httpStatus}" soft="${soft ? "true" : "false"}" ` +
		`retry_status="${retryPolicy.retryStatus}" title="${escapeCompletionGateXmlAttribute(title)}">` +
		`${escapeCompletionGateXmlText(trimmedDetail)}</completion_gate_problem>`
	)
}

function escapeCompletionGateXmlAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeCompletionGateXmlText(value: string): string {
	return escapeCompletionGateXmlAttribute(value)
}

/** Critical urgency banner when approaching hard stop (mirrors PagerDuty escalation tiers). */
export function buildCompletionGateEscalationBrief(config: TaskConfig): string {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	const remaining = MAX_COMPLETION_GATE_BLOCK_COUNT - blockCount
	if (remaining > COMPLETION_GATE_ESCALATION_REMAINING || remaining <= 0) {
		return ""
	}

	return (
		`🚨 **Gate escalation:** ${remaining} attempt(s) until hard stop. ` +
		"Fix blocking violations before retrying attempt_completion."
	)
}

export function buildCompletionBreatherHint(config: TaskConfig): string {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	const mistakes = config.taskState.consecutiveMistakeCount
	const hints: string[] = []

	if (blockCount >= COMPLETION_GATE_WARN_THRESHOLD) {
		hints.push(
			"Pause attempt_completion. Document violation fixes in scratchpad.md, run verification commands, then retry with an updated result.",
		)
	}

	if (mistakes >= DEFAULT_MAX_CONSECUTIVE_MISTAKES - 1) {
		hints.push("A cognitive breather is imminent — slow down, review scratchpad.md and git status before the next tool call.")
	}

	if (hints.length === 0) {
		return ""
	}

	return `💡 **Agent ergonomics:** ${hints.join(" ")}`
}

export function buildCompletionPreflightRecoveryHint(reason: CompletionPreflightReason): string {
	switch (reason) {
		case "empty_result":
			return "Write a 1–2 paragraph summary of what was done and retry attempt_completion."
		case "result_too_brief":
			return "Expand your result to a substantive 1–2 paragraph summary of changes and outcomes."
		case "result_too_long":
			return "Shorten the result to 1–2 paragraphs; move checklists to task_progress."
		case "checklist_in_result":
			return "Remove checklist lines from result — put the completed checklist in task_progress only."
		case "unfinished_markers":
			return "Remove TODO/FIXME/placeholder text from the codebase, then summarize the finished work."
		case "invalid_tone":
			return "End with a definitive statement — no questions or 'let me know if' phrasing."
		case "duplicate_submission":
			return "Change your result summary to reflect fixes, or wait for the cooldown to expire before retrying."
		case "retry_cooldown":
			return "Use the cooldown window to fix violations and run verification commands."
		case "focus_chain_incomplete":
			return "Mark all focus chain items [x] via update_todo_list before completing."
		case "task_progress_required":
			return "Pass task_progress with the full focus chain checklist, all items [x]."
		case "task_progress_incomplete":
			return "Pass task_progress with every checklist item marked [x]."
		case "task_progress_align":
			return "Include every focus chain item in task_progress with matching labels, all [x]."
		case "circuit_breaker":
			return "Stop calling attempt_completion — start a new task after fixing root causes."
		case "roadmap_gate":
			return "Edit ROADMAP.md to resolve governance gates — validation and bootstrap fill run automatically at completion."
		case "audit_gate":
			return "Address critical audit violations in the workspace, run verification, then retry with an updated result."
		case "double_check":
			return "Re-read the verification checklist, confirm each item, then call attempt_completion again."
		case "audit_error":
			return "Audit services failed — verify workspace state manually, then retry after recovery."
		case "invalid_demo_command":
			return "Use a demo command that starts a server, opens a UI, or runs tests — not echo/cat."
	}
}

/** RFC 7807-style structured recovery block for agent parsing. */
export function buildCompletionGateRecoveryBlock(reason: CompletionPreflightReason): string {
	const hint = buildCompletionPreflightRecoveryHint(reason)
	return `<completion_gate_recovery reason="${reason}">${escapeCompletionGateXmlText(hint)}</completion_gate_recovery>`
}

/** Wrap completion errors with structured status + recovery hints for the agent. */
export function buildCompletionAgentErrorMessage(
	message: string,
	config: TaskConfig,
	options?: { result?: string; extraBlocks?: string[] },
): string {
	const reason = resolveCompletionBlockReason(message, config)
	const parts = [message]
	const humanBrief = buildCompletionGateHumanBrief(config, reason)
	if (humanBrief && !message.includes("Gate block")) {
		parts.push(humanBrief)
	}
	parts.push(buildCompletionGateStructuredContext(message, config, options))
	const playbook = buildCompletionGatePlaybook(reason)
	if (playbook && !message.includes("Recovery playbook")) {
		parts.push(playbook)
	}
	const breatherHint = buildCompletionBreatherHint(config)
	if (breatherHint) {
		parts.push(breatherHint)
	}
	const escalationBrief = buildCompletionGateEscalationBrief(config)
	if (escalationBrief) {
		parts.push(escalationBrief)
	}
	return parts.join("\n\n")
}

/** Wrap an already-formatted completion gate message for tool results. */
export function wrapFormattedCompletionError(formattedMessage: string): ToolResponse {
	return formatResponse.toolError(formattedMessage)
}

/** Standard tool error wrapper with agent ergonomics context. */
export function formatCompletionToolError(message: string, config: TaskConfig, options?: { result?: string }): ToolResponse {
	return wrapFormattedCompletionError(buildCompletionAgentErrorMessage(message, config, options))
}

/**
 * Detects no-op retries after a gate block (same result re-submitted without changes).
 * Mirrors idempotency / duplicate-request guards in production APIs.
 */
export function detectDuplicateCompletionSubmission(
	config: TaskConfig,
	result: string,
	options?: { currentCheckpointHash?: string },
): string | null {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	const priorFingerprint = config.taskState.lastBlockedCompletionResultFingerprint
	if (blockCount === 0 || !priorFingerprint) {
		return null
	}
	if (hashCompletionResult(result) !== priorFingerprint) {
		return null
	}

	if (hasWorkspaceChangedSinceGateBlock(config, options?.currentCheckpointHash)) {
		return null
	}

	const lastAttempt = config.taskState.lastCompletionAttemptAt
	const cooldownMs = getCompletionRetryCooldownMs(blockCount)
	if (lastAttempt && Date.now() - lastAttempt >= cooldownMs) {
		// After backoff window, allow same summary — workspace fixes may not change the prose.
		return null
	}

	return (
		"Duplicate completion submission: you re-submitted the same result after a gate block. " +
		"Fix violations in the workspace and update your result before retrying."
	)
}

export function recordBlockedCompletionResultFingerprint(config: TaskConfig, result: string, checkpointHash?: string): void {
	config.taskState.lastBlockedCompletionResultFingerprint = hashCompletionResult(result)
	recordGateBlockCheckpointHash(config, checkpointHash)
}

export function clearBlockedCompletionResultFingerprint(config: TaskConfig): void {
	config.taskState.lastBlockedCompletionResultFingerprint = undefined
}

export function recordCompletionPreflightFailure(config: TaskConfig): void {
	config.taskState.consecutiveMistakeCount++
}

/**
 * Progressive agent recovery guidance (mirrors circuit-breaker warn → trip patterns).
 * Appended to gate-block tool errors so the model gets actionable next steps, not just a stop signal.
 */
export function buildCompletionGateRetryGuidance(blockCount: number): string {
	if (blockCount <= 1 || blockCount >= MAX_COMPLETION_GATE_BLOCK_COUNT) {
		return ""
	}

	if (blockCount >= COMPLETION_GATE_WARN_THRESHOLD) {
		const remaining = MAX_COMPLETION_GATE_BLOCK_COUNT - blockCount
		return (
			`\n\n⚠️ **Completion gate pressure (${blockCount}/${MAX_COMPLETION_GATE_BLOCK_COUNT})** — ` +
			`${remaining} attempt(s) remain before a hard stop.\n` +
			"1. Read the violations above and fix root causes in code — do not re-submit the same summary.\n" +
			"2. Run tests or verify behavior changed before calling attempt_completion again.\n" +
			"3. If blocked on audit score, address critical violations first; warnings may be acceptable depending on policy."
		)
	}

	return (
		`\n\n💡 **Repeated completion gate block (${blockCount}/${MAX_COMPLETION_GATE_BLOCK_COUNT})** — ` +
		"address the listed violations before retrying. Re-submitting unchanged work will not pass."
	)
}

export function appendCompletionGateRetryGuidance(message: string, blockCount: number): string {
	const guidance = buildCompletionGateRetryGuidance(blockCount)
	return guidance ? `${message}${guidance}` : message
}

function getCompletionGateCircuitBreakerMessage(config: TaskConfig): string | null {
	if (!isCompletionGateCircuitBreakerTripped(config)) {
		return null
	}
	return (
		`Task completion blocked: maximum completion gate retries (${MAX_COMPLETION_GATE_BLOCK_COUNT}) exceeded.\n\n` +
		"**Recovery playbook:**\n" +
		"1. Stop calling attempt_completion — further calls will fail until you start a new task.\n" +
		"2. Review audit artifacts and fix the underlying violations in the workspace.\n" +
		"3. Use act_mode_respond or scratchpad.md to document what changed before starting fresh."
	)
}

export function getCompletionGateCircuitBreakerError(config: TaskConfig): string | null {
	return getCompletionGateCircuitBreakerMessage(config)
}

export function checkCompletionGateCircuitBreaker(config: TaskConfig): ToolResponse | null {
	const message = getCompletionGateCircuitBreakerMessage(config)
	if (!message) {
		return null
	}
	recordCompletionGateBlockEvent(config, "circuit_breaker")
	const telemetryContext = getCompletionGateTelemetryContext(config)
	telemetryService.captureCompletionPreflightBlocked(config.ulid, {
		taskId: config.taskId,
		reason: "circuit_breaker",
		blockCount: config.taskState.completionGateBlockCount ?? 0,
		consecutiveMistakes: config.taskState.consecutiveMistakeCount,
		attemptCount: config.taskState.completionAttemptCount ?? 0,
		lastReason: config.taskState.lastCompletionBlockReason,
		failedStage: "circuit_breaker",
		pressureLevel: telemetryContext.pressureLevel,
		retryStatus: telemetryContext.retryStatus,
		historyLength: telemetryContext.historyLength,
		sessionId: telemetryContext.sessionId,
	})
	return formatCompletionToolError(message, config)
}

export function recordCompletionGateBlock(config: TaskConfig): number {
	config.taskState.completionGateBlockCount = (config.taskState.completionGateBlockCount ?? 0) + 1
	return config.taskState.completionGateBlockCount ?? 0
}

/**
 * Unified gate block event — increments counter, records fingerprint, and reason.
 * Mirrors idempotent event-sourced gate transitions in production CI systems.
 */
export function recordCompletionGateBlockEvent(
	config: TaskConfig,
	reason: CompletionPreflightReason,
	options?: { result?: string; checkpointHash?: string },
): number {
	if (reason === "circuit_breaker") {
		config.taskState.consecutiveMistakeCount++
		getOrCreateCompletionGateSessionId(config)
		recordCompletionBlockReason(config, reason)
		return config.taskState.completionGateBlockCount ?? 0
	}

	if (isCompletionSoftBlockReason(reason)) {
		recordCompletionBlockReason(config, reason)
		return config.taskState.completionGateBlockCount ?? 0
	}

	const blockCount = recordCompletionGateBlock(config)
	config.taskState.lastCompletionAttemptAt = Date.now()
	if (options?.result) {
		recordBlockedCompletionResultFingerprint(config, options.result, options.checkpointHash)
	}
	recordCompletionBlockReason(config, reason)
	return blockCount
}

export function markCompletionGatesPassed(config: TaskConfig): void {
	config.taskState.consecutiveMistakeCount = 0
	clearCompletionGateObservabilityState(config)
	clearBlockedCompletionResultFingerprint(config)
	config.taskState.lastGateBlockCheckpointHash = undefined
}

/** Reset completion attempt state after a successful finish (next completion gets fresh double-check + gate budget). */
export function markCompletionAttemptFinished(config: TaskConfig): void {
	config.taskState.doubleCheckCompletionPending = false
	config.taskState.completionGateBlockCount = 0
	config.taskState.lastCompletionAttemptAt = undefined
	config.taskState.lastGateBlockCheckpointHash = undefined
	clearCompletionGateObservabilityState(config)
	config.taskState.lastProactiveGuidanceBlockCount = undefined
	config.taskState.preflightReadinessHintEmitted = undefined
	clearCompletionGateBlockHistory(config)
	config.taskState.completionGateSessionId = undefined
	clearBlockedCompletionResultFingerprint(config)
}

export const DOUBLE_CHECK_REVERIFY_STEPS = [
	"All requested changes have been made",
	"No steps were skipped or partially completed",
	"Edge cases and error handling are addressed",
	"The solution matches what was asked for, not just what was convenient",
	"Output files contain exactly what was specified--no extra columns, fields, debug output, or commentary",
	"If the task specifies numerical thresholds or accuracy targets, verify your result meets the criteria. If close but not passing, iterate rather than declaring completion",
] as const

export function buildDoubleCheckReverifyMessage(extras?: { taskSection?: string; auditPreviewSection?: string }): string {
	const numbered = DOUBLE_CHECK_REVERIFY_STEPS.map((step, index) => `${index + 1}. ${step}`).join("\n")
	return (
		"Before completing, re-verify your work against the original task requirements. Check that:\n" +
		numbered +
		(extras?.taskSection ?? "") +
		(extras?.auditPreviewSection ?? "") +
		"\n\nIf everything checks out, call attempt_completion again with your final result."
	)
}
