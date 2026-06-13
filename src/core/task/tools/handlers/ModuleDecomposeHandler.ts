import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as fs from "fs/promises"
import * as path from "path"
import { DietCodeDefaultTool } from "@/shared/tools"
import { ModuleDecomposer } from "../../../policy/ModuleDecomposer"
import type { TaskConfig } from "../types/TaskConfig"
import type { IToolHandler, ToolResponse } from "../types/ToolContracts"

interface DecomposeParams {
	path: string
}

/**
 * ModuleDecomposeHandler: Structural Blueprinting.
 * Helps agents split "Fat" modules into focused, modular components.
 */
export class ModuleDecomposeHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.STABILITY_DECOMPOSE

	getDescription(block: ToolUse): string {
		const params = block.params as unknown as DecomposeParams
		return `[decompose module: ${params.path}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const params = block.params as unknown as DecomposeParams
		const relPath = params.path

		if (!relPath) {
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		try {
			const absPath = path.resolve(config.cwd, relPath)
			const content = await fs.readFile(absPath, "utf-8")

			const decomposer = new ModuleDecomposer()
			const plan = decomposer.analyze(relPath, content)
			const totalLines = content.split("\n").length

			if (plan.steps.length === 0) {
				return formatResponse.toolResult(
					`The module '${relPath}' is already structurally modular.\n` +
						`Integrity Score: ${plan.integrityScore}%\n` +
						`Line Count: ${totalLines} / 1500`,
				)
			}

			let response =
				`Structural Decomposition Plan for: ${plan.filePath}\n` +
				`Current Layer: ${plan.currentLayer.toUpperCase()}\n` +
				`Build Health: ${plan.buildHealth} / 100${plan.projectedHealth ? ` -> PROJECTED: ${plan.projectedHealth} / 100 [V180 Recovery]` : ""}\n` +
				`Integrity Score: ${plan.integrityScore} / 100${plan.projectedIntegrity ? ` -> PROJECTED: ${plan.projectedIntegrity} / 100` : ""}\n` +
				`Line Count: ${totalLines} / 1500${totalLines > 1200 ? " (WARNING: Approaching Industrial Limit)" : ""}\n\n` +
				`V180 SOURCE HEALING: After creating modules from the Blueprints below, remove the extracted code from ${plan.filePath} to achieve the projected health recovery.\n\n` +
				`RECOMMENDED STEPS:\n`

			plan.steps.sort((a, b) => {
				const riskMap = { LOW: 0, MEDIUM: 1, HIGH: 2 }
				return (riskMap[a.risk || "MEDIUM"] || 1) - (riskMap[b.risk || "MEDIUM"] || 1)
			})

			plan.steps.forEach((step, index) => {
				const category = step.action === "EXTRACT" ? "FISSION" : "AXIOMATIC"
				const riskEmoji = step.risk === "LOW" ? "✅" : step.risk === "MEDIUM" ? "⚠️" : "🛑"

				response +=
					`${index + 1}. [${step.risk || "MEDIUM"}] [${category}: ${step.action}] ${step.target} -> ${step.destination} ${riskEmoji}\n` +
					`   Reason: ${step.reason}\n`

				if (step.boilerplate) {
					response += `   BLUEPRINT:\n\`\`\`typescript\n${step.boilerplate}\n\`\`\`\n`
				}

				if (step.intentSuggestion) {
					response += `   Intent: ${step.intentSuggestion}\n`
				}
			})

			if (totalLines > 1000) {
				response += `\nProjected State: Executing [FISSION] steps will increase Build Health to ${plan.projectedHealth}/100 and ensure module modularity.`
			}

			response += `\n\nDirective: Follow these steps to restore structural integrity. Use 'scaffold_module' to create the destination files if they don't exist.`

			return formatResponse.toolResult(response)
		} catch (error) {
			return `Decomposition failed: ${(error as Error)?.message}`
		}
	}
}
