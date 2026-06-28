import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"

const id = DietCodeDefaultTool.USE_SUBAGENTS

const generic: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "use_subagents",
	description:
		"Run up to five focused in-process subagents through a bounded, work-conserving pool. Keep critical-path I/O and final synthesis in the parent; delegate substantial, preferably disjoint scopes. Prefix a prompt with [execution_mode:read_only|audit_only|planning_only|documentation_only|diagnostic_only|mutation] to declare its authority. Non-mutating lanes receive only local read/diagnostic tools; use mutation or [write_set:path] whenever a lane may write, run commands, use MCP, or otherwise cause side effects. Add [depends_on:0,1] only for true dependencies, using zero-based lane indices. Each lane returns its result and usage stats.",
	contextRequirements: (context) => context.subagentsEnabled === true && !context.isSubagentRun,
	parameters: [
		{
			name: "prompt_1",
			required: true,
			instruction: "Lane 0 prompt. Give it a concrete, self-contained scope and explicit execution_mode header.",
		},
		{
			name: "prompt_2",
			required: false,
			instruction: "Optional lane 1 prompt. Keep it independent or declare [depends_on:0].",
		},
		{
			name: "prompt_3",
			required: false,
			instruction: "Optional lane 2 prompt. Keep it independent or declare zero-based dependencies.",
		},
		{
			name: "prompt_4",
			required: false,
			instruction: "Optional lane 3 prompt. Keep it independent or declare zero-based dependencies.",
		},
		{
			name: "prompt_5",
			required: false,
			instruction: "Optional lane 4 prompt. Keep it independent or declare zero-based dependencies.",
		},
	],
}

export const subagent_variants = [generic]
