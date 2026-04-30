import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = DietCodeDefaultTool.PROJECT_MAP

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "project_map",
	description:
		"Build a Project Map for planning. Use this before broad grep/read exploration in Plan Mode to identify starting files, connected files, risk areas with mitigations, targeted fact-check searches/reads, confidence, and safe/recommended/refactor choices. Internally this uses structural and cognitive project context when available.",
	parameters: [
		{
			name: "query",
			required: false,
			type: "string",
			instruction: "Plain-language task or feature description to map when no exact file or symbol is known.",
		},
		{
			name: "path",
			required: false,
			type: "string",
			instruction: "Known file path to use as the starting point for structural context.",
		},
		{
			name: "symbol",
			required: false,
			type: "string",
			instruction: "Known function, class, type, or exported symbol to locate and map.",
		},
		{
			name: "maxFiles",
			required: false,
			type: "integer",
			instruction: "Maximum number of files to return in each section. Defaults to 12 and is capped at 30.",
		},
		{
			name: "includeEvidence",
			required: false,
			type: "boolean",
			instruction:
				"Whether to include a concise evidence list explaining which context sources informed the map. Defaults to true.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const project_map_variants = [GENERIC]
