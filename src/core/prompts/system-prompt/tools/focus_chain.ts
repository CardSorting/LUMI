import { ModelFamily } from "@/shared/prompts"
import { CodemarieDefaultTool } from "@/shared/tools"
import type { CodemarieToolSpec } from "../spec"

// HACK: Placeholder to act as tool dependency
const generic: CodemarieToolSpec = {
	variant: ModelFamily.GENERIC,
	id: CodemarieDefaultTool.TODO,
	name: "focus_chain",
	description: "",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

export const focus_chain_variants = [generic]
