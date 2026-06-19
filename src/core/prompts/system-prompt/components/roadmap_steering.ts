import { AUTO_GOVERNANCE, formatKanbanGateStatusLine } from "@/services/roadmap/RoadmapAutoGovernance"
import { getRoadmapConfig } from "@/services/roadmap/RoadmapConfig"
import { sessionBrief } from "@/services/roadmap/RoadmapSession"
import { SystemPromptSection } from "../templates/placeholders"
import type { ComponentFunction } from "../types"

export const getRoadmapSteeringSection: ComponentFunction = async (_variant, context) => {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled || !context.cwd) {
		return ""
	}

	const brief = await sessionBrief(context.cwd)
	if (!brief || brief.success === false) {
		return ""
	}

	const identity = brief.project_identity_line || brief.steering_brief || "this project"
	const nextCall = brief.agent_next_call || brief.first_call || "roadmap(action='guide')"
	const gate = (brief.roadmap_gate || {}) as Record<string, unknown>
	const blocking = (gate.blocking_gates || []) as Array<{ id?: string }>
	const gateStatus =
		formatKanbanGateStatusLine({
			kanbanCompleteAllowed: brief.kanban_complete_allowed as boolean | undefined,
			validationPending: !!brief.validation_pending,
			schemaValid: brief.schema_valid as boolean | null | undefined,
			blockingGates: blocking,
		}) || ""
	const governanceNote =
		brief.auto_clearable_governance_only || brief.validation_pending || brief.bootstrap_complete === false
			? AUTO_GOVERNANCE.continueTaskMidPass
			: AUTO_GOVERNANCE.validationAtCompletion

	return `=== ${SystemPromptSection.ROADMAP_STEERING} ===

# Auto-Rolling Roadmap

ROADMAP.md at the workspace root is the long-horizon steering surface — not a backlog.

**Project:** ${identity}
**Phase:** ${brief.phase || "unknown"}
**Health:** ${brief.health_status || "unknown"}
**Prime directive:** Did the latest work strengthen or weaken the project's center of gravity?

**Auto-governance at completion:** ${AUTO_GOVERNANCE.bootstrapAtCompletion} ${AUTO_GOVERNANCE.validationAtCompletion} ${AUTO_GOVERNANCE.checkpointTouchAtCompletion} ${AUTO_GOVERNANCE.noManualValidate}

**Mid-task guidance:** ${governanceNote}
${gateStatus ? `\n**Gate status:** ${gateStatus}` : ""}

**Recommended next call:** ${nextCall}

Tool actions (optional — governance is internal at \`attempt_completion\`):
- \`/roadmap cockpit\` — operator one-screen summary
- \`/roadmap doctor\` — production health checks
- \`/roadmap explain-gate\` / \`/roadmap explain-stale\` — diagnostics when blocked
- \`roadmap(action='guide')\` — phase, gates, steering digest
- \`roadmap(action='checkpoint')\` — full evidence before major direction changes
- \`roadmap(action='apply_bootstrap_fill')\` — preview evidence autofill (write runs automatically at completion)
- \`roadmap(action='progress', context='--current')\` — gate snapshot + recent activity

If \`attempt_completion\` is blocked by roadmap gates, edit ROADMAP.md per the gate message — do not call validate or MCP for governance.`
}
