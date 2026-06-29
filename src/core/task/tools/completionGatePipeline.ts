import { createHash } from "node:crypto"
import { telemetryService } from "@services/telemetry"
import {
	applyWorkspaceAuditPolicy,
	type GatePolicyProvenance,
	resolveCompletionGateContext,
} from "@shared/audit/auditGatePolicyLoader"
import { type AuditGateDecision, evaluateAuditGate } from "@shared/audit/auditGateReport"
import { resolvePlanBaselineMetadata } from "@shared/audit/auditMessages"
import { buildPreCompletionChecklistBlock, buildPreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { buildCompletionGateMessage, runCompletionAudit } from "@shared/audit/completionAudit"
import {
	COMPLETION_AUDIT_CACHE_TTL_MS,
	PARENT_PROGRESSIVE_GATE_BLOCK_LIMIT,
	parseIntentThresholdOverrides,
	SUBAGENT_IO_LANE_RESULT_MIN_LENGTH,
} from "@shared/audit/gatePolicy"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import type { LaneExecutionMode } from "@shared/subagent/governedExecution"
import { formatAutoRemediationSummary } from "@/services/roadmap/RoadmapAutoGovernance"
import {
	buildRoadmapCompletionExtraBlocks,
	evaluateRoadmapCompletionBlock,
	failClosedCompletionMessage,
	roadmapPreflightReadinessFromDryRun,
} from "@/services/roadmap/RoadmapCompletionGate"
import { getRoadmapConfig } from "@/services/roadmap/RoadmapConfig"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import {
	appendCompletionGateRetryGuidance,
	buildCompletionAgentErrorMessage,
	type CompletionPreflightStage,
	classifyCompletionPreflightReason,
	detectDuplicateCompletionSubmission,
	getCompletionGateCircuitBreakerError,
	getCompletionGateTelemetryContext,
	getCompletionGraphRevision,
	getLatestCheckpointHashFromMessages,
	isCompletionGateCircuitBreakerTripped,
	mapCompletionReasonToPreflightStage,
	markCompletionGatesPassed,
	recordCompletionAttemptTime,
	recordCompletionGateBlockEvent,
	recordCompletionPreflightFailure,
	validateCompletionAttemptCooldown,
	validateCompletionDemoCommand,
	validateCompletionResultExcludesChecklist,
	validateCompletionResultMaxLength,
	validateCompletionResultMinLength,
	validateCompletionResultQuality,
	validateCompletionTaskProgress,
	validateCompletionTaskProgressRequired,
	validateFocusChainComplete,
	validateTaskProgressAlignsWithFocusChain,
} from "./attemptCompletionUtils"
import { mapPreflightReasonToLifecycleState, publishGateLifecycleStatus } from "./completion/GateLifecycleEvaluator"
import { isNonMutatingMode } from "./subagent/LockNecessity"
import type { TaskConfig } from "./types/TaskConfig"

export type CompletionAuditGateResult =
	| {
			status: "passed"
			auditMetadata: TaskAuditMetadata
			planBaseline?: TaskAuditMetadata
			gateDecision: AuditGateDecision
			gateOptions: Awaited<ReturnType<typeof resolveCompletionGateContext>>["options"]
			policyProvenance: GatePolicyProvenance
	  }
	| {
			status: "blocked"
			message: string
			auditMetadata: TaskAuditMetadata
			gateDecision: AuditGateDecision
			blockCount: number
			gateOptions: Awaited<ReturnType<typeof resolveCompletionGateContext>>["options"]
			policyProvenance: GatePolicyProvenance
	  }
	| { status: "skipped" }
	| { status: "error"; message: string }

function emitCompletionGateBlockTelemetry(
	config: TaskConfig,
	reason: ReturnType<typeof classifyCompletionPreflightReason>,
	blockCount: number,
): void {
	const telemetryContext = getCompletionGateTelemetryContext(config)
	telemetryService.captureCompletionPreflightBlocked(config.ulid, {
		taskId: config.taskId,
		reason,
		blockCount,
		consecutiveMistakes: config.taskState.consecutiveMistakeCount,
		attemptCount: config.taskState.completionAttemptCount ?? 0,
		lastReason: config.taskState.lastCompletionBlockReason,
		failedStage: mapCompletionReasonToPreflightStage(reason),
		pressureLevel: telemetryContext.pressureLevel,
		retryStatus: telemetryContext.retryStatus,
		historyLength: telemetryContext.historyLength,
		sessionId: telemetryContext.sessionId,
	})
}

export { emitCompletionGateBlockTelemetry }

function finalizePreflightError(
	rawMessage: string,
	config: TaskConfig,
	context?: { result?: string; checkpointHash?: string },
): string {
	const reason = classifyCompletionPreflightReason(rawMessage)
	const blockCount = recordCompletionGateBlockEvent(config, reason, context)
	emitCompletionGateBlockTelemetry(config, reason, blockCount)

	const recovery = config.taskState.lastRoadmapGateRecovery
	const extraBlocks =
		recovery && reason === "roadmap_gate"
			? buildRoadmapCompletionExtraBlocks({
					blocked: true,
					remediationSteps: recovery.remediationSteps,
					blockingGates: recovery.blockingGates,
					autoClearableOnly: recovery.autoClearableOnly ?? false,
				})
			: undefined
	config.taskState.lastRoadmapGateRecovery = undefined

	void publishGateLifecycleStatus(config, mapPreflightReasonToLifecycleState(config, reason))

	return buildCompletionAgentErrorMessage(rawMessage, config, {
		result: context?.result,
		extraBlocks,
	})
}

function rejectPreflightStage(
	config: TaskConfig,
	error: string,
	context: { result: string; checkpointHash?: string },
	checks: { onFailure: (config: TaskConfig) => void },
	options?: { soft?: boolean },
): string {
	if (!options?.soft) {
		checks.onFailure(config)
	}
	return finalizePreflightError(error, config, context)
}

type PreflightCheckContext = {
	config: TaskConfig
	params: {
		result: string
		taskProgress?: string
		command?: string
	}
	checkpointHash?: string
	validateQuality: (result: string) => string | null
}

/** Declarative preflight stage registry — order mirrors COMPLETION_PREFLIGHT_STAGES. */
export const PREFLIGHT_STAGE_RUNNERS: ReadonlyArray<{
	stage: CompletionPreflightStage
	validate: (ctx: PreflightCheckContext) => string | null
	soft?: boolean
}> = [
	{
		stage: "quality",
		validate: (ctx) => ctx.validateQuality(ctx.params.result),
	},
	{
		stage: "checklist_in_result",
		validate: (ctx) => validateCompletionResultExcludesChecklist(ctx.params.result),
	},
	{
		stage: "min_length",
		validate: (ctx) => validateCompletionResultMinLength(ctx.params.result),
	},
	{
		stage: "max_length",
		validate: (ctx) => validateCompletionResultMaxLength(ctx.params.result),
	},
	{
		stage: "task_progress_required",
		validate: (ctx) => validateCompletionTaskProgressRequired(ctx.config, ctx.params.taskProgress),
	},
	{
		stage: "task_progress_complete",
		validate: (ctx) => validateCompletionTaskProgress(ctx.params.taskProgress),
	},
	{
		stage: "task_progress_align",
		validate: (ctx) => validateTaskProgressAlignsWithFocusChain(ctx.config, ctx.params.taskProgress),
	},
	{
		stage: "focus_chain",
		validate: (ctx) => validateFocusChainComplete(ctx.config),
	},
	{
		stage: "cooldown",
		validate: (ctx) => validateCompletionAttemptCooldown(ctx.config),
		soft: true,
	},
	{
		stage: "duplicate",
		validate: (ctx) =>
			detectDuplicateCompletionSubmission(ctx.config, ctx.params.result, {
				currentCheckpointHash: ctx.checkpointHash,
			}),
		soft: true,
	},
	{
		stage: "demo_command",
		validate: (ctx) => validateCompletionDemoCommand(ctx.params.command),
	},
]

export type GatePreflightReadinessIssue = {
	stage: CompletionPreflightStage
	message: string
	/** info = non-blocking advisory (e.g. auto-clearable roadmap governance) */
	severity?: "block" | "info"
}

/** Lane-local blocking stages only — parent-only checks deferred to seal barrier (ADR-013). */
export const SUBAGENT_LANE_PREFLIGHT_STAGES = new Set<CompletionPreflightStage>([
	"quality",
	"min_length",
	"max_length",
	"demo_command",
])

/** Non-mutating preflight dry-run — surfaces blockers before attempt_completion (mirrors CI dry-run). */
export function evaluateGatePreflightReadiness(
	config: TaskConfig,
	params: {
		result: string
		taskProgress?: string
		command?: string
	},
	validateQuality: (result: string) => string | null = validateCompletionResultQuality,
): GatePreflightReadinessIssue[] {
	if (isCompletionGateCircuitBreakerTripped(config)) {
		const message = getCompletionGateCircuitBreakerError(config)
		return message ? [{ stage: "circuit_breaker", message }] : []
	}

	const preflightContext: PreflightCheckContext = {
		config,
		params,
		checkpointHash: getLatestCheckpointHashFromMessages(config),
		validateQuality,
	}

	const issues: GatePreflightReadinessIssue[] = []
	for (const runner of PREFLIGHT_STAGE_RUNNERS) {
		const stageError = runner.validate(preflightContext)
		if (stageError) {
			issues.push({ stage: runner.stage, message: stageError, severity: "block" })
		}
	}
	return issues
}

/** Async dry-run — includes roadmap governance stage (mirrors full preflight minus audit). */
export async function evaluateGatePreflightReadinessAsync(
	config: TaskConfig,
	params: {
		result: string
		taskProgress?: string
		command?: string
	},
	validateQuality: (result: string) => string | null = validateCompletionResultQuality,
	logPrefix = "GatePreflightReadiness",
): Promise<GatePreflightReadinessIssue[]> {
	const issues = evaluateGatePreflightReadiness(config, params, validateQuality)
	if (issues.some((issue) => issue.stage === "circuit_breaker")) {
		return issues
	}

	const roadmapError = await evaluateRoadmapCompletionGateError(config, logPrefix, { dryRun: true })
	if (roadmapError) {
		issues.push({ stage: "roadmap", message: roadmapError, severity: "block" })
	} else if (getRoadmapConfig().enabled) {
		try {
			const block = await evaluateRoadmapCompletionBlock(config.cwd, { dryRun: true })
			const advisory = roadmapPreflightReadinessFromDryRun(block)
			if (advisory?.severity === "info") {
				issues.push(advisory)
			}
		} catch {
			// non-fatal — readiness hint must not block completion attempt
		}
	}

	return issues
}

export async function runCompletionPreflightChecks(
	config: TaskConfig,
	params: {
		result: string
		taskProgress?: string
		command?: string
	},
	logPrefix: string,
	checks: {
		validateQuality: (result: string) => string | null
		onFailure: (config: TaskConfig) => void
	},
): Promise<string | null> {
	// Fail fast — circuit breaker before any expensive work (mirrors API gateway patterns).
	const circuitBreakerMessage = getCompletionGateCircuitBreakerError(config)
	if (circuitBreakerMessage) {
		return finalizePreflightError(circuitBreakerMessage, config)
	}

	const checkpointHash = getLatestCheckpointHashFromMessages(config)
	recordCompletionAttemptTime(config)

	const gateContext = { result: params.result, checkpointHash }
	const preflightContext: PreflightCheckContext = {
		config,
		params,
		checkpointHash,
		validateQuality: checks.validateQuality,
	}

	for (const runner of PREFLIGHT_STAGE_RUNNERS) {
		const stageError = runner.validate(preflightContext)
		if (stageError) {
			if (runner.soft) {
				// Non-blocking advisory — mirrors Retry-After without hard stop (ADR parent zen path).
				continue
			}
			return rejectPreflightStage(config, stageError, gateContext, checks, { soft: runner.soft })
		}
	}

	const roadmapError = await evaluateRoadmapCompletionGateError(config, logPrefix)
	if (roadmapError) {
		return finalizePreflightError(roadmapError, config, gateContext)
	}

	return null
}

export function hashCompletionAuditInput(result: string, taskDescription: string, checkpointHash?: string): string {
	return createHash("sha256")
		.update(result.trim())
		.update("|")
		.update(taskDescription.slice(0, 500))
		.update("|")
		.update(checkpointHash ?? "")
		.digest("hex")
}

/** Record advisory audit for completion cache reuse (act-mode, deferred command audit). */
export function recordAdvisoryAuditCache(
	config: TaskConfig,
	result: string,
	taskDescription: string,
	metadata: TaskAuditMetadata,
): void {
	config.taskState.lastAdvisoryAudit = metadata
	config.taskState.lastAdvisoryAuditCacheKey = hashCompletionAuditInput(
		result,
		taskDescription,
		getLatestCheckpointHashFromMessages(config),
	)
	config.taskState.lastAdvisoryAuditCachedAt = Date.now()
}

async function resolveCompletionAuditMetadata(
	config: TaskConfig,
	params: { result: string; taskDescription: string },
): Promise<TaskAuditMetadata> {
	const checkpointHash = getLatestCheckpointHashFromMessages(config)
	const cacheKey = hashCompletionAuditInput(params.result, params.taskDescription, checkpointHash)
	const cachedAt = config.taskState.lastCompletionAuditCachedAt
	const cachedKey = config.taskState.lastCompletionAuditCacheKey
	const cached = config.taskState.lastCompletionAudit
	const currentRevision = getCompletionGraphRevision(config)

	if (cached && cachedKey === cacheKey && config.taskState.lastCompletionAuditGraphRevision === currentRevision) {
		return cached
	}
	if (cached && cachedKey === cacheKey && cachedAt && Date.now() - cachedAt < COMPLETION_AUDIT_CACHE_TTL_MS) {
		return cached
	}

	const advisoryKey = config.taskState.lastAdvisoryAuditCacheKey
	const advisoryAt = config.taskState.lastAdvisoryAuditCachedAt
	const advisory = config.taskState.lastAdvisoryAudit
	if (advisory && advisoryKey === cacheKey && advisoryAt && Date.now() - advisoryAt < COMPLETION_AUDIT_CACHE_TTL_MS) {
		config.taskState.lastCompletionAuditCacheKey = cacheKey
		config.taskState.lastCompletionAuditCachedAt = Date.now()
		config.taskState.lastCompletionAuditGraphRevision = currentRevision
		return advisory
	}

	let auditMetadata = await runCompletionAudit(config.taskId, params.taskDescription, params.result, params.taskDescription)
	auditMetadata = await applyWorkspaceAuditPolicy(config.cwd, auditMetadata, config)
	config.taskState.lastCompletionAuditCacheKey = cacheKey
	config.taskState.lastCompletionAuditCachedAt = Date.now()
	config.taskState.lastCompletionAuditGraphRevision = currentRevision
	return auditMetadata
}

function resolveProgressiveGateOptions(
	config: TaskConfig,
	baseOptions: Awaited<ReturnType<typeof resolveCompletionGateContext>>["options"],
): Awaited<ReturnType<typeof resolveCompletionGateContext>>["options"] {
	const blockCount = config.taskState.completionGateBlockCount ?? 0
	if (blockCount >= PARENT_PROGRESSIVE_GATE_BLOCK_LIMIT) {
		return baseOptions
	}
	return {
		...baseOptions,
		criticalOnly: baseOptions.criticalOnly || true,
	}
}

export async function evaluateRoadmapCompletionGateError(
	config: TaskConfig,
	logPrefix: string,
	options?: { dryRun?: boolean },
): Promise<string | null> {
	const circuitBreakerMessage = getCompletionGateCircuitBreakerError(config)
	if (circuitBreakerMessage) {
		return circuitBreakerMessage
	}

	const roadmapService = RoadmapService.getInstance()
	if (!roadmapService.isEnabled()) {
		return null
	}

	try {
		const block = await evaluateRoadmapCompletionBlock(config.cwd, { dryRun: options?.dryRun })
		if (block.blocked) {
			if (!options?.dryRun) {
				config.taskState.consecutiveMistakeCount++
				config.taskState.lastRoadmapGateRecovery = {
					remediationSteps: block.remediationSteps,
					blockingGates: block.blockingGates,
					autoClearableOnly: block.autoClearableOnly ?? false,
				}
			}
			const remediated = formatAutoRemediationSummary(block.remediationSteps || [])
			const base = block.message || failClosedCompletionMessage()
			return remediated ? `${base}\n\n${remediated}` : base
		}
		if (options?.dryRun && block.dryRunAdvisory) {
			return null
		}
	} catch (error) {
		Logger.error(`[${logPrefix}] Failed to evaluate Roadmap Governance Gates:`, error)
		if (roadmapService.getConfig().fail_closed_completion_gates) {
			if (!options?.dryRun) {
				config.taskState.consecutiveMistakeCount++
			}
			return failClosedCompletionMessage()
		}
	}

	return null
}

export async function evaluateCompletionAuditGate(
	config: TaskConfig,
	params: {
		result: string
		taskDescription: string
		logPrefix: string
	},
): Promise<CompletionAuditGateResult> {
	if (!config.auditCompletionGateEnabled) {
		return { status: "skipped" }
	}

	const checkpointHash = getLatestCheckpointHashFromMessages(config)

	// Fast-path: if the audit cache is still valid (same checkpoint hash, within
	// TTL or same graph revision) and the last gate decision was "passed", reuse it directly.  This
	// avoids redundant filesystem reads in resolveCompletionGateContext and
	// re-evaluation of the audit gate when nothing has changed.
	const cacheKey = hashCompletionAuditInput(params.result, params.taskDescription, checkpointHash)
	const cachedAt = config.taskState.lastCompletionAuditCachedAt
	const cachedKey = config.taskState.lastCompletionAuditCacheKey
	const cachedAudit = config.taskState.lastCompletionAudit
	const currentRevision = getCompletionGraphRevision(config)
	const isCacheValid =
		cachedAudit &&
		cachedKey === cacheKey &&
		((cachedAt && Date.now() - cachedAt < COMPLETION_AUDIT_CACHE_TTL_MS) ||
			config.taskState.lastCompletionAuditGraphRevision === currentRevision)

	if (isCacheValid && config.taskState.engineeringVerifiedAt) {
		// Re-evaluate the gate decision with the cached metadata to produce a
		// fresh result object, but skip the expensive audit run and policy load.
		try {
			const gateContext = await resolveCompletionGateContext(config, config.cwd, {
				lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
			})
			const gateOptions = resolveProgressiveGateOptions(config, gateContext.options)
			const gateDecision = evaluateAuditGate(cachedAudit, gateOptions)
			if (!gateDecision.blocked) {
				markCompletionGatesPassed(config)
				const passContext = getCompletionGateTelemetryContext(config)
				telemetryService.captureCompletionGatesPassed(config.ulid, {
					taskId: config.taskId,
					blockCount: config.taskState.completionGateBlockCount ?? 0,
					attemptCount: config.taskState.completionAttemptCount ?? 0,
					score: gateDecision.score,
					sessionId: passContext.sessionId,
					historyLength: passContext.historyLength,
					pressureLevel: passContext.pressureLevel,
				})
				return {
					status: "passed",
					auditMetadata: cachedAudit,
					gateDecision,
					gateOptions,
					policyProvenance: gateContext.policyProvenance,
				}
			}
		} catch {
			// Fall through to full evaluation if fast-path fails
		}
	}

	try {
		const messages = config.messageState?.getDietCodeMessages?.() ?? []
		const planBaseline = resolvePlanBaselineMetadata(messages, config.taskState.lastPlanAuditMetadata)
		const auditMetadata = await resolveCompletionAuditMetadata(config, params)

		const gateContext = await resolveCompletionGateContext(config, config.cwd, {
			planBaselineMetadata: planBaseline,
			lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
		})
		const gateOptions = resolveProgressiveGateOptions(config, gateContext.options)
		const gateDecision = evaluateAuditGate(auditMetadata, gateOptions)

		if (gateDecision.blocked) {
			config.taskState.consecutiveMistakeCount++
			const blockCount = recordCompletionGateBlockEvent(config, "audit_gate", {
				result: params.result,
				checkpointHash,
			})
			emitCompletionGateBlockTelemetry(config, "audit_gate", blockCount)
			const auditHumanMessage = appendCompletionGateRetryGuidance(
				buildCompletionGateMessage(auditMetadata, {
					scoreThreshold: config.auditCompletionGateThreshold,
					criticalOnly: gateOptions.criticalOnly ?? config.auditCompletionGateCriticalOnly,
					intentAdjustedThreshold: config.auditIntentThresholdAdjustmentsEnabled,
					intentThresholdOverrides: parseIntentThresholdOverrides(config.auditIntentThresholdOverrides),
					advisoryMetadata: config.taskState.lastAdvisoryAudit,
					planBaselineMetadata: planBaseline,
					gateDecision,
				}),
				blockCount,
			)
			const checklistSummary = buildPreCompletionChecklistSummary(auditMetadata, gateOptions)
			const checklistBlock = checklistSummary ? buildPreCompletionChecklistBlock(checklistSummary) : ""
			const message = buildCompletionAgentErrorMessage(auditHumanMessage, config, {
				result: params.result,
				extraBlocks: checklistBlock ? [checklistBlock] : undefined,
			})

			return {
				status: "blocked",
				message,
				auditMetadata,
				gateDecision,
				blockCount,
				gateOptions,
				policyProvenance: gateContext.policyProvenance,
			}
		}

		markCompletionGatesPassed(config)
		const passContext = getCompletionGateTelemetryContext(config)
		telemetryService.captureCompletionGatesPassed(config.ulid, {
			taskId: config.taskId,
			blockCount: config.taskState.completionGateBlockCount ?? 0,
			attemptCount: config.taskState.completionAttemptCount ?? 0,
			score: gateDecision.score,
			sessionId: passContext.sessionId,
			historyLength: passContext.historyLength,
			pressureLevel: passContext.pressureLevel,
		})
		return {
			status: "passed",
			auditMetadata,
			planBaseline,
			gateDecision,
			gateOptions,
			policyProvenance: gateContext.policyProvenance,
		}
	} catch (error) {
		Logger.error(`[${params.logPrefix}] Failed to run completion audit gate:`, error)
		// No hidden fallback — a stale cached audit must never produce a "passed" receipt.
		// The audit layer must be atomically tied to the canonical evaluation snapshot.
		// If the audit infra fails, emit an explicit terminal diagnostic instead.
		config.taskState.consecutiveMistakeCount++
		recordCompletionGateBlockEvent(config, "audit_error")
		emitCompletionGateBlockTelemetry(config, "audit_error", config.taskState.completionGateBlockCount ?? 0)
		return {
			status: "error",
			message: buildCompletionAgentErrorMessage(
				"Task completion blocked: hardening audit evaluation failed. " +
					"Fix the underlying issue or retry after audit services recover.",
				config,
				{ result: params.result },
			),
		}
	}
}

export type CompletionGateFlowResult =
	| { status: "passed"; audit: CompletionAuditGateResult }
	| { status: "blocked"; message: string }

export type SubagentCompletionGateResult = {
	error: string | null
	advisoryAudit?: TaskAuditMetadata
	advisoryWouldBlock?: boolean
}

/** Fast lane preflight — quality/safety only; no parent circuit breaker or gate telemetry. */
export function runSubagentCompletionLanePreflight(
	config: TaskConfig,
	params: {
		result: string
		command?: string
		laneExecutionMode?: LaneExecutionMode
	},
	validateQuality: (result: string) => string | null = validateCompletionResultQuality,
): string | null {
	const preflightContext: PreflightCheckContext = {
		config,
		params,
		validateQuality,
	}
	const ioAuthorityLane = params.laneExecutionMode ? isNonMutatingMode(params.laneExecutionMode) : false

	for (const runner of PREFLIGHT_STAGE_RUNNERS) {
		if (!SUBAGENT_LANE_PREFLIGHT_STAGES.has(runner.stage)) {
			continue
		}
		if (runner.stage === "min_length" && ioAuthorityLane) {
			const trimmed = params.result.trim()
			if (trimmed.length < SUBAGENT_IO_LANE_RESULT_MIN_LENGTH) {
				config.taskState.consecutiveMistakeCount++
				return (
					`Lane completion rejected: result too brief (${trimmed.length} chars, minimum ${SUBAGENT_IO_LANE_RESULT_MIN_LENGTH} for I/O authority lanes). ` +
					"Provide a concise findings summary."
				)
			}
			continue
		}
		const stageError = runner.validate(preflightContext)
		if (stageError) {
			config.taskState.consecutiveMistakeCount++
			return stageError
		}
	}

	return null
}

/**
 * Shadow audit for subagent lanes — records findings without blocking throughput.
 * Full enforcement remains at the parent seal barrier and parent attempt_completion.
 */
export async function evaluateSubagentAdvisoryAudit(
	config: TaskConfig,
	params: {
		result: string
		taskDescription: string
		logPrefix: string
	},
): Promise<{ metadata?: TaskAuditMetadata; wouldBlock: boolean }> {
	if (!config.auditCompletionGateEnabled) {
		return { wouldBlock: false }
	}

	try {
		const messages = config.messageState?.getDietCodeMessages?.() ?? []
		const planBaseline = resolvePlanBaselineMetadata(messages, config.taskState.lastPlanAuditMetadata)
		let auditMetadata = await runCompletionAudit(config.taskId, params.taskDescription, params.result, params.taskDescription)
		auditMetadata = await applyWorkspaceAuditPolicy(config.cwd, auditMetadata, config)

		const gateContext = await resolveCompletionGateContext(config, config.cwd, {
			planBaselineMetadata: planBaseline,
			lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
		})
		const gateDecision = evaluateAuditGate(auditMetadata, gateContext.options)
		if (gateDecision.blocked) {
			config.taskState.lastAdvisoryAudit = auditMetadata
			return { metadata: auditMetadata, wouldBlock: true }
		}

		return { metadata: auditMetadata, wouldBlock: false }
	} catch (error) {
		Logger.warn(`[${params.logPrefix}] Subagent advisory audit skipped (non-blocking):`, error)
		return { wouldBlock: false }
	}
}

/** Parent attempt_completion — full preflight + blocking audit. */
export async function runCompletionGateFlow(
	config: TaskConfig,
	params: {
		result: string
		taskProgress?: string
		command?: string
		taskDescription?: string
	},
	logPrefix: string,
): Promise<CompletionGateFlowResult> {
	const preflightError = await runCompletionPreflightChecks(config, params, logPrefix, {
		validateQuality: validateCompletionResultQuality,
		onFailure: recordCompletionPreflightFailure,
	})
	if (preflightError) {
		return { status: "blocked", message: preflightError }
	}

	const auditResult = await evaluateCompletionAuditGate(config, {
		result: params.result,
		taskDescription: params.taskDescription ?? params.result,
		logPrefix,
	})

	if (auditResult.status === "blocked" || auditResult.status === "error") {
		return { status: "blocked", message: auditResult.message }
	}

	return { status: "passed", audit: auditResult }
}
