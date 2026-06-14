import { telemetryService } from "@services/telemetry"
import {
	applyWorkspaceAuditPolicy,
	type GatePolicyProvenance,
	resolveCompletionGateContext,
} from "@shared/audit/auditGatePolicyLoader"
import { type CompletionGateDecision, evaluateCompletionGate } from "@shared/audit/auditGateReport"
import { getLatestPlanAuditFromMessages } from "@shared/audit/auditMessages"
import { buildCompletionGateMessage, runCompletionAudit } from "@shared/audit/completionAudit"
import { parseIntentThresholdOverrides } from "@shared/audit/gatePolicy"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { evaluateRoadmapCompletionBlock, failClosedCompletionMessage } from "@/services/roadmap/RoadmapCompletionGate"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import {
	appendCompletionGateRetryGuidance,
	buildCompletionAgentErrorMessage,
	classifyCompletionPreflightReason,
	detectDuplicateCompletionSubmission,
	getCompletionGateCircuitBreakerError,
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

function emitCompletionPreflightTelemetry(
	config: TaskConfig,
	reason: ReturnType<typeof classifyCompletionPreflightReason>,
	blockCount: number,
): void {
	telemetryService.captureCompletionPreflightBlocked(config.ulid, {
		taskId: config.taskId,
		reason,
		blockCount,
		consecutiveMistakes: config.taskState.consecutiveMistakeCount,
		attemptCount: config.taskState.completionAttemptCount ?? 0,
		lastReason: config.taskState.lastCompletionBlockReason,
		failedStage: mapCompletionReasonToPreflightStage(reason),
	})
}

function finalizePreflightError(
	rawMessage: string,
	config: TaskConfig,
	context?: { result?: string; checkpointHash?: string },
): string {
	const reason = classifyCompletionPreflightReason(rawMessage)
	const blockCount = recordCompletionGateBlockEvent(config, reason, context)
	emitCompletionPreflightTelemetry(config, reason, blockCount)
	return buildCompletionAgentErrorMessage(rawMessage, config)
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

	const qualityError = checks.validateQuality(params.result)
	if (qualityError) {
		checks.onFailure(config)
		return finalizePreflightError(qualityError, config, gateContext)
	}

	const checklistInResultError = validateCompletionResultExcludesChecklist(params.result)
	if (checklistInResultError) {
		checks.onFailure(config)
		return finalizePreflightError(checklistInResultError, config, gateContext)
	}

	const minLengthError = validateCompletionResultMinLength(params.result)
	if (minLengthError) {
		checks.onFailure(config)
		return finalizePreflightError(minLengthError, config, gateContext)
	}

	const maxLengthError = validateCompletionResultMaxLength(params.result)
	if (maxLengthError) {
		checks.onFailure(config)
		return finalizePreflightError(maxLengthError, config, gateContext)
	}

	const taskProgressRequiredError = validateCompletionTaskProgressRequired(config, params.taskProgress)
	if (taskProgressRequiredError) {
		checks.onFailure(config)
		return finalizePreflightError(taskProgressRequiredError, config, gateContext)
	}

	const taskProgressError = validateCompletionTaskProgress(params.taskProgress)
	if (taskProgressError) {
		checks.onFailure(config)
		return finalizePreflightError(taskProgressError, config, gateContext)
	}

	const taskProgressAlignError = validateTaskProgressAlignsWithFocusChain(config, params.taskProgress)
	if (taskProgressAlignError) {
		checks.onFailure(config)
		return finalizePreflightError(taskProgressAlignError, config, gateContext)
	}

	const focusChainError = validateFocusChainComplete(config)
	if (focusChainError) {
		checks.onFailure(config)
		return finalizePreflightError(focusChainError, config, gateContext)
	}

	const cooldownError = validateCompletionAttemptCooldown(config)
	if (cooldownError) {
		checks.onFailure(config)
		return finalizePreflightError(cooldownError, config, gateContext)
	}

	const duplicateError = detectDuplicateCompletionSubmission(config, params.result, {
		currentCheckpointHash: checkpointHash,
	})
	if (duplicateError) {
		checks.onFailure(config)
		return finalizePreflightError(duplicateError, config, gateContext)
	}

	const demoCommandError = validateCompletionDemoCommand(params.command)
	if (demoCommandError) {
		checks.onFailure(config)
		return finalizePreflightError(demoCommandError, config, gateContext)
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
			telemetryService.captureCompletionPreflightBlocked(config.ulid, {
				taskId: config.taskId,
				reason: "audit_gate",
				blockCount,
				consecutiveMistakes: config.taskState.consecutiveMistakeCount,
				attemptCount: config.taskState.completionAttemptCount ?? 0,
				lastReason: "audit_gate",
				failedStage: "audit",
			})
			const message = buildCompletionAgentErrorMessage(
				appendCompletionGateRetryGuidance(
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
				),
				config,
			)

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
		telemetryService.captureCompletionPreflightBlocked(config.ulid, {
			taskId: config.taskId,
			reason: "audit_error",
			blockCount: config.taskState.completionGateBlockCount ?? 0,
			consecutiveMistakes: config.taskState.consecutiveMistakeCount,
			attemptCount: config.taskState.completionAttemptCount ?? 0,
			lastReason: "audit_error",
			failedStage: "audit",
		})
		return {
			status: "error",
			message: buildCompletionAgentErrorMessage(
				"Task completion blocked: hardening audit evaluation failed. " +
					"Fix the underlying issue or retry after audit services recover.",
				config,
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
