import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeDefaultTool } from "@/shared/tools"
import { SafeNumber } from "../../../../shared/utils/SafeNumber"
import { StabilityDoctor } from "../../../policy/StabilityDoctor"
import { SpiderEngine } from "../../../policy/spider/SpiderEngine"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * StabilityDoctorHandler: Handles the 'diagnose_sovereignty' tool.
 * Provides real-time architectural health auditing for agents.
 */
export class StabilityDoctorHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.STABILITY_DIAGNOSE

	getDescription(block: ToolUse): string {
		return `[${block.name} for current substrate]`
	}

	async execute(config: TaskConfig, _block: ToolUse): Promise<ToolResponse> {
		if (!config.isSubagentExecution) {
			return formatResponse.toolError(
				"🛑 **ACCESS DENIED**: Specialized diagnostic tools are reserved for Stability Sub-Agents. Please use 'attempt_completion' to trigger an autonomous documentation phase.",
			)
		}
		try {
			const engine = new SpiderEngine(config.cwd)
			const loaded = await engine.loadRegistry()

			if (!loaded) {
				// If no registry, we must build from scratch (expensive, but necessary here)
				// Agents should ideally run a scan first, but we handle the fallback.
				return formatResponse.toolResult(
					"Architectural Registry not found. Please run a full project scan via 'execute_command { command: \"npm run scan\" }' to initialize stability tracking.",
				)
			}

			const doctor = new StabilityDoctor(config.cwd)
			const report = await doctor.diagnose(engine)

			return formatResponse.toolResult(
				`Stability Diagnostic Report [Status: ${doctor.getAgentSignal(report)}]\n\n` +
					`Integrity Score: ${SafeNumber.format(report.integrityScore, 1)}%\n` +
					`Environment Context:\n` +
					`- Total Files: ${report.environmentContext.totalFiles}\n` +
					`- Gravity Center: ${report.environmentContext.gravityCenter}\n` +
					`- Logic Hotspots: ${report.environmentContext.logicHotspots.join(", ")}\n\n` +
					`Activity Map:\n${report.activityMap
						.slice(0, 5)
						.map((f: { path: string; score: number }) => `- ${f.path} (Score: ${SafeNumber.format(f.score, 1)})`)
						.join("\n")}\n\n` +
					`Active Violations:\n${report.violations.map((v) => `[${v.type}] ${v.path}: ${v.message}\n   -> Remediation: ${v.remediation}`).join("\n\n")}\n\n` +
					`Optimization Opportunities:\n${report.optimizations.map((o) => `- Move ${o.file} to ${o.recommendedLayer}: ${o.reason}`).join("\n")}`,
			)
		} catch (error) {
			return `Error during stability diagnosis: ${(error as Error)?.message}`
		}
	}
}
