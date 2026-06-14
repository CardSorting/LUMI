import type { ToolUse } from "@core/assistant-message"
import { Logger } from "@shared/services/Logger"
import { DietCodeDefaultTool } from "@shared/tools"
import { errorEnvelope } from "@/services/roadmap/RoadmapErrors"
import { emitProgress, recordLastError } from "@/services/roadmap/RoadmapProgress"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { journalRoadmapToolCall } from "@/services/roadmap/RoadmapToolJournal"
import type { TaskConfig } from "../types/TaskConfig"
import type { IToolHandler, ToolResponse } from "../types/ToolContracts"

const KNOWN_ACTIONS = new Set([
	"guide",
	"status",
	"cockpit",
	"checkpoint",
	"validate",
	"doctor",
	"apply_bootstrap_fill",
	"template",
	"explain_gate",
	"explain-gate",
	"explain_stale",
	"explain-stale",
	"evidence",
	"progress",
	"watch",
	"last_error",
])

export class RoadmapToolHandler implements IToolHandler {
	readonly name: DietCodeDefaultTool

	constructor(name: DietCodeDefaultTool = DietCodeDefaultTool.ROADMAP) {
		this.name = name
	}

	getDescription(block: ToolUse): string {
		return `[${block.name} action='${block.params.action || "default"}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const workspace = config.cwd
		interface RoadmapParams {
			action?: string
			context?: string
			user_request?: string
			task_progress?: string
		}
		const params = block.params as RoadmapParams
		const actionParam = (params.action || "").trim().toLowerCase()

		let action = actionParam
		if (!action) {
			action = block.name === DietCodeDefaultTool.ROADMAP_CHECKPOINT ? "checkpoint" : "guide"
		}

		const roadmapService = RoadmapService.getInstance()
		if (!roadmapService.isEnabled()) {
			return JSON.stringify(
				errorEnvelope({
					code: "roadmap_disabled",
					message: "Roadmap feature is disabled",
					action,
					workspace,
					safeToRetry: false,
				}),
				null,
				2,
			)
		}

		if (!KNOWN_ACTIONS.has(action)) {
			return JSON.stringify(
				errorEnvelope({
					code: "unknown_roadmap_action",
					message: `Unknown roadmap action '${action}'. Use roadmap(action='guide') to see valid actions.`,
					action,
					workspace,
					retryCommand: "roadmap(action='guide')",
				}),
				null,
				2,
			)
		}

		try {
			let result: Record<string, unknown>

			switch (action) {
				case "guide":
					result = await roadmapService.getOperationalStatus(workspace, params.context)
					break
				case "status":
					result = await roadmapService.getOperationalStatus(workspace, "status", "light")
					break
				case "cockpit":
					result = await roadmapService.buildCockpit(workspace)
					break
				case "checkpoint":
					result = await roadmapService.checkpointBrief(workspace, params.context, params.user_request)
					break
				case "validate":
					result = await roadmapService.validateRoadmap(workspace)
					break
				case "doctor":
					result = await roadmapService.runDoctor(workspace)
					break
				case "apply_bootstrap_fill":
					result = await roadmapService.applyBootstrapFillBrief(workspace, params.context)
					break
				case "template":
					result = await roadmapService.getTemplateBrief(workspace)
					break
				case "explain_gate":
				case "explain-gate":
					result = await roadmapService.explainGate(workspace)
					break
				case "explain_stale":
				case "explain-stale":
					result = await roadmapService.explainStale(workspace)
					break
				case "evidence": {
					const evidence = await roadmapService.gatherEvidence(workspace, null, "full")
					result = roadmapService.wrapClarityEnvelope({
						action: "evidence",
						success: true,
						ok: true,
						workspace,
						evidence,
						project_fingerprint: evidence.project_fingerprint,
						project_steering_digest: evidence.project_steering_digest,
						project_identity_line: evidence.project_identity_line,
					})
					break
				}
				case "progress":
					result = await roadmapService.getProgressSnapshot(workspace, params.context)
					break
				case "watch":
					result = await roadmapService.getWatchReport(workspace)
					break
				case "last_error":
					result = await roadmapService.getLastErrorBrief(workspace)
					break
				default:
					result = await roadmapService.getOperationalStatus(workspace, params.context)
			}

			const serialized = JSON.stringify(result, null, 2)
			await journalRoadmapToolCall(action, workspace, result, config.taskId)

			if (params.task_progress?.trim()) {
				try {
					await emitProgress("roadmap.task_progress", {
						action,
						workspace,
						payload: { task_progress: params.task_progress.trim(), phase: result.phase },
					})
				} catch {
					// non-fatal
				}
			}

			return serialized
		} catch (error) {
			Logger.error("[RoadmapToolHandler] Action failed:", error)
			const envelope = errorEnvelope({
				code: "roadmap_action_failed",
				message: error instanceof Error ? error.message : String(error),
				action,
				workspace,
				retryCommand: action === "validate" ? "roadmap(action='validate')" : "roadmap(action='guide')",
			})
			await recordLastError(envelope)
			await journalRoadmapToolCall(action, workspace, envelope, config.taskId)
			return JSON.stringify(envelope, null, 2)
		}
	}
}
