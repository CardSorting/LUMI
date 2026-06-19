import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const ROADMAP_ACTIONS =
	"guide | status | explain_gate | explain_stale | progress | watch | checkpoint | doctor | template | apply_bootstrap_fill | validate (diagnostic) | cockpit | evidence | last_error"

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id: DietCodeDefaultTool.ROADMAP,
	name: "roadmap",
	description:
		"Per-project ROADMAP.md steering — living checkpoint for center of gravity, Now/Next/Later, code soup audit, and completion gates. Governance (validate, bootstrap autofill, checkpoint date) runs automatically at attempt_completion — roadmap(action='validate') is diagnostic only. Responses include project_identity_line, governance_policy, _roadmap_operator_hints, agent_playbook, and recommended_next_action.",
	parameters: [
		{
			name: "action",
			required: true,
			type: "string",
			instruction: `Roadmap action. One of: ${ROADMAP_ACTIONS}.`,
		},
		{
			name: "context",
			required: false,
			type: "string",
			instruction:
				"Optional context — preview-only for apply_bootstrap_fill (writes run at attempt_completion); 'digest' or 'compact' for slim checkpoint; 'stale refresh' for checkpoint; '--current' or '--tail' for progress.",
		},
		{
			name: "user_request",
			required: false,
			type: "string",
			instruction: "Optional user request text to include in checkpoint briefing.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const CHECKPOINT: DietCodeToolSpec = {
	...GENERIC,
	id: DietCodeDefaultTool.ROADMAP_CHECKPOINT,
	name: "roadmap_checkpoint",
	description:
		"Alias for roadmap(action='checkpoint') — full evidence bundle and checkpoint algorithm before editing ROADMAP.md.",
	parameters: [
		{
			name: "context",
			required: false,
			type: "string",
			instruction: "Optional checkpoint context (e.g. 'stale refresh', 'coherence recovery', 'repair schema').",
		},
		{
			name: "user_request",
			required: false,
			type: "string",
			instruction: "Optional user request text for the checkpoint pass.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const roadmap_variants = [GENERIC, CHECKPOINT]
