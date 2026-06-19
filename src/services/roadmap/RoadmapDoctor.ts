import * as fs from "fs/promises"
import * as path from "path"
import { AUTO_GOVERNANCE } from "./RoadmapAutoGovernance"
import { getRoadmapConfig } from "./RoadmapConfig"
import { formatExplainGateReport, recommendNextAction, wrapClarityEnvelope } from "./RoadmapOperator"
import { progressJsonlPath, readLastError } from "./RoadmapProgress"
import type { RoadmapService } from "./RoadmapService"
import { bundledSkillPath, workspaceSkillPath } from "./RoadmapSkillInstall"

export async function runDoctorChecks(roadmapService: RoadmapService, workspace: string): Promise<Record<string, unknown>> {
	const cfg = getRoadmapConfig()
	const checks: Array<{ name: string; ok: boolean; detail: string }> = []
	const recommendations: string[] = []

	const addCheck = (name: string, ok: boolean, detail = "") => {
		checks.push({ name, ok, detail })
	}

	addCheck("roadmap.enabled", cfg.enabled, cfg.enabled ? "enabled" : "disabled")
	addCheck("auto_install_skills", true, cfg.auto_install_skills ? "enabled" : "disabled — install skill manually")

	try {
		await fs.access(await bundledSkillPath())
		addCheck("bundled_skill_present", true, await bundledSkillPath())
	} catch {
		addCheck("bundled_skill_present", false, "bundled SKILL.md missing")
		recommendations.push("Restore optional-skills/dietcode/auto-rolling-roadmap/SKILL.md in extension bundle")
	}

	try {
		await fs.access(workspaceSkillPath(workspace))
		addCheck("workspace_skill_installed", true, workspaceSkillPath(workspace))
	} catch {
		addCheck("workspace_skill_installed", false, "not installed — session start or roadmap(action='doctor')")
		if (cfg.auto_install_skills) {
			recommendations.push("roadmap(action='doctor') after session start to install workspace skill")
		}
	}

	const roadmapPath = path.join(workspace, "ROADMAP.md")
	let roadmapExists = false
	try {
		await fs.access(roadmapPath)
		roadmapExists = true
		addCheck("roadmap_present", true, roadmapPath)
		addCheck("roadmap_readable", true, roadmapPath)
	} catch {
		addCheck("roadmap_present", false, "ROADMAP.md not found — bootstrap required")
		recommendations.push("roadmap(action='checkpoint') to bootstrap ROADMAP.md")
	}

	const status = await roadmapService.getOperationalStatus(workspace, "", "standard")
	const gate = (status.roadmap_gate || {}) as Record<string, unknown>

	if (roadmapExists) {
		addCheck("schema_valid", status.schema_valid !== false, status.schema_valid ? "valid" : "invalid")
		addCheck("checkpoint_fresh", !gate.checkpoint_stale, String(gate.stale_summary || "fresh"))
		if (gate.checkpoint_stale) {
			recommendations.push("Update Recent Checkpoint (section 11) in ROADMAP.md")
		}
		if (status.validation_pending) {
			addCheck("validation_current", false, "ROADMAP.md changed since last validate")
			recommendations.push(AUTO_GOVERNANCE.validationAtCompletion)
		} else {
			addCheck("validation_current", true, "validated after last edit")
		}
	}

	addCheck("progress_log_available", true, progressJsonlPath())

	const statePath = roadmapService.getStatePath(workspace)
	try {
		await fs.access(statePath)
		addCheck("workspace_state_available", true, statePath)
	} catch {
		addCheck("workspace_state_available", !roadmapExists, "run validate to persist roadmap-state.json")
	}

	const lastError = await readLastError()
	if (lastError) {
		addCheck("last_error_clear", false, String(lastError.message || lastError.error))
		recommendations.push(String(lastError.retry_command || "roadmap(action='guide')"))
	} else {
		addCheck("last_error_clear", true, "no recorded errors")
	}

	if (status.bootstrap_complete === false) {
		recommendations.push(AUTO_GOVERNANCE.bootstrapAtCompletion)
	}

	const okCount = checks.filter((c) => c.ok).length
	const nextRec = recommendNextAction({
		phase: String(status.phase || ""),
		roadmap_exists: roadmapExists,
		schema_valid: status.schema_valid,
		stale: !!gate.checkpoint_stale,
		validation_pending: !!status.validation_pending,
		bootstrap_incomplete: status.bootstrap_complete === false,
		last_error: lastError,
	})

	const report = formatDoctorReport(checks, recommendations, nextRec, status)

	return wrapClarityEnvelope({
		action: "doctor",
		success: okCount === checks.length,
		ok: okCount === checks.length,
		workspace,
		checks,
		checks_passed: okCount,
		checks_total: checks.length,
		recommendations,
		recommended_next_action: nextRec,
		operator_summary: report.split("\n")[0] || "Roadmap doctor complete",
		report,
		roadmap_gate: gate,
		project_steering_digest: status.project_steering_digest,
		project_identity_line: status.project_identity_line,
		steering_brief: status.steering_brief,
		phase: status.phase,
		agent_next_call: nextRec.command,
	})
}

export function formatDoctorReport(
	checks: Array<{ name: string; ok: boolean; detail: string }>,
	recommendations: string[],
	nextRec: { command: string; detail: string },
	status: Record<string, unknown>,
): string {
	const lines = ["🩺 Roadmap doctor", ""]
	for (const check of checks) {
		lines.push(`${check.ok ? "✅" : "❌"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`)
	}
	lines.push("")
	if (recommendations.length > 0) {
		lines.push("Recommendations:")
		for (const rec of recommendations.slice(0, 6)) {
			lines.push(`  → ${rec}`)
		}
	}
	if (status.bootstrap_complete === false) {
		lines.push("", `Bootstrap: ${status.bootstrap_placeholder_count ?? "?"} template phrase(s) remain`)
	}
	const gate = (status.roadmap_gate || {}) as Record<string, unknown>
	if (gate.kanban_complete_allowed === false) {
		lines.push(
			"",
			formatExplainGateReport({
				workspace: String(status.workspace || ""),
				closed_gates: (gate.closed_gates as Array<Record<string, unknown>>) || [],
				open_gates: (gate.open_gates as string[]) || [],
				kanban_complete_allowed: false,
			}),
		)
	}
	lines.push("", `→ ${nextRec.command}`)
	return lines.join("\n")
}
