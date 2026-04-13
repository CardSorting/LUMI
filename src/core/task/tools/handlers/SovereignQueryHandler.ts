import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

interface QueryParams {
	layer?: string
	minLogicDensity?: number
	maxIoEntropy?: number
	limit?: number
}

import { SpiderEngine } from "../../../policy/SpiderEngine"

/**
 * SovereignQueryHandler: The Architectural Search Engine.
 * Allows agents to find hotspots and patterns within the structural graph.
 */
export class SovereignQueryHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.SOVEREIGN_QUERY

	getDescription(block: ToolUse): string {
		const params = block.params as unknown as QueryParams
		return `[query sovereignty registry for layers: ${params.layer || "all"}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const params = block.params as unknown as QueryParams
		const { layer, minLogicDensity = 0, maxIOEntropy = 1, minComplexity = 0, orphanedOnly = false } = params

		try {
			const engine = new SpiderEngine(config.cwd)
			const loaded = await engine.loadRegistry()

			if (!loaded) {
				return formatResponse.toolResult(
					"Architectural registry not found. Please run a full project scan via 'execute_command { command: \"npm run scan\" }' first.",
				)
			}

			const results = Array.from(engine.nodes.values()).filter((node) => {
				if (layer && node.layer !== layer.toLowerCase()) return false
				if (node.logicDensity < minLogicDensity) return false
				if (node.ioEntropy > maxIOEntropy) return false
				if (node.astComplexity < minComplexity) return false
				if (orphanedOnly && !node.orphaned) return false
				return true
			})

			if (results.length === 0) {
				return formatResponse.toolResult("No files matched the specified sovereign criteria.")
			}

			// Sort by 'Fever Score' (composite of density/entropy/complexity)
			results.sort((a, b) => {
				const scoreA = a.ioEntropy * 10 + (a.orphaned ? 5 : 0)
				const scoreB = b.ioEntropy * 10 + (b.orphaned ? 5 : 0)
				return scoreB - scoreA
			})

			const report = results
				.slice(0, 20)
				.map(
					(node) =>
						`- ${node.path} [${node.layer.toUpperCase()}]\n` +
						`  Density: ${(node.logicDensity * 100).toFixed(1)}% | Entropy: ${(node.ioEntropy * 100).toFixed(1)}% | Complexity: ${node.astComplexity}`,
				)
				.join("\n\n")

			return formatResponse.toolResult(
				`Sovereign Query Results (${results.length} files found):\n\n${report}` +
					(results.length > 20 ? `\n\n... and ${results.length - 20} more files matched.` : ""),
			)
		} catch (error) {
			return `Sovereign query failed: ${(error as Error)?.message}`
		}
	}
}
