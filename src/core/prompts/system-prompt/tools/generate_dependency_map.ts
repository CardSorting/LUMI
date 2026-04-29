import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## generate_dependency_map
 * Description: Generates a project-wide dependency map. Visualizes coupling and cross-layer violations.
 * Parameters:
 * - rootPath: (optional) Root path to start the map from (defaults to src).
 */

const id = DietCodeDefaultTool.STABILITY_MAP

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "generate_dependency_map",
	description: "Generates a dependency map to visualize project coupling and identify cross-layer violations.",
	parameters: [
		{
			name: "rootPath",
			required: false,
			type: "string",
			instruction: "Root path for the dependency map.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const generate_dependency_map_variants = [GENERIC]
