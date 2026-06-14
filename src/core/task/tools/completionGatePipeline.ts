import { telemetryService } from "@services/telemetry"
import {
	applyWorkspaceAuditPolicy,
	type GatePolicyProvenance,
	resolveCompletionGateContext,
} from "@shared/audit/auditGatePolicyLoader"
import { type CompletionGateDecision, evaluateCompletionGate } from "@shared/audit/auditGateReport"
import { getLatestPlanAuditFromMessages } from "@shared/audit/auditMessages"
import { buildPreCompletionChecklistBlock, buildPreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { buildCompletionGateMessage, runCompletionAudit } from "@shared/audit/completionAudit"
import { parseIntentThresholdOverrides } from "@shared/audit/gatePolicy"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { evaluateRoadmapCompletionBlock, failClosedCompletionMessage } from "@/services/roadmap/RoadmapCompletionGate"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import {
	appendCompletionGateRetryGuidance,
	buildCompletionAgentErrorMessage,
	type CompletionPreflightStage,
	classifyCompletionPreflightReason,
	detectDuplicateCompletionSubmission,
	getCompletionGateCircuitBreakerError,
	getCompletionGateTelemetryContext,
	getLatestCheckpointHashFromMessages,
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
import type { TaskConfig } from "./types/TaskConfig"

export type CompletionAuditGateResult =
	| {
			status: "passed"
			auditMetadata: TaskAuditMetadata
			planBaseline?: TaskAuditMetadata
			gateDecision: CompletionGateDecision
			gateOptions: Awaited<ReturnType<typeof resolveCompletionGateContext>>["options"]
			policyProvenance: GatePolicyProvenance
	  }
	| {
			status: "blocked"
			message: string
			auditMetadata: TaskAuditMetadata
			gateDecision: CompletionGateDecision
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
	return buildCompletionAgentErrorMessage(rawMessage, config, { result: context?.result })
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
	},
	{
		stage: "demo_command",
		validate: (ctx) => validateCompletionDemoCommand(ctx.params.command),
	},
]

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
			return rejectPreflightStage(config, stageError, gateContext, checks, { soft: runner.soft })
		}
	}

	const roadmapError = await evaluateRoadmapCompletionGateError(config, logPrefix)
	if (roadmapError) {
		return finalizePreflightError(roadmapError, config, gateContext)
	}

	return null
}

export async function evaluateRoadmapCompletionGateError(config: TaskConfig, logPrefix: string): Promise<string | null> {
	const circuitBreakerMessage = getCompletionGateCircuitBreakerError(config)
	if (circuitBreakerMessage) {
		return circuitBreakerMessage
	}

	const roadmapService = RoadmapService.getInstance()
	if (!roadmapService.isEnabled()) {
		return null
	}

	try {
		const block = await evaluateRoadmapCompletionBlock(config.cwd)
		if (block.blocked) {
			config.taskState.consecutiveMistakeCount++
			return block.message || failClosedCompletionMessage()
		}
	} catch (error) {
		Logger.error(`[${logPrefix}] Failed to evaluate Roadmap Governance Gates:`, error)
		if (roadmapService.getConfig().fail_closed_completion_gates) {
			config.taskState.consecutiveMistakeCount++
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

	try {
		const messages = config.messageState?.getDietCodeMessages?.() ?? []
		const planBaseline = getLatestPlanAuditFromMessages(messages)
		let auditMetadata = await runCompletionAudit(config.taskId, params.taskDescription, params.result, params.taskDescription)
		auditMetadata = await applyWorkspaceAuditPolicy(config.cwd, auditMetadata, config)

		const gateContext = await resolveCompletionGateContext(config, config.cwd, {
			planBaselineMetadata: planBaseline,
			lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
		})
		const gateDecision = evaluateCompletionGate(auditMetadata, gateContext.options)

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
					criticalOnly: config.auditCompletionGateCriticalOnly,
					intentAdjustedThreshold: config.auditIntentThresholdAdjustmentsEnabled,
					intentThresholdOverrides: parseIntentThresholdOverrides(config.auditIntentThresholdOverrides),
					advisoryMetadata: config.taskState.lastAdvisoryAudit,
					planBaselineMetadata: planBaseline,
					gateDecision,
				}),
				blockCount,
			)
			const checklistSummary = buildPreCompletionChecklistSummary(auditMetadata, gateContext.options)
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
				gateOptions: gateContext.options,
				policyProvenance: gateContext.policyProvenance,
			}
		}

		markCompletionGatesPassed(config)
		telemetryService.captureCompletionGatesPassed(config.ulid, {
			taskId: config.taskId,
			blockCount: config.taskState.completionGateBlockCount ?? 0,
			attemptCount: config.taskState.completionAttemptCount ?? 0,
			score: gateDecision.score,
		})
		return {
			status: "passed",
			auditMetadata,
			planBaseline,
			gateDecision,
			gateOptions: gateContext.options,
			policyProvenance: gateContext.policyProvenance,
		}
	} catch (error) {
		Logger.error(`[${params.logPrefix}] Failed to run completion audit gate:`, error)
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

/** Unified preflight + audit gate flow for main agent and subagents (excludes double-check). */
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
