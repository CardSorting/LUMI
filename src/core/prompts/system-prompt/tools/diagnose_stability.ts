import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## diagnose_stability
 * Description: Performs a deep stability scan of the current project state. Returns build health, complexity hotspots, and structural violations.
 */

const id = DietCodeDefaultTool.STABILITY_DIAGNOSE

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "diagnose_stability",
	description:
		"Performs a deep stability scan of the project. Returns build health, complexity hotspots, and structural violations.",
	parameters: [TASK_PROGRESS_PARAMETER],
}

export const diagnose_stability_variants = [GENERIC]
