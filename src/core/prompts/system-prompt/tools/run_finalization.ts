import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"

const id = DietCodeDefaultTool.RUN_FINALIZATION

const generic: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "run_finalization",
	description: `Run same-session documentation and ledger finalization after engineering is verified. Use this when completion retry is locked or when documentation (.wiki/) still needs to be updated. Does not re-run engineering work. Call with seal=true after finalization succeeds to emit a sealed receipt and end the session without another attempt_completion.`,
	parameters: [
		{
			name: "seal",
			required: false,
			instruction: "Set to true to emit the sealed receipt and end the session after finalization evidence exists.",
			usage: "true",
		},
		{
			name: "summary",
			required: false,
			instruction: "Optional operator-facing summary included in the sealed receipt.",
			usage: "Optional summary",
		},
	],
}

export const run_finalization_variants = [generic]
