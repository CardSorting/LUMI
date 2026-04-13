import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as fs from "fs/promises"
import * as path from "path"
import { DietCodeDefaultTool } from "@/shared/tools"
import { SovereignDecomposer } from "../../../policy/SovereignDecomposer"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

interface DecomposeParams {
	path: string
}

/**
 * SovereignDecomposeHandler: Structural Blueprinting.
 * Helps agents split "Fat" modules into sovereign components.
 */
export class SovereignDecomposeHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.SOVEREIGN_DECOMPOSE

	getDescription(block: ToolUse): string {
		const params = block.params as unknown as DecomposeParams
		return `[decompose sovereign module: ${params.path}]`
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

			const decomposer = new SovereignDecomposer()
			const plan = decomposer.analyze(relPath, content)

			if (plan.steps.length === 0) {
				return formatResponse.toolResult(
					`The module '${relPath}' is already structurally sovereign.\n` + `Integrity Score: ${plan.integrityScore}%`,
				)
			}

			let response =
				`Structural Decomposition Plan for '${relPath}'\n` +
				`Integrity Score: ${plan.integrityScore}% (DEGRADED)\n` +
				`Layer: ${plan.currentLayer}\n\n` +
				`RECOMMENDED STEPS:\n`

			plan.steps.forEach((step, index) => {
				response +=
					`${index + 1}. [${step.action}] ${step.target} -> ${step.destination}\n` + `   Reason: ${step.reason}\n`
			})

			response += `\nDirective: Follow these steps to restore sovereignty. Use 'scaffold_sovereign_module' to create the destination files if they don't exist.`

			return formatResponse.toolResult(response)
		} catch (error) {
			return `Decomposition failed: ${(error as Error)?.message}`
		}
	}
}
