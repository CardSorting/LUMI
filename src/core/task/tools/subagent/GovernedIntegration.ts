import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type {
	ClaimHistoryEntry,
	GovernedAdmissionResult,
	GovernedAuditIntegration,
	GovernedCrashPhase,
	GovernedOrchestrationLease,
	GovernedRoadmapLinkage,
	LaneExecutionReceipt,
	MergeGateResult,
	RoadmapCompletionOutcome,
	RoadmapCompletionUpdatePolicy,
} from "@shared/subagent/governedExecution"
import { buildRoadmapLeaseTaskId } from "@shared/subagent/governedExecution"
import type { TaskConfig } from "@/core/task/index"
import type { GatePreflightReadinessIssue } from "@/core/task/tools/completionGatePipeline"
import { evaluateGatePreflightReadinessAsync } from "@/core/task/tools/completionGatePipeline"
import { evaluateRoadmapCompletionBlock } from "@/services/roadmap/RoadmapCompletionGate"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { parseDependsOnFromPrompt, parseRoadmapItemFromPrompt } from "./LockNecessity"

/** MergeGate reconciles parallel lane artifacts; workspace audit runs via completionGatePipeline. */
export const MERGE_GATE_ROLE = "commit_barrier" as const

export const ROADMAP_INTEGRATION_PARTIAL = [
	"per_lane_scheduleAdmission_on_lock_acquire",
	"roadmap_item_linkage_via_prompt_tags_only",
] as const

export const AUDIT_STORAGE_BOUNDARY =
	"Governed receipts and swarm envelopes persist under task subagent_executions/; BroccoliDB CAS audit_events are not written by the governed coordinator." as const

export const BROCCOLI_SUBSTRATE_BOUNDARY =
	"BroccoliDB is used for lock fencing and replay substrate only; governed audit evidence is receipt-local under subagent_executions/." as const

export function buildLaneDependencyMap(prompts: string[], params?: Record<string, string | undefined>): Map<number, number[]> {
	const deps = new Map<number, number[]>()
	for (let index = 0; index < prompts.length; index++) {
		const laneKey = `depends_on_${index + 1}`
		const fromParam = params?.[laneKey]?.trim() || params?.depends_on?.trim()
		const fromPrompt = parseDependsOnFromPrompt(prompts[index])
		const raw = fromParam || (fromPrompt.length ? fromPrompt.join(",") : "")
		if (!raw) {
			continue
		}
		const indices = raw
			.split(",")
			.map((part) => Number.parseInt(part.trim(), 10))
			.filter((n) => Number.isFinite(n) && n >= 0 && n < prompts.length && n !== index)
		if (indices.length) {
			deps.set(index, [...new Set(indices)])
		}
	}
	return deps
}

export function buildLaneRoadmapItemMap(prompts: string[], params?: Record<string, string | undefined>): Map<number, string> {
	const items = new Map<number, string>()
	for (let index = 0; index < prompts.length; index++) {
		const laneKey = `roadmap_item_${index + 1}`
		const fromParam = params?.[laneKey]?.trim()
		const fromPrompt = parseRoadmapItemFromPrompt(prompts[index])
		const item = fromParam || fromPrompt
		if (item) {
			items.set(index, item)
		}
	}
	return items
}

export async function captureRoadmapLinkage(
	workspace: string,
	swarmId: string,
	admission: GovernedAdmissionResult,
	laneReceipts: LaneExecutionReceipt[],
	options?: {
		orchestrationLease?: GovernedOrchestrationLease
		completionPolicy?: RoadmapCompletionUpdatePolicy
		completionOutcome?: RoadmapCompletionOutcome
		workspaceRoadmapSnapshotId?: string
		swarmRoadmapPlan?: import("@shared/subagent/roadmapProjection").SwarmRoadmapPlan
		patchReconciliation?: import("@shared/subagent/roadmapProjection").RoadmapPatchReconciliation
		workspaceCommit?: import("@shared/subagent/roadmapProjection").RoadmapWorkspaceCommitResult
	},
): Promise<GovernedRoadmapLinkage> {
	const roadmapEnabled = admission.roadmapEnabled ?? false
	const orchestrationLeaseTaskIds = laneReceipts.map((lane) => buildRoadmapLeaseTaskId(swarmId, lane.index))
	const laneRoadmapItems = laneReceipts.map((lane) => ({
		index: lane.index,
		laneId: lane.laneId,
		roadmapItemId: lane.roadmapItemId,
		roadmapLeaseTaskId: lane.roadmapLeaseTaskId || buildRoadmapLeaseTaskId(swarmId, lane.index),
	}))

	const linkage: GovernedRoadmapLinkage = {
		operation: admission.operation,
		roadmapEnabled,
		pressureScore: admission.pressureScore,
		orchestrationLeaseTaskIds,
		laneRoadmapItems,
		orchestrationLease: options?.orchestrationLease,
		completionPolicy: options?.completionPolicy,
		completionOutcome: options?.completionOutcome,
		workspaceRoadmapSnapshotId: options?.workspaceRoadmapSnapshotId,
		swarmRoadmapPlan: options?.swarmRoadmapPlan,
		agentProjections: laneReceipts
			.filter((lane) => lane.agentRoadmapId)
			.map((lane) => ({
				agentRoadmapId: lane.agentRoadmapId!,
				laneId: lane.laneId,
				agentId: lane.agentId,
				projectedItems: lane.projectedItems ?? [],
			})),
		patchReconciliation: options?.patchReconciliation,
		workspaceCommit: options?.workspaceCommit,
		incompleteIntegration: roadmapEnabled ? [...ROADMAP_INTEGRATION_PARTIAL] : ["roadmap_disabled"],
	}

	if (!roadmapEnabled) {
		return linkage
	}

	try {
		const status = await RoadmapService.getInstance().getOperationalStatus(workspace, "", "light")
		linkage.nowItemCount = Array.isArray(status.now_items) ? status.now_items.length : undefined
		linkage.validationPending = !!status.validation_pending
		linkage.kanbanCompleteAllowed = status.kanban_complete_allowed as boolean | undefined
		const block = await evaluateRoadmapCompletionBlock(workspace, { dryRun: true })
		if (block.blocked && block.message) {
			linkage.completionAdvisory = block.message
		}
	} catch {
		linkage.completionAdvisory = "roadmap operational status unavailable at seal"
	}

	return linkage
}

export async function runGovernedSwarmAuditPreflight(
	config: TaskConfig,
	swarmSummary: string,
): Promise<GatePreflightReadinessIssue[]> {
	return evaluateGatePreflightReadinessAsync(config, {
		result: swarmSummary,
		taskProgress: swarmSummary,
	})
}

export function auditFalsePositiveLocks(
	laneReceipts: LaneExecutionReceipt[],
	mergeGate: MergeGateResult,
): {
	lockSkippedCount: number
	missingLockViolations: number
} {
	const lockSkippedCount = laneReceipts.filter((lane) => lane.lockRequired === false).length
	const missingLockViolations = mergeGate.violations.filter(
		(v) => v.includes("missing governed lock") || v.includes("performed writes without lock"),
	).length
	return { lockSkippedCount, missingLockViolations }
}

export function summarizePerLaneCompletionAudit(
	agents: SubagentExecutionEnvelope[],
): GovernedAuditIntegration["perLaneCompletionAudit"] {
	return agents.map((agent) => ({
		index: agent.index,
		agentId: agent.agentId,
		phase: agent.phase,
		blocked: agent.phase === "completion_gate" && agent.status === "failed",
	}))
}

export function buildGovernedAuditIntegration(options: {
	preflightIssues: GatePreflightReadinessIssue[]
	laneReceipts: LaneExecutionReceipt[]
	mergeGate: MergeGateResult
	agents: SubagentExecutionEnvelope[]
	receiptIntegrityValid: boolean
	roadmapLinkage?: GovernedRoadmapLinkage
}): GovernedAuditIntegration {
	const { lockSkippedCount, missingLockViolations } = auditFalsePositiveLocks(options.laneReceipts, options.mergeGate)
	const blockingPreflight = options.preflightIssues.filter((i) => i.severity !== "info")

	return {
		preflightIssues: options.preflightIssues.map((issue) => ({
			stage: issue.stage,
			message: issue.message,
			severity: issue.severity,
		})),
		perLaneCompletionAudit: summarizePerLaneCompletionAudit(options.agents),
		mergeGateRole: MERGE_GATE_ROLE,
		workspaceAuditAtPreflight: blockingPreflight.length === 0,
		workspaceAuditAtSeal: options.receiptIntegrityValid && options.mergeGate.passed,
		receiptIntegrityValidated: options.receiptIntegrityValid,
		falsePositiveLockAudit: { lockSkippedCount, missingLockViolations },
		storageBoundary: AUDIT_STORAGE_BOUNDARY,
		roadmapCompletionAdvisory: options.roadmapLinkage?.completionAdvisory,
	}
}

export function swarmSummaryFromEntries(prompts: string[]): string {
	return prompts.map((prompt, index) => `Lane ${index + 1}: ${prompt.slice(0, 200)}`).join("\n")
}

export function resolveGovernedRoadmapCompletionPolicy(
	params?: Record<string, string | undefined>,
): RoadmapCompletionUpdatePolicy {
	const raw = params?.roadmap_completion_update?.trim().toLowerCase()
	if (raw === "enabled" || raw === "true" || raw === "on_sealed_success") {
		return "update_on_sealed_success"
	}
	return "advisory_only"
}

export async function applyGovernedRoadmapCompletionPolicy(options: {
	workspace: string
	policy: RoadmapCompletionUpdatePolicy
	sealed: boolean
	mergePassed: boolean
	integrityValid: boolean
	replayMismatch?: boolean
	unsafeRetry?: boolean
}): Promise<RoadmapCompletionOutcome> {
	if (options.policy === "advisory_only") {
		return { policy: "advisory_only", status: "advisory_only", reason: "default_advisory_only" }
	}
	if (!options.sealed || !options.mergePassed || !options.integrityValid) {
		return { policy: options.policy, status: "blocked", reason: "receipt_not_sealed_success" }
	}
	if (options.replayMismatch) {
		return { policy: options.policy, status: "blocked", reason: "replay_mismatch" }
	}
	if (options.unsafeRetry) {
		return { policy: options.policy, status: "blocked", reason: "unsafe_retry" }
	}

	const block = await evaluateRoadmapCompletionBlock(options.workspace)
	if (block.blocked) {
		return {
			policy: options.policy,
			status: "blocked",
			reason: block.message || "roadmap_completion_blocked",
			remediationSteps: block.remediationSteps,
		}
	}

	return {
		policy: options.policy,
		status: "updated",
		reason: "roadmap_completion_applied",
		remediationSteps: block.remediationSteps,
	}
}

export function inferSwarmCrashPhase(input: {
	laneReceipts: LaneExecutionReceipt[]
	claimHistory: ClaimHistoryEntry[]
	dagRunning: boolean
}): GovernedCrashPhase {
	const acquired = input.claimHistory.filter((entry) => entry.event === "acquired").length
	const released = input.claimHistory.filter((entry) => entry.event === "released").length
	const activeClaims = acquired > released

	const unreleasedLanes = input.laneReceipts.filter((lane) => lane.lockRequired && !lane.claimReleased)
	const completedUnreleased = unreleasedLanes.some((lane) => lane.status === "completed")
	const runningLanes = input.laneReceipts.filter((lane) => lane.status === "running")

	if (activeClaims && input.laneReceipts.length === 0) {
		return "after_claim_before_execution"
	}
	if (completedUnreleased) {
		return "after_execution_before_release"
	}
	if (runningLanes.length > 0 || input.dagRunning) {
		return "during_lane_execution"
	}
	if (input.laneReceipts.length > 0 && unreleasedLanes.length === 0) {
		return "after_release_before_seal"
	}
	return "parent_before_merge_gate"
}

/** Receipts must live under subagent_executions/ — not BroccoliDB CAS audit store. */
export function assertGovernedReceiptStoragePath(artifactPath: string): boolean {
	return artifactPath.includes("subagent_executions/")
}
