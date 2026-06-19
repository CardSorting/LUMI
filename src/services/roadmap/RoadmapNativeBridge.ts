import { DietCodeDefaultTool } from "@shared/tools"
import * as path from "path"
import { buildProjectContextLines } from "./RoadmapAgentSteering"
import { AUTO_GOVERNANCE } from "./RoadmapAutoGovernance"
import { getRoadmapConfig } from "./RoadmapConfig"
import { emitProgress } from "./RoadmapProgress"
import { RoadmapService } from "./RoadmapService"
import { journalRoadmapFileMutation } from "./RoadmapToolJournal"

const ROADMAP_NAMES = new Set(["ROADMAP.md", "roadmap.md"])

function normalizedPath(raw: unknown): string {
	return String(raw || "")
		.trim()
		.replace(/\\/g, "/")
}

function pathBasename(filePath: string): string {
	return path.basename(filePath)
}

export function isRoadmapFilename(filePath: string): boolean {
	return ROADMAP_NAMES.has(pathBasename(normalizedPath(filePath)))
}

export function targetsRoadmapFile(toolName: string, args: Record<string, unknown> | undefined): boolean {
	if (!args) return false
	const name = (toolName || "").trim().toLowerCase()
	if (name === DietCodeDefaultTool.FILE_NEW || name === DietCodeDefaultTool.FILE_EDIT) {
		return isRoadmapFilename(normalizedPath(args.path))
	}
	if (name === DietCodeDefaultTool.APPLY_PATCH) {
		return isRoadmapFilename(normalizedPath(args.path))
	}
	if (name === DietCodeDefaultTool.DIETCODE_KERNEL && String(args.action || "").toLowerCase() === "patch") {
		return isRoadmapFilename(normalizedPath(args.path))
	}
	return false
}

export function resolveRoadmapWritePath(
	writePath: string,
	workspace: string,
): { resolved: string | null; error: string | null; expected: string } {
	const ws = path.resolve(workspace)
	const raw = normalizedPath(writePath)
	const expected = path.join(ws, "ROADMAP.md")

	if (!raw) {
		return { resolved: null, error: "missing write path", expected }
	}
	if (!isRoadmapFilename(raw)) {
		return { resolved: null, error: "not a ROADMAP.md write", expected }
	}

	const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ws, raw)
	if (candidate !== expected) {
		try {
			const rel = path.relative(ws, candidate)
			if (rel.startsWith("..") || path.isAbsolute(rel)) {
				return {
					resolved: null,
					error: `ROADMAP.md must live at workspace root: ${expected} (got ${candidate})`,
					expected,
				}
			}
		} catch {
			return {
				resolved: null,
				error: `ROADMAP.md must live at workspace root: ${expected} (got ${candidate})`,
				expected,
			}
		}
	}

	return { resolved: expected, error: null, expected }
}

export async function validateRoadmapWriteTarget(
	writePath: string,
	workspace: string,
	status?: Record<string, unknown>,
): Promise<{
	ok: boolean
	allowed: boolean
	error?: string
	workspace: string
	roadmap_path?: string
	expected_path: string
	bootstrap_incomplete?: boolean
	bootstrap_placeholder_count?: number
	project_steering_brief?: string
}> {
	const ws = path.resolve(workspace)
	const check = resolveRoadmapWritePath(writePath, ws)
	const liveStatus = status || (await RoadmapService.getInstance().getOperationalStatus(ws, "", "light"))
	const brief = String(liveStatus.steering_brief || liveStatus.project_identity_line || "")
	const bootstrapInc = liveStatus.bootstrap_complete === false

	if (check.error) {
		return {
			ok: false,
			allowed: false,
			error: check.error,
			workspace: ws,
			expected_path: check.expected,
			project_steering_brief: brief,
			bootstrap_incomplete: bootstrapInc,
			bootstrap_placeholder_count: liveStatus.bootstrap_placeholder_count as number | undefined,
		}
	}

	return {
		ok: true,
		allowed: true,
		workspace: ws,
		roadmap_path: check.resolved || check.expected,
		expected_path: check.expected,
		project_steering_brief: brief,
		bootstrap_incomplete: bootstrapInc,
		bootstrap_placeholder_count: liveStatus.bootstrap_placeholder_count as number | undefined,
	}
}

export async function roadmapWriteHint(
	toolName: string,
	args: Record<string, unknown> | undefined,
	workspace: string,
): Promise<Record<string, unknown>> {
	const writePath = normalizedPath(args?.path)
	const status = await RoadmapService.getInstance().getOperationalStatus(workspace, "", "light")
	const check = await validateRoadmapWriteTarget(writePath, workspace, status)
	const projectBrief = check.project_steering_brief
	const bootstrapInc = check.bootstrap_incomplete === true
	const briefBit = projectBrief ? ` Project: ${projectBrief}.` : ""

	if (!check.allowed) {
		return {
			string_code: "roadmap_write_rejected",
			preferred_tool: "roadmap",
			preferred_command: "roadmap(action='guide')",
			recovery_suggestion: (check.error || "Write ROADMAP.md only in the project workspace root.") + briefBit,
			suggested_slash_command: "/roadmap guide",
			next_action: "roadmap(action='guide')",
			source_tool: toolName,
			path: writePath,
			workspace: check.workspace,
			expected_path: check.expected_path,
			project_steering_brief: projectBrief,
			write_rejected: true,
		}
	}

	let followup = `${AUTO_GOVERNANCE.writeMutationFollowup}${briefBit}`
	if (bootstrapInc) {
		followup += ` Bootstrap incomplete (${check.bootstrap_placeholder_count ?? "?"} phrase(s)) — ${AUTO_GOVERNANCE.bootstrapAtCompletion}`
	}

	return {
		string_code: "roadmap_write_followup",
		preferred_tool: "roadmap",
		preferred_command: null,
		recovery_suggestion: followup,
		suggested_slash_command: null,
		next_action: AUTO_GOVERNANCE.continueTaskMidPass,
		governance_policy: AUTO_GOVERNANCE.noManualValidate,
		auto_clearable_governance_only: status.auto_clearable_governance_only ?? false,
		validation_pending: !!status.validation_pending,
		source_tool: toolName,
		path: writePath,
		workspace: check.workspace,
		roadmap_path: check.roadmap_path,
		expected_path: check.expected_path,
		project_steering_brief: projectBrief,
		bootstrap_incomplete: bootstrapInc,
		project_steering_digest: status.project_steering_digest || null,
		write_rejected: false,
	}
}

export function mergeRoadmapHintIntoResult(result: unknown, hint: Record<string, unknown>): string {
	let parsed: Record<string, unknown>
	if (typeof result === "object" && result !== null && !Array.isArray(result)) {
		parsed = { ...(result as Record<string, unknown>) }
	} else if (typeof result === "string") {
		try {
			const loaded = JSON.parse(result)
			parsed = typeof loaded === "object" && loaded !== null ? { ...loaded } : { result }
		} catch {
			parsed = { result }
		}
	} else {
		parsed = { result }
	}

	parsed._roadmap_write_hint = hint
	if (hint.governance_policy) {
		parsed.governance_policy = hint.governance_policy
	}
	if (hint.auto_clearable_governance_only != null) {
		parsed.auto_clearable_governance_only = hint.auto_clearable_governance_only
	}
	const digest = hint.project_steering_digest
	if (typeof digest === "object" && digest !== null) {
		parsed.project_steering_digest = digest
		const identityLine = (digest as Record<string, unknown>).identity_line
		if (typeof identityLine === "string") {
			parsed.project_identity_line = identityLine
		}
	}
	if (hint.write_rejected) {
		parsed._roadmap_write_rejected = true
		parsed.success = false
		parsed.ok = false
	}
	return JSON.stringify(parsed, null, 2)
}

export function parseRoadmapToolAction(args: Record<string, unknown> | undefined): string {
	if (!args) return ""
	return String(args.action || "")
		.trim()
		.toLowerCase()
}

export async function preflightRoadmapWrite(
	toolName: string,
	args: Record<string, unknown> | undefined,
	workspace: string,
): Promise<{ block: boolean; message?: string }> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled || !cfg.block_writes_outside_workspace || !targetsRoadmapFile(toolName, args)) {
		return { block: false }
	}

	const check = await validateRoadmapWriteTarget(normalizedPath(args?.path), workspace)
	if (check.allowed) {
		return { block: false }
	}

	const status = await RoadmapService.getInstance().getOperationalStatus(workspace, "", "light")
	const contextLines = buildProjectContextLines({
		project_identity_line: status.project_identity_line,
		steering_brief: status.steering_brief,
		project_steering_digest: status.project_steering_digest,
		project_fingerprint: status.project_fingerprint,
	})
	const steeringLine =
		contextLines.length > 0 ? ` ${contextLines[0]}` : check.project_steering_brief ? ` ${check.project_steering_brief}` : ""

	try {
		await emitProgress("roadmap.write_blocked", {
			action: "pre_tool_call",
			workspace,
			success: false,
			payload: {
				tool: toolName,
				path: normalizedPath(args?.path),
				expected_path: check.expected_path,
				error: check.error,
			},
		})
	} catch {
		// non-fatal
	}

	return {
		block: true,
		message:
			`ROADMAP write blocked — ${check.error || "path outside project workspace"}. ` +
			`Expected: ${check.expected_path}.${steeringLine}`,
	}
}

export async function afterRoadmapWrite(
	toolName: string,
	args: Record<string, unknown> | undefined,
	workspace: string,
): Promise<void> {
	if (!getRoadmapConfig().enabled || !targetsRoadmapFile(toolName, args)) {
		return
	}
	const check = await validateRoadmapWriteTarget(normalizedPath(args?.path), workspace)
	await journalRoadmapFileMutation({
		toolName,
		path: normalizedPath(args?.path),
		workspace,
		allowed: check.allowed,
		expectedPath: check.expected_path,
		error: check.error,
		bootstrapIncomplete: check.bootstrap_incomplete,
	})
	if (!check.allowed) {
		return
	}
	await RoadmapService.getInstance().recordFileMutation(workspace, toolName, String(args?.path || "ROADMAP.md"))
}

export async function appendRoadmapWriteHint(
	toolName: string,
	args: Record<string, unknown> | undefined,
	workspace: string,
	toolResult: unknown,
): Promise<unknown> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled || !cfg.nudge_on_roadmap_write || !targetsRoadmapFile(toolName, args)) {
		return toolResult
	}
	const hint = await roadmapWriteHint(toolName, args, workspace)
	return mergeRoadmapHintIntoResult(toolResult, hint)
}
