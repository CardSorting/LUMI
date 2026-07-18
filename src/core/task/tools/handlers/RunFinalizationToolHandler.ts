import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeDefaultTool } from "@shared/tools"
import { FinalizationRunner } from "../finalization/FinalizationRunner"
import type { TaskConfig } from "../types/TaskConfig"
import { declareApprovalIntent, declareNoConsentIntent, type IToolHandler, type ToolResponse } from "../types/ToolContracts"

export class RunFinalizationToolHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.RUN_FINALIZATION

	getApprovalIntent(block: ToolUse) {
		if (block.params.seal === "true") return declareNoConsentIntent(block, "Read the existing completion seal")
		return declareApprovalIntent(block, {
			description: "Run post-completion documentation maintenance",
			requirements: [
				{
					capability: "workspace_write",
					path: ".wiki",
					risk: "high",
					requestedSideEffects: ["update Agent Playbook documentation"],
					autoApprovalEligible: true,
				},
				{
					capability: "subagent",
					risk: "elevated",
					requestedSideEffects: ["delegate post-completion documentation maintenance"],
					autoApprovalEligible: false,
				},
			],
		})
	}

	getDescription(_block: ToolUse): string {
		return `[${this.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const seal = block.params.seal === "true"

		const runner = new FinalizationRunner(config)

		if (seal) {
			const sealResult = await runner.sealSession()
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
			`${result.message}\n\n<finalization_evidence>${result.evidenceJson}</finalization_evidence>`,
		)
	}
}
