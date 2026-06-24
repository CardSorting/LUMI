import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import {
	DietCodeAskUseSubagents,
	DietCodeSaySubagentStatus,
	DietCodeSubagentUsageInfo,
	SubagentStatusItem,
} from "@shared/ExtensionMessage"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import { createContinuityMarker, SWARM_ENVELOPE_SCHEMA_VERSION } from "@shared/subagent/executionEnvelope"
import type { GovernedReceiptSummary, GovernedSwarmReceipt, LaneExecutionReceipt } from "@shared/subagent/governedExecution"
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
	buildLaneDependencyMap,
	buildLaneRoadmapItemMap,
	runGovernedSwarmAuditPreflight,
	swarmSummaryFromEntries,
} from "../subagent/GovernedIntegration"
import { GovernedSwarmCoordinator } from "../subagent/GovernedSwarmCoordinator"
import { classifyLockNecessity, resolveLaneLockIntent } from "../subagent/LockNecessity"
import { computeSwarmArtifactChecksum, planResumeFromArtifact, type SwarmResumePlan } from "../subagent/ResumeSwarmFromArtifact"
import { SUBAGENT_DEFAULT_ALLOWED_TOOLS, SubagentBuilder } from "../subagent/SubagentBuilder"
import { loadSwarmEnvelope, persistSwarmEnvelope } from "../subagent/SubagentExecutionStore"
import { SubagentRunner, type SubagentRunResult } from "../subagent/SubagentRunner"
import { buildParentToolResult, buildSwarmSummaryOverlay } from "../subagent/SwarmReportBuilder"
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
		const autoApproveResult = uiHelpers.shouldAutoApproveTool(this.name)
		const [shouldAutoApprove] = Array.isArray(autoApproveResult) ? autoApproveResult : [autoApproveResult, false]

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

		// Production Hardening: Limit number of prompts for nested subagents to prevent swarm explosions
		const MAX_PROMPTS_PER_SWARM = config.isSubagentExecution ? 5 : 15
		if (prompts.length > MAX_PROMPTS_PER_SWARM) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Maximum subagent swarm size exceeded. Requested ${prompts.length}, but limited to ${MAX_PROMPTS_PER_SWARM} for stability.`,
			)
		}

		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		Logger.info(
			`[SubagentToolHandler] Spawning swarm of ${prompts.length} subagents (Mode: ${currentMode}, Concurrency: 3, Timeout: 20m)`,
		)

		const apiConfig = config.services.stateManager.getApiConfiguration()
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const approvalPayload: DietCodeAskUseSubagents = { prompts }
		const approvalBody = JSON.stringify(approvalPayload)

		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(this.name)
		const [autoApproveSafe] = Array.isArray(autoApproveResult) ? autoApproveResult : [autoApproveResult, false]
		const didAutoApprove = !!autoApproveSafe

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
				await config.callbacks.say(
					"subagent",
					JSON.stringify({
						status: "running",
						resumePlan: resumePlan.recoveryReceipt,
						sourceSwarmId: resumeSwarmId,
						operatorVisible: true,
					}),
				)
			} catch (error) {
				return formatResponse.toolError(`Resume-from-artifact rejected: ${(error as Error).message}`)
			}
		}

		const swarmId = resumePlan?.newSwarmId || uuidv4()
		const swarmExecutionId = uuidv4()
		const swarmStartedAt = Date.now()
		const agentEnvelopes = new Map<string, SubagentExecutionEnvelope>()

		const entries: SubagentStatusItem[] = prompts.map((prompt, index) => ({
			id: Math.random().toString(36).substring(2, 9),
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

		const governedCoordinator = new GovernedSwarmCoordinator(
			config.cwd,
			RoadmapService.getInstance().isEnabled(),
			prompts.length,
			laneDependencies,
			createLockAuthority({ inMemory: process.env.TS_NODE_PROJECT?.includes("unit-test") ?? false }),
			undefined,
			resumePlan?.recoveryReceipt?.resumeAttemptId,
		)
		const swarmAdmission = await governedCoordinator.admitSwarm(config.taskId)
		if (!swarmAdmission.admitted) {
			return formatResponse.toolError(
				`Swarm admission rejected (roadmap pressure). Retry after ${swarmAdmission.backoffMs}ms.`,
			)
		}

		let auditPreflightIssues: GatePreflightReadinessIssue[] = []
		try {
			auditPreflightIssues = await runGovernedSwarmAuditPreflight(config, swarmSummaryFromEntries(prompts))
		} catch (error) {
			Logger.warn("[SubagentToolHandler] Governed swarm audit preflight failed:", error)
			auditPreflightIssues = [{ stage: "roadmap_governance", message: "preflight unavailable" }]
		}

		const laneReceipts: LaneExecutionReceipt[] = []
		let governedReceiptSummary: GovernedReceiptSummary | undefined

		const emitStatus = async (status: DietCodeSaySubagentStatus["status"], partial: boolean) => {
			const completed = entries.filter((entry) => entry.status === "completed" || entry.status === "failed").length
			const successes = entries.filter((entry) => entry.status === "completed").length
			const failures = entries.filter((entry) => entry.status === "failed").length
			const toolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
			const inputTokens = entries.reduce((acc, entry) => acc + (entry.inputTokens || 0), 0)
			const outputTokens = entries.reduce((acc, entry) => acc + (entry.outputTokens || 0), 0)
			const contextWindow = entries.reduce((acc, entry) => Math.max(acc, entry.contextWindow || 0), 0)
			const maxContextTokens = entries.reduce((acc, entry) => Math.max(acc, entry.contextTokens || 0), 0)
			const maxContextUsagePercentage = entries.reduce((acc, entry) => Math.max(acc, entry.contextUsagePercentage || 0), 0)

			const swarmStatus: SwarmExecutionEnvelope["status"] =
				status === "running" ? "running" : failures > 0 ? "failed" : "completed"
			const draft = buildSwarmEnvelopeDraft({
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
			try {
				const persistedPath = await persistSwarmEnvelope(config.taskId, draft)
				artifactPath = persistedPath
			} catch (error) {
				Logger.warn("[SubagentToolHandler] Failed to persist swarm execution artifact:", error)
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
				invariantViolations: draft.invariants.violations,
				governedReceipt:
					governedReceiptSummary ??
					governedCoordinator.buildLiveReceiptSummary(swarmId, swarmAdmission, laneReceipts, swarmStartedAt),
			}

			await config.callbacks.say("subagent", JSON.stringify(payload), undefined, undefined, partial)
		}

		let statusUpdateQueue: Promise<void> = Promise.resolve()
		const queueStatusUpdate = (status: DietCodeSaySubagentStatus["status"], partial: boolean): Promise<void> => {
			statusUpdateQueue = statusUpdateQueue.catch(() => undefined).then(() => emitStatus(status, partial))
			return statusUpdateQueue
		}

		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "subagent")
		await queueStatusUpdate("running", true)

		const currentDepth = config.recursionDepth || 0
		const maxDepthSetting = config.services.stateManager.getGlobalSettingsKey("maxSwarmDepth")
		const maxDepth = typeof maxDepthSetting === "number" ? maxDepthSetting : 3
		if (currentDepth >= maxDepth) {
			const depthError = `Swarm Recursion Limit Reached (Depth: ${currentDepth}). To prevent runaway loops, this swarm cannot spawn further subagents. Complete the current task or simplify the objective.`
			Logger.warn(`[SubagentToolHandler] Recursion limit reached: ${depthError}`)
			return formatResponse.toolError(depthError)
		}

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

		const runners = prompts.map(() => {
			const runner = new SubagentRunner(config, builder)
			runner.setRecursionDepth(currentDepth + 1)
			return runner
		})
		const abortPollInterval = setInterval(() => {
			if (!config.taskState.abort) {
				return
			}
			clearInterval(abortPollInterval)
			void Promise.allSettled(runners.map((runner) => runner.abort()))
		}, 100)

		// Wire each subagent prompt to an orchestrator child stream
		const childStreamIds: (string | null)[] = await Promise.all(
			prompts.map(async (prompt) => {
				if (!parentStreamId) return null
				try {
					const childStream = await orchestrator.spawnChildStream(parentStreamId, `subagent: ${prompt.slice(0, 80)}`)
					return childStream.id
				} catch {
					return null
				}
			}),
		)

		// Production Hardening: Concurrency Limit (max 3 subagents in parallel)
		const MAX_CONCURRENCY = 3
		const results: PromiseSettledResult<SubagentRunResult>[] = new Array(prompts.length)
		let totalSwarmCost = 0
		const MAX_PARENT_COST = config.taskState.maxCost

		const runSubagent = async (index: number) => {
			if (resumePlan) {
				const entry = entries[index]
				const reused = resumePlan.reuseAgents.find((agent) => agent.index === entry.index)
				if (reused) {
					entry.status = "completed"
					entry.result = reused.result
					const sourceEnvelope = (await loadSwarmEnvelope(config.taskId, resumePlan.sourceSwarmId))?.agents.find(
						(agent) => agent.agentId === reused.envelopeId,
					)
					if (sourceEnvelope) {
						agentEnvelopes.set(entry.id, sourceEnvelope)
						enrichEntryFromEnvelope(entry, sourceEnvelope)
					}
					laneReceipts.push(
						governedCoordinator.buildLaneReceipt(
							{
								laneId: `swarm-lane:${swarmId}:${index}`,
								swarmId,
								agentId: entry.id,
								index,
								roadmapLeaseTaskId: `swarm-lane-${swarmId}-${index}`,
								claimedAt: Date.now(),
							},
							sourceEnvelope,
							"skipped",
							true,
						),
					)
					governedCoordinator.markLaneSkipped(index)
					await queueStatusUpdate("running", true)
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

			// Production Hardening: Staggered spawn to prevent simultaneous rate-limit bursts
			if (index > 0) {
				await new Promise((resolve) => setTimeout(resolve, 500))
			}

			const current = entries[index]
			const laneIntent = resolveLaneLockIntent(prompts[index], block.params as Record<string, string | undefined>, index)
			laneIntent.roadmapItemId = laneRoadmapItems.get(index)
			const laneNecessity = classifyLockNecessity(laneIntent)
			const laneClaim = await governedCoordinator.acquireLane(swarmId, current.id, index, laneIntent)
			if (!laneClaim.success || !laneClaim.claim) {
				current.status = "failed"
				current.error = laneClaim.error || "Work lane claim rejected (ownership ambiguous)."
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
						current.error,
					),
				)
				await queueStatusUpdate("running", true)
				results[index] = {
					status: "fulfilled",
					value: {
						status: "failed",
						error: current.error,
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

			try {
				const result = await runners[index].runWithEnvelope(
					prompts[index],
					async (update) => {
						// Real-time Swarm Cost Monitoring
						if (update.stats?.totalCost !== undefined) {
							const previousSubagentCost = current.totalCost || 0
							const costDelta = update.stats.totalCost - previousSubagentCost
							totalSwarmCost += costDelta

							if (MAX_PARENT_COST && totalSwarmCost > MAX_PARENT_COST) {
								const costError = `Swarm Cumulative Cost Budget Exceeded ($${totalSwarmCost} > $${MAX_PARENT_COST}). Aborting entire swarm.`
								Logger.error(`[SubagentToolHandler] ${costError}`)
								// Abort all runners immediately
								void Promise.allSettled(runners.map((r) => r.abort()))
							}
						}

						if (update.status === "running") {
							current.status = "running"
						}
						if (update.status === "completed") {
							current.status = "completed"
							const childId = childStreamIds[index]
							if (childId) {
								const streamSummary = [
									excerpt(update.result, 200),
									`artifact:${swarmId}`,
									`agent:${current.id}`,
								].join(" | ")
								orchestrator.completeStream(childId, streamSummary).catch(() => {})
							}
						}
						if (update.status === "failed") {
							current.status = "failed"
							const childId = childStreamIds[index]
							if (childId) orchestrator.failStream(childId, update.error || "Subagent failed").catch(() => {})
						}
						if (update.result !== undefined) {
							current.result = update.result
						}
						if (update.error !== undefined) {
							current.error = update.error
						}
						if (update.latestToolCall !== undefined) {
							current.latestToolCall = update.latestToolCall
						}
						if (update.activeSignals !== undefined) {
							current.criticalSignals = update.activeSignals
						}
						if (update.stats) {
							current.toolCalls = update.stats.toolCalls || 0
							current.inputTokens = update.stats.inputTokens || 0
							current.outputTokens = update.stats.outputTokens || 0
							current.totalCost = update.stats.totalCost || 0
							current.contextTokens = update.stats.contextTokens || 0
							current.contextWindow = update.stats.contextWindow || 0
							current.contextUsagePercentage = update.stats.contextUsagePercentage || 0
						}
						await queueStatusUpdate("running", true)
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
						onTranscriptFlush: async () => {
							await queueStatusUpdate("running", true)
						},
					},
					childStreamIds[index] || undefined,
				)
				if (result.envelope) {
					agentEnvelopes.set(current.id, result.envelope)
					enrichEntryFromEnvelope(current, result.envelope)
				}
				laneReceipts.push(
					governedCoordinator.buildLaneReceipt(
						laneClaim.claim,
						result.envelope,
						result.status === "completed" ? "completed" : "failed",
						false,
						result.error,
					),
				)
				results[index] = { status: "fulfilled", value: result }
			} catch (error) {
				Logger.error(`[SubagentToolHandler] Subagent ${index} crashed:`, error)
				current.status = "failed"
				current.error = (error as Error).message || "Internal Runner Crash"
				const childId = childStreamIds[index]
				if (childId) orchestrator.failStream(childId, current.error).catch(() => {})
				laneReceipts.push(
					governedCoordinator.buildLaneReceipt(laneClaim.claim, undefined, "failed", false, current.error),
				)
				await queueStatusUpdate("running", true)
				results[index] = { status: "rejected", reason: error }
			} finally {
				const succeeded = current.status === "completed"
				const failed = current.status === "failed"
				await governedCoordinator.releaseLane(laneClaim.claim, succeeded, failed, current.error)
				const lastReceipt = laneReceipts.find((receipt) => receipt.agentId === current.id && receipt.index === index)
				if (lastReceipt) {
					lastReceipt.claimReleased = true
					lastReceipt.dagState = governedCoordinator.getLaneDAG().getNode(index)?.state
				}
			}
		}

		const executeSwarmLanes = async (): Promise<void> => {
			const pending = new Set(prompts.map((_, index) => index))
			const running = new Map<number, Promise<void>>()

			while (pending.size > 0 || running.size > 0) {
				for (const index of [...pending]) {
					if (running.size >= MAX_CONCURRENCY) {
						break
					}
					if (!governedCoordinator.isLaneReady(index)) {
						continue
					}
					pending.delete(index)
					const job = runSubagent(index).finally(() => {
						running.delete(index)
					})
					running.set(index, job)
				}

				if (pending.size > 0 && running.size === 0) {
					for (const index of pending) {
						entries[index].status = "failed"
						entries[index].error = "Lane blocked by dependencies (upstream not sealed or deadlock)"
						laneReceipts.push(
							governedCoordinator.buildLaneReceipt(
								{
									laneId: `swarm-lane:${swarmId}:${index}`,
									swarmId,
									agentId: entries[index].id,
									index,
									roadmapLeaseTaskId: `swarm-lane-${swarmId}-${index}`,
									roadmapItemId: laneRoadmapItems.get(index),
									claimedAt: Date.now(),
									executionMode: "mutation",
									lockRequired: true,
								},
								undefined,
								"blocked",
								false,
								entries[index].error,
							),
						)
						results[index] = {
							status: "fulfilled",
							value: {
								status: "failed",
								error: entries[index].error,
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
					}
					pending.clear()
					break
				}

				if (running.size > 0) {
					await Promise.race(running.values())
				}
			}
		}

		// Production Hardening: 20-minute hard timeout for the entire swarm execution
		const SUBAGENT_EXECUTION_TIMEOUT_MS = 20 * 60 * 1000

		try {
			await pTimeout(executeSwarmLanes(), {
				milliseconds: SUBAGENT_EXECUTION_TIMEOUT_MS,
				message: "Subagent swarm execution timed out after 20 minutes.",
			})
		} catch (err: unknown) {
			Logger.error("[SubagentToolHandler] Swarm execution error or timeout:", err)
			// Abort all runners on timeout to prevent zombie processes
			void Promise.allSettled(runners.map((r) => r.abort()))
		} finally {
			clearInterval(abortPollInterval)
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

		const failures = entries.filter((entry) => entry.status === "failed").length
		let finalSwarmStatus: SwarmExecutionEnvelope["status"] =
			failures > 0
				? "failed"
				: failures === 0 && entries.some((entry) => entry.status === "failed")
					? "failed"
					: "completed"

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
		})

		finalEnvelope.checksum = computeSwarmArtifactChecksum(finalEnvelope)

		try {
			const artifactPath = await persistSwarmEnvelope(config.taskId, finalEnvelope)
			finalEnvelope.artifactPath = artifactPath
		} catch (error) {
			Logger.warn("[SubagentToolHandler] Failed to persist final swarm execution artifact:", error)
		}

		let governedReceipt: GovernedSwarmReceipt | undefined
		try {
			governedReceipt = await governedCoordinator.sealReceipt({
				taskId: config.taskId,
				envelope: finalEnvelope,
				admission: swarmAdmission,
				laneReceipts,
				preflightIssues: auditPreflightIssues,
			})
			finalEnvelope.invariants.violations.push(...governedReceipt.mergeGate.violations)
			finalEnvelope.invariants.validated = governedReceipt.sealed

			if (!governedReceipt.sealed) {
				finalSwarmStatus = "failed"
				finalEnvelope.status = "failed"
			}

			governedReceiptSummary = await governedCoordinator.buildReceiptSummary(governedReceipt)
		} catch (error) {
			Logger.warn("[SubagentToolHandler] Failed to seal governed swarm receipt:", error)
			finalSwarmStatus = "failed"
		}

		await queueStatusUpdate(finalSwarmStatus === "failed" ? "failed" : "completed", false)

		const subagentUsagePayload: DietCodeSubagentUsageInfo = {
			source: "subagents",
			tokensIn: usageTokensIn,
			tokensOut: usageTokensOut,
			cacheWrites: usageCacheWrites,
			cacheReads: usageCacheReads,
			cost: usageCost,
		}
		await config.callbacks.say("subagent_usage", JSON.stringify(subagentUsagePayload))

		return formatResponse.toolResult(buildParentToolResult(finalEnvelope, summaryOverlay, governedReceipt))
	}
}
