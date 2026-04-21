import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## sovereign_integrity_sweep
 * Description: Request a structural integrity scan and proactive repair cycle for a set of files. This tool triggers the Sovereign Garbage Collector to identify and automatically fix build/lint errors (PFH).
 * Parameters:
 * - files: (required) List of file paths to sweep (relative to current directory).
 * - task_progress: (optional) A checklist showing task progress after completion.
 */

const id = DietCodeDefaultTool.SOVEREIGN_SWEEP

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "sovereign_integrity_sweep",
	description:
		"Request a structural integrity scan and proactive repair cycle. Triggers the Sovereign Garbage Collector to identify and automatically fix build/lint errors using Proactive Forensic Healing (PFH).",
	parameters: [
		{
			name: "files",
			required: true,
			type: "array",
			items: { type: "string" },
			instruction: "List of file paths to sweep and heal (relative to current directory).",
			usage: '["src/core/policy/FluidPolicyEngine.ts"]',
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const sovereign_integrity_sweep_variants = [GENERIC]
