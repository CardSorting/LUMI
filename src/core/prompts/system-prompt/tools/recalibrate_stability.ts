import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## recalibrate_stability
 * Description: Resets the activity pressure for the current project. Use this when you have performed a strategic review or reached a stability milestone and need to clear the activity cooldown.
 * Parameters:
 * - justification: (required) A professional explanation for the stability recalibration.
 */

const id = DietCodeDefaultTool.STABILITY_RECALIBRATE

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "recalibrate_stability",
	description:
		"Resets project activity pressure. Use this after a strategic review or when you need to clear an activity cooldown to proceed with complex changes.",
	parameters: [
		{
			name: "justification",
			required: true,
			type: "string",
			instruction: "Professional justification for resetting the activity pressure.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const recalibrate_stability_variants = [GENERIC]
