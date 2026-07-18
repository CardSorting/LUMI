import { createHash } from "node:crypto"
import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { flushTaskGeneration, getJoyRideCache } from "@core/joyride"
import { formatResponse } from "@core/prompts/responses"
import { maybeTransitionToReplanMode } from "@core/task/utils/replanModeTransition"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { telemetryService } from "@services/telemetry"
import { findLastIndex } from "@shared/array"
import { type GatePolicyProvenance, resolveCompletionGateOptions } from "@shared/audit/auditGatePolicyLoader"
import { resolvePlanBaselineMetadata } from "@shared/audit/auditMessages"
import { buildPreCompletionChecklistBlock, buildPreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { enrichAuditMetadataWithArtifactPaths, persistAuditWorkspaceArtifacts } from "@shared/audit/auditWorkspaceArtifacts"
import { buildAuditHookMetadata, scheduleCompletionAuditPersistence } from "@shared/audit/completionAudit"
import { detectReplanIntent } from "@shared/detectReplanIntent"
import { COMPLETION_RESULT_CHANGES_FLAG, type DietCodeMessage, type TaskAuditMetadata } from "@shared/ExtensionMessage"
import { CoordinationError, CoordinationErrorCode } from "@shared/governance/CoordinationErrors"
import type { LockClaim } from "@shared/governance/lockTypes"
import { Logger } from "@shared/services/Logger"
import { DietCodeDefaultTool } from "@shared/tools"
import { configuredCoordinationAuthorityMode } from "@/core/governance/LockAuthority"
import { SWARM_LOCK_PROTOCOL_VERSION, SwarmMutexService } from "@/core/swarm/SwarmMutexService"
import { getCoordinationRawDb } from "@/infrastructure/db/Config"
import { finalizeRoadmapSession } from "@/services/roadmap/RoadmapLifecycle"
import { showNotificationForApproval } from "../../utils"
import { buildUserFeedbackContent } from "../../utils/buildUserFeedbackContent"
import {
	buildCompletionGateReadinessBlock,
	buildCompletionPreflightReadinessBrief,
	buildProactiveCompletionGuidance,
	getLatestCheckpointHashFromMessages,
	markCompletionAttemptFinished,
	markPreflightReadinessHintEmitted,
	markProactiveCompletionGuidanceEmitted,
	resolveAuditStateIdentifier,
	shouldEmitPreflightReadinessHint,
	shouldEmitProactiveCompletionGuidance,
	shouldRejectDoubleCheckCompletion,
	validateCompletionResultQuality,
} from "../attemptCompletionUtils"
import { evaluateGateLifecycle, latchEngineeringVerified, publishGateLifecycleStatus } from "../completion/GateLifecycleEvaluator"
import {
	type CompletionAuditGateResult,
	evaluateCompletionAuditGate,
	evaluateGatePreflightReadinessAsync,
	runCompletionPreflightChecks,
} from "../completionGatePipeline"
import type { TaskConfig } from "../types/TaskConfig"
import type { IPartialBlockHandler, IToolHandler, ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { getTaskCompletionTelemetry } from "../utils"
import { ToolResultUtils } from "../utils/ToolResultUtils"
import { getInitialTaskPreview } from "../utils/taskPreview"

async function buildAuditGateOptions(
	config: TaskConfig,
	extras?: {
		advisoryMetadata?: TaskAuditMetadata
		planBaselineMetadata?: TaskAuditMetadata
	},
) {
	return resolveCompletionGateOptions(config, config.cwd, {
		...extras,
		lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
	})
}

function scheduleRoadmapFinalization(config: TaskConfig): void {
	const scope = "roadmap-finalization"
	config.latencyTracker?.mark("persistence_scheduled", { scope })
	void finalizeRoadmapSession(config.cwd, config.taskId)
		.then(() => config.latencyTracker?.mark("persistence_completed", { scope }))
		.catch((error) => {
			config.latencyTracker?.mark("persistence_failed", { scope })
			Logger.warn("[AttemptCompletionHandler] Deferred roadmap finalization skipped:", error)
		})
}

function schedulePendingCompletionAuditPersistence(config: TaskConfig): void {
	const pending = config.taskState.pendingCompletionAuditPersistence
	if (!pending) return
	config.taskState.pendingCompletionAuditPersistence = undefined
	scheduleCompletionAuditPersistence(config.taskId, pending, config.latencyTracker)
}

async function persistAuditArtifactsIfEnabled(
	config: TaskConfig,
	metadata: TaskAuditMetadata,
	event: "completion" | "gate_block",
	gateOptions?: Awaited<ReturnType<typeof buildAuditGateOptions>>,
	policyProvenance?: GatePolicyProvenance,
): Promise<TaskAuditMetadata> {
	if (!config.auditWorkspaceArtifactsEnabled) {
		return metadata
	}
	try {
		const result = await persistAuditWorkspaceArtifacts({
			cwd: config.cwd,
			taskId: config.taskId,
			metadata,
			event,
			includeSarif: config.auditSarifHookExportEnabled,
			gateOptions: gateOptions ?? (await buildAuditGateOptions(config)),
			gatePolicySettings: config,
			policyProvenance,
		})
		if (result) {
			return enrichAuditMetadataWithArtifactPaths(metadata, result)
		}
	} catch (error) {
		Logger.warn("[AttemptCompletionHandler] Failed to persist audit workspace artifacts:", error)
	}
	return metadata
}

export interface CompletionDecision {
	status: "approved" | "blocked_recoverable" | "blocked_terminal"
	code:
		| "COMPLETION_APPROVED"
		| "ROADMAP_REMEDIATION_REQUIRED"
		| "AUDIT_REQUIRED"
		| "STATE_CHANGED_AFTER_AUDIT"
		| "ACTIVE_WORK_REMAINS"
		| "VERIFICATION_FAILED"
		| "INTEGRITY_FAILURE"
	nextTransition:
		| "TERMINAL_SUCCESS"
		| "REMEDIATE_ROADMAP"
		| "RUN_AUDIT"
		| "REVERIFY"
		| "RETURN_TO_EXECUTION"
		| "TERMINAL_FAILURE"
	stateVersion: number
	decisionId: string
	details?: Record<string, unknown>
}

export const COMPLETION_DECISION_SCHEMA_VERSION = 1

export type TaskCompletionStatus = "succeeded" | "failed" | "cancelled"

export interface CompletionDecisionIdentityInput {
	taskId: string
	evaluatedStateVersion: number
	checkpoint: string
	outcome: TaskCompletionStatus
	decisionSchemaVersion: number
}

export interface TaskCompletionRecord {
	taskId: string
	decisionId: string
	status: TaskCompletionStatus
	evaluatedStateVersion: number
	evaluatedCheckpointJson: string
	decisionJson: string
	ownerId: string
	leaseEpoch: string
	fencingToken: string
	committedAt: number
}

interface CompletionRawDatabase {
	exec(sql: string): void
	prepare(sql: string): {
		get(...parameters: unknown[]): unknown
		run(...parameters: unknown[]): { changes: number }
	}
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize)
	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {}
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const child = (value as Record<string, unknown>)[key]
			if (child !== undefined) result[key] = canonicalize(child)
		}
		return result
	}
	if (typeof value === "bigint") return value.toString()
	return value
}

export function canonicalCompletionJson(value: unknown): string {
	return JSON.stringify(canonicalize(value))
}

/**
 * Generates a canonical, schema-versioned decision ID using SHA-256.
 * The digest is computed over sorted, explicit identity fields.
 */
export function canonicalDecisionId(input: CompletionDecisionIdentityInput): string {
	return createHash("sha256").update(canonicalCompletionJson(input)).digest("hex")
}

function parseCompletionRecord(row: unknown): TaskCompletionRecord {
	const record = row as Partial<TaskCompletionRecord>
	if (
		!record ||
		typeof record.taskId !== "string" ||
		typeof record.decisionId !== "string" ||
		(record.status !== "succeeded" && record.status !== "failed" && record.status !== "cancelled") ||
		!Number.isInteger(record.evaluatedStateVersion) ||
		typeof record.evaluatedCheckpointJson !== "string" ||
		typeof record.decisionJson !== "string" ||
		typeof record.ownerId !== "string" ||
		typeof record.leaseEpoch !== "string" ||
		typeof record.fencingToken !== "string" ||
		!Number.isFinite(record.committedAt)
	) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			"Malformed task completion record.",
			"fail_closed",
		)
	}
	let checkpoint: unknown
	try {
		checkpoint = JSON.parse(record.evaluatedCheckpointJson)
		JSON.parse(record.decisionJson)
	} catch (error) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			`Task completion '${record.taskId}' contains invalid JSON.`,
			"fail_closed",
			undefined,
			error,
		)
	}
	if (
		!checkpoint ||
		typeof checkpoint !== "object" ||
		typeof (checkpoint as { checkpoint?: unknown }).checkpoint !== "string"
	) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			`Task completion '${record.taskId}' has an invalid checkpoint payload.`,
			"fail_closed",
		)
	}
	const expectedDecisionId = canonicalDecisionId({
		taskId: record.taskId,
		evaluatedStateVersion: record.evaluatedStateVersion as number,
		checkpoint: (checkpoint as { checkpoint: string }).checkpoint,
		outcome: record.status,
		decisionSchemaVersion: COMPLETION_DECISION_SCHEMA_VERSION,
	})
	if (expectedDecisionId !== record.decisionId) {
		throw new CoordinationError(
			CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
			`Task completion '${record.taskId}' failed decision digest validation.`,
			"fail_closed",
		)
	}
	return record as TaskCompletionRecord
}

export async function durableGetTaskCompletion(taskId: string): Promise<TaskCompletionRecord | undefined> {
	let rawDb: CompletionRawDatabase
	try {
		rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
	} catch (error) {
		throw new CoordinationError(
			CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE,
			"SQLite authority unavailable while reading task completion.",
			"retry",
			undefined,
			error,
		)
	}
	const row = rawDb.prepare("SELECT * FROM task_completions WHERE taskId = ?").get(taskId)
	return row ? parseCompletionRecord(row) : undefined
}

export interface CommitTaskCompletionInput {
	record: TaskCompletionRecord
	resourceKey: string
	currentStateVersion: () => number
}

export type CommitTaskCompletionResult = {
	kind: "committed" | "idempotent" | "duplicate_suppressed"
	record: TaskCompletionRecord
}

/** Strict BEGIN IMMEDIATE terminal CAS with lease, generation, payload, and state-version validation. */
export function commitTaskCompletionTransaction(
	rawDb: CompletionRawDatabase,
	input: CommitTaskCompletionInput,
): CommitTaskCompletionResult {
	rawDb.exec("BEGIN IMMEDIATE")
	try {
		const lease = rawDb.prepare("SELECT * FROM swarm_locks WHERE resource = ?").get(input.resourceKey) as
			| Record<string, unknown>
			| undefined
		if (
			!lease ||
			lease.ownerId !== input.record.ownerId ||
			lease.leaseEpoch !== input.record.leaseEpoch ||
			lease.fencingToken !== input.record.fencingToken ||
			lease.authorityMode !== "sqlite" ||
			Number(lease.protocolVersion) !== SWARM_LOCK_PROTOCOL_VERSION ||
			Number(lease.expiresAt) < Date.now()
		) {
			throw new CoordinationError(
				CoordinationErrorCode.FENCING_TOKEN_REJECTED,
				"Completion lease ownership, epoch, token, protocol, or expiry validation failed.",
				"abort_owner",
			)
		}
		const generation = rawDb
			.prepare("SELECT highestLeaseEpoch, highestFencingToken FROM swarm_lock_generations WHERE resourceKey = ?")
			.get(input.resourceKey) as Record<string, unknown> | undefined
		if (
			!generation ||
			generation.highestLeaseEpoch !== input.record.leaseEpoch ||
			generation.highestFencingToken !== input.record.fencingToken
		) {
			throw new CoordinationError(
				CoordinationErrorCode.FENCING_TOKEN_REJECTED,
				"Completion lease is not the freshest allocated generation.",
				"abort_owner",
			)
		}
		if (input.currentStateVersion() !== input.record.evaluatedStateVersion) {
			throw new CoordinationError(
				CoordinationErrorCode.OWNERSHIP_CHANGED,
				"Task state changed after completion evaluation.",
				"abort_owner",
			)
		}

		const existingRaw = rawDb.prepare("SELECT * FROM task_completions WHERE taskId = ?").get(input.record.taskId)
		if (existingRaw) {
			const existing = parseCompletionRecord(existingRaw)
			if (existing.decisionId === input.record.decisionId) {
				if (
					existing.decisionJson !== input.record.decisionJson ||
					existing.evaluatedCheckpointJson !== input.record.evaluatedCheckpointJson ||
					existing.status !== input.record.status
				) {
					throw new CoordinationError(
						CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
						"The same completion decision ID has a different payload.",
						"fail_closed",
					)
				}
				rawDb.exec("COMMIT")
				return { kind: "idempotent", record: existing }
			}
			if (existing.status === input.record.status) {
				rawDb.exec("COMMIT")
				return { kind: "duplicate_suppressed", record: existing }
			}
			throw new CoordinationError(
				CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
				`Terminal conflict: existing status '${existing.status}', proposed '${input.record.status}'.`,
				"fail_closed",
			)
		}

		rawDb
			.prepare(
				`INSERT INTO task_completions (
					taskId, decisionId, status, evaluatedStateVersion, evaluatedCheckpointJson,
					decisionJson, ownerId, leaseEpoch, fencingToken, committedAt
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.record.taskId,
				input.record.decisionId,
				input.record.status,
				input.record.evaluatedStateVersion,
				input.record.evaluatedCheckpointJson,
				input.record.decisionJson,
				input.record.ownerId,
				input.record.leaseEpoch,
				input.record.fencingToken,
				input.record.committedAt,
			)
		rawDb.exec("COMMIT")
		return { kind: "committed", record: input.record }
	} catch (error) {
		try {
			rawDb.exec("ROLLBACK")
		} catch {}
		throw error
	}
}

async function evaluateCompletionDecision(
	config: TaskConfig,
	result: string,
	taskDescription: string,
	decisionId: string,
	stateVersion: number,
	_command?: string,
): Promise<CompletionDecision> {
	// 1. Check roadmap gate
	try {
		const { evaluateRoadmapCompletionBlock } = require("@/services/roadmap/RoadmapCompletionGate")
		const roadmapBlock = await evaluateRoadmapCompletionBlock(config.cwd)
		if (roadmapBlock.blocked) {
			return {
				status: "blocked_recoverable",
				code: "ROADMAP_REMEDIATION_REQUIRED",
				nextTransition: "REMEDIATE_ROADMAP",
				stateVersion,
				decisionId,
				details: {
					blocker: roadmapBlock.message || "ROADMAP steering gate closed.",
					remediationSteps: roadmapBlock.remediationSteps,
				},
			}
		}
	} catch (error) {
		Logger.warn("[AttemptCompletionHandler] Roadmap completion gate check failed:", error)
	}

	// 2. Lifecycle guard check
	const { evaluateCompletionLifecycle } = await import("../completion/completionSnapshotBuilder")
	const lifecycleDecision = evaluateCompletionLifecycle(config, {
		result,
		taskDescription,
		auditCacheKey: decisionId,
	})

	if (lifecycleDecision.kind === "hard_block") {
		return {
			status: "blocked_terminal",
			code: "VERIFICATION_FAILED",
			nextTransition: "TERMINAL_FAILURE",
			stateVersion,
			decisionId,
			details: { blocker: lifecycleDecision.reason || "Verification failed." },
		}
	}

	if (lifecycleDecision.nextAllowedAction === "run_finalization") {
		return {
			status: "blocked_recoverable",
			code: "ROADMAP_REMEDIATION_REQUIRED",
			nextTransition: "REMEDIATE_ROADMAP",
			stateVersion,
			decisionId,
			details: { blocker: lifecycleDecision.reason },
		}
	}

	if (lifecycleDecision.nextAllowedAction === "modify_workspace") {
		return {
			status: "blocked_recoverable",
			code: "AUDIT_REQUIRED",
			nextTransition: "RUN_AUDIT",
			stateVersion,
			decisionId,
			details: { blocker: lifecycleDecision.reason },
		}
	}

	// 3. Check active work remaining (unsealed lanes)
	if (config.taskState.swarmRuntime && config.taskState.swarmRuntime.lanesComplete < config.taskState.swarmRuntime.lanesTotal) {
		return {
			status: "blocked_recoverable",
			code: "ACTIVE_WORK_REMAINS",
			nextTransition: "RETURN_TO_EXECUTION",
			stateVersion,
			decisionId,
			details: {
				blocker: "Swarm has active, unsealed lanes remaining.",
				lanesComplete: config.taskState.swarmRuntime.lanesComplete,
				lanesTotal: config.taskState.swarmRuntime.lanesTotal,
			},
		}
	}

	// 4. Default approval
	return {
		status: "approved",
		code: "COMPLETION_APPROVED",
		nextTransition: "TERMINAL_SUCCESS",
		stateVersion,
		decisionId,
	}
}

export class AttemptCompletionHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = DietCodeDefaultTool.ATTEMPT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for attempt_completion
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const result = uiHelpers.removeClosingTag(block, "result", block.params.result)
		if (result) {
			await uiHelpers.say("completion_result", result, undefined, undefined, block.partial)
		}
		// We will handle command in the final execution step
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		// Validate required parameters
		if (!result) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "result")
		}
		config.latencyTracker?.mark("completion_validation_started", {
			invocationId: block.call_id,
			toolName: block.name,
			scope: "attempt-completion",
		})

		// Backend-only: the proactive completion guidance and preflight readiness brief
		// (including the machine-parseable <completion_gate_envelope> payload) are diagnostic
		// signals for the gate pipeline, not user-facing chat. We log them and keep the state
		// tracking / observability cache in sync, but never `say()` them into the chat UI —
		// the model receives real gate context through the tool-result return path, and the
		// envelope is cached on taskState for subagent handoff regardless.
		if (shouldEmitProactiveCompletionGuidance(config)) {
			try {
				Logger.debug(
					`[AttemptCompletionHandler] Proactive completion guidance:\n${buildProactiveCompletionGuidance(config)}`,
				)
				markProactiveCompletionGuidanceEmitted(config)
			} catch (error) {
				Logger.warn("[AttemptCompletionHandler] Failed to record proactive completion guidance:", error)
			}
		}

		if (shouldEmitPreflightReadinessHint(config)) {
			void (async () => {
				try {
					const readinessIssues = await evaluateGatePreflightReadinessAsync(
						config,
						{ result, taskProgress: block.params.task_progress, command },
						validateCompletionResultQuality,
						"AttemptCompletionHandler",
					)
					const readinessParts = [
						buildCompletionPreflightReadinessBrief(config),
						buildCompletionGateReadinessBlock(readinessIssues),
					]
					if (config.auditCompletionGateEnabled && config.taskState.lastAdvisoryAudit) {
						const checklistSummary = buildPreCompletionChecklistSummary(
							config.taskState.lastAdvisoryAudit,
							await buildAuditGateOptions(config, {
								planBaselineMetadata: resolvePlanBaselineMetadata(
									config.messageState.getDietCodeMessages(),
									config.taskState.lastPlanAuditMetadata,
								),
							}),
						)
						if (checklistSummary) {
							readinessParts.push(buildPreCompletionChecklistBlock(checklistSummary))
						}
					}
					Logger.debug(`[AttemptCompletionHandler] Preflight readiness brief:\n${readinessParts.join("\n\n")}`)
					markPreflightReadinessHintEmitted(config)
				} catch (error) {
					Logger.warn("[AttemptCompletionHandler] Failed to record preflight readiness hint:", error)
				}
			})()
		}

		const checkpointHash = getLatestCheckpointHashFromMessages(config)
		const taskDescription = getInitialTaskPreview(config) || ""
		const stateIdentifier = await resolveAuditStateIdentifier(config)
		const evaluatedStateVersion = config.taskState.workspaceStateVersion || 0
		const decisionId = canonicalDecisionId({
			taskId: config.taskId,
			evaluatedStateVersion,
			checkpoint: stateIdentifier,
			outcome: "succeeded",
			decisionSchemaVersion: COMPLETION_DECISION_SCHEMA_VERSION,
		})
		const activeLockContainer = config.taskState.activeLockClaim as LockClaim | { lockClaim?: LockClaim } | undefined
		const activeLockClaim =
			activeLockContainer && "lockClaim" in activeLockContainer
				? activeLockContainer.lockClaim
				: (activeLockContainer as LockClaim | undefined)
		const authorityMode = activeLockClaim?.authorityMode ?? configuredCoordinationAuthorityMode()
		const successResponse = [{ type: "text" as const, text: "[attempt_completion] Result: Done" }]
		let existingCompletion: TaskCompletionRecord | undefined

		// Durable state is authoritative in production and is checked before re-evaluation.
		if (authorityMode === "sqlite") {
			try {
				existingCompletion = await durableGetTaskCompletion(config.taskId)
				if (existingCompletion) {
					if (existingCompletion.status !== "succeeded") {
						return formatResponse.toolError(
							`Terminal conflict: task already committed with status '${existingCompletion.status}' (${existingCompletion.decisionId}).`,
						)
					}
					if (existingCompletion.decisionId !== decisionId) {
						Logger.info(
							`[AttemptCompletionHandler] Suppressed duplicate completion ${decisionId}; existing decision is ${existingCompletion.decisionId}.`,
						)
						config.taskState.isTerminalState = true
						config.taskState.lastCompletionDecisionId = existingCompletion.decisionId
						config.taskState.lastCompletionDecisionResult = JSON.stringify(successResponse)
						return successResponse
					}
				}
			} catch (error) {
				const coordination =
					error instanceof CoordinationError
						? error
						: new CoordinationError(
								CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE,
								"SQLite completion authority unavailable.",
								"retry",
								undefined,
								error,
							)
				return formatResponse.toolError(
					JSON.stringify({
						code: coordination.code,
						retryClass: coordination.retryClass,
						message: coordination.message,
					}),
				)
			}
		} else if (config.taskState.lastCompletionDecisionId === decisionId && config.taskState.lastCompletionDecisionResult) {
			Logger.info(
				`[AttemptCompletionHandler] Idempotent completion call for decisionId=${decisionId}. Returning cached result.`,
			)
			return JSON.parse(config.taskState.lastCompletionDecisionResult)
		}

		// ─── Strongly-Typed Completion Decision Evaluation ───
		const completionDecision = await evaluateCompletionDecision(
			config,
			result,
			taskDescription,
			decisionId,
			evaluatedStateVersion,
			command,
		)
		Logger.info(
			`[AttemptCompletionHandler] Completion lifecycle decision: status=${completionDecision.status}, code=${completionDecision.code}`,
		)

		if (completionDecision.status !== "approved") {
			if (existingCompletion?.decisionId === decisionId) {
				return formatResponse.toolError(
					JSON.stringify({
						code: CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
						retryClass: "fail_closed",
						message: "The same completion decision ID now evaluates to a different terminal payload.",
					}),
				)
			}
			config.latencyTracker?.mark("authoritative_completion_decided", {
				invocationId: block.call_id,
				toolName: block.name,
				scope: "rejected",
			})

			// Increment quality counters instead of model mistake counter
			if (completionDecision.status === "blocked_recoverable") {
				if (completionDecision.code === "ROADMAP_REMEDIATION_REQUIRED" || completionDecision.code === "AUDIT_REQUIRED") {
					config.taskState.executionQualityCounters.recoverableCompletionBlocks++
				} else {
					config.taskState.executionQualityCounters.prematureCompletionAttempts++
				}
			} else if (completionDecision.status === "blocked_terminal") {
				config.taskState.executionQualityCounters.prematureCompletionAttempts++
			}

			const structuredError = JSON.stringify(completionDecision, null, 2)
			// Cache error response for idempotency
			config.taskState.lastCompletionDecisionId = decisionId
			config.taskState.lastCompletionDecisionResult = JSON.stringify(formatResponse.toolError(structuredError))
			return formatResponse.toolError(structuredError)
		}

		// ─── Durable CAS Terminalization ───
		if (authorityMode === "sqlite") {
			const checkpointJson = canonicalCompletionJson({ checkpoint: stateIdentifier })
			const decisionJson = canonicalCompletionJson({ decision: completionDecision, result })
			if (existingCompletion?.decisionId === decisionId) {
				if (
					existingCompletion.evaluatedCheckpointJson !== checkpointJson ||
					existingCompletion.decisionJson !== decisionJson
				) {
					return formatResponse.toolError(
						JSON.stringify({
							code: CoordinationErrorCode.COORDINATION_STATE_CORRUPT,
							retryClass: "fail_closed",
							message: "The same completion decision ID has a different payload.",
						}),
					)
				}
				config.taskState.isTerminalState = true
				config.taskState.lastCompletionDecisionId = existingCompletion.decisionId
				config.taskState.lastCompletionDecisionResult = JSON.stringify(successResponse)
				return successResponse
			}
			let commitClaim = activeLockClaim
			let releaseOwnedCompletionLease = false
			try {
				if (commitClaim && (commitClaim.authorityMode !== "sqlite" || !commitClaim.backends.swarmMutex)) {
					throw new CoordinationError(
						CoordinationErrorCode.AUTHORITY_MODE_MISMATCH,
						"A local-test or non-durable claim cannot terminalize through SQLite authority.",
						"fail_closed",
					)
				}
				if (!commitClaim) {
					const lease = await SwarmMutexService.acquireLease(`task-completion:${config.taskId}`, config.taskId, 60_000)
					commitClaim = {
						claimId: `completion:${decisionId}`,
						resourceKey: lease.resource,
						ownerId: lease.ownerId,
						fencingToken: lease.fencingToken,
						leaseEpoch: lease.leaseEpoch,
						authorityMode: "sqlite",
						acquiredAt: lease.createdAt,
						backends: {
							inProcess: false,
							swarmMutex: true,
							roadmapLease: false,
							fileLock: false,
							broccoliFence: false,
						},
					}
					releaseOwnedCompletionLease = true
				}

				const completionRecord: TaskCompletionRecord = {
					taskId: config.taskId,
					decisionId,
					status: "succeeded",
					evaluatedStateVersion,
					evaluatedCheckpointJson: checkpointJson,
					decisionJson,
					ownerId: commitClaim.ownerId,
					leaseEpoch: commitClaim.leaseEpoch,
					fencingToken: commitClaim.fencingToken,
					committedAt: Date.now(),
				}
				const rawDb = (await getCoordinationRawDb()) as CompletionRawDatabase
				const committed = commitTaskCompletionTransaction(rawDb, {
					record: completionRecord,
					resourceKey: commitClaim.resourceKey,
					currentStateVersion: () => config.taskState.workspaceStateVersion || 0,
				})
				if (committed.kind === "duplicate_suppressed") {
					Logger.info(
						`[AttemptCompletionHandler] Suppressed duplicate completion ${decisionId}; existing decision is ${committed.record.decisionId}.`,
					)
				}
			} catch (error) {
				const coordination =
					error instanceof CoordinationError
						? error
						: new CoordinationError(
								CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE,
								"SQLite completion CAS failed.",
								"retry",
								undefined,
								error,
							)
				return formatResponse.toolError(
					JSON.stringify({
						code: coordination.code,
						retryClass: coordination.retryClass,
						message: coordination.message,
					}),
				)
			} finally {
				if (releaseOwnedCompletionLease && commitClaim) {
					await SwarmMutexService.release(
						commitClaim.resourceKey,
						commitClaim.ownerId,
						commitClaim.leaseEpoch,
						commitClaim.fencingToken,
					).catch((error) => Logger.warn("[AttemptCompletionHandler] Completion lease cleanup failed:", error))
				}
			}
		}
		config.taskState.isTerminalState = true

		let auditMetadata: TaskAuditMetadata | undefined
		let planBaseline: TaskAuditMetadata | undefined
		let auditGateResult: CompletionAuditGateResult | undefined

		// Completion diagnostics run only after the canonical action guard allows
		// attempt_completion. Findings are evidence; they never return tool errors.
		const preflightDiagnostics = await runCompletionPreflightChecks(
			config,
			{ result, taskProgress: block.params.task_progress, command },
			"AttemptCompletionHandler",
			{
				validateQuality: validateCompletionResultQuality,
				onFailure: () => undefined,
			},
		)
		if (preflightDiagnostics.length > 0) {
			Logger.debug(
				`[AttemptCompletionHandler] Advisory completion diagnostics:\n${buildCompletionGateReadinessBlock(preflightDiagnostics)}`,
			)
		}

		if (
			shouldRejectDoubleCheckCompletion(config.doubleCheckCompletionEnabled, config.taskState.doubleCheckCompletionPending)
		) {
			config.taskState.doubleCheckCompletionPending = true
			Logger.debug("[AttemptCompletionHandler] Double-check diagnostic is advisory; canonical completion remains allowed.")
		}

		// V225: passive forensic diagnostic.
		if (config.universalGuard) {
			void config.universalGuard.checkForensicCompliance().then((compliance) => {
				if (!compliance.compliant && compliance.advisory) {
					Logger.debug(`[AttemptCompletionHandler] Forensic advisory:\n${compliance.advisory}`)
				}
			})
		}

		// Capture hardening and safety evidence without affecting execution.
		auditGateResult = await evaluateCompletionAuditGate(config, {
			result,
			taskDescription,
			logPrefix: "AttemptCompletionHandler",
		})

		if (auditGateResult.status === "advisory_passed" || auditGateResult.status === "advisory_failed") {
			auditMetadata = auditGateResult.auditMetadata
			planBaseline =
				auditGateResult.status === "advisory_passed"
					? auditGateResult.planBaseline
					: resolvePlanBaselineMetadata(
							config.messageState.getDietCodeMessages(),
							config.taskState.lastPlanAuditMetadata,
						)

			telemetryService.captureAuditGateEvaluation(config.ulid, {
				taskId: config.taskId,
				blocked: false,
				score: auditGateResult.gateDecision.score,
				effectiveThreshold: auditGateResult.gateDecision.effectiveThreshold,
				grade: auditGateResult.gateDecision.grade,
				reasonCodes: auditGateResult.gateDecision.reasons.map((reason) => reason.code),
				suppressedViolationCount: auditMetadata.suppressed_violations?.length ?? 0,
				workspacePolicyApplied: auditGateResult.policyProvenance.workspacePolicyApplied,
			})

			auditMetadata = await persistAuditArtifactsIfEnabled(
				config,
				auditMetadata,
				"completion",
				auditGateResult.gateOptions,
				auditGateResult.policyProvenance,
			)
			config.taskState.lastCompletionAudit = auditMetadata

			if (auditGateResult.status === "advisory_failed") {
				Logger.debug(`[AttemptCompletionHandler] Advisory audit diagnostics:\n${auditGateResult.diagnostics}`)
			}
		} else if (auditGateResult.status === "diagnostic_error") {
			Logger.warn(`[AttemptCompletionHandler] ${auditGateResult.diagnostics}`)
		}

		// The canonical action guard allowed completion; latch verification from
		// that decision, never from advisory quality diagnostics.
		latchEngineeringVerified(config, checkpointHash)
		config.latencyTracker?.mark("authoritative_completion_decided", {
			invocationId: block.call_id,
			toolName: block.name,
			scope: "authoritative-result",
		})
		await publishGateLifecycleStatus(config, evaluateGateLifecycle(config))

		if (auditGateResult.status === "advisory_passed") {
			Logger.debug(
				`[AttemptCompletionHandler] Completion diagnostics passed with score ${auditGateResult.gateDecision.score}.`,
			)
		}

		// Cache terminal success response for idempotency
		config.taskState.lastCompletionDecisionId = decisionId
		config.taskState.lastCompletionDecisionResult = JSON.stringify(successResponse)

		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Task Completed",
				message: result.replace(/\n/g, " "),
			})
		}

		const addNewChangesFlagToLastCompletionResultMessage = async () => {
			// Add newchanges flag if there are new changes to the workspace
			const hasNewChanges = await config.callbacks.doesLatestTaskCompletionHaveNewChanges()
			const dietcodeMessages = config.messageState.getDietCodeMessages()

			const lastCompletionResultMessageIndex = findLastIndex(
				dietcodeMessages,
				(m: DietCodeMessage) => m.say === "completion_result",
			)
			const lastCompletionResultMessage =
				lastCompletionResultMessageIndex !== -1 ? dietcodeMessages[lastCompletionResultMessageIndex] : undefined
			if (
				lastCompletionResultMessage &&
				lastCompletionResultMessageIndex !== -1 &&
				hasNewChanges &&
				!lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
			) {
				await config.messageState.updateDietCodeMessage(lastCompletionResultMessageIndex, {
					text: lastCompletionResultMessage.text + COMPLETION_RESULT_CHANGES_FLAG,
				})
			}
		}

		// Remove any partial completion_result message that may exist
		// Search backwards since other messages may have been inserted after the partial
		const dietcodeMessages = config.messageState.getDietCodeMessages()
		const partialCompletionIndex = findLastIndex(
			dietcodeMessages,
			(m) => m.partial === true && m.type === "say" && m.say === "completion_result",
		)
		if (partialCompletionIndex !== -1) {
			const updatedMessages = [
				...dietcodeMessages.slice(0, partialCompletionIndex),
				...dietcodeMessages.slice(partialCompletionIndex + 1),
			]
			config.messageState.setDietCodeMessages(updatedMessages)
			await config.messageState.saveDietCodeMessagesAndUpdateHistory()
		}

		let commandResult: ToolResponse | undefined
		const lastMessage = config.messageState.getDietCodeMessages().at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask !== "command") {
				// haven't sent a command message yet so first send completion_result then command
				config.latencyTracker?.mark("result_presentation_started", { scope: "authoritative-result" })
				const completionMessageTs = await config.callbacks.say(
					"completion_result",
					result,
					undefined,
					undefined,
					false,
					auditMetadata,
				)
				config.latencyTracker?.mark("result_presentation_completed", { scope: "authoritative-result" })
				schedulePendingCompletionAuditPersistence(config)
				await config.callbacks.saveCheckpoint(true, completionMessageTs)
				await addNewChangesFlagToLastCompletionResultMessage()
			} else {
				// we already sent a command message, meaning the complete completion message has also been sent
				schedulePendingCompletionAuditPersistence(config)
				await config.callbacks.saveCheckpoint(true)
			}

			// Attempt completion is a special tool where we want to update the focus chain list before the user provides response
			if (!block.partial && config.focusChainSettings.enabled) {
				await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
			}

			// Check if command should be auto-approved
			// attempt_completion commands don't have requires_approval param, so we treat them as safe commands
			const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(DietCodeDefaultTool.BASH)
			const autoApproveSafe = Array.isArray(autoApproveResult) ? autoApproveResult[0] : autoApproveResult

			if (autoApproveSafe) {
				// Auto-approve flow - show command as 'say' instead of 'ask'
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "command")
				await config.callbacks.say("command", command, undefined, undefined, false)
			} else {
				// Manual approval flow - need to ask for approval
				showNotificationForApproval(
					`DietCode wants to execute a command: ${command}`,
					config.autoApprovalSettings.enableNotifications,
				)

				const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("command", command, config)
				if (!didApprove) {
					return formatResponse.toolDenied()
				}
			}

			// Execute the command
			const [userRejected, execCommandResult] = await config.callbacks.executeCommandTool(command, undefined) // no timeout for attempt_completion command

			if (userRejected) {
				config.taskState.didRejectTool = true
				return execCommandResult
			}
			// user didn't reject, but the command may have output
			commandResult = execCommandResult

			telemetryService.captureTaskCompleted(
				config.ulid,
				getTaskCompletionTelemetry(config, auditMetadata, {
					advisoryMetadata: config.taskState.lastAdvisoryAudit,
					planBaseline,
				}),
			)
			try {
				flushTaskGeneration(getJoyRideCache(), config.taskId, "task_completed")
				scheduleRoadmapFinalization(config)
			} catch (error) {
				Logger.warn("[AttemptCompletionHandler] Roadmap session finalize skipped:", error)
			}
		} else {
			// Send the complete completion_result message (partial was already removed above)
			config.latencyTracker?.mark("result_presentation_started", { scope: "authoritative-result" })
			const completionMessageTs = await config.callbacks.say(
				"completion_result",
				result,
				undefined,
				undefined,
				false,
				auditMetadata,
			)
			config.latencyTracker?.mark("result_presentation_completed", { scope: "authoritative-result" })
			schedulePendingCompletionAuditPersistence(config)
			await config.callbacks.saveCheckpoint(true, completionMessageTs)
			await addNewChangesFlagToLastCompletionResultMessage()
			telemetryService.captureTaskCompleted(
				config.ulid,
				getTaskCompletionTelemetry(config, auditMetadata, {
					advisoryMetadata: config.taskState.lastAdvisoryAudit,
					planBaseline,
				}),
			)
			try {
				flushTaskGeneration(getJoyRideCache(), config.taskId, "task_completed")
				scheduleRoadmapFinalization(config)
			} catch (error) {
				Logger.warn("[AttemptCompletionHandler] Roadmap session finalize skipped:", error)
			}
		}

		// we already sent completion_result says, an empty string asks relinquishes control over button and field
		// in case last command was interactive and in partial state, the UI is expecting an ask response. This ends the command ask response, freeing up the UI to proceed with the completion ask.
		if (config.messageState.getDietCodeMessages().at(-1)?.ask === "command_output") {
			await config.callbacks.say("command_output", "")
		}

		if (!block.partial && config.focusChainSettings.enabled) {
			await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
		}

		// Run TaskComplete hook BEFORE presenting the "Start New Task" button
		// At this point we know: task is complete, checkpoint saved, result shown to user
		markCompletionAttemptFinished(config)
		await this.runTaskCompleteHook(config, block)

		const { response, text, images, files: completionFiles } = await config.callbacks.ask("completion_result", "", false)
		const prefix = "[attempt_completion] Result: Done"
		if (response === "yesButtonClicked") {
			return prefix // signals to recursive loop to stop (for now this never happens since yesButtonClicked will trigger a new task)
		}

		await config.callbacks.say("user_feedback", text ?? "", images, completionFiles)

		await maybeTransitionToReplanMode({
			feedback: text,
			currentMode: config.mode,
			yoloModeToggled: config.yoloModeToggled,
			switchToPlanMode: config.callbacks.switchToPlanMode,
			sayInfo: async (message) => {
				await config.callbacks.say("info", message)
			},
		})

		// Run UserPromptSubmit hook when user provides post-completion feedback
		let hookContextModification: string | undefined
		if (text || (images && images.length > 0) || (completionFiles && completionFiles.length > 0)) {
			const userContentForHook = await buildUserFeedbackContent(text, images, completionFiles)

			const hookResult = await config.callbacks.runUserPromptSubmitHook(userContentForHook, "feedback")

			if (hookResult.cancel === true) {
				return formatResponse.toolDenied()
			}

			// Capture hook context modification to add to tool results
			hookContextModification = hookResult.contextModification
		}

		const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
		if (commandResult) {
			if (typeof commandResult === "string") {
				toolResults.push({
					type: "text",
					text: commandResult,
				})
			} else if (Array.isArray(commandResult)) {
				toolResults.push(...commandResult)
			}
		}

		if (text) {
			const replanRequested = detectReplanIntent(text)
			toolResults.push(
				{
					type: "text",
					text: replanRequested
						? "The user has provided feedback requesting a scope pivot. Return to PLAN MODE workflow — explore the updated requirements and present a revised plan via plan_mode_respond before implementing."
						: "The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.",
				},
				{
					type: "text",
					text: `<feedback>\n${text}\n</feedback>`,
				},
			)
		}

		// Add hook context modification if provided
		if (hookContextModification) {
			toolResults.push({
				type: "text" as const,
				text: `<hook_context source="UserPromptSubmit">\n${hookContextModification}\n</hook_context>`,
			})
		}

		const fileContentString = completionFiles?.length ? await processFilesIntoText(completionFiles) : ""
		if (fileContentString) {
			toolResults.push({
				type: "text" as const,
				text: fileContentString,
			})
		}

		if (images && images.length > 0) {
			toolResults.push(...formatResponse.imageBlocks(images))
		}

		// Return the tool results as a complex response
		return [
			{
				type: "text" as const,
				text: prefix,
			},
			...toolResults,
		]
	}

	/**
	 * Runs the TaskComplete hook after user confirms task completion.
	 * This is a non-cancellable, observation-only hook similar to TaskCancel.
	 * Errors are logged but do not affect task completion.
	 */
	private async runTaskCompleteHook(config: TaskConfig, block: ToolUse): Promise<void> {
		const hooksEnabled = getHooksEnabledSafe()
		if (!hooksEnabled) {
			return
		}

		try {
			const { executeHook } = await import("@core/hooks/hook-executor")

			const gateOptions = config.taskState.lastCompletionAudit ? await buildAuditGateOptions(config) : undefined

			await executeHook({
				hookName: "TaskComplete",
				hookInput: {
					taskComplete: {
						taskMetadata: {
							taskId: config.taskId,
							ulid: config.ulid,
							result: block.params.result || "",
							command: block.params.command || "",
							...(config.taskState.lastCompletionAudit
								? buildAuditHookMetadata(config.taskState.lastCompletionAudit, {
										includeSarif: config.auditSarifHookExportEnabled,
										gateOptions,
										taskUri: `task://${config.taskId}`,
									})
								: {}),
						},
					},
				},
				isCancellable: false, // Non-cancellable - task is already complete
				say: config.callbacks.say,
				setActiveHookExecution: undefined, // Explicitly undefined for non-cancellable hooks
				clearActiveHookExecution: undefined, // Explicitly undefined for non-cancellable hooks
				messageStateHandler: config.messageState,
				taskId: config.taskId,
				hooksEnabled,
			})
		} catch (error) {
			// TaskComplete hook failed - non-fatal, just log
			Logger.error("[TaskComplete Hook] Failed (non-fatal):", error)
		}
	}
}
