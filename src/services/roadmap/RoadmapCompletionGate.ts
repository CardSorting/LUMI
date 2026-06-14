import { getRoadmapConfig } from "./RoadmapConfig"
import { blockingClosedGates } from "./RoadmapGateCatalog"
import { RoadmapService } from "./RoadmapService"

export interface RoadmapCompletionBlock {
	blocked: boolean
	message?: string
	retryCommand?: string
	blockingGates?: Array<{ id?: string; label: string; why: string; fix: string }>
}

export async function evaluateRoadmapCompletionBlock(
	workspace: string,
	status?: Record<string, unknown>,
): Promise<RoadmapCompletionBlock> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) {
		return { blocked: false }
	}

	const liveStatus = status || (await RoadmapService.getInstance().getOperationalStatus(workspace, "", "light"))

	if (liveStatus.validation_pending) {
		return {
			blocked: true,
			message:
				"Task completion blocked: ROADMAP.md has pending modifications that must be validated first.\n" +
				"Please run: roadmap(action='validate')",
			retryCommand: "roadmap(action='validate')",
		}
	}

	if (liveStatus.kanban_complete_allowed === false) {
		const gate = (liveStatus.roadmap_gate || {}) as Record<string, unknown>
		const blockingGates = (gate.blocking_gates || []) as Array<{ label: string; why: string; fix: string; id?: string }>
		const closedGatesMsg = blockingGates.map((g) => `- ${g.label}: ${g.why}. Fix: ${g.fix}`).join("\n")
		return {
			blocked: true,
			message:
				"Task completion blocked by Roadmap Governance Gates:\n" +
				(closedGatesMsg || "- Unknown gate closed") +
				"\n\nPlease resolve these gates before calling attempt_completion.",
			retryCommand: "roadmap(action='explain_gate')",
			blockingGates,
		}
	}

	return { blocked: false }
}

/** Kernel-style pre-completion gate — mirrors dietcode require_fresh_checkpoint_before_complete. */
export async function requireFreshCheckpointBeforeComplete(workspace: string): Promise<string | null> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) return null

	const block = await evaluateRoadmapCompletionBlock(workspace)
	if (!block.blocked) return null

	if (block.blockingGates && block.blockingGates.length > 0) {
		const first = block.blockingGates[0]
		return (
			`ROADMAP steering gate closed (${first.label}) — ${first.why}. ` +
			`Fix: ${first.fix}. Diagnostic: roadmap(action='explain_gate')`
		)
	}

	return block.message || "ROADMAP steering gate closed — roadmap(action='explain_gate')"
}

export function failClosedCompletionMessage(): string {
	return (
		"Task completion blocked: roadmap gate evaluation failed.\n" +
		"Run roadmap(action='doctor') to diagnose, then roadmap(action='explain_gate') if gates remain closed."
	)
}

export function isGateBlockingSchema(closedGates: Array<{ id?: string }>, cfg = getRoadmapConfig()): boolean {
	return blockingClosedGates(closedGates as never, cfg).some((g) => g.id === "schema_valid")
}
