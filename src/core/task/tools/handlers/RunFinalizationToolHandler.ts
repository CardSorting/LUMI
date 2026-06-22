import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeDefaultTool } from "@shared/tools"
import { canRunFinalization } from "../completion/GateLifecycleEvaluator"
import { FinalizationRunner } from "../finalization/FinalizationRunner"
import type { TaskConfig } from "../types/TaskConfig"
import type { IToolHandler, ToolResponse } from "../types/ToolContracts"

export class RunFinalizationToolHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.RUN_FINALIZATION

	getDescription(_block: ToolUse): string {
		return `[${this.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const seal = block.params.seal === "true"

		if (!canRunFinalization(config) && !seal) {
			return formatResponse.toolError(
				"Finalization is not available. Engineering must be verified first, or completion retry must be locked with a verified engineering latch.",
			)
		}

		const runner = new FinalizationRunner(config)

		if (seal) {
			const sealResult = await runner.sealSession(block.params.summary)
			if (!sealResult.success) {
				return formatResponse.toolError(sealResult.message)
			}
			return formatResponse.toolResult(
				`${sealResult.message}\n\n<completion_receipt>${sealResult.receiptJson}</completion_receipt>`,
			)
		}

		const result = await runner.run()
		if (!result.success) {
			return formatResponse.toolError(result.message)
		}

		return formatResponse.toolResult(
			`${result.message}\n\n<finalization_evidence>${result.evidenceJson}</finalization_evidence>\n\nCall run_finalization with seal=true to emit the sealed receipt and end the session.`,
		)
	}
}
