import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## decompose_module
 * Description: Analyzes a complex module and provides a structural decomposition plan. Helps split large files into focused, independent components.
 * Parameters:
 * - path: (required) Path to the module to decompose.
 */

const id = DietCodeDefaultTool.STABILITY_DECOMPOSE

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "decompose_module",
	description:
		"Analyzes a complex module and provides a structural decomposition plan to help split it into focused components.",
	parameters: [
		{
			name: "path",
			required: true,
			type: "string",
			instruction: "Path to the module to decompose.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const decompose_module_variants = [GENERIC]
