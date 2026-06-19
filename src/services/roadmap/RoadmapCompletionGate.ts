import * as fs from "fs/promises"
import * as path from "path"
import {
	AUTO_GOVERNANCE,
	buildRoadmapGateStructuredEnvelope,
	formatBlockingGatesList,
	formatRemediationNote,
	STALE_AUTO_TOUCH_REASONS,
} from "./RoadmapAutoGovernance"
import { getRoadmapConfig } from "./RoadmapConfig"
import { blockingClosedGates } from "./RoadmapGateCatalog"
import { findBootstrapPlaceholders } from "./RoadmapSchema"
import { RoadmapService } from "./RoadmapService"

export interface RoadmapCompletionBlock {
	blocked: boolean
	message?: string
	blockingGates?: Array<{ id?: string; label: string; why: string; fix: string }>
	remediationSteps?: string[]
}

/** Internal pre-completion remediation — no agent tool or MCP calls. */
export async function remediateRoadmapGatesInternally(
	workspace: string,
): Promise<{ steps: string[]; status: Record<string, unknown> }> {
	const svc = RoadmapService.getInstance()
	const cfg = getRoadmapConfig()
	const steps: string[] = []

	const rawState = await svc.readState(workspace)
	const validationWasPending = !!rawState.validation_pending

	const roadmapPath = path.join(workspace, "ROADMAP.md")
	let bootstrapNeeded = false
	try {
		const text = await fs.readFile(roadmapPath, "utf8")
		bootstrapNeeded = cfg.auto_bootstrap_fill && findBootstrapPlaceholders(text).length > 0
	} catch {
		bootstrapNeeded = false
	}

	if (bootstrapNeeded) {
		try {
			const filled = await svc.writeBootstrapAutofill(workspace, false)
			if (filled?.written && (filled.applied_count ?? 0) > 0) {
				steps.push(`auto-filled ${filled.applied_count} bootstrap placeholder(s) in ROADMAP.md`)
			}
		} catch {
			// non-fatal
		}
	}

	if (validationWasPending || steps.length > 0) {
		try {
			await svc.validateRoadmap(workspace)
			steps.push("auto-validated ROADMAP.md schema")
		} catch {
			// non-fatal
		}
	}

	let liveStatus = await svc.getOperationalStatus(workspace, "", "light")

	if (cfg.warn_on_stale_before_complete) {
		const gate = (liveStatus.roadmap_gate || {}) as Record<string, unknown>
		const staleReason = String(gate.stale_reason || "")
		if (gate.checkpoint_stale && STALE_AUTO_TOUCH_REASONS.has(staleReason)) {
			try {
				const touched = await svc.touchRecentCheckpointDate(workspace)
				if (touched.written) {
					steps.push("auto-stamped Recent Checkpoint date in ROADMAP.md")
					await svc.validateRoadmap(workspace)
					liveStatus = await svc.getOperationalStatus(workspace, "", "light")
				}
			} catch {
				// non-fatal
			}
		}
	}

	return { steps, status: liveStatus }
}

export async function evaluateRoadmapCompletionBlock(workspace: string): Promise<RoadmapCompletionBlock> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) {
		return { blocked: false }
	}

	const { steps, status: liveStatus } = await remediateRoadmapGatesInternally(workspace)
	const remediationNote = formatRemediationNote(steps)

	if (liveStatus.validation_pending) {
		return {
			blocked: true,
			message: AUTO_GOVERNANCE.autoValidateFailed + remediationNote + `\n\n${AUTO_GOVERNANCE.editRoadmapResolve}`,
			remediationSteps: steps,
		}
	}

	if (liveStatus.kanban_complete_allowed === false) {
		const gate = (liveStatus.roadmap_gate || {}) as Record<string, unknown>
		const blockingGates = (gate.blocking_gates || []) as Array<{ label: string; why: string; fix: string; id?: string }>
		const closedGatesMsg = formatBlockingGatesList(blockingGates)
		return {
			blocked: true,
			message:
				`${AUTO_GOVERNANCE.gatesBlockedPrefix}\n` +
				(closedGatesMsg || "- Unknown gate closed") +
				remediationNote +
				`\n\n${AUTO_GOVERNANCE.editRoadmapResolve}`,
			blockingGates,
			remediationSteps: steps,
		}
	}

	return { blocked: false, remediationSteps: steps.length > 0 ? steps : undefined }
}

/** Kernel-style pre-completion gate — mirrors dietcode require_fresh_checkpoint_before_complete. */
export async function requireFreshCheckpointBeforeComplete(workspace: string): Promise<string | null> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) return null

	const block = await evaluateRoadmapCompletionBlock(workspace)
	if (!block.blocked) return null

	const remediated =
		block.remediationSteps && block.remediationSteps.length > 0 ? ` (${block.remediationSteps.join("; ")})` : ""

	if (block.blockingGates && block.blockingGates.length > 0) {
		const first = block.blockingGates[0]
		return (
			`ROADMAP steering gate closed (${first.label}) — ${first.why}. ` +
			`${AUTO_GOVERNANCE.editRoadmapResolve}${remediated}`
		)
	}

	return (block.message || `ROADMAP steering gate closed — ${AUTO_GOVERNANCE.editRoadmapResolve}`) + remediated
}

export function failClosedCompletionMessage(): string {
	return AUTO_GOVERNANCE.gateEvaluationFailed
}

export function isGateBlockingSchema(closedGates: Array<{ id?: string }>, cfg = getRoadmapConfig()): boolean {
	return blockingClosedGates(closedGates as never, cfg).some((g) => g.id === "schema_valid")
}

/** Structured recovery blocks for completion gate agent envelope. */
export function buildRoadmapCompletionExtraBlocks(block: RoadmapCompletionBlock): string[] {
	return [buildRoadmapGateStructuredEnvelope(block)]
}
