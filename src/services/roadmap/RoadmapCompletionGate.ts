import * as fs from "fs/promises"
import * as path from "path"
import {
	AUTO_GOVERNANCE,
	buildRoadmapGateStructuredEnvelope,
	formatBlockingGatesList,
	formatRemediationNote,
	isAutoClearableGovernanceOnly,
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
	dryRunAdvisory?: boolean
	autoClearableOnly?: boolean
}

export interface RoadmapCompletionEvaluateOptions {
	/** Non-mutating preview for preflight readiness — no ROADMAP.md writes. */
	dryRun?: boolean
}

interface RemediationPlan {
	validationWasPending: boolean
	bootstrapNeeded: boolean
	mechanicalStaleTouch: boolean
}

async function buildRemediationPlan(workspace: string, options?: RoadmapCompletionEvaluateOptions): Promise<RemediationPlan> {
	const svc = RoadmapService.getInstance()
	const cfg = getRoadmapConfig()
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

	let mechanicalStaleTouch = false
	if (cfg.warn_on_stale_before_complete) {
		try {
			const liveStatus = await svc.getOperationalStatus(workspace, "", "light")
			const gate = (liveStatus.roadmap_gate || {}) as Record<string, unknown>
			const staleReason = String(gate.stale_reason || "")
			mechanicalStaleTouch = !!gate.checkpoint_stale && STALE_AUTO_TOUCH_REASONS.has(staleReason)
		} catch {
			mechanicalStaleTouch = false
		}
	}

	return { validationWasPending, bootstrapNeeded, mechanicalStaleTouch }
}

function plannedStepsFromPlan(plan: RemediationPlan, executed?: Partial<RemediationPlan>): string[] {
	const steps: string[] = []
	const prefix = executed ? "auto" : "will"
	if (plan.bootstrapNeeded) {
		steps.push(`${prefix}-fill bootstrap placeholders in ROADMAP.md at attempt_completion`)
	}
	if (plan.validationWasPending || plan.bootstrapNeeded) {
		steps.push(`${prefix}-validate ROADMAP.md schema at attempt_completion`)
	}
	if (plan.mechanicalStaleTouch) {
		steps.push(`${prefix}-stamp Recent Checkpoint date in ROADMAP.md at attempt_completion`)
	}
	return steps
}

function isAutoClearableOnlyBlock(liveStatus: Record<string, unknown>): boolean {
	const gate = (liveStatus.roadmap_gate || {}) as Record<string, unknown>
	const blocking = (gate.blocking_gates || []) as Array<{ id?: string }>
	return isAutoClearableGovernanceOnly({
		kanbanCompleteAllowed: liveStatus.kanban_complete_allowed as boolean | undefined,
		validationPending: !!liveStatus.validation_pending,
		schemaValid: liveStatus.schema_valid as boolean | null | undefined,
		blockingGates: blocking,
	})
}

/** Internal pre-completion remediation — no agent tool or MCP calls. */
export async function remediateRoadmapGatesInternally(
	workspace: string,
	options?: RoadmapCompletionEvaluateOptions,
): Promise<{ steps: string[]; status: Record<string, unknown> }> {
	const svc = RoadmapService.getInstance()
	const cfg = getRoadmapConfig()
	const plan = await buildRemediationPlan(workspace, options)

	if (options?.dryRun) {
		const liveStatus = await svc.getOperationalStatus(workspace, "", "light")
		return { steps: plannedStepsFromPlan(plan), status: liveStatus }
	}

	const steps: string[] = []

	if (plan.bootstrapNeeded) {
		try {
			const filled = await svc.writeBootstrapAutofill(workspace, false)
			if (filled?.written && (filled.applied_count ?? 0) > 0) {
				steps.push(`auto-filled ${filled.applied_count} bootstrap placeholder(s) in ROADMAP.md`)
			}
		} catch {
			// non-fatal
		}
	}

	if (plan.validationWasPending || steps.length > 0) {
		try {
			await svc.validateRoadmap(workspace)
			steps.push("auto-validated ROADMAP.md schema")
		} catch {
			// non-fatal
		}
	}

	let liveStatus = await svc.getOperationalStatus(workspace, "", "light")

	if (plan.mechanicalStaleTouch) {
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

	return { steps, status: liveStatus }
}

export async function evaluateRoadmapCompletionBlock(
	workspace: string,
	options?: RoadmapCompletionEvaluateOptions,
): Promise<RoadmapCompletionBlock> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) {
		return { blocked: false }
	}

	const { steps, status: liveStatus } = await remediateRoadmapGatesInternally(workspace, options)

	if (options?.dryRun) {
		if (liveStatus.kanban_complete_allowed === false && isAutoClearableOnlyBlock(liveStatus)) {
			return {
				blocked: false,
				remediationSteps: steps,
				dryRunAdvisory: true,
				autoClearableOnly: true,
				message: `${AUTO_GOVERNANCE.continueTaskMidPass} Planned: ${steps.join("; ")}.`,
			}
		}
	}

	const remediationNote = formatRemediationNote(steps)

	if (liveStatus.validation_pending) {
		return {
			blocked: true,
			message: AUTO_GOVERNANCE.autoValidateFailed + remediationNote + `\n\n${AUTO_GOVERNANCE.editRoadmapResolve}`,
			remediationSteps: steps,
			autoClearableOnly: false,
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
			autoClearableOnly: false,
		}
	}

	return { blocked: false, remediationSteps: steps.length > 0 ? steps : undefined, dryRunAdvisory: options?.dryRun }
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
	return [
		buildRoadmapGateStructuredEnvelope({
			remediationSteps: block.remediationSteps,
			blockingGates: block.blockingGates,
			autoClearableOnly: block.autoClearableOnly ?? block.dryRunAdvisory ?? false,
		}),
	]
}
