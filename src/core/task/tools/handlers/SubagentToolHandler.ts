import { setTimeout as delay } from "node:timers/promises"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveCompletionGateOptions } from "@shared/audit/auditGatePolicyLoader"
import {
	DietCodeAskUseSubagents,
	DietCodeSaySubagentStatus,
	DietCodeSubagentUsageInfo,
	SubagentStatusItem,
} from "@shared/ExtensionMessage"
import { CoordinationError, CoordinationErrorCode, RETRY_POLICY } from "@shared/governance/CoordinationErrors"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { createContinuityMarker, SWARM_ENVELOPE_SCHEMA_VERSION } from "@shared/subagent/executionEnvelope"
import type {
	ConfidenceProbeHistoryEntry,
	GovernedCrashPhase,
	GovernedReceiptSummary,
	GovernedSwarmReceipt,
	LaneExecutionReceipt,
	WorkLaneClaim,
} from "@shared/subagent/governedExecution"
import { buildOrchestrationLeaseTaskId } from "@shared/subagent/governedExecution"
import { laneStateShouldDegradeOnTimeout, mapEntryStatusToLaneState } from "@shared/subagent/laneStateMachine"
import pTimeout from "p-timeout"
import { v4 as uuidv4 } from "uuid"
import { createLockAuthority } from "@/core/governance/LockAuthority"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { DietCodeDefaultTool } from "@/shared/tools"
import { showNotificationForApproval } from "../../utils"
import type { GatePreflightReadinessIssue } from "../completionGatePipeline"
import { AgentConfigLoader } from "../subagent/AgentConfigLoader"
import {
	buildConfidenceRetryFingerprint,
	computeEvidenceDelta,
	evaluateConfidenceAwareConvergence,
	evidenceIdentity,
	MAX_TOTAL_CONFIDENCE_PROBES,
} from "../subagent/ConfidenceAwareConvergence"
import { createSwarmValidationSnapshot } from "../subagent/executionValidation"
import {
	buildLaneDependencyMap,
	buildLaneRoadmapItemMap,
	inferSwarmCrashPhase,
	resolveGovernedRoadmapCompletionPolicy,
	runGovernedSwarmAuditPreflight,
	swarmSummaryFromEntries,
} from "../subagent/GovernedIntegration"
import { GovernedSwarmCoordinator } from "../subagent/GovernedSwarmCoordinator"
import {
	classifyLockNecessity,
	computeFastIoReservedSlots,
	declaresMutationIntent,
	isNonMutatingMode,
	laneDispatchWeight,
	resolveLaneLockIntent,
} from "../subagent/LockNecessity"
import {
	AuthorityAwareExecutionPool,
	addSubagentRunStats,
	CoalescingAsyncEmitter,
	calculateRetryDelayMs,
	computeMaxInFlightLanes,
	createGovernedExecutionPathMetrics,
	createParentAbortWatcher,
	createSwarmSchedulerWake,
	DEFAULT_SUBAGENT_CONCURRENCY,
	DEFAULT_SUBAGENT_MAX_ATTEMPTS,
	emptySubagentRunStats,
	errorMessage,
	getRecoveryDecision,
	SUBAGENT_ABORT_GRACE_MS,
	SUBAGENT_ATTEMPT_TIMEOUT_MS,
	SUBAGENT_AUDIT_PREFLIGHT_TIMEOUT_MS,
	SUBAGENT_STATUS_MIN_INTERVAL_MS,
	SUBAGENT_SWARM_TIMEOUT_MS,
	SUBAGENT_UI_IO_TIMEOUT_MS,
	type SubagentRunStats,
	shouldPersistSwarmProgressArtifact,
	shouldReleaseLaneClaimBetweenAttempts,
	waitForSettlement,
} from "../subagent/ParentAgentFlowControl"
import {
	computeSwarmArtifactChecksum,
	planResumeFromArtifact,
	SWARM_TERMINAL_STAGING_VIOLATION,
	type SwarmResumePlan,
} from "../subagent/ResumeSwarmFromArtifact"
import { constrainSubagentToolsForLane, SUBAGENT_DEFAULT_ALLOWED_TOOLS, SubagentBuilder } from "../subagent/SubagentBuilder"
import { persistSwarmEnvelope } from "../subagent/SubagentExecutionStore"
import { SubagentRunner, type SubagentRunResult } from "../subagent/SubagentRunner"
import { buildParentToolResult, buildSwarmSummaryOverlay } from "../subagent/SwarmReportBuilder"
import { detectDeadlocks } from "../subagent/TarjanDeadlockDetector"
import type { TaskConfig } from "../types/TaskConfig"
import type { IFullyManagedTool, ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

interface ConfigWithExtensions extends TaskConfig {
	getSessionStreamId?: () => string
}

const PROMPT_KEYS = ["prompt_1", "prompt_2", "prompt_3", "prompt_4", "prompt_5"] as const

function resolveConfiguredSubagentName(toolName: string): string | undefined {
	return AgentConfigLoader.getInstance().resolveSubagentNameForTool(toolName)
}

function collectPrompts(block: ToolUse, configuredSubagentName?: string): string[] {
	if (configuredSubagentName) {
		const dynamicPrompt = block.params.prompt?.trim() || block.params.prompt_1?.trim()
		return dynamicPrompt ? [dynamicPrompt] : []
	}

	return PROMPT_KEYS.map((key) => block.params[key]?.trim()).filter((prompt): prompt is string => !!prompt)
}

function requiredApprovalTools(prompts: string[], params: Record<string, string | undefined>): DietCodeDefaultTool[] {
	return [
		...new Set(
			prompts.map((prompt, index) =>
				declaresMutationIntent(resolveLaneLockIntent(prompt, params, index))
					? DietCodeDefaultTool.FILE_EDIT
					: DietCodeDefaultTool.USE_SUBAGENTS,
			),
		),
	]
}

function isToolAutoApproved(result: boolean | [boolean, boolean] | undefined): boolean {
	return Array.isArray(result) ? result[0] : !!result
}

function excerpt(text: string | undefined, maxChars = 1200): string {
	if (!text) {
		return ""
	}

	const trimmed = text.trim()
	if (trimmed.length <= maxChars) {
		return trimmed
	}

	return `${trimmed.slice(0, maxChars)}...`
}

function enrichEntryFromEnvelope(entry: SubagentStatusItem, envelope?: SubagentExecutionEnvelope): void {
	if (!envelope) {
		return
	}
	entry.envelopeId = envelope.agentId
	entry.blockers = envelope.blockers
	entry.warnings = envelope.warnings
	entry.touchedFiles = envelope.touchedFiles
	entry.executionValidity = envelope.executionValidity
	entry.confidence = envelope.confidence
	entry.evidenceCount = envelope.evidenceRefs.length
	entry.transcriptEventCount = envelope.transcriptEventCount
	entry.compactionEventCount = envelope.compactionEvents?.length || 0
	entry.compactionWarnings = (envelope.compactionEvents || []).map(
		(event) =>
			`Compaction ${event.reason}: dropped ${event.droppedRange[0]}-${event.droppedRange[1]} (risk ${event.continuityRiskLevel})`,
	)
	entry.toolSteps = envelope.toolSteps.map((step) => ({
		index: step.index,
		toolName: step.toolName,
		preview: step.preview,
		timestamp: step.timestamp,
		touchedPaths: step.touchedPaths,
	}))
}

function buildSwarmEnvelopeDraft(options: {
	swarmId: string
	executionId?: string
	taskId: string
	parentStreamId?: string
	parentExecutionId?: string
	resumeAttemptId?: string
	recoveryReceipt?: SwarmExecutionEnvelope["recoveryReceipt"]
	entries: SubagentStatusItem[]
	agentEnvelopes: Map<string, SubagentExecutionEnvelope>
	blackboard: string[]
	startedAt: number
	status: SwarmExecutionEnvelope["status"]
	summaryOverlay?: string
	artifactPath?: string
	taskAmbiguityProfile?: SwarmExecutionEnvelope["taskAmbiguityProfile"]
}): SwarmExecutionEnvelope {
	const completedAgents = options.entries.filter((entry) => entry.status === "completed" || entry.status === "failed").length

	return {
		swarmId: options.swarmId,
		executionId: options.executionId || options.swarmId,
		taskId: options.taskId,
		parentStreamId: options.parentStreamId,
		parentExecutionId: options.parentExecutionId,
		resumeAttemptId: options.resumeAttemptId,
		recoveryReceipt: options.recoveryReceipt,
		taskAmbiguityProfile: options.taskAmbiguityProfile,
		continuity: createContinuityMarker(
			options.swarmId,
			options.taskId,
			options.entries.length,
			completedAgents,
			options.status,
		),
		agents: options.entries
			.map((entry) => options.agentEnvelopes.get(entry.id))
			.filter((envelope): envelope is SubagentExecutionEnvelope => Boolean(envelope)),
		blackboardSnapshot: [...options.blackboard],
		summaryOverlay: options.summaryOverlay,
		timestamps: {
			started: options.startedAt,
			completed: options.status !== "running" ? Date.now() : undefined,
		},
		status: options.status,
		invariants: { validated: false, violations: [] },
		artifactPath: options.artifactPath || "",
		schemaVersion: SWARM_ENVELOPE_SCHEMA_VERSION,
	}
}

export class UseSubagentsToolHandler implements IFullyManagedTool {
	readonly name = DietCodeDefaultTool.USE_SUBAGENTS

	getDescription(_block: ToolUse): string {
		const configuredSubagentName = resolveConfiguredSubagentName(_block.name)
		return configuredSubagentName ? `[subagent: ${configuredSubagentName}]` : "[subagents]"
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const configuredSubagentName = resolveConfiguredSubagentName(block.name)
		const prompts = configuredSubagentName
			? [
					uiHelpers
						.removeClosingTag(block, "prompt", block.params.prompt?.trim() || block.params.prompt_1?.trim())
						?.trim(),
				].filter((prompt): prompt is string => !!prompt)
			: PROMPT_KEYS.map((key) => uiHelpers.removeClosingTag(block, key, block.params[key]?.trim()))
					.map((prompt) => prompt?.trim())
					.filter((prompt): prompt is string => !!prompt)

		if (prompts.length === 0) {
			return
		}

		const partialMessage = JSON.stringify({ prompts } satisfies DietCodeAskUseSubagents)
		const shouldAutoApprove = requiredApprovalTools(prompts, block.params).every((tool) =>
			isToolAutoApproved(uiHelpers.shouldAutoApproveTool(tool)),
		)

		if (shouldAutoApprove) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "use_subagents")
			await uiHelpers.say("use_subagents", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "use_subagents")
			await uiHelpers.ask("use_subagents", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const subagentsEnabled = config.services.stateManager.getGlobalSettingsKey("subagentsEnabled")
		if (!subagentsEnabled) {
			return formatResponse.toolError("Subagents are disabled. Enable them in Settings > Features to use this tool.")
		}

		const configuredSubagentName = resolveConfiguredSubagentName(block.name)
		const prompts = collectPrompts(block, configuredSubagentName)

		if (prompts.length === 0) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, configuredSubagentName ? "prompt" : "prompt_1")
		}

		const MAX_PROMPTS_PER_SWARM = PROMPT_KEYS.length
		if (prompts.length > MAX_PROMPTS_PER_SWARM) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Maximum subagent swarm size exceeded. Requested ${prompts.length}, but limited to ${MAX_PROMPTS_PER_SWARM} for stability.`,
			)
		}

		const currentDepth = config.recursionDepth || 0
		const maxDepthSetting = config.services.stateManager.getGlobalSettingsKey("maxSwarmDepth")
		const maxDepth = typeof maxDepthSetting === "number" ? maxDepthSetting : 3
		if (currentDepth >= maxDepth) {
			const depthError = `Swarm Recursion Limit Reached (Depth: ${currentDepth}). To prevent runaway loops, this swarm cannot spawn further subagents. Complete the current task or simplify the objective.`
			Logger.warn(`[SubagentToolHandler] Recursion limit reached: ${depthError}`)
			return formatResponse.toolError(depthError)
		}

		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		Logger.info(
			`[SubagentToolHandler] Spawning swarm of ${prompts.length} subagents (Mode: ${currentMode}, Concurrency: ${DEFAULT_SUBAGENT_CONCURRENCY}, Timeout: ${SUBAGENT_SWARM_TIMEOUT_MS / 60_000}m)`,
		)

		const apiConfig = config.services.stateManager.getApiConfiguration()
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const approvalPayload: DietCodeAskUseSubagents = { prompts }
		const approvalBody = JSON.stringify(approvalPayload)

		const didAutoApprove = requiredApprovalTools(prompts, block.params as Record<string, string | undefined>).every((tool) =>
			isToolAutoApproved(config.autoApprover?.shouldAutoApproveTool(tool)),
		)

		if (didAutoApprove) {
			telemetryService.captureToolUsage(
				config.ulid,
				this.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				undefined,
				block.isNativeToolCall,
			)
		} else {
			showNotificationForApproval(
				prompts.length === 1
					? `DietCode wants to use ${configuredSubagentName ? `the '${configuredSubagentName}' subagent` : "a subagent"}`
					: `DietCode wants to use ${prompts.length} subagents`,
				config.autoApprovalSettings.enableNotifications,
			)
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("use_subagents", approvalBody, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					this.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					undefined,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
			telemetryService.captureToolUsage(
				config.ulid,
				this.name,
				config.api.getModel().id,
				provider,
				false,
				true,
				undefined,
				block.isNativeToolCall,
			)
		}

		config.taskState.consecutiveMistakeCount = 0

		const resumeSwarmId = block.params.resume_swarm_id?.trim()
		let resumePlan: SwarmResumePlan | undefined
		if (resumeSwarmId) {
			try {
				resumePlan = await planResumeFromArtifact(config.taskId, resumeSwarmId, {
					newSwarmId: uuidv4(),
				})
				await pTimeout(
					config.callbacks.say(
						"subagent",
						JSON.stringify({
							status: "running",
							resumePlan: resumePlan.recoveryReceipt,
							sourceSwarmId: resumeSwarmId,
							operatorVisible: true,
						}),
					),
					{ milliseconds: SUBAGENT_UI_IO_TIMEOUT_MS, message: "Resume status UI timed out." },
				).catch((error) => Logger.warn("[SubagentToolHandler] Failed to emit resume status:", error))
			} catch (error) {
				return formatResponse.toolError(`Resume-from-artifact rejected: ${(error as Error).message}`)
			}
		}

		const swarmId = resumePlan?.newSwarmId || uuidv4()
		const swarmExecutionId = uuidv4()
		const swarmStartedAt = Date.now()
		config.taskState.swarmRuntime = {
			swarmId,
			startedAt: swarmStartedAt,
			lanesTotal: prompts.length,
			lanesComplete: 0,
			lanesDegraded: 0,
			lanesHardBlocked: 0,
			advisoryNoiseSuppressed: 0,
		}
		const agentEnvelopes = new Map<string, SubagentExecutionEnvelope>()

		const entries: SubagentStatusItem[] = prompts.map((prompt, index) => ({
			id: uuidv4(),
			name: configuredSubagentName || `Subagent ${index + 1}`,
			index: index + 1,
			prompt,
			criticalSignals: [],
			status: "pending",
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
			latestToolCall: undefined,
		}))

		const parentStreamId = (config as ConfigWithExtensions).getSessionStreamId?.()

		const laneDependencies = buildLaneDependencyMap(prompts, block.params as Record<string, string | undefined>)
		const laneRoadmapItems = buildLaneRoadmapItemMap(prompts, block.params as Record<string, string | undefined>)
		const executionPathMetrics = createGovernedExecutionPathMetrics()

		const governedCoordinator = new GovernedSwarmCoordinator(
			config.cwd,
			RoadmapService.getInstance().isEnabled(),
			prompts.length,
			laneDependencies,
			createLockAuthority({ inMemory: process.env.TS_NODE_PROJECT?.includes("unit-test") ?? false }),
			undefined,
			resumePlan?.recoveryReceipt?.resumeAttemptId,
			executionPathMetrics,
		)
		const orchestrationLeaseTaskId = buildOrchestrationLeaseTaskId(swarmId)
		const roadmapService = RoadmapService.getInstance()
		const runtimeState = await roadmapService.getOrHydrateRuntimeState(config.cwd)
		if (runtimeState.locks?.[orchestrationLeaseTaskId]) {
			const leaseOwner = runtimeState.locks[orchestrationLeaseTaskId].owner_agent
			if (leaseOwner !== config.taskId) {
				Logger.info(
					`[SubagentToolHandler] Reclaiming stale orchestration lease '${orchestrationLeaseTaskId}' from owner '${leaseOwner}'.`,
				)
				await roadmapService.releaseOrchestrationLease(config.cwd, leaseOwner, orchestrationLeaseTaskId)
			}
		}

		// Initialize global task-level recovery budget
		if (!config.taskState.recoveryBudget) {
			config.taskState.recoveryBudget = {
				taskId: config.taskId,
				maxAttempts: 15,
				attemptsUsed: 0,
				maxElapsedMs: 15 * 60 * 1000,
				startedAt: Date.now(),
				maxNoProgressAttempts: 5,
				noProgressAttempts: 0,
				lastProgressVersion: 0,
			}
		}

		let swarmAdmission = await governedCoordinator.admitSwarm(config.taskId, "subagent_swarm", swarmId)
		let orchestrationLease = swarmAdmission.admitted
			? await governedCoordinator.acquireSwarmOrchestrationLease(swarmId, config.taskId)
			: { acquired: false, error: "admit denied" }

		if (!swarmAdmission.admitted || !orchestrationLease.acquired) {
			const maxAdmissionAttempts = 5
			for (let attempt = 1; attempt <= maxAdmissionAttempts; attempt++) {
				const backoff = swarmAdmission.backoffMs || 1000
				Logger.warn(
					`[SubagentToolHandler] Swarm admission or lease denied. Retrying in ${backoff}ms (attempt ${attempt}/${maxAdmissionAttempts})...`,
				)
				await delay(backoff)

				swarmAdmission = await governedCoordinator.admitSwarm(config.taskId, "subagent_swarm", swarmId)
				if (swarmAdmission.admitted) {
					orchestrationLease = await governedCoordinator.acquireSwarmOrchestrationLease(swarmId, config.taskId)
					if (orchestrationLease.acquired) {
						break
					}
				}
			}
		}

		if (!swarmAdmission.admitted) {
			return formatResponse.toolError(
				`Swarm admission rejected (roadmap pressure). Retry after ${swarmAdmission.backoffMs}ms.`,
			)
		}

		if (!orchestrationLease.acquired) {
			return formatResponse.toolError(orchestrationLease.error || "Swarm admission rejected (orchestration lease denied).")
		}

		let statusEmitter: CoalescingAsyncEmitter<{ status: DietCodeSaySubagentStatus["status"]; partial: boolean }> | undefined
		let stopAbortWatcher: (() => void) | undefined
		let abortActiveRunners: (() => Promise<void>) | undefined
		try {
			const roadmapCompletionPolicy = resolveGovernedRoadmapCompletionPolicy(
				block.params as Record<string, string | undefined>,
			)

			let auditPreflightIssues: GatePreflightReadinessIssue[] = []
			void pTimeout(runGovernedSwarmAuditPreflight(config, swarmSummaryFromEntries(prompts)), {
				milliseconds: SUBAGENT_AUDIT_PREFLIGHT_TIMEOUT_MS,
				message: "Governed swarm audit preflight timed out.",
			})
				.catch((error) => {
					Logger.warn("[SubagentToolHandler] Governed swarm audit preflight failed:", error)
					return [{ stage: "audit" as const, message: "governed preflight unavailable", severity: "info" as const }]
				})
				.then((issues) => {
					auditPreflightIssues = issues
				})

			const laneReceipts: LaneExecutionReceipt[] = []
			let governedReceiptSummary: GovernedReceiptSummary | undefined
			let swarmInterrupted = false
			let swarmCrashPhase: GovernedCrashPhase = "parent_before_merge_gate"
			let swarmArtifactPath = `subagent_executions/${swarmId}.json`

			const emitStatus = async (
				status: DietCodeSaySubagentStatus["status"],
				partial: boolean,
				options?: { persistArtifact?: boolean; envelope?: SwarmExecutionEnvelope },
			) => {
				const completed = entries.filter((entry) => entry.status === "completed" || entry.status === "failed").length
				const successes = entries.filter((entry) => entry.status === "completed").length
				const failures = entries.filter((entry) => entry.status === "failed").length
				const toolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
				const inputTokens = entries.reduce((acc, entry) => acc + (entry.inputTokens || 0), 0)
				const outputTokens = entries.reduce((acc, entry) => acc + (entry.outputTokens || 0), 0)
				const contextWindow = entries.reduce((acc, entry) => Math.max(acc, entry.contextWindow || 0), 0)
				const maxContextTokens = entries.reduce((acc, entry) => Math.max(acc, entry.contextTokens || 0), 0)
				const maxContextUsagePercentage = entries.reduce(
					(acc, entry) => Math.max(acc, entry.contextUsagePercentage || 0),
					0,
				)

				const swarmStatus: SwarmExecutionEnvelope["status"] =
					status === "running" ? "running" : failures > 0 ? "failed" : "completed"
				const draft =
					options?.envelope ??
					buildSwarmEnvelopeDraft({
						swarmId,
						executionId: swarmExecutionId,
						taskId: config.taskId,
						parentStreamId,
						parentExecutionId: resumePlan?.parentExecutionId,
						resumeAttemptId: resumePlan?.resumeAttemptId,
						recoveryReceipt: resumePlan?.recoveryReceipt,
						entries,
						agentEnvelopes,
						blackboard: config.taskState.swarmBlackboard || [],
						startedAt: swarmStartedAt,
						status: swarmStatus,
					})

				let artifactPath = draft.artifactPath
				if (options?.persistArtifact !== false) {
					try {
						const persistedPath = await persistSwarmEnvelope(config.taskId, draft)
						artifactPath = persistedPath
					} catch (error) {
						Logger.warn("[SubagentToolHandler] Failed to persist swarm execution artifact:", error)
					}
				}

				const payload: DietCodeSaySubagentStatus = {
					status,
					total: entries.length,
					completed,
					successes,
					failures,
					toolCalls,
					inputTokens,
					outputTokens,
					contextWindow,
					maxContextTokens,
					maxContextUsagePercentage,
					items: entries,
					swarmId,
					continuityMarker: {
						...draft.continuity,
						lastPersistedAt: Date.now(),
					},
					artifactPath,
					summaryOverlay: draft.summaryOverlay,
					invariantViolations: draft.invariants.violations,
					governedReceipt:
						governedReceiptSummary ??
						governedCoordinator.buildLiveReceiptSummary(swarmId, swarmAdmission, laneReceipts, swarmStartedAt),
				}

				if (partial && status === "running") {
					await pTimeout(config.callbacks.say("subagent", JSON.stringify(payload), undefined, undefined, partial), {
						milliseconds: SUBAGENT_UI_IO_TIMEOUT_MS,
						message: "Subagent status UI timed out.",
					}).catch((error) => Logger.warn("[SubagentToolHandler] Non-blocking status emit failed:", error))
					return
				}

				await pTimeout(config.callbacks.say("subagent", JSON.stringify(payload), undefined, undefined, partial), {
					milliseconds: SUBAGENT_UI_IO_TIMEOUT_MS,
					message: "Subagent status UI timed out.",
				})
			}

			const activeStatusEmitter = new CoalescingAsyncEmitter<{
				status: DietCodeSaySubagentStatus["status"]
				partial: boolean
			}>(
				(update) =>
					emitStatus(update.status, update.partial, {
						persistArtifact: shouldPersistSwarmProgressArtifact(update.status, update.partial),
					}),
				SUBAGENT_STATUS_MIN_INTERVAL_MS,
				(error) => Logger.warn("[SubagentToolHandler] Failed to emit coalesced swarm status:", error),
			)
			statusEmitter = activeStatusEmitter
			let lastProgressFingerprint = ""
			const queueStatusUpdate = (status: DietCodeSaySubagentStatus["status"], partial: boolean): void => {
				if (status === "running") {
					const fingerprint = entries
						.map((entry) => `${entry.status}:${entry.toolCalls}:${Math.round((entry.totalCost || 0) * 10_000)}`)
						.join("|")
					if (fingerprint === lastProgressFingerprint) {
						return
					}
					lastProgressFingerprint = fingerprint
				} else {
					lastProgressFingerprint = ""
				}
				activeStatusEmitter.enqueue({ status, partial })
			}

			await pTimeout(config.callbacks.removeLastPartialMessageIfExistsWithType("say", "subagent"), {
				milliseconds: SUBAGENT_UI_IO_TIMEOUT_MS,
				message: "Partial subagent status cleanup timed out.",
			}).catch((error) => Logger.warn("[SubagentToolHandler] Failed to clear partial subagent status:", error))
			queueStatusUpdate("running", true)

			const laneIntents = prompts.map((prompt, index) => {
				const intent = resolveLaneLockIntent(prompt, block.params as Record<string, string | undefined>, index)
				intent.roadmapItemId = laneRoadmapItems.get(index)
				return intent
			})
			const laneNecessities = laneIntents.map(classifyLockNecessity)
			const laneDispatchWeights = new Map<number, number>(
				laneIntents.map((intent, index) => [index, laneDispatchWeight(intent.executionMode)]),
			)
			const laneScheduleMemo = new Map<number, number>()
			const laneExecutionPriority = (index: number): number =>
				governedCoordinator.getLaneDAG().getLaneScheduleScore(index, laneScheduleMemo, laneDispatchWeights)

			const builder = new SubagentBuilder(config, configuredSubagentName)

			// Phase 3: Swarm Tool Delegation & Authorization Guard
			const requestedTools = builder.getAllowedTools() || []
			const unauthorizedTools = requestedTools.filter(
				(t: DietCodeDefaultTool) => !SUBAGENT_DEFAULT_ALLOWED_TOOLS.includes(t) && t !== DietCodeDefaultTool.ATTEMPT,
			)

			if (unauthorizedTools.length > 0) {
				Logger.warn(
					`[SubagentToolHandler] Subagent '${configuredSubagentName}' requested restricted tools: ${unauthorizedTools.join(", ")}. Permission denied.`,
				)
				// Force filter the toolset to only include authorized tools
				builder.setAllowedTools(requestedTools.filter((t) => !unauthorizedTools.includes(t)))
			}
			const effectiveAllowedTools = builder.getAllowedTools()
			let templateBuilderAvailable = true

			const createRunner = (index: number) => {
				// Each lane attempt owns its API handler and mutable prompt context. Sharing the
				// template builder would let one lane's abort or context update affect siblings.
				const isolatedBuilder = templateBuilderAvailable ? builder : new SubagentBuilder(config, configuredSubagentName)
				templateBuilderAvailable = false
				isolatedBuilder.setAllowedTools(
					constrainSubagentToolsForLane(effectiveAllowedTools, laneNecessities[index].lockRequired),
				)
				const runner = new SubagentRunner(config, isolatedBuilder)
				runner.setRecursionDepth(currentDepth + 1)
				runner.setLaneExecutionMode(laneIntents[index].executionMode)
				return runner
			}
			const activeRunners = new Map<number, SubagentRunner>()
			const retryingLanes = new Set<number>()
			const retryDeadlines = new Map<number, number>()
			let schedulerStateVersion = 0
			let swarmStopReason: string | undefined
			const swarmStopController = new AbortController()
			const abortAllRunners = async (): Promise<void> => {
				await Promise.allSettled([...activeRunners.values()].map((runner) => runner.abort()))
			}
			abortActiveRunners = abortAllRunners
			const requestSwarmStop = (reason: string): void => {
				if (!swarmStopReason) {
					swarmStopReason = reason
					Logger.warn(`[SubagentToolHandler] Stopping swarm: ${reason}`)
					swarmStopController.abort(reason)
				}
				void abortAllRunners()
			}
			stopAbortWatcher = createParentAbortWatcher(
				() => !!config.taskState.abort,
				() => requestSwarmStop("Subagent swarm cancelled by parent task."),
			)

			// Trace registration is observability-only: start it concurrently and never gate lane execution.
			const childStreamIdPromises: Array<Promise<string | null>> = prompts.map(async (prompt) => {
				if (!parentStreamId) return null
				try {
					const childStream = await orchestrator.spawnChildStream(parentStreamId, `subagent: ${prompt.slice(0, 80)}`)
					return childStream.id
				} catch {
					return null
				}
			})
			const completeChildStream = (index: number, summary: string): void => {
				void childStreamIdPromises[index].then((childStreamId) => {
					if (childStreamId) {
						void orchestrator.completeStream(childStreamId, summary).catch(() => {})
					}
				})
			}
			const failChildStream = (index: number, error: string): void => {
				void childStreamIdPromises[index].then((childStreamId) => {
					if (childStreamId) {
						void orchestrator.failStream(childStreamId, error).catch(() => {})
					}
				})
			}

			const results: PromiseSettledResult<SubagentRunResult>[] = Array.from({ length: prompts.length })
			const executionSlots = new AuthorityAwareExecutionPool(
				DEFAULT_SUBAGENT_CONCURRENCY,
				computeFastIoReservedSlots(DEFAULT_SUBAGENT_CONCURRENCY),
			)
			const maxInFlightLanes = computeMaxInFlightLanes(DEFAULT_SUBAGENT_CONCURRENCY)
			const schedulerWake = createSwarmSchedulerWake()
			let activeLaneExecutions = 0
			const swarmGateOptionsPromise = resolveCompletionGateOptions(config, config.cwd, {
				lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
			})
			// Optional parent context starts early and overlaps lane admission, runner setup,
			// skill discovery, and system-prompt generation. Its bounded failure is reused;
			// a lane never repeats a slow context fetch on the critical path.
			const prefetchedParentContextPromise = parentStreamId
				? pTimeout(orchestrator.getCompressedContext(parentStreamId), {
						milliseconds: SUBAGENT_UI_IO_TIMEOUT_MS,
						message: "Parent context prefetch timed out.",
					}).catch(() => undefined)
				: Promise.resolve(undefined)
			let totalSwarmCost = 0
			const MAX_PARENT_COST = config.taskState.maxCost
			const swarmDeadline = swarmStartedAt + SUBAGENT_SWARM_TIMEOUT_MS

			const applyEntryStats = (entry: SubagentStatusItem, stats: SubagentRunStats): void => {
				entry.toolCalls = stats.toolCalls
				entry.inputTokens = stats.inputTokens
				entry.outputTokens = stats.outputTokens
				entry.totalCost = stats.totalCost
				entry.contextTokens = stats.contextTokens
				entry.contextWindow = stats.contextWindow
				entry.contextUsagePercentage = stats.contextUsagePercentage
			}

			const failedRunResult = (error: string, stats = emptySubagentRunStats()): SubagentRunResult => ({
				status: "failed",
				error,
				stats,
			})

			const runSubagent = async (index: number) => {
				if (resumePlan) {
					const entry = entries[index]
					const reused = resumePlan.reuseAgents.find((agent) => agent.index === entry.index)
					if (reused?.sourceLaneReceipt) {
						entry.status = "completed"
						entry.result = reused.result
						const originalSourceEnvelope = resumePlan.sourceEnvelope.agents.find(
							(agent) => agent.agentId === reused.envelopeId,
						)
						const sourceEnvelope = originalSourceEnvelope
							? {
									...originalSourceEnvelope,
									agentId: entry.id,
									parentSwarmId: swarmId,
									parentTaskId: config.taskId,
									lineage: {
										...originalSourceEnvelope.lineage,
										swarmId,
										index: entry.index,
										resumeAttemptId: resumePlan.resumeAttemptId,
									},
								}
							: undefined
						if (sourceEnvelope) {
							agentEnvelopes.set(entry.id, sourceEnvelope)
							enrichEntryFromEnvelope(entry, sourceEnvelope)
						}
						laneReceipts.push({
							...reused.sourceLaneReceipt,
							laneId: `swarm-lane:${swarmId}:${index}`,
							agentId: entry.id,
							index,
							attemptId: governedCoordinator.getAttemptId(),
							status: "skipped",
							sealedAt: Date.now(),
							executionValidity: "valid",
							findingConfidence: originalSourceEnvelope?.confidence ?? reused.sourceLaneReceipt.findingConfidence,
							confidenceReason:
								originalSourceEnvelope?.structuredFindings.find((finding) => finding.source === "verbatim")
									?.confidenceReason ?? reused.sourceLaneReceipt.confidenceReason,
							sourceAuthority: {
								sourceSwarmId: resumePlan.sourceSwarmId,
								sourceAttemptId: reused.sourceLaneReceipt.attemptId ?? "historical",
								sourceLaneId: reused.sourceLaneReceipt.laneId,
								sourceAgentId: reused.sourceLaneReceipt.agentId,
							},
						})
						governedCoordinator.markLaneSkipped(index)
						completeChildStream(
							index,
							[excerpt(reused.result, 200), `artifact:${swarmId}`, `agent:${entry.id}`, "reused:true"].join(" | "),
						)
						queueStatusUpdate("running", true)
						results[index] = {
							status: "fulfilled",
							value: {
								status: "completed",
								result: reused.result,
								stats: {
									toolCalls: 0,
									inputTokens: 0,
									outputTokens: 0,
									cacheWriteTokens: 0,
									cacheReadTokens: 0,
									totalCost: 0,
									contextTokens: 0,
									contextWindow: 0,
									contextUsagePercentage: 0,
								},
							},
						}
						return
					}
				}

				const current = entries[index]
				const laneIntent = laneIntents[index]
				const laneNecessity = laneNecessities[index]
				const swarmGateOptions = await swarmGateOptionsPromise
				let activeClaim: WorkLaneClaim | undefined

				try {
					let accumulatedStats = emptySubagentRunStats()
					let finalResult: SubagentRunResult | undefined
					let finalError: Error | undefined

					for (let attempt = 1; attempt <= DEFAULT_SUBAGENT_MAX_ATTEMPTS; attempt++) {
						if (swarmStopReason || config.taskState.abort) {
							finalError = new Error(swarmStopReason || "Subagent swarm cancelled by parent task.")
							break
						}

						const remainingSwarmMs = swarmDeadline - Date.now()
						if (remainingSwarmMs <= 0) {
							finalError = new Error("Subagent swarm execution deadline reached.")
							break
						}

						const releaseExecutionSlot = await executionSlots.acquire(
							laneExecutionPriority(index),
							isNonMutatingMode(laneIntent.executionMode),
						)
						if (swarmStopReason || config.taskState.abort) {
							releaseExecutionSlot()
							finalError = new Error(swarmStopReason || "Subagent swarm cancelled by parent task.")
							break
						}

						activeLaneExecutions++
						schedulerStateVersion++
						let runner: SubagentRunner | undefined
						let attemptLatestStats = emptySubagentRunStats()
						let attemptLastCost = 0
						let attemptPromise: Promise<SubagentRunResult> | undefined
						let attemptResult: SubagentRunResult | undefined
						let attemptError: Error | undefined
						let shouldRetry = false
						let retryDelayMs = 0

						try {
							const laneClaimResult = await governedCoordinator.acquireLane(swarmId, current.id, index, laneIntent)
							if (!laneClaimResult.success || !laneClaimResult.claim) {
								const code = laneClaimResult.code || CoordinationErrorCode.OWNERSHIP_AMBIGUOUS
								throw new CoordinationError(
									code,
									laneClaimResult.error || "Work lane claim rejected.",
									RETRY_POLICY[code],
								)
							}
							activeClaim = laneClaimResult.claim

							runner = createRunner(index)
							activeRunners.set(index, runner)
							current.status = "running"
							current.error = undefined

							const recordAttemptCost = (nextCost: number): void => {
								const boundedCost = Math.max(attemptLastCost, nextCost)
								totalSwarmCost += boundedCost - attemptLastCost
								attemptLastCost = boundedCost
								if (MAX_PARENT_COST && totalSwarmCost > MAX_PARENT_COST) {
									requestSwarmStop(
										`Swarm cumulative cost budget exceeded ($${totalSwarmCost.toFixed(4)} > $${MAX_PARENT_COST}).`,
									)
								}
							}

							try {
								attemptPromise = runner.runWithEnvelope(
									prompts[index],
									async (update) => {
										if (update.stats?.totalCost !== undefined) {
											attemptLatestStats = update.stats
											recordAttemptCost(update.stats.totalCost)
										}

										if (update.status === "running") {
											current.status = "running"
										}
										if (update.status === "completed") {
											current.status = "completed"
											if (config.taskState.swarmRuntime) {
												config.taskState.swarmRuntime.lanesComplete++
											}
										}
										if (update.status === "failed") {
											current.status = "failed"
											if (config.taskState.swarmRuntime) {
												config.taskState.swarmRuntime.lanesHardBlocked++
											}
										}
										current.laneRuntimeState = mapEntryStatusToLaneState({
											entryStatus: current.status,
											hasPartialResult: Boolean(current.result?.trim()),
											hasHardError: current.status === "failed",
											hasAdvisoryWarnings: (current.warnings?.length ?? 0) > 0,
											degraded: current.warnings?.some((w) => w.startsWith("degraded_complete")),
										})
										if (update.result !== undefined) {
											current.result = update.result
										}
										if (update.error !== undefined) {
											current.error = update.error
										}
										if (update.latestToolCall !== undefined) {
											current.latestToolCall = update.latestToolCall
										}
										if (update.advisorySignals !== undefined && update.advisorySignals.length > 0) {
											current.warnings = Array.from(
												new Set([...(current.warnings ?? []), ...update.advisorySignals]),
											)
										}
										if (update.hardSignals !== undefined && update.hardSignals.length > 0) {
											current.criticalSignals = update.hardSignals
										}
										if (update.activeSignals !== undefined) {
											current.warnings = Array.from(
												new Set([
													...(current.warnings ?? []),
													...update.activeSignals.filter((s) => s.startsWith("ADVISORY:")),
												]),
											)
											const hard = update.activeSignals.filter((s) => !s.startsWith("ADVISORY:"))
											if (hard.length > 0) {
												current.criticalSignals = hard
											}
										}
										if (update.stats) {
											applyEntryStats(current, addSubagentRunStats(accumulatedStats, update.stats))
										}
										queueStatusUpdate("running", true)
									},
									{
										agentId: current.id,
										role: current.name,
										swarmId,
										taskId: config.taskId,
										index: current.index,
										depth: currentDepth + 1,
										parentStreamId,
										parentExecutionId: resumePlan?.parentExecutionId,
										resumeAttemptId: resumePlan?.resumeAttemptId,
										prefetchedParentContext: prefetchedParentContextPromise,
										swarmGateOptions,
										onTranscriptFlush: async () => {
											queueStatusUpdate("running", true)
										},
										siblingEnvelopes: agentEnvelopes,
										laneIntents,
										laneDAG: governedCoordinator.getLaneDAG(),
										lockClaim: activeClaim,
									},
									undefined,
								)
								attemptResult = await pTimeout(attemptPromise, {
									milliseconds: Math.min(SUBAGENT_ATTEMPT_TIMEOUT_MS, remainingSwarmMs),
									message: `Subagent lane ${index} execution timed out.`,
								})
							} catch (error) {
								attemptError = new Error(errorMessage(error))
								const timedOut = /timed out/i.test(attemptError.message)
								if (timedOut && laneStateShouldDegradeOnTimeout(laneIntent.executionMode)) {
									const partialResult =
										current.result?.trim() ||
										`[degraded] Advisory lane ${index} timed out — partial evidence preserved.`
									current.status = "completed"
									current.result = partialResult
									current.warnings = [...(current.warnings ?? []), "degraded_complete: advisory lane timeout"]
									current.laneRuntimeState = "degraded_complete"
									governedCoordinator.getLaneDAG().markSealed(index)
									if (config.taskState.swarmRuntime) {
										config.taskState.swarmRuntime.lanesDegraded++
										config.taskState.swarmRuntime.lanesComplete++
									}
									attemptLatestStats = accumulatedStats
									finalResult = { status: "completed", result: partialResult, stats: accumulatedStats }
									finalError = undefined
									break
								}
								Logger.warn(
									`[SubagentToolHandler] Subagent ${index} attempt ${attempt}/${DEFAULT_SUBAGENT_MAX_ATTEMPTS} failed: ${attemptError.message}`,
								)
								await runner?.abort().catch(() => undefined)
								if (attemptPromise) {
									const settled = await waitForSettlement(attemptPromise, SUBAGENT_ABORT_GRACE_MS)
									if (!settled) {
										attemptError = new Error(
											`${attemptError.message} Runner did not stop within the abort grace period.`,
										)
										swarmInterrupted = true
										requestSwarmStop(attemptError.message)
									}
								}
							}

							if (attemptResult) {
								attemptLatestStats = attemptResult.stats
								recordAttemptCost(attemptResult.stats.totalCost)
							}
							accumulatedStats = addSubagentRunStats(accumulatedStats, attemptLatestStats)
							applyEntryStats(current, accumulatedStats)

							if (attemptResult?.status === "completed" && !swarmStopReason) {
								finalResult = { ...attemptResult, stats: accumulatedStats }
								finalError = undefined
								break
							}

							const failure =
								swarmStopReason || attemptError?.message || attemptResult?.error || "Subagent failed to complete"
							finalError = new Error(failure)
							finalResult = attemptResult
								? { ...attemptResult, status: "failed", error: failure, stats: accumulatedStats }
								: failedRunResult(failure, accumulatedStats)

							const decision = getRecoveryDecision(attemptError ?? failure, attempt)
							let canRetry =
								attempt < DEFAULT_SUBAGENT_MAX_ATTEMPTS &&
								!swarmStopReason &&
								!config.taskState.abort &&
								(decision.action === "retry" || decision.action === "reconcile_then_retry")

							if (canRetry && config.taskState.recoveryBudget) {
								const budget = config.taskState.recoveryBudget
								if (Date.now() - budget.startedAt > budget.maxElapsedMs) {
									Logger.error(`[SubagentToolHandler] Recovery budget timeout exceeded.`)
									canRetry = false
								} else {
									budget.attemptsUsed++
									if (budget.attemptsUsed > budget.maxAttempts) {
										Logger.error(
											`[SubagentToolHandler] Global recovery attempts budget exhausted (${budget.attemptsUsed}/${budget.maxAttempts}).`,
										)
										canRetry = false
									} else {
										const currentProgress = {
											workspaceContentVersion: config.taskState.workspaceContentVersion || 0,
											auditMetadataVersion: config.taskState.auditMetadataVersion || 0,
											completedLaneCount: config.taskState.swarmRuntime
												? config.taskState.swarmRuntime.lanesComplete
												: 0,
											activeBlockerCount: 0,
										}

										const lastProgress = config.taskState.lastProgressMarker
										const sameProgress =
											lastProgress &&
											lastProgress.workspaceContentVersion === currentProgress.workspaceContentVersion &&
											lastProgress.auditMetadataVersion === currentProgress.auditMetadataVersion &&
											lastProgress.completedLaneCount === currentProgress.completedLaneCount

										if (sameProgress) {
											budget.noProgressAttempts++
											if (budget.noProgressAttempts > budget.maxNoProgressAttempts) {
												Logger.error(
													`[SubagentToolHandler] Max consecutive no-progress attempts exceeded.`,
												)
												canRetry = false
											}
										} else {
											budget.noProgressAttempts = 0
											config.taskState.lastProgressMarker = currentProgress
										}
									}
								}
							}

							if (!canRetry) {
								break
							}

							if (shouldReleaseLaneClaimBetweenAttempts(laneNecessity.lockRequired, true) && activeClaim) {
								await governedCoordinator.releaseLaneLocks(activeClaim)
							}

							shouldRetry = true
							executionPathMetrics.retryDecisions++
							retryDelayMs = decision.delayMs ?? calculateRetryDelayMs(attempt)

							if (decision.action === "reconcile_then_retry") {
								Logger.info(`[SubagentToolHandler] Action is reconcile_then_retry. Reclaiming swarm leases...`)
								await governedCoordinator
									.admitSwarm(config.taskId, "subagent_swarm", swarmId)
									.catch(() => undefined)
							}
						} finally {
							if (runner && activeRunners.get(index) === runner) {
								activeRunners.delete(index)
							}
							releaseExecutionSlot()
							activeLaneExecutions--
							schedulerStateVersion++
							schedulerWake.notify()
						}

						if (shouldRetry) {
							Logger.warn(
								`[SubagentToolHandler] Retrying transient failure on lane ${index} in ${retryDelayMs}ms (attempt ${attempt + 1}/${DEFAULT_SUBAGENT_MAX_ATTEMPTS}).`,
							)
							current.status = "running"
							current.error = undefined
							queueStatusUpdate("running", true)
							retryingLanes.add(index)
							retryDeadlines.set(index, Date.now() + retryDelayMs)
							schedulerStateVersion++
							try {
								if (retryDelayMs > 0) {
									await delay(retryDelayMs, undefined, { signal: swarmStopController.signal }).catch(
										(error) => {
											if ((error as Error).name !== "AbortError") {
												throw error
											}
										},
									)
								}
							} finally {
								retryingLanes.delete(index)
								retryDeadlines.delete(index)
								schedulerStateVersion++
							}
						}
					}

					if (!activeClaim && finalError?.message.includes("Work lane claim rejected")) {
						laneReceipts.push(
							governedCoordinator.buildLaneReceipt(
								{
									laneId: `swarm-lane:${swarmId}:${index}`,
									swarmId,
									agentId: current.id,
									index,
									roadmapLeaseTaskId: `swarm-lane-${swarmId}-${index}`,
									claimedAt: Date.now(),
									executionMode: laneIntent.executionMode,
									lockRequired: laneNecessity.lockRequired,
								},
								undefined,
								"collision_rejected",
								false,
								finalError.message,
							),
						)
						queueStatusUpdate("running", true)
						results[index] = { status: "fulfilled", value: failedRunResult(finalError.message) }
						return
					}

					const resolvedResult =
						finalResult ||
						failedRunResult(finalError?.message || swarmStopReason || "Subagent execution failed", accumulatedStats)
					current.status = resolvedResult.status
					current.result = resolvedResult.result
					current.error = resolvedResult.error
					applyEntryStats(current, resolvedResult.stats)
					if (resolvedResult.envelope) {
						agentEnvelopes.set(current.id, resolvedResult.envelope)
						enrichEntryFromEnvelope(current, resolvedResult.envelope)
					}
					if (resolvedResult.status === "completed") {
						const streamSummary = [
							excerpt(resolvedResult.result, 200),
							`artifact:${swarmId}`,
							`agent:${current.id}`,
						].join(" | ")
						completeChildStream(index, streamSummary)
					} else {
						failChildStream(index, resolvedResult.error || "Subagent failed")
					}
					if (activeClaim) {
						laneReceipts.push(
							governedCoordinator.buildLaneReceipt(
								activeClaim,
								resolvedResult.envelope,
								resolvedResult.status === "completed" ? "completed" : "failed",
								false,
								resolvedResult.error,
							),
						)
					}
					queueStatusUpdate("running", true)
					results[index] = { status: "fulfilled", value: resolvedResult }
				} catch (error) {
					Logger.error(`[SubagentToolHandler] Subagent ${index} crashed:`, error)
					current.status = "failed"
					current.error = errorMessage(error)
					failChildStream(index, current.error)
					if (activeClaim) {
						laneReceipts.push(
							governedCoordinator.buildLaneReceipt(activeClaim, undefined, "failed", false, current.error),
						)
					}
					queueStatusUpdate("running", true)
					results[index] = { status: "fulfilled", value: failedRunResult(current.error) }
				} finally {
					if (activeClaim) {
						const succeeded = current.status === "completed"
						const failed = current.status === "failed"
						await governedCoordinator.releaseLane(activeClaim, succeeded, failed, current.error)
						const lastReceipt = laneReceipts.find(
							(receipt) => receipt.agentId === current.id && receipt.index === index,
						)
						if (lastReceipt) {
							lastReceipt.claimReleased = true
							lastReceipt.dagState = governedCoordinator.getLaneDAG().getNode(index)?.state
						}
					}
				}
			}

			const failPendingLane = (index: number, reason: string): void => {
				const entry = entries[index]
				entry.status = "failed"
				entry.error = reason
				governedCoordinator.getLaneDAG().markFailed(index, reason)
				laneReceipts.push(
					governedCoordinator.buildLaneReceipt(
						{
							laneId: `swarm-lane:${swarmId}:${index}`,
							swarmId,
							agentId: entry.id,
							index,
							roadmapLeaseTaskId: `swarm-lane-${swarmId}-${index}`,
							roadmapItemId: laneRoadmapItems.get(index),
							claimedAt: Date.now(),
							executionMode: laneIntents[index].executionMode,
							lockRequired: laneNecessities[index].lockRequired,
						},
						undefined,
						"blocked",
						false,
						reason,
					),
				)
				results[index] = { status: "fulfilled", value: failedRunResult(reason) }
				queueStatusUpdate("running", true)
			}

			const executeSwarmLanes = async (): Promise<void> => {
				const pending = new Set(prompts.map((_, index) => index))
				const running = new Map<number, Promise<void>>()

				while (pending.size > 0 || running.size > 0) {
					if (swarmStopReason || config.taskState.abort) {
						const reason = swarmStopReason || "Subagent swarm cancelled by parent task."
						for (const index of pending) {
							failPendingLane(index, reason)
						}
						pending.clear()
						schedulerStateVersion++
					}

					let propagatedFailure: boolean
					do {
						propagatedFailure = false
						for (const index of [...pending]) {
							const node = governedCoordinator.getLaneDAG().getNode(index)
							const failedDependencies = (node?.dependsOn || []).filter(
								(dependency) => governedCoordinator.getLaneDAG().getNode(dependency)?.state === "failed",
							)
							if (failedDependencies.length > 0) {
								pending.delete(index)
								schedulerStateVersion++
								failPendingLane(index, `Lane blocked by failed dependencies: ${failedDependencies.join(", ")}`)
								propagatedFailure = true
							}
						}
					} while (propagatedFailure)

					const readyByPriority = governedCoordinator
						.getLaneDAG()
						.getReadyLanesByPriority(laneDispatchWeights)
						.filter((index) => pending.has(index))
					for (const index of readyByPriority) {
						// Count admitted lane lifecycles, not only runners that have acquired a
						// pool slot. runSubagent yields during setup, so activeLaneExecutions alone
						// allowed the entire pending set to spill into the queue in one tick.
						if (running.size >= maxInFlightLanes) {
							break
						}
						pending.delete(index)
						schedulerStateVersion++
						const job = runSubagent(index)
							.catch((error) => {
								const reason = `Lane execution infrastructure failed: ${errorMessage(error)}`
								Logger.error(`[SubagentToolHandler] ${reason}`, error)
								if (!results[index]) {
									entries[index].status = "failed"
									entries[index].error = reason
									governedCoordinator.getLaneDAG().markFailed(index, reason)
									if (!laneReceipts.some((receipt) => receipt.index === index)) {
										laneReceipts.push(
											governedCoordinator.buildLaneReceipt(
												{
													laneId: `swarm-lane:${swarmId}:${index}`,
													swarmId,
													agentId: entries[index].id,
													index,
													roadmapLeaseTaskId: `swarm-lane-${swarmId}-${index}`,
													claimedAt: Date.now(),
													executionMode: laneIntents[index].executionMode,
													lockRequired: laneNecessities[index].lockRequired,
												},
												undefined,
												"failed",
												false,
												reason,
											),
										)
									}
									results[index] = { status: "fulfilled", value: failedRunResult(reason) }
									queueStatusUpdate("running", true)
								}
							})
							.finally(() => {
								running.delete(index)
								schedulerStateVersion++
								schedulerWake.notify()
							})
						running.set(index, job)
						schedulerStateVersion++
					}

					// Monotonic ProgressSnapshot tracking
					const completedLaneCount = prompts
						.map((_, i) => i)
						.filter((i) => governedCoordinator.getLaneDAG().getNode(i)?.state === "sealed").length
					const runningLaneCount = running.size
					const readyLaneCount = governedCoordinator
						.getLaneDAG()
						.getReadyLanes()
						.filter((i) => pending.has(i)).length
					const blockedLaneCount = [...pending].filter(
						(i) => governedCoordinator.getLaneDAG().getNode(i)?.state === "blocked",
					).length
					const retryingLaneCount = retryingLanes.size

					const progressSnapshot = {
						stateVersion: schedulerStateVersion,
						laneStateVersion: governedCoordinator.getLaneDAG().getStateVersion(),
						completedLaneCount,
						runningLaneCount,
						readyLaneCount,
						retryingLaneCount,
						blockedLaneCount,
						lastProgressAt: Date.now(),
					}
					Logger.info(`[SwarmScheduler] ProgressSnapshot: ${JSON.stringify(progressSnapshot)}`)
					if (pending.size > 0 && running.size === 0) {
						const dag = governedCoordinator.getLaneDAG()
						const laneSnapshot = dag.immutableSnapshot()
						const observedSchedulerVersion = schedulerStateVersion
						const deadlockRes = detectDeadlocks({
							pendingLanes: Object.freeze([...pending]),
							runningLaneIndices: new Set(running.keys()),
							timersActive: new Set(retryingLanes),
							activeLaneExecutions,
							maxInFlightLanes,
							dag: { getNode: (index) => laneSnapshot.nodes.get(index) },
							stateVersion: observedSchedulerVersion,
							laneStateVersion: laneSnapshot.version,
							observedAt: Date.now(),
							timerDeadlines: new Map(retryDeadlines),
						})

						if (deadlockRes.hasDeadlock) {
							if (
								schedulerStateVersion !== observedSchedulerVersion ||
								dag.getStateVersion() !== laneSnapshot.version
							) {
								Logger.info(
									"[SwarmScheduler] Scheduler changed after deadlock snapshot; discarding recovery decision.",
								)
								continue
							}
							Logger.error(`[SwarmScheduler] Deadlock declared! Causal Wait-For Graph: ${deadlockRes.explanation}`)

							for (const index of pending) {
								const node = dag.getNode(index)
								const dependencyStates = (node?.dependsOn || []).map(
									(dependency) => `${dependency}:${dag.getNode(dependency)?.state || "missing"}`,
								)
								failPendingLane(
									index,
									`Lane dependency deadlock (Tarjan cycle detected: ${deadlockRes.explanation})${dependencyStates.length ? ` (${dependencyStates.join(", ")})` : ""}`,
								)
							}
							pending.clear()
							schedulerStateVersion++
							break
						}
						Logger.info(`[SwarmScheduler] Wait-For graph evaluated: ${deadlockRes.explanation}`)
					}

					const needsSchedulerWake = pending.size > 0 && activeLaneExecutions >= maxInFlightLanes && running.size > 0
					if (needsSchedulerWake) {
						await Promise.race([Promise.race(running.values()), schedulerWake.wait()])
					} else if (running.size > 0) {
						await Promise.race(running.values())
					} else if (pending.size > 0 && activeLaneExecutions >= maxInFlightLanes) {
						await schedulerWake.wait()
					}
				}
			}

			const swarmExecutionPromise = executeSwarmLanes()
			try {
				await pTimeout(swarmExecutionPromise, {
					milliseconds: SUBAGENT_SWARM_TIMEOUT_MS,
					message: `Subagent swarm execution timed out after ${SUBAGENT_SWARM_TIMEOUT_MS / 60_000} minutes.`,
				})
			} catch (err: unknown) {
				Logger.error("[SubagentToolHandler] Swarm execution error or timeout:", err)
				swarmInterrupted = true
				requestSwarmStop(errorMessage(err))
				await abortAllRunners()
				await waitForSettlement(swarmExecutionPromise, SUBAGENT_ABORT_GRACE_MS)
			} finally {
				stopAbortWatcher?.()
				stopAbortWatcher = undefined
				if (config.taskState.abort) {
					swarmInterrupted = true
				}
			}
			// Drain parent-visible status writes. Advisory audit preflight is sampled if ready
			// and never delays receipt sealing or parent continuation.
			await activeStatusEmitter.stop().catch((error) => {
				Logger.warn("[SubagentToolHandler] Status emitter drain failed (non-fatal):", error)
			})

			if (swarmInterrupted) {
				const dagSnapshot = governedCoordinator.getLaneDAG().snapshot()
				swarmCrashPhase = inferSwarmCrashPhase({
					laneReceipts,
					claimHistory: governedCoordinator.getClaimHistory(),
					dagRunning: dagSnapshot.some((node) => node.state === "running"),
				})
			}

			let usageTokensIn = 0
			let usageTokensOut = 0
			let usageCacheWrites = 0
			let usageCacheReads = 0
			let usageCost = 0

			results.forEach((result, index) => {
				if (!result) {
					entries[index].status = "failed"
					entries[index].error = "Subagent task was aborted or timed out before execution."
					return
				}

				if (result.status === "rejected") {
					entries[index].status = "failed"
					entries[index].error = (result.reason as Error)?.message || "Subagent execution failed"
					return
				}

				entries[index].status = result.value.status
				entries[index].result = result.value.result
				entries[index].error = result.value.error
				entries[index].toolCalls = result.value.stats.toolCalls || 0
				entries[index].inputTokens = result.value.stats.inputTokens || 0
				entries[index].outputTokens = result.value.stats.outputTokens || 0
				entries[index].totalCost = result.value.stats.totalCost || 0
				entries[index].contextTokens = result.value.stats.contextTokens || 0
				entries[index].contextWindow = result.value.stats.contextWindow || 0
				entries[index].contextUsagePercentage = result.value.stats.contextUsagePercentage || 0
				if (result.value.envelope) {
					agentEnvelopes.set(entries[index].id, result.value.envelope)
					enrichEntryFromEnvelope(entries[index], result.value.envelope)
				}

				usageTokensIn += result.value.stats.inputTokens || 0
				usageTokensOut += result.value.stats.outputTokens || 0
				usageCacheWrites += result.value.stats.cacheWriteTokens || 0
				usageCacheReads += result.value.stats.cacheReadTokens || 0
				usageCost += result.value.stats.totalCost || 0
			})

			const failures = entries.filter(
				(entry) => entry.status === "failed" && !entry.warnings?.some((w) => w.startsWith("degraded_complete")),
			).length
			let finalSwarmStatus: SwarmExecutionEnvelope["status"] = failures > 0 ? "failed" : "completed"
			const confidenceProbeHistory: ConfidenceProbeHistoryEntry[] = [...(resumePlan?.probeHistory ?? [])]
			let preliminaryConvergence = evaluateConfidenceAwareConvergence({
				agents: [...agentEnvelopes.values()],
				laneReceipts,
				probeHistory: confidenceProbeHistory,
			})

			while (
				failures === 0 &&
				!swarmInterrupted &&
				!config.taskState.abort &&
				preliminaryConvergence.gateDecision.kind === "targeted_probe" &&
				confidenceProbeHistory.length < MAX_TOTAL_CONFIDENCE_PROBES
			) {
				const probeDecision = preliminaryConvergence.gateDecision
				const candidateFindings = [
					...preliminaryConvergence.tentativeFindings,
					...preliminaryConvergence.acceptedFindings,
				].filter((finding) => probeDecision.sourceLaneIds.includes(finding.laneId))
				const sourceFinding =
					candidateFindings.find((finding) => probeDecision.question.includes(`"${finding.claim}"`)) ??
					candidateFindings[0]
				if (!sourceFinding) break

				const probeId = uuidv4()
				const probeLaunchedAt = Date.now()
				const probeIndex = prompts.length + confidenceProbeHistory.length
				const probeBuilder = new SubagentBuilder(config, configuredSubagentName)
				probeBuilder.setAllowedTools(constrainSubagentToolsForLane(effectiveAllowedTools, false))
				const probeRunner = new SubagentRunner(config, probeBuilder)
				probeRunner.setRecursionDepth(currentDepth + 1)
				probeRunner.setLaneExecutionMode("diagnostic_only")
				activeRunners.set(probeIndex, probeRunner)

				let probeResult: SubagentRunResult | undefined
				let probeError: string | undefined
				try {
					const remainingSwarmMs = Math.max(1, swarmDeadline - Date.now())
					probeResult = await pTimeout(
						probeRunner.runWithEnvelope(probeDecision.question, () => undefined, {
							agentId: probeId,
							role: "Confidence verification probe",
							swarmId,
							taskId: config.taskId,
							index: probeIndex,
							depth: currentDepth + 1,
							parentStreamId,
							parentExecutionId: resumePlan?.parentExecutionId,
							resumeAttemptId: resumePlan?.resumeAttemptId,
							prefetchedParentContext: prefetchedParentContextPromise,
							swarmGateOptions: await swarmGateOptionsPromise,
						}),
						{
							milliseconds: Math.min(SUBAGENT_ATTEMPT_TIMEOUT_MS, remainingSwarmMs),
							message: `Confidence probe ${probeId} timed out.`,
						},
					)
				} catch (error) {
					probeError = errorMessage(error)
					await probeRunner.abort().catch(() => undefined)
				} finally {
					activeRunners.delete(probeIndex)
				}

				if (probeResult) {
					usageTokensIn += probeResult.stats.inputTokens
					usageTokensOut += probeResult.stats.outputTokens
					usageCacheWrites += probeResult.stats.cacheWriteTokens
					usageCacheReads += probeResult.stats.cacheReadTokens
					usageCost += probeResult.stats.totalCost
				}
				const probeEnvelope = probeResult?.envelope
				const meaningfulEvidence = (probeEnvelope?.evidenceRefs ?? []).filter(
					(evidence) => evidence.kind === "file" || evidence.kind === "tool_output",
				)
				const evidenceDelta = computeEvidenceDelta(sourceFinding.evidenceRefs, meaningfulEvidence)
				const probeFinding = probeEnvelope?.structuredFindings.find((finding) => finding.source === "verbatim")
				const principalClaims = probeFinding?.summary
					? [probeFinding.summary]
					: probeResult?.result?.trim()
						? [excerpt(probeResult.result, 500)]
						: [probeError || "Probe produced no finding."]
				const confidenceReason = probeFinding?.confidenceReason ?? "model_uncertainty"
				const toolSequence = probeEnvelope?.toolSteps.map((step) => step.toolName) ?? []
				const fingerprint = buildConfidenceRetryFingerprint({
					assignment: probeDecision.question,
					evidenceRefs: meaningfulEvidence,
					principalClaims,
					confidenceReason,
					toolSequence,
				})
				const confidencePlateau =
					evidenceDelta.length === 0 ||
					confidenceProbeHistory.some(
						(previous) => previous.claimId === sourceFinding.id && previous.fingerprint === fingerprint,
					)
				confidenceProbeHistory.push({
					probeId,
					claimId: sourceFinding.id,
					question: probeDecision.question,
					sourceLaneIds: probeDecision.sourceLaneIds,
					reason: probeDecision.reason,
					attempt: confidenceProbeHistory.filter((previous) => previous.claimId === sourceFinding.id).length + 1,
					launchedAt: probeLaunchedAt,
					completedAt: Date.now(),
					evidenceRefs: meaningfulEvidence,
					evidenceDelta: evidenceDelta.map(evidenceIdentity),
					principalClaims,
					findingConfidence: probeFinding?.confidence ?? probeEnvelope?.confidence ?? "unknown",
					confidenceReason,
					toolSequence,
					fingerprint,
					status:
						probeResult?.status === "completed" && evidenceDelta.length > 0
							? "completed"
							: probeResult?.status === "failed" || probeError
								? "failed"
								: "exhausted",
					confidencePlateau,
				})
				preliminaryConvergence = evaluateConfidenceAwareConvergence({
					agents: [...agentEnvelopes.values()],
					laneReceipts,
					probeHistory: confidenceProbeHistory,
				})
			}

			const blackboard = config.taskState.swarmBlackboard || []
			const summaryOverlay = buildSwarmSummaryOverlay(
				buildSwarmEnvelopeDraft({
					swarmId,
					taskId: config.taskId,
					parentStreamId,
					entries,
					agentEnvelopes,
					blackboard,
					startedAt: swarmStartedAt,
					status: finalSwarmStatus,
					artifactPath: swarmArtifactPath,
				}),
				entries,
			)
			const finalEnvelope = buildSwarmEnvelopeDraft({
				swarmId,
				executionId: swarmExecutionId,
				taskId: config.taskId,
				parentStreamId,
				parentExecutionId: resumePlan?.parentExecutionId,
				resumeAttemptId: resumePlan?.resumeAttemptId,
				recoveryReceipt: resumePlan?.recoveryReceipt,
				entries,
				agentEnvelopes,
				blackboard,
				startedAt: swarmStartedAt,
				status: finalSwarmStatus,
				summaryOverlay,
				artifactPath: swarmArtifactPath,
				taskAmbiguityProfile: preliminaryConvergence.taskAmbiguityProfile,
			})

			finalEnvelope.checksum = computeSwarmArtifactChecksum(finalEnvelope)
			const validationSnapshot = createSwarmValidationSnapshot(finalEnvelope, finalEnvelope.checksum, executionPathMetrics)
			let terminalArtifactPrepared = false
			try {
				const stagingEnvelope: SwarmExecutionEnvelope = {
					...finalEnvelope,
					invariants: {
						validated: false,
						violations: [...finalEnvelope.invariants.violations, SWARM_TERMINAL_STAGING_VIOLATION],
					},
				}
				swarmArtifactPath = await persistSwarmEnvelope(config.taskId, stagingEnvelope, {
					validationSnapshot,
					metrics: executionPathMetrics,
				})
				finalEnvelope.artifactPath = swarmArtifactPath
				terminalArtifactPrepared = true
			} catch (error) {
				Logger.warn("[SubagentToolHandler] Failed to stage terminal swarm execution artifact:", error)
				finalSwarmStatus = "failed"
				finalEnvelope.invariants.violations.push(`terminal artifact staging failed: ${errorMessage(error)}`)
			}

			let governedReceipt: GovernedSwarmReceipt | undefined
			try {
				if (swarmInterrupted) {
					governedReceipt = await governedCoordinator.sealCrashReceipt({
						taskId: config.taskId,
						swarmId,
						executionId: swarmExecutionId,
						admission: swarmAdmission,
						crashPhase: swarmCrashPhase,
						laneReceipts,
						artifactPath: swarmArtifactPath,
						preflightIssues: auditPreflightIssues,
						completionPolicy: roadmapCompletionPolicy,
						retryReason: config.taskState.abort ? "abort:parent" : "timeout:swarm",
					})
					finalSwarmStatus = "failed"
					finalEnvelope.invariants.violations.push(`crash:${swarmCrashPhase}`)
				} else {
					governedReceipt = await governedCoordinator.sealReceipt({
						taskId: config.taskId,
						envelope: finalEnvelope,
						admission: swarmAdmission,
						laneReceipts,
						forceFail: !terminalArtifactPrepared,
						preflightIssues: auditPreflightIssues,
						completionPolicy: roadmapCompletionPolicy,
						validationSnapshot,
						recoveryActive: Boolean(resumePlan),
						probeHistory: confidenceProbeHistory,
					})
					finalEnvelope.invariants.violations.push(...governedReceipt.mergeGate.violations)
					finalEnvelope.invariants.validated = governedReceipt.sealed

					if (governedReceipt.continuationDecision?.permittedAction !== "continue_parent") {
						finalSwarmStatus = "failed"
					}
				}

				governedReceiptSummary = await governedCoordinator.buildReceiptSummary(governedReceipt)
			} catch (error) {
				Logger.warn("[SubagentToolHandler] Failed to seal governed swarm receipt:", error)
				finalSwarmStatus = "failed"
				finalEnvelope.invariants.violations.push(`governed receipt sealing failed: ${errorMessage(error)}`)
			}

			const executionStateChanged = finalEnvelope.status !== finalSwarmStatus
			finalEnvelope.status = finalSwarmStatus
			if (executionStateChanged) {
				finalEnvelope.continuity = createContinuityMarker(
					swarmId,
					config.taskId,
					entries.length,
					entries.filter((entry) => entry.status === "completed" || entry.status === "failed").length,
					finalSwarmStatus,
				)
				finalEnvelope.timestamps.completed = Date.now()
				finalEnvelope.checksum = computeSwarmArtifactChecksum(finalEnvelope)
			}
			try {
				swarmArtifactPath = await persistSwarmEnvelope(config.taskId, finalEnvelope, {
					validationSnapshot,
					metrics: executionPathMetrics,
				})
				finalEnvelope.artifactPath = swarmArtifactPath
			} catch (error) {
				Logger.warn("[SubagentToolHandler] Failed to persist terminal swarm execution artifact:", error)
				const receiptAccepted = governedReceipt?.continuationDecision?.permittedAction === "continue_parent"
				if (receiptAccepted) {
					finalEnvelope.invariants.advisoryWarnings = [
						...(finalEnvelope.invariants.advisoryWarnings ?? []),
						`terminal artifact promotion deferred: ${errorMessage(error)}`,
					]
				} else {
					finalSwarmStatus = "failed"
					finalEnvelope.status = "failed"
					finalEnvelope.invariants.violations.push(`terminal artifact persistence failed: ${errorMessage(error)}`)
					finalEnvelope.continuity = createContinuityMarker(
						swarmId,
						config.taskId,
						entries.length,
						entries.filter((entry) => entry.status === "completed" || entry.status === "failed").length,
						"failed",
					)
					finalEnvelope.checksum = computeSwarmArtifactChecksum(finalEnvelope)
				}
			}

			await emitStatus(finalSwarmStatus === "failed" ? "failed" : "completed", false, {
				persistArtifact: false,
				envelope: finalEnvelope,
			}).catch((error) => Logger.warn("[SubagentToolHandler] Failed to emit terminal swarm status:", error))

			const subagentUsagePayload: DietCodeSubagentUsageInfo = {
				source: "subagents",
				tokensIn: usageTokensIn,
				tokensOut: usageTokensOut,
				cacheWrites: usageCacheWrites,
				cacheReads: usageCacheReads,
				cost: usageCost,
			}
			await pTimeout(config.callbacks.say("subagent_usage", JSON.stringify(subagentUsagePayload)), {
				milliseconds: SUBAGENT_UI_IO_TIMEOUT_MS,
				message: "Subagent usage UI timed out.",
			}).catch((error) => Logger.warn("[SubagentToolHandler] Failed to emit subagent usage:", error))

			return formatResponse.toolResult(buildParentToolResult(finalEnvelope, summaryOverlay, governedReceipt))
		} finally {
			stopAbortWatcher?.()
			stopAbortWatcher = undefined
			config.taskState.swarmRuntime = undefined
			await abortActiveRunners?.().catch((error) =>
				Logger.warn("[SubagentToolHandler] Failed to abort active runners during cleanup:", error),
			)
			await statusEmitter
				?.stop()
				.catch((error) => Logger.warn("[SubagentToolHandler] Failed to stop status I/O during cleanup:", error))
			try {
				await governedCoordinator.releaseSwarmOrchestrationLease()
			} catch (error) {
				Logger.warn("[SubagentToolHandler] Failed to release swarm orchestration lease:", error)
			}
		}
	}
}
