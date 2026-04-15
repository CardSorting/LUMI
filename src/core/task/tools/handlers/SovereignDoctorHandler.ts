import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeDefaultTool } from "@/shared/tools"
import { SovereignDoctor } from "../../../policy/SovereignDoctor"
import { SpiderEngine } from "../../../policy/spider/SpiderEngine"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * SovereignDoctorHandler: Handles the 'diagnose_sovereignty' tool.
 * Provides real-time architectural health auditing for agents.
 */
export class SovereignDoctorHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.SOVEREIGN_DIAGNOSE

	getDescription(block: ToolUse): string {
		return `[${block.name} for current substrate]`
	}

	async execute(config: TaskConfig, _block: ToolUse): Promise<ToolResponse> {
		try {
			const engine = new SpiderEngine(config.cwd)
			const loaded = await engine.loadRegistry()

			if (!loaded) {
				// If no registry, we must build from scratch (expensive, but necessary here)
				// Agents should ideally run a scan first, but we handle the fallback.
				return formatResponse.toolResult(
					"Architectural Registry not found. Please run a full project scan via 'execute_command { command: \"npm run scan\" }' to initialize JoyZoning.",
				)
			}

			const doctor = new SovereignDoctor(config.cwd)
			const report = await doctor.diagnose(engine)

			return formatResponse.toolResult(
				`JoyZoning Sovereignty Report [Status: ${doctor.getAgentSignal(report)}]\n\n` +
					`Integrity Score: ${report.integrityScore.toFixed(1)}%\n` +
					`Hotspots (Fever Map):\n${report.feverMap
						.slice(0, 5)
						.map((f) => `- ${f.path} (Score: ${f.score.toFixed(1)})`)
						.join("\n")}\n\n` +
					`Active Violations:\n${report.violations.map((v) => `[${v.type}] ${v.path}: ${v.message}\n   -> Remediation: ${v.remediation}`).join("\n\n")}\n\n` +
					`Optimization Opportunities:\n${report.optimizations.map((o) => `- Move ${o.file} to ${o.recommendedLayer}: ${o.reason}`).join("\n")}`,
			)
		} catch (error) {
			return `Error during sovereign diagnosis: ${(error as Error)?.message}`
		}
	}
}
