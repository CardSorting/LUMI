import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## ast_repair
 * Description: Applies high-fidelity AST repairs to specific TypeScript logic violations. Use this when you have specific line/column diagnostics from a build failure or stability sweep.
 * Parameters:
 * - diagnostics: (required) Array of ForensicDiagnostic objects to repair.
 */

const id = DietCodeDefaultTool.STABILITY_HEAL

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "ast_repair",
	description:
		"Applies high-fidelity AST repairs to specific TypeScript logic violations. Target specific line/column errors identified during build or stability sweep.",
	parameters: [
		{
			name: "diagnostics",
			required: true,
			type: "array",
			instruction: "List of diagnostics to repair.",
			items: {
				type: "object",
				properties: {
					file: { type: "string", description: "Path to the file." },
					line: { type: "integer", description: "1-indexed line number." },
					column: { type: "integer", description: "1-indexed column number." },
					code: { type: "integer", description: "TS error code (e.g. 2304)." },
					message: { type: "string", description: "The error message." },
				},
				required: ["file", "line", "column", "code", "message"],
			},
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const ast_repair_variants = [GENERIC]
