/**
 * /roadmap slash command — operator console mirroring dietcode slash_commands._handle_roadmap.
 */
import * as path from "path"
import { formatCockpitReport } from "./RoadmapCockpit"
import { getRoadmapConfig } from "./RoadmapConfig"
import { formatDoctorReport } from "./RoadmapDoctor"
import { formatExplainStaleReport } from "./RoadmapFreshness"
import { formatExplainGateReport } from "./RoadmapOperator"
import { formatWatchReport, readProgressTail } from "./RoadmapProgress"
import { RoadmapService } from "./RoadmapService"

export const ROADMAP_SLASH_HELP = `/roadmap — auto-rolling roadmap checkpoint console

Subcommands:
  cockpit                One-screen operator summary (health, schema, code soup, next action)
  doctor                 Install skill + production health checks
  status                 Parse ROADMAP.md health and schema completeness
  evidence               Gather read-only project signals for a checkpoint pass
  checkpoint [context]   Full checkpoint briefing (evidence + update algorithm)
  validate               Schema validation for ROADMAP.md
  template               Bootstrap skeleton for first-pass ROADMAP.md
  guide                  Phase, health, and recommended next agent call
  progress [--timeline]  Roadmap tool activity (current + optional timeline)
  progress --current     Full progress + gate snapshot JSON
  progress --tail        JSON tail of roadmap-progress.jsonl
  watch                  Compact live summary of last roadmap action
  last-error             Last roadmap failure or validation issue
  explain-stale          Why checkpoint may be stale vs git activity
  explain-gate           Closed schema/freshness gates (kanban_complete policy)
`

function splitSlashArgs(raw: string): string[] {
	const trimmed = raw.trim()
	if (!trimmed) return []

	const tokens: string[] = []
	let current = ""
	let quote: "'" | '"' | null = null

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i]
		if (quote) {
			if (ch === quote) {
				quote = null
			} else {
				current += ch
			}
			continue
		}
		if (ch === "'" || ch === '"') {
			quote = ch
			continue
		}
		if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current)
				current = ""
			}
			continue
		}
		current += ch
	}
	if (current) tokens.push(current)
	return tokens
}

function resolveSlashWorkspace(explicit?: string): string {
	if (explicit?.trim()) return path.resolve(explicit.trim())
	return path.resolve(process.cwd())
}

function payloadReport(payload: Record<string, unknown>): string | null {
	const report = payload.report
	return typeof report === "string" && report.trim() ? report : null
}

export async function executeRoadmapSlashCommand(rawArgs: string, workspace?: string): Promise<string> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) {
		return "🗺️ Roadmap is disabled — enable mira.roadmap.enabled in settings."
	}

	const ws = resolveSlashWorkspace(workspace)
	const argv = splitSlashArgs(rawArgs)
	if (!argv.length || ["help", "-h", "--help"].includes(argv[0].toLowerCase())) {
		return ROADMAP_SLASH_HELP
	}

	const sub = argv[0].toLowerCase()
	const context = argv.slice(1).join(" ").trim()
	const service = RoadmapService.getInstance()

	try {
		switch (sub) {
			case "cockpit": {
				const payload = await service.buildCockpit(ws)
				return payloadReport(payload) || formatCockpitReport(payload)
			}
			case "doctor": {
				const payload = await service.runDoctor(ws)
				if (payloadReport(payload)) return payloadReport(payload)!
				return formatDoctorReport(
					(payload.checks as Array<{ name: string; ok: boolean; detail: string }>) || [],
					(payload.recommendations as string[]) || [],
					(payload.recommended_next_action as { command: string; detail: string }) || {
						command: "roadmap(action='guide')",
						detail: "",
					},
					payload,
				)
			}
			case "status": {
				const status = await service.getOperationalStatus(ws, "status", "light")
				const lines = [`🗺️ Roadmap status — ${ws}`, `Exists: ${!!status.roadmap_exists}`]
				if (status.health_status) lines.push(`Health: ${status.health_status}`)
				if (status.code_soup_risk) lines.push(`Code soup risk: ${status.code_soup_risk}`)
				if (status.recent_checkpoint_date) lines.push(`Last checkpoint: ${status.recent_checkpoint_date}`)
				const missing = (status.sections_missing as string[]) || []
				if (missing.length > 0) lines.push(`Missing sections: ${missing.length}`)
				lines.push("", `→ ${status.agent_next_call || "roadmap(action='guide')"}`)
				return lines.join("\n")
			}
			case "evidence": {
				const evidence = await service.gatherEvidence(ws, null, "full")
				const roadmap = (evidence.roadmap || {}) as Record<string, unknown>
				const git = (evidence.git || {}) as Record<string, unknown>
				const lines = [
					`🗺️ Roadmap evidence — ${ws}`,
					`ROADMAP.md: ${roadmap.exists ? "present" : "missing"}`,
					`READMEs: ${((evidence.readmes as unknown[]) || []).length}`,
					`Git commits: ${((git.recent_commits as unknown[]) || []).length}`,
					`TODO/FIXME markers: ${((evidence.todo_markers as unknown[]) || []).length}`,
				]
				const uncertainty = (evidence.uncertainty as string[]) || []
				if (uncertainty.length > 0) {
					lines.push("Uncertainty:")
					for (const note of uncertainty.slice(0, 5)) lines.push(`  - ${note}`)
				}
				return lines.join("\n")
			}
			case "checkpoint": {
				const data = await service.checkpointBrief(ws, context)
				const lines = [
					`🗺️ Roadmap checkpoint briefing — ${ws}`,
					`Phase: ${data.phase}`,
					`Skill: ${data.skill_path}`,
					String(data.operator_summary || ""),
					`Next: ${data.agent_next_call || ""}`,
				]
				const uncertainty = ((data.evidence as Record<string, unknown>)?.uncertainty as string[]) || []
				if (uncertainty.length > 0) {
					lines.push("Uncertainty:")
					for (const note of uncertainty.slice(0, 5)) lines.push(`  - ${note}`)
				}
				lines.push("Use roadmap(action='checkpoint') for full JSON briefing.")
				return lines.join("\n")
			}
			case "validate": {
				const data = await service.validateRoadmap(ws)
				const validation = (data.validation || {}) as Record<string, unknown>
				const lines = [
					`🗺️ Roadmap validate — ${ws}`,
					`Valid: ${validation.valid}`,
					`Schema complete: ${validation.schema_complete}`,
					`Now items: ${validation.now_item_count}`,
				]
				for (const issue of ((validation.issues as Array<Record<string, unknown>>) || []).slice(0, 8)) {
					lines.push(`  • [${issue.severity}] ${issue.message}`)
				}
				lines.push(`Next: ${data.agent_next_call || "roadmap(action='guide')"}`)
				return lines.join("\n")
			}
			case "template": {
				const data = await service.getTemplateBrief(ws)
				const skeleton = String(data.skeleton || "")
				const preview = skeleton.split("\n").slice(0, 24).join("\n")
				return [
					`🗺️ Roadmap template — ${ws}`,
					String(data.operator_summary || ""),
					`Next: ${data.agent_next_call || ""}`,
					"",
					"--- skeleton preview ---",
					preview,
					"…",
				].join("\n")
			}
			case "progress": {
				if (argv.includes("--current")) {
					const payload = await service.getProgressSnapshot(ws, "--current")
					return JSON.stringify(payload, null, 2)
				}
				if (argv.includes("--tail")) {
					return JSON.stringify(await readProgressTail(20), null, 2)
				}
				const payload = await service.getProgressSnapshot(ws, context)
				return payloadReport(payload) || JSON.stringify(payload, null, 2)
			}
			case "watch": {
				const payload = await service.getWatchReport(ws)
				return (
					payloadReport(payload) ||
					formatWatchReport(
						(payload.current as Record<string, unknown>) || null,
						(payload.last_error as Record<string, unknown>) || null,
						payload,
					)
				)
			}
			case "last-error":
			case "last_error": {
				const payload = await service.getLastErrorBrief(ws)
				const err = payload.last_error
				if (!err) return "🗺️ No roadmap errors recorded this session."
				return JSON.stringify(err, null, 2)
			}
			case "explain-gate":
			case "explain_gate": {
				const payload = await service.explainGate(ws)
				return (
					payloadReport(payload) ||
					formatExplainGateReport({
						workspace: ws,
						closed_gates: (payload.closed_gates as Array<Record<string, unknown>>) || [],
						open_gates: (payload.open_gates as string[]) || [],
						blocking_gates: (payload.blocking_gates as Array<Record<string, unknown>>) || [],
						kanban_complete_allowed: payload.kanban_complete_allowed as boolean,
						validation: payload.validation as Record<string, unknown>,
						freshness: payload.freshness as Record<string, unknown>,
					})
				)
			}
			case "explain-stale":
			case "explain_stale": {
				const payload = await service.explainStale(ws)
				return (
					payloadReport(payload) ||
					formatExplainStaleReport(
						(payload.checkpoint_freshness as Record<string, unknown>) || {},
						String(payload.project_identity_line || payload.steering_brief || ""),
					)
				)
			}
			case "guide": {
				const data = await service.getOperationalStatus(ws, context)
				const lines = [
					`🗺️ Roadmap guide — ${ws}`,
					`Phase: ${data.phase}`,
					`ROADMAP.md: ${data.roadmap_exists ? "present" : "missing"}`,
				]
				if (data.health_status) lines.push(`Health: ${data.health_status}`)
				if (data.code_soup_risk) lines.push(`Code soup risk: ${data.code_soup_risk}`)
				lines.push(String(data.operator_summary || ""))
				lines.push(`Next call: ${data.agent_next_call || ""}`)
				const hints = (data._roadmap_operator_hints || {}) as Record<string, unknown>
				if (hints.suggested_slash_command) lines.push(`Slash: ${hints.suggested_slash_command}`)
				return lines.join("\n")
			}
			default:
				return `Unknown subcommand: ${sub}\n\n${ROADMAP_SLASH_HELP}`
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return `❌ Roadmap slash command failed: ${message}\n\nTry /roadmap doctor`
	}
}

export function roadmapSlashCommandResponse(report: string): string {
	return `<roadmap_slash_result type="operator_console">
${report}
</roadmap_slash_result>
<explicit_instructions type="roadmap_slash">
The user ran a /roadmap operator slash command. The console output is in roadmap_slash_result above.
Acknowledge briefly if helpful; do not re-run the same roadmap action unless the user asks.
For deeper agent work, use roadmap(action='...') tool calls per agent_playbook.
</explicit_instructions>
`
}
