import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## scaffold_module
 * Description: Scaffolds a new module following architectural best practices. Creates the file structure and provides boilerplate.
 * Parameters:
 * - path: (required) Target path for the new module.
 * - template: (optional) Template to use (e.g. 'domain-service', 'infrastructure-adapter').
 */

const id = DietCodeDefaultTool.STABILITY_SCAFFOLD

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "scaffold_module",
	description:
		"Scaffolds a new module following architectural best practices. Creates the file structure and provides boilerplate.",
	parameters: [
		{
			name: "path",
			required: true,
			type: "string",
			instruction: "Target path for the new module.",
		},
		{
			name: "template",
			required: false,
			type: "string",
			instruction: "Template type (e.g. 'domain-service', 'infrastructure-adapter').",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const scaffold_module_variants = [GENERIC]
