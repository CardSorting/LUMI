import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## query_stability
 * Description: Queries the stability registry for a specific file or module. Returns detailed activity metrics and churn history.
 * Parameters:
 * - path: (required) Path to the file or module to query.
 */

const id = DietCodeDefaultTool.STABILITY_QUERY

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "query_stability",
	description: "Queries stability metrics for a specific file or module. Useful for understanding churn and activity hotspots.",
	parameters: [
		{
			name: "path",
			required: true,
			type: "string",
			instruction: "Path to the file or module.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const query_stability_variants = [GENERIC]
