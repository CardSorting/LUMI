import * as path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { ApiHandler, buildApiHandler } from "@core/api"
import { parseAssistantMessageV2, ToolUse } from "@core/assistant-message"
import {
	filterEnabledSkills,
	filterSubagentPromptSkills,
	getResolvedSkillsForCwd,
} from "@core/context/instructions/user-instructions/skills"
import { formatResponse } from "@core/prompts/responses"
import { PromptRegistry } from "@core/prompts/system-prompt"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { StreamResponseHandler } from "@core/task/StreamResponseHandler"
import { ModelInfo } from "@shared/api"
import { resolveCompletionGateOptions } from "@shared/audit/auditGatePolicyLoader"
import type { CompletionGateOptions } from "@shared/audit/auditGateReport"
import { buildSubagentAuditContext, buildSubagentGateSignals } from "@shared/audit/auditSubagentContext"
import type { ExecutionFunnelEvent } from "@shared/execution/executionFunnelEvent"
import {
	DietCodeAssistantToolUseBlock,
	DietCodeStorageMessage,
	DietCodeTextContentBlock,
	DietCodeUserContent,
} from "@shared/messages"
import { Logger } from "@shared/services/Logger"
import type { LaneAuthorityState } from "@shared/subagent/blockerPolicy"
import type { SubagentExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type { LaneExecutionMode } from "@shared/subagent/governedExecution"
import type { CompactionEventRecord } from "@shared/subagent/transcript"
import { DietCodeDefaultTool, DietCodeTool } from "@shared/tools"
import { v4 as uuidv4 } from "uuid"
import { ContextManager } from "@/core/context/context-management/ContextManager"
import { checkContextWindowExceededError } from "@/core/context/context-management/context-error-handling"
import { getContextWindowInfo } from "@/core/context/context-management/context-window-utils"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { HostRegistryInfo } from "@/registry"
import { DietCodeError, DietCodeErrorType } from "@/services/error"
import { ApiFormat } from "@/shared/proto/dietcode/models"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "@/utils/cost"
import { TaskState } from "../../TaskState"
import {
	buildCompletionGateObservabilityEnvelope,
	canonicalizeAttemptCompletionResultParams,
	getCompletionGateOperationalState,
	getCompletionGatePressureLevel,
	getCompletionGateRetryPolicy,
	getLatestCheckpointHashFromMessages,
	wrapFormattedCompletionError,
} from "../attemptCompletionUtils"
import { executionFunnel, shouldBypassGuardForLaneIoTool, shouldUseIoAuthorityReadFastPath } from "../execution/ExecutionFunnel"
import { validateSubagentCompletionGates } from "../subagentCompletionGates"
import { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import { resolveContinuationFromParentSignals } from "./CoordinatorExecutionAuthority"
import { shouldEnableParallelToolCallingForLane } from "./LockNecessity"
import { SubagentBuilder } from "./SubagentBuilder"
import { SubagentEnvelopeBuilder } from "./SubagentEnvelopeBuilder"
import { SubagentTranscriptRecorder } from "./SubagentTranscriptRecorder"
import { SwarmConsensusHandler } from "./SwarmConsensusHandler"

const MAX_EMPTY_ASSISTANT_RETRIES = 3
const MAX_INITIAL_STREAM_ATTEMPTS = 3
const INITIAL_STREAM_RETRY_BASE_DELAY_MS = 250
const MAX_TOTAL_TOOL_CALLS = 50
const MAX_PARALLEL_IO_TOOL_CALLS = 4
const MAX_TASK_ITERATIONS = 25

function getParentCompletionFailedStage(taskState: TaskState): string | undefined {
	return taskState.lastCompletionFailedStage
}

function getParentGatePressureLevel(taskState: TaskState): string | undefined {
	return taskState.completionGatePressureLevel
}

function getSubagentGateConfig(baseConfig: TaskConfig): TaskConfig {
	return {
		taskState: baseConfig.taskState,
		focusChainSettings: baseConfig.focusChainSettings,
		messageState: baseConfig.messageState,
	} as TaskConfig
}

export type SubagentRunStatus = "completed" | "failed"

export interface SubagentRunResult {
	status: SubagentRunStatus
	result?: string
	error?: string
	stats: SubagentRunStats
	envelope?: SubagentExecutionEnvelope
}

interface ConfigWithExtensions extends TaskConfig {
	getSessionStreamId?: () => string
}

interface SubagentProgressUpdate {
	stats?: SubagentRunStats
	latestToolCall?: string
	status?: "running" | "completed" | "failed"
	result?: string
	error?: string
	/** @deprecated Use advisorySignals — parent gate context is never lane-blocking authority. */
	activeSignals?: string[]
	advisorySignals?: string[]
	hardSignals?: string[]
	authorityState?: LaneAuthorityState
}

interface SubagentRunStats {
	toolCalls: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number
	contextTokens: number
	contextWindow: number
	contextUsagePercentage: number
	maxTokens?: number
	maxCost?: number
}

interface SubagentRequestUsageState {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalTokens: number
	totalCost?: number
}

interface SubagentUsageState {
	currentRequest: SubagentRequestUsageState
	lastRequest?: SubagentRequestUsageState
}

interface SubagentToolCall {
	toolUseId: string
	id?: string
	call_id?: string
	name: string
	input: unknown
	isNativeToolCall: boolean
}

function createEmptyRequestUsageState(): SubagentRequestUsageState {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheWriteTokens: 0,
		cacheReadTokens: 0,
		totalTokens: 0,
	}
}

function serializeToolResult(result: unknown): string {
	if (typeof result === "string") {
		return result
	}

	if (Array.isArray(result)) {
		return result
			.map((item) => {
				if (!item || typeof item !== "object") {
					return String(item)
				}

				const maybeText = (item as { text?: string }).text
				if (typeof maybeText === "string") {
					return maybeText
				}

				return JSON.stringify(item)
			})
			.join("\n")
	}

	return JSON.stringify(result, null, 2)
}

function toToolUseParams(input: unknown): Partial<Record<string, string>> {
	if (!input || typeof input !== "object") {
		return {}
	}

	const params: Record<string, string> = {}
	for (const [key, value] of Object.entries(input)) {
		params[key] = typeof value === "string" ? value : JSON.stringify(value)
	}

	return params
}

function calculateApiCost(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
): number {
	const format = modelInfo.apiFormat
	if (
		format === ApiFormat.OPENAI_CHAT ||
		format === ApiFormat.OPENAI_RESPONSES ||
		format === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
	) {
		return calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens)
	}
	// Fallback to Anthropic style for providers where inputTokens already represents the total
	return calculateApiCostAnthropic(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens)
}

function formatToolArgPreview(value: string, maxLength = 48): string {
	const normalized = value.replace(/\s+/g, " ").trim()
	if (normalized.length <= maxLength) {
		return normalized
	}
	return `${normalized.slice(0, maxLength - 3)}...`
}

function formatToolCallPreview(toolName: string, params: Partial<Record<string, string>>): string {
	const entries = Object.entries(params).filter(([, value]) => value !== undefined)
	const visibleEntries = entries.slice(0, 3)
	const omittedCount = Math.max(0, entries.length - visibleEntries.length)

	const args = visibleEntries
		.map(([key, value]) => `${key}=${formatToolArgPreview(value ?? "")}`)
		.concat(omittedCount > 0 ? [`...+${omittedCount}`] : [])
		.join(", ")

	return `${toolName}(${args})`
}

function normalizeToolCallArguments(argumentsPayload: unknown): string {
	if (typeof argumentsPayload === "string") {
		return argumentsPayload
	}

	try {
		return JSON.stringify(argumentsPayload ?? {})
	} catch {
		return "{}"
	}
}

function resolveToolUseId(call: { id?: string; call_id?: string; name?: string }, index: number): string {
	const id = call.id?.trim()
	if (id) {
		return id
	}

	const callId = call.call_id?.trim()
	if (callId) {
		return callId
	}

	const fallbackId = `subagent_tool_${Date.now()}_${index + 1}`
	Logger.warn(`[SubagentRunner] Missing tool call id for '${call.name || "unknown"}'; using fallback '${fallbackId}'`)
	return fallbackId
}

function toAssistantToolUseBlock(call: SubagentToolCall): DietCodeAssistantToolUseBlock {
	return {
		type: "tool_use",
		id: call.toolUseId,
		name: call.name,
		input: call.input,
		call_id: call.call_id,
	}
}

function parseNonNativeToolCalls(assistantText: string): SubagentToolCall[] {
	const parsedBlocks = parseAssistantMessageV2(assistantText)

	return parsedBlocks
		.filter((block): block is ToolUse => block.type === "tool_use")
		.filter((block) => !block.partial)
		.map((block, index) => ({
			toolUseId: resolveToolUseId({ call_id: block.call_id, name: block.name }, index),
			name: block.name,
			input: block.params,
			call_id: block.call_id,
			isNativeToolCall: false,
		}))
}

function pushSubagentToolResultBlock(
	toolResultBlocks: DietCodeUserContent[],
	call: SubagentToolCall,
	label: string,
	content: string,
): void {
	if (call.isNativeToolCall) {
		toolResultBlocks.push({
			type: "tool_result",
			tool_use_id: call.toolUseId,
			call_id: call.call_id,
			content,
		})
		return
	}

	toolResultBlocks.push({
		type: "text",
		text: `${label} Result:\n${content}`,
	})
}

export class SubagentRunner {
	private readonly apiHandler: ApiHandler
	private readonly agent: SubagentBuilder
	private readonly allowedTools: DietCodeDefaultTool[]
	private activeApiAbort?: () => void
	private abortRequested = false
	private recursionDepth = 0
	private laneExecutionMode: LaneExecutionMode = "mutation"
	private commandOwnerId = uuidv4()
	private prefetchedParentContext?: string | Promise<string | undefined>
	private swarmGateOptions?: CompletionGateOptions
	private activeCommandExecutions = 0
	private abortingCommands = false
	private siblingEnvelopes?: Map<string, SubagentExecutionEnvelope>
	private laneIntents?: any[]
	private laneDAG?: any
	private laneIndex?: number
	private swarmId?: string
	private lockClaim?: any
	private streamId?: string

	private readonly baseConfig: TaskConfig
	private totalConsecutiveIdenticalCalls = 0
	private readonly MAX_CONSECUTIVE_IDENTICAL_CALLS = 3
	private signaledFindings = new Set<string>()
	private signalingFindings = new Set<string>()
	private signalSequence = 0
	private stats: SubagentRunStats = {
		toolCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheWriteTokens: 0,
		cacheReadTokens: 0,
		totalCost: 0,
		contextTokens: 0,
		contextWindow: 0,
		contextUsagePercentage: 0,
	}
	private activeSignals: string[] = []
	private onProgress?: (update: SubagentProgressUpdate) => void
	private toolCallHistory: string[] = []
	private envelopeBuilder?: SubagentEnvelopeBuilder
	private transcriptRecorder?: SubagentTranscriptRecorder
	private onTranscriptFlush?: () => Promise<void>
	private transcriptArtifactPath?: string

	constructor(baseConfig: TaskConfig, agent: SubagentBuilder) {
		this.baseConfig = baseConfig
		this.agent = agent
		this.apiHandler = this.agent.getApiHandler()
		this.allowedTools = this.agent.getAllowedTools()
	}

	setRecursionDepth(depth: number): void {
		this.recursionDepth = depth
	}

	setLaneExecutionMode(mode: LaneExecutionMode): void {
		this.laneExecutionMode = mode
	}

	async abort(): Promise<void> {
		this.abortRequested = true

		try {
			this.activeApiAbort?.()
		} catch (error) {
			Logger.error("[SubagentRunner] failed to abort active API stream", error)
		}

		if (this.activeCommandExecutions > 0 && !this.abortingCommands && this.baseConfig.callbacks.cancelRunningCommandTool) {
			this.abortingCommands = true
			try {
				await this.baseConfig.callbacks.cancelRunningCommandTool(this.commandOwnerId)
			} catch (error) {
				Logger.error("[SubagentRunner] failed to cancel running command execution", error)
			} finally {
				this.abortingCommands = false
			}
		}
	}

	private shouldAbort(): boolean {
		return this.abortRequested || this.baseConfig.taskState.abort
	}

	private async getWorkspaceMetadataEnvironmentBlock(): Promise<string | null> {
		try {
			const workspacesJson =
				(await this.baseConfig.workspaceManager?.buildWorkspacesJson()) ??
				JSON.stringify(
					{
						workspaces: {
							[this.baseConfig.cwd]: {
								hint: path.basename(this.baseConfig.cwd) || this.baseConfig.cwd,
							},
						},
					},
					null,
					2,
				)

			return `<environment_details>\n# Workspace Configuration\n${workspacesJson}\n</environment_details>`
		} catch (error) {
			Logger.warn("[SubagentRunner] Failed to build workspace metadata block", error)
			return null
		}
	}

	runWithEnvelope(
		prompt: string,
		onProgress: (update: SubagentProgressUpdate) => void,
		envelopeContext: {
			agentId: string
			role: string
			swarmId: string
			taskId: string
			index: number
			depth: number
			parentStreamId?: string
			parentExecutionId?: string
			resumeAttemptId?: string
			executionId?: string
			prefetchedParentContext?: string | Promise<string | undefined>
			swarmGateOptions?: CompletionGateOptions
			onTranscriptFlush?: () => Promise<void>
			siblingEnvelopes?: Map<string, SubagentExecutionEnvelope>
			laneIntents?: any[]
			laneDAG?: any
			lockClaim?: any
		},
		streamId?: string,
	): Promise<SubagentRunResult> {
		const executionId = envelopeContext.executionId || uuidv4()
		this.commandOwnerId = executionId
		this.prefetchedParentContext = envelopeContext.prefetchedParentContext
		this.swarmGateOptions = envelopeContext.swarmGateOptions
		this.onTranscriptFlush = envelopeContext.onTranscriptFlush
		this.siblingEnvelopes = envelopeContext.siblingEnvelopes
		this.laneIntents = envelopeContext.laneIntents
		this.laneDAG = envelopeContext.laneDAG
		this.laneIndex = envelopeContext.index
		this.swarmId = envelopeContext.swarmId
		this.lockClaim = envelopeContext.lockClaim
		this.transcriptRecorder = new SubagentTranscriptRecorder({
			swarmId: envelopeContext.swarmId,
			agentId: envelopeContext.agentId,
			taskId: envelopeContext.taskId,
			executionId,
		})
		this.envelopeBuilder = new SubagentEnvelopeBuilder(
			envelopeContext.agentId,
			executionId,
			envelopeContext.role,
			envelopeContext.swarmId,
			envelopeContext.taskId,
			prompt,
			{
				swarmId: envelopeContext.swarmId,
				index: envelopeContext.index,
				depth: envelopeContext.depth,
				resumeAttemptId: envelopeContext.resumeAttemptId,
			},
			envelopeContext.parentStreamId,
			streamId,
		)
		if (envelopeContext.parentExecutionId) {
			this.envelopeBuilder.setParentExecutionId(envelopeContext.parentExecutionId)
		}
		return this.run(prompt, onProgress, streamId)
	}

	async run(
		prompt: string,
		onProgress: (update: SubagentProgressUpdate) => void,
		streamId?: string,
	): Promise<SubagentRunResult> {
		this.streamId = streamId
		this.abortRequested = false
		this.envelopeBuilder?.setStatus("running")

		if (this.transcriptRecorder) {
			this.transcriptArtifactPath = await this.transcriptRecorder.init()
			this.transcriptRecorder.append("system_event", { phase: "spawned", prompt }, "raw")
			await this.transcriptRecorder.flush()
			this.envelopeBuilder?.setTranscriptMeta(
				this.transcriptArtifactPath,
				this.transcriptRecorder.getEvents().length,
				this.transcriptRecorder.getMeta(this.transcriptArtifactPath).byteSize,
			)
			await this.invokeTranscriptFlushCallback()
		}

		const state = new TaskState()
		state.recursionDepth = this.recursionDepth
		const subagentConfig = this.createSubagentTaskConfig(state)
		let emptyAssistantResponseRetries = 0
		const usageState: SubagentUsageState = {
			currentRequest: createEmptyRequestUsageState(),
		}
		this.stats = {
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0,
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
			maxTokens: this.baseConfig.taskState.maxTokens,
			maxCost: this.baseConfig.taskState.maxCost,
		}
		const stats = this.stats

		this.activeSignals = []
		this.onProgress = onProgress
		onProgress({ status: "running", stats })

		const gateOptions =
			this.swarmGateOptions ??
			(await resolveCompletionGateOptions(this.baseConfig, this.baseConfig.cwd, {
				lastAdvisoryAudit: this.baseConfig.taskState.lastAdvisoryAudit,
			}))
		const parentCompletionFailedStage = getParentCompletionFailedStage(this.baseConfig.taskState)
		const parentGateConfig = getSubagentGateConfig(this.baseConfig)
		const parentGateObservability =
			this.baseConfig.taskState.completionGateObservabilityEnvelope ??
			buildCompletionGateObservabilityEnvelope(parentGateConfig)
		const parentGatePressureLevel =
			getParentGatePressureLevel(this.baseConfig.taskState) ?? getCompletionGatePressureLevel(parentGateConfig)
		const parentGateRetryStatus = this.baseConfig.taskState.lastCompletionBlockReason
			? getCompletionGateRetryPolicy(
					this.baseConfig.taskState
						.lastCompletionBlockReason as import("../attemptCompletionUtils").CompletionPreflightReason,
					parentGateConfig,
				).retryStatus
			: undefined
		const parentGateOperationalState = getCompletionGateOperationalState(parentGateConfig)
		const parentGateBlockHistoryCount = this.baseConfig.taskState.completionGateBlockHistory?.length
		const parentGateSessionId = this.baseConfig.taskState.completionGateSessionId
		const parentGateSignals = buildSubagentGateSignals({
			lastCompletionAudit: this.baseConfig.taskState.lastCompletionAudit,
			lastAdvisoryAudit: this.baseConfig.taskState.lastAdvisoryAudit,
			completionGateBlockCount: this.baseConfig.taskState.completionGateBlockCount,
			lastCompletionBlockReason: this.baseConfig.taskState.lastCompletionBlockReason,
			lastCompletionFailedStage: parentCompletionFailedStage,
			completionAttemptCount: this.baseConfig.taskState.completionAttemptCount,
			completionGatePressureLevel: parentGatePressureLevel,
			completionGateRetryStatus: parentGateRetryStatus,
			completionGateBlockHistoryCount: parentGateBlockHistoryCount,
			completionGateSessionId: parentGateSessionId,
			completionGateOperationalState: parentGateOperationalState,
			gateOptions,
		})
		const hardSignals = parentGateSignals.filter((s) => s.startsWith("SIGNAL: PARENT_CRITICAL"))
		const { advisorySignals } = resolveContinuationFromParentSignals(parentGateSignals)
		if (advisorySignals.length > 0 || hardSignals.length > 0) {
			this.activeSignals = [...advisorySignals, ...hardSignals]
			onProgress({
				advisorySignals,
				hardSignals,
				authorityState: "executing",
			})
		}

		try {
			const mode = this.baseConfig.services.stateManager.getGlobalSettingsKey("mode")
			const apiConfiguration = this.baseConfig.services.stateManager.getApiConfiguration()
			const api = this.apiHandler
			this.activeApiAbort = api.abort?.bind(api)

			const providerId = (
				mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider
			) as string
			const providerInfo = {
				providerId,
				model: api.getModel(),
				mode,
				customPrompt: this.baseConfig.services.stateManager.getGlobalSettingsKey("customPrompt"),
			}
			stats.contextWindow = providerInfo.model.info.contextWindow || 0
			const nativeToolCallsRequested =
				providerInfo.model.info.apiFormat === ApiFormat.OPENAI_RESPONSES ||
				!!this.baseConfig.services.stateManager.getGlobalStateKey("nativeToolCallEnabled")

			const host = HostRegistryInfo.get()
			const discoveredSkills = await getResolvedSkillsForCwd(this.baseConfig.cwd)
			const globalSkillsToggles = this.baseConfig.services.stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
			const localSkillsToggles = this.baseConfig.services.stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {}
			const availableSkills = filterEnabledSkills(discoveredSkills, globalSkillsToggles, localSkillsToggles)
			const configuredSkillNames = this.agent.getConfiguredSkills()
			const resolvedForPrompt = filterSubagentPromptSkills(availableSkills)
			const skills =
				configuredSkillNames !== undefined
					? configuredSkillNames
							.map((skillName) => {
								const skill = resolvedForPrompt.find((candidate) => candidate.name === skillName)
								if (!skill) {
									Logger.warn(
										`[SubagentRunner] Configured skill '${skillName}' not found or disabled for subagent run.`,
									)
								}
								return skill
							})
							.filter((skill): skill is (typeof resolvedForPrompt)[number] => Boolean(skill))
					: resolvedForPrompt

			const context: SystemPromptContext = {
				providerInfo,
				cwd: this.baseConfig.cwd,
				ide: host?.platform || "Unknown",
				skills,
				focusChainSettings: this.baseConfig.focusChainSettings,
				browserSettings: this.baseConfig.browserSettings,
				yoloModeToggled: false,
				enableNativeToolCalls: nativeToolCallsRequested,
				enableParallelToolCalling: shouldEnableParallelToolCallingForLane(
					this.laneExecutionMode,
					!!this.baseConfig.enableParallelToolCalling,
				),
				isSubagentRun: true,
				mode: mode as "plan" | "act", // Subagents inherit the parent's mode context
				parentMode: mode as "plan" | "act",
			}

			const promptRegistry = PromptRegistry.getInstance()
			const generatedSystemPrompt = await promptRegistry.get(context)

			// Fluid Orchestration: Inject parent stream context for subagent awareness
			try {
				const currentHash = getLatestCheckpointHashFromMessages(this.baseConfig)
				const lastAuditHash = this.baseConfig.taskState.lastCompletionAuditCheckpointHash
				const isStale = lastAuditHash !== undefined && currentHash !== lastAuditHash

				const auditContext = buildSubagentAuditContext({
					lastCompletionAudit: this.baseConfig.taskState.lastCompletionAudit,
					lastAdvisoryAudit: this.baseConfig.taskState.lastAdvisoryAudit,
					completionGateBlockCount: this.baseConfig.taskState.completionGateBlockCount,
					lastCompletionBlockReason: this.baseConfig.taskState.lastCompletionBlockReason,
					lastCompletionFailedStage: parentCompletionFailedStage,
					completionAttemptCount: this.baseConfig.taskState.completionAttemptCount,
					completionGatePressureLevel: parentGatePressureLevel,
					completionGateObservabilityEnvelope: parentGateObservability,
					completionGateRetryStatus: parentGateRetryStatus,
					completionGateBlockHistoryCount: parentGateBlockHistoryCount,
					completionGateSessionId: parentGateSessionId,
					completionGateOperationalState: parentGateOperationalState,
					gateOptions,
					mode: mode as "plan" | "act",
					isStale,
				})
				const parentStreamId = (this.baseConfig as ConfigWithExtensions).getSessionStreamId?.()
				const compressed =
					this.prefetchedParentContext !== undefined
						? await this.prefetchedParentContext
						: parentStreamId
							? await orchestrator.getCompressedContext(parentStreamId).catch(() => undefined)
							: undefined
				const combined = [auditContext, compressed].filter(Boolean).join("\n\n")
				this.agent.setParentStreamContext(combined)
			} catch (err) {
				Logger.error("[SubagentRunner] Failed to fetch parent context:", err)
			}

			// Sibling Swarm State Sharing
			if (this.siblingEnvelopes && this.laneIndex !== undefined) {
				const siblingContextParts: string[] = []
				const dag = this.laneDAG
				const currentIdx = this.laneIndex

				for (const [agentId, envelope] of this.siblingEnvelopes.entries()) {
					const sibIdx = envelope.lineage?.index
					if (sibIdx === undefined || sibIdx === currentIdx) continue

					const isDependency = dag ? dag.laneDependsOn(currentIdx, sibIdx) : false
					const relationLabel = isDependency ? "Prerequisite" : "Advisory"

					const touchedFilesList = (envelope.touchedFiles || [])
						.map((f) => `- [${f}](file://${this.baseConfig.cwd}/${f})`)
						.join("\n")

					const resultText = envelope.verbatimOutput || "No output provided."
					const excerptText = resultText.length > 1500 ? resultText.slice(0, 1500) + "\n... (truncated)" : resultText

					siblingContextParts.push(
						`#### [${relationLabel}] Lane ${sibIdx + 1} (${envelope.role || `Subagent ${sibIdx + 1}`})` +
							`\n- **Prompt**: ${envelope.prompt}` +
							(touchedFilesList ? `\n- **Files Modified**:\n${touchedFilesList}` : "") +
							`\n- **Execution Result**:\n\`\`\`\n${excerptText}\n\`\`\``,
					)
				}

				if (siblingContextParts.length > 0) {
					this.agent.setSiblingLanesContext(
						`The following sibling lanes in the current swarm have already completed:\n\n${siblingContextParts.join("\n\n")}`,
					)
				}
			}

			const useNativeToolCalls = !!promptRegistry.nativeTools?.length
			const nativeTools = useNativeToolCalls ? this.agent.buildNativeTools(context) : undefined

			if (useNativeToolCalls && (!nativeTools || nativeTools.length === 0)) {
				const error = "Subagent tool requires native tool calling support."
				this.envelopeBuilder?.fail(error)
				return this.finalizeAndPublish({ status: "failed", error, stats })
			}

			if (this.shouldAbort()) {
				await this.abort()
				const error = "Subagent run cancelled."
				this.envelopeBuilder?.abort()
				return this.finalizeAndPublish({ status: "failed", error, stats })
			}

			const workspaceMetadataEnvironmentBlock = await this.getWorkspaceMetadataEnvironmentBlock()
			const conversation: DietCodeStorageMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: prompt,
						} as DietCodeTextContentBlock,
						...(workspaceMetadataEnvironmentBlock
							? [
									{
										type: "text",
										text: workspaceMetadataEnvironmentBlock,
									} as DietCodeTextContentBlock,
								]
							: []),
					],
				},
			]

			let iterationCount = 0
			while (iterationCount < MAX_TASK_ITERATIONS) {
				iterationCount++
				const systemPrompt = this.agent.buildSystemPrompt(generatedSystemPrompt)
				if (
					usageState.lastRequest &&
					this.shouldCompactBeforeNextRequest(usageState.lastRequest.totalTokens, api, providerInfo.model.id)
				) {
					const didCompact = await this.compactConversationForContextWindow(
						conversation,
						usageState.lastRequest.totalTokens,
						"proactive_threshold",
					)
					if (didCompact) {
						Logger.warn("[SubagentRunner] Proactively compacted context before next subagent request.")
					}
					usageState.lastRequest = undefined
				}

				await this.recordTranscript("llm_request", {
					iteration: iterationCount,
					modelId: providerInfo.model.id,
					providerId: providerInfo.providerId,
					messageCount: conversation.length,
				})

				const streamHandler = new StreamResponseHandler()
				const { toolUseHandler } = streamHandler.getHandlers()
				usageState.currentRequest = createEmptyRequestUsageState()
				const requestUsage = usageState.currentRequest

				let assistantText = ""
				let assistantTextSignature: string | undefined
				let requestId: string | undefined

				const stream = this.createMessageWithInitialChunkRetry(
					api,
					systemPrompt,
					conversation,
					nativeTools,
					providerInfo.providerId,
					providerInfo.model.id,
				)

				for await (const chunk of stream) {
					switch (chunk.type) {
						case "usage":
							requestId = requestId ?? chunk.id
							stats.inputTokens += chunk.inputTokens || 0
							stats.outputTokens += chunk.outputTokens || 0
							stats.cacheWriteTokens += chunk.cacheWriteTokens || 0
							stats.cacheReadTokens += chunk.cacheReadTokens || 0
							requestUsage.inputTokens += chunk.inputTokens || 0
							requestUsage.outputTokens += chunk.outputTokens || 0
							requestUsage.cacheWriteTokens += chunk.cacheWriteTokens || 0
							requestUsage.cacheReadTokens += chunk.cacheReadTokens || 0
							requestUsage.totalTokens =
								requestUsage.inputTokens +
								requestUsage.outputTokens +
								requestUsage.cacheWriteTokens +
								requestUsage.cacheReadTokens
							requestUsage.totalCost = chunk.totalCost ?? requestUsage.totalCost
							stats.contextTokens = requestUsage.totalTokens
							stats.contextUsagePercentage =
								stats.contextWindow > 0 ? (stats.contextTokens / stats.contextWindow) * 100 : 0
							onProgress({ stats: { ...stats } })

							// Phase 3: Adaptive Budgeting
							if (stats.maxTokens && stats.inputTokens + stats.outputTokens > stats.maxTokens) {
								const error = `Swarm Token Budget Exceeded (${stats.maxTokens} tokens). Terminating subagent to prevent runaway costs.`
								Logger.warn(`[SubagentRunner] ${error}`)
								this.envelopeBuilder?.fail(error)
								this.envelopeBuilder?.recordRetryHint("Reduce context usage or raise token budget before retry.")
								return this.finalizeAndPublish({ status: "failed", error, stats })
							}
							if (stats.maxCost && stats.totalCost > stats.maxCost) {
								const error = `Swarm Cost Budget Exceeded ($${stats.maxCost}). Terminating subagent to prevent runaway costs.`
								Logger.warn(`[SubagentRunner] ${error}`)
								this.envelopeBuilder?.fail(error)
								this.envelopeBuilder?.recordRetryHint("Lower tool usage or raise cost budget before retry.")
								return this.finalizeAndPublish({ status: "failed", error, stats })
							}

							if (stats.toolCalls >= MAX_TOTAL_TOOL_CALLS) {
								const error = `Swarm Tool Call Limit Exceeded (${MAX_TOTAL_TOOL_CALLS}). Terminating subagent to prevent infinite tool loops.`
								Logger.warn(`[SubagentRunner] ${error}`)
								this.envelopeBuilder?.fail(error)
								this.envelopeBuilder?.recordRetryHint(
									"Simplify the objective or decompose into smaller subtasks.",
								)
								return this.finalizeAndPublish({ status: "failed", error, stats })
							}
							break
						case "text":
							requestId = requestId ?? chunk.id
							assistantText += chunk.text || ""
							assistantTextSignature = chunk.signature || assistantTextSignature
							break
						case "tool_calls":
							requestId = requestId ?? chunk.id
							toolUseHandler.processToolUseDelta(
								{
									id: chunk.tool_call.function?.id,
									type: "tool_use",
									name: chunk.tool_call.function?.name,
									input: normalizeToolCallArguments(chunk.tool_call.function?.arguments),
								},
								chunk.tool_call.call_id,
							)
							break
						case "reasoning":
							requestId = requestId ?? chunk.id
							break
					}

					if (this.shouldAbort()) {
						await this.abort()
						const error = "Subagent run cancelled."
						this.envelopeBuilder?.abort()
						return this.finalizeAndPublish({ status: "failed", error, stats })
					}
				}

				const calculatedRequestCost =
					requestUsage.totalCost ??
					calculateApiCost(
						providerInfo.model.info,
						requestUsage.inputTokens,
						requestUsage.outputTokens,
						requestUsage.cacheWriteTokens,
						requestUsage.cacheReadTokens,
					)
				requestUsage.totalTokens =
					requestUsage.inputTokens +
					requestUsage.outputTokens +
					requestUsage.cacheWriteTokens +
					requestUsage.cacheReadTokens
				stats.totalCost += calculatedRequestCost || 0
				usageState.lastRequest = { ...requestUsage }

				const nativeFinalizedToolCalls = toolUseHandler.getAllFinalizedToolUses().map((toolCall, index) => ({
					toolUseId: resolveToolUseId(toolCall, index),
					id: toolCall.id,
					call_id: toolCall.call_id,
					name: toolCall.name,
					input: toolCall.input,
					isNativeToolCall: true,
				}))
				const parsedNonNativeToolCalls = parseNonNativeToolCalls(assistantText)
				const fallbackNonNativeToolCalls = nativeFinalizedToolCalls.map((toolCall) => ({
					...toolCall,
					isNativeToolCall: false,
				}))

				let finalizedToolCalls: SubagentToolCall[] = []
				if (useNativeToolCalls) {
					finalizedToolCalls = nativeFinalizedToolCalls
				} else if (parsedNonNativeToolCalls.length > 0) {
					finalizedToolCalls = parsedNonNativeToolCalls
				} else if (fallbackNonNativeToolCalls.length > 0) {
					// Defensive fallback: if non-native mode receives structured tool call chunks,
					// execute them but serialize results as plain text to avoid tool_result pairing mismatches.
					Logger.warn(
						"[SubagentRunner] Received structured tool_calls while native tool calling is disabled; falling back to non-native result serialization.",
					)
					finalizedToolCalls = fallbackNonNativeToolCalls
				}
				const assistantContent: (DietCodeTextContentBlock | DietCodeAssistantToolUseBlock)[] = []
				if (assistantText.trim().length > 0) {
					assistantContent.push({
						type: "text",
						text: assistantText,
						signature: assistantTextSignature,
					})
				}
				if (useNativeToolCalls) {
					assistantContent.push(...finalizedToolCalls.map(toAssistantToolUseBlock))
				}

				if (assistantContent.length > 0) {
					conversation.push({
						role: "assistant",
						content: assistantContent,
						id: requestId,
					})
					await this.recordTranscript(
						"assistant_turn",
						{
							requestId,
							text: assistantText,
							toolCallCount: finalizedToolCalls.length,
						},
						"raw",
					)
				}

				if (finalizedToolCalls.length === 0) {
					emptyAssistantResponseRetries += 1
					if (emptyAssistantResponseRetries > MAX_EMPTY_ASSISTANT_RETRIES) {
						const error = "Subagent did not call attempt_completion."
						this.envelopeBuilder?.fail(error)
						this.envelopeBuilder?.recordRetryHint("Ensure the subagent calls attempt_completion with a result.")
						return this.finalizeAndPublish({ status: "failed", error, stats })
					}

					// Mirror the main loop's no-tools-used nudge so empty/blank model turns
					// can recover without surfacing an immediate hard failure in subagent UI.
					if (assistantContent.length === 0) {
						conversation.push({
							role: "assistant",
							content: [
								{
									type: "text",
									text: "Failure: I did not provide a response.",
								},
							],
							id: requestId,
						})
					}
					conversation.push({
						role: "user",
						content: [
							{
								type: "text",
								text: formatResponse.noToolsUsed(useNativeToolCalls),
							},
						],
					})
					await delay(0)
					continue
				}
				emptyAssistantResponseRetries = 0

				if (this.canExecuteParallelIoBatch(finalizedToolCalls)) {
					const toolResultBlocks = await this.executeParallelIoBatch(finalizedToolCalls, subagentConfig, state)
					conversation.push({
						role: "user",
						content: toolResultBlocks,
					})
					await delay(0)
					continue
				}

				const toolResultBlocks = [] as DietCodeUserContent[]
				for (const call of finalizedToolCalls) {
					const toolName = call.name as DietCodeDefaultTool
					const toolCallParams = toToolUseParams(call.input)

					if (toolName === DietCodeDefaultTool.ATTEMPT) {
						canonicalizeAttemptCompletionResultParams(toolCallParams)
						if (toolCallParams?.result) {
							await this.signalCriticalFindingsToSwarm(toolCallParams.result as string)
						}
						const completionResult = typeof toolCallParams?.result === "string" ? toolCallParams.result.trim() : ""
						if (!completionResult) {
							const missingResultError = formatResponse.missingToolParameterError("result")
							pushSubagentToolResultBlock(toolResultBlocks, call, toolName, missingResultError)
							continue
						}

						const gateResult = await validateSubagentCompletionGates(
							subagentConfig,
							completionResult,
							typeof toolCallParams?.task_progress === "string" ? toolCallParams.task_progress : undefined,
							typeof toolCallParams?.command === "string" ? toolCallParams.command : undefined,
							{ laneExecutionMode: this.laneExecutionMode },
						)
						this.envelopeBuilder?.recordCompletionFunnel(gateResult.completionFunnelEvent)
						if (gateResult.auditDeferredToSeal) {
							this.envelopeBuilder?.recordWarning(
								"Lane audit deferred to parent seal barrier — I/O authority fast path.",
							)
						}
						for (const diagnostic of gateResult.diagnostics) {
							this.envelopeBuilder?.recordWarning(diagnostic)
						}
						if (gateResult.error) {
							this.envelopeBuilder?.setPhase("completion_gate")
							this.envelopeBuilder?.recordBlocker(gateResult.error)
							pushSubagentToolResultBlock(
								toolResultBlocks,
								call,
								toolName,
								serializeToolResult(wrapFormattedCompletionError(gateResult.error)),
							)
							continue
						}

						stats.toolCalls += 1
						onProgress({ stats: { ...stats } })
						this.envelopeBuilder?.setPhase("completion_gate")
						this.envelopeBuilder?.complete(completionResult)
						await this.recordTranscript("completion", { result: completionResult }, "raw")
						const finalized = await this.finalizeResult({ status: "completed", result: completionResult, stats })
						void this.signalCriticalFindingsToSwarm(completionResult)
						await SwarmConsensusHandler.handleSignal(this.baseConfig, completionResult)
						onProgress({ status: "completed", result: completionResult, stats: { ...stats } })
						return finalized
					}

					const toolCallBlock: ToolUse = {
						type: "tool_use",
						name: toolName,
						params: toolCallParams,
						partial: false,
						isNativeToolCall: call.isNativeToolCall,
						call_id: call.call_id || call.toolUseId,
					}

					if (call.call_id) {
						state.toolUseIdMap.set(call.call_id, call.toolUseId)
					}

					const latestToolCall = formatToolCallPreview(toolName, toolCallParams)
					onProgress({ latestToolCall })
					await this.recordTranscript("tool_call", { toolName, preview: latestToolCall, params: toolCallParams }, "raw")

					const handler = this.baseConfig.coordinator.getHandler(toolName)
					let toolResult: unknown

					const outcome = await executionFunnel.execute({
						config: subagentConfig,
						block: toolCallBlock,
						registered: !!handler,
						handler,
						lane: "subagent",
						laneMode: this.laneExecutionMode,
						allowedInLane: this.allowedTools.includes(toolName),
						collisionCheck: this.streamId
							? async (mutationPaths) => {
									if (mutationPaths.length === 0) return undefined
									const collision = await orchestrator.checkCollision(this.streamId!, [...mutationPaths])
									return collision
										? `[COLLISION] ${collision} Wait for the other agent to finish or coordinate elsewhere.`
										: undefined
								}
							: undefined,
					})
					toolResult = outcome.result ?? formatResponse.toolError(outcome.event.reason)

					const guard = this.baseConfig.universalGuard
					if (
						guard &&
						(toolName === DietCodeDefaultTool.FILE_READ || toolName === DietCodeDefaultTool.SEARCH) &&
						toolCallParams.path &&
						typeof toolResult === "string"
					) {
						const pathKey = toolCallParams.path
						const currentCount = state.currentTurnReadHistory.get(pathKey) || 0
						if (currentCount === 0) state.currentTurnUniqueReadCount++
						const newCount = currentCount + 1
						state.currentTurnReadHistory.set(pathKey, newCount)
						state.currentTurnTotalReadCount++
						const globalCount = (state.taskReadHistory.get(pathKey) || 0) + 1
						state.taskReadHistory.set(pathKey, globalCount)
						toolResult = shouldUseIoAuthorityReadFastPath(toolName, this.laneExecutionMode)
							? guard.onReadIoAuthority(pathKey, toolResult)
							: await guard.onRead(pathKey, toolResult, state.currentTurnUniqueReadCount, newCount, globalCount)
					}

					stats.toolCalls += 1
					onProgress({ stats: { ...stats } })

					const serializedToolResult = serializeToolResult(toolResult)
					const toolDescription = handler?.getDescription(toolCallBlock) || `[${toolName}]`
					this.recordToolStepInEnvelope(
						toolName,
						latestToolCall,
						serializedToolResult,
						toolCallParams as Record<string, string>,
						outcome.event,
					)
					await this.recordTranscript(
						"tool_response",
						{
							toolName,
							preview: latestToolCall,
							resultExcerpt: serializedToolResult.slice(0, 500),
							executionFunnelEvent: outcome.event,
						},
						"raw",
					)
					pushSubagentToolResultBlock(toolResultBlocks, call, toolDescription, serializedToolResult)

					// Phase 5: Cross-Swarm Memory Signalling
					// Advisory cross-swarm persistence must not delay the next model turn.
					if (serializedToolResult.length > 0) {
						void this.signalCriticalFindingsToSwarm(serializedToolResult)
					}

					// Phase 6: Repetition Detection & Self-Correction
					this.applyRepetitionDetection(toolName, toolCallParams, toolResultBlocks)
				}

				conversation.push({
					role: "user",
					content: toolResultBlocks,
				})

				await delay(0)
			}

			const loopError = `Swarm Iteration Limit Exceeded (${MAX_TASK_ITERATIONS}). Subagent failed to complete the task within allowed turns.`
			this.envelopeBuilder?.fail(loopError)
			this.envelopeBuilder?.recordRetryHint("Decompose the task or increase iteration budget.")
			return this.finalizeAndPublish({ status: "failed", error: loopError, stats })
		} catch (error) {
			if (this.shouldAbort()) {
				const cancelledError = "Subagent run cancelled."
				this.envelopeBuilder?.abort()
				return this.finalizeAndPublish({ status: "failed", error: cancelledError, stats })
			}

			const errorText = (error as Error).message || "Subagent execution failed."
			Logger.error("[SubagentRunner] run failed", error)
			this.envelopeBuilder?.fail(errorText)
			return this.finalizeAndPublish({ status: "failed", error: errorText, stats })
		} finally {
			this.activeApiAbort = undefined
		}
	}

	private createSubagentTaskConfig(subagentTaskState = new TaskState()): TaskConfig {
		const baseCallbacks = this.baseConfig.callbacks
		const { ToolExecutorCoordinator } = require("../ToolExecutorCoordinator")
		const coordinator = new ToolExecutorCoordinator()
		const validator = new ToolValidator(
			this.baseConfig.services.dietcodeIgnoreController,
			// biome-ignore lint/style/noNonNullAssertion: Guard is guaranteed to exist by SubagentToolHandler validation.
			this.baseConfig.universalGuard!,
		) // Add guard from config

		for (const tool of this.allowedTools) {
			coordinator.registerByName(tool, validator)
		}

		subagentTaskState.recursionDepth = this.recursionDepth
		subagentTaskState.swarmId = this.swarmId
		subagentTaskState.laneIndex = this.laneIndex
		subagentTaskState.activeLockClaim = this.lockClaim

		return {
			...this.baseConfig,
			api: this.apiHandler,
			coordinator,
			taskState: subagentTaskState,
			messageState: this.baseConfig.messageState, // Use parent's message state handler but they will have their own stream
			recursionDepth: this.recursionDepth,
			isSubagentExecution: true,
			vscodeTerminalExecutionMode: "vscodeTerminal",
			callbacks: {
				...baseCallbacks,
				say: async () => undefined,
				sayAndCreateMissingParamError: async (_toolName, paramName) =>
					formatResponse.toolError(formatResponse.missingToolParameterError(paramName)),
				executeCommandTool: async (command: string, timeoutSeconds: number | undefined) => {
					this.activeCommandExecutions += 1
					try {
						return await baseCallbacks.executeCommandTool(command, timeoutSeconds, {
							suppressUserInteraction: true,
							ownerId: this.commandOwnerId,
						})
					} finally {
						this.activeCommandExecutions = Math.max(0, this.activeCommandExecutions - 1)
					}
				},
			},
		}
	}

	private shouldRetryInitialStreamError(error: unknown, providerId: string, modelId: string): boolean {
		// Mirror main loop behavior: do not auto-retry auth/balance failures.
		const parsedError = DietCodeError.transform(error, modelId, providerId)
		const isAuthError = parsedError.isErrorType(DietCodeErrorType.Auth)
		const isBalanceError = parsedError.isErrorType(DietCodeErrorType.Balance)

		if (isAuthError || isBalanceError) {
			return false
		}

		return true
	}

	private async recordTranscript(
		kind: import("@shared/subagent/transcript").SubagentTranscriptEventKind,
		payload: Record<string, unknown>,
		contentKind: import("@shared/subagent/transcript").TranscriptContentKind = "raw",
	): Promise<void> {
		if (!this.transcriptRecorder || !this.transcriptArtifactPath) {
			return
		}
		this.transcriptRecorder.append(kind, payload, contentKind)
		if (kind === "compaction") {
			// Compaction is a recovery boundary: persist it before dropping context.
			await this.transcriptRecorder.flush()
			return
		}
		this.transcriptRecorder.scheduleFlush()
	}

	private canExecuteParallelIoBatch(calls: SubagentToolCall[]): boolean {
		return (
			calls.length > 1 &&
			calls.every((call) => {
				const toolName = call.name as DietCodeDefaultTool
				return (
					toolName !== DietCodeDefaultTool.ATTEMPT &&
					this.allowedTools.includes(toolName) &&
					shouldBypassGuardForLaneIoTool(this.laneExecutionMode, toolName)
				)
			})
		)
	}

	/** Execute pure lane-local queries together, then project evidence in model-emission order. */
	private async executeParallelIoBatch(
		calls: SubagentToolCall[],
		subagentConfig: TaskConfig,
		state: TaskState,
	): Promise<DietCodeUserContent[]> {
		const executeCall = async (call: SubagentToolCall) => {
			const toolName = call.name as DietCodeDefaultTool
			const toolCallParams = toToolUseParams(call.input)
			const toolCallBlock: ToolUse = {
				type: "tool_use",
				name: toolName,
				params: toolCallParams,
				partial: false,
				isNativeToolCall: call.isNativeToolCall,
				call_id: call.call_id || call.toolUseId,
			}
			if (call.call_id) {
				state.toolUseIdMap.set(call.call_id, call.toolUseId)
			}

			const latestToolCall = formatToolCallPreview(toolName, toolCallParams)
			this.onProgress?.({ latestToolCall })
			await this.recordTranscript("tool_call", { toolName, preview: latestToolCall, params: toolCallParams }, "raw")
			const handler = this.baseConfig.coordinator.getHandler(toolName)
			const execution = await executionFunnel.execute({
				config: subagentConfig,
				block: toolCallBlock,
				registered: !!handler,
				handler,
				lane: "subagent",
				laneMode: this.laneExecutionMode,
				allowedInLane: this.allowedTools.includes(toolName),
			})
			const toolResult: unknown = execution.result ?? formatResponse.toolError(execution.event.reason)

			return {
				call,
				handler,
				latestToolCall,
				toolCallParams,
				toolResult,
				executed: true,
				executionFunnelEvent: execution.event,
			}
		}
		const executableCount = Math.min(calls.length, Math.max(0, MAX_TOTAL_TOOL_CALLS - this.stats.toolCalls))
		const outcomes: Awaited<ReturnType<typeof executeCall>>[] = []
		for (let offset = 0; offset < executableCount; offset += MAX_PARALLEL_IO_TOOL_CALLS) {
			outcomes.push(...(await Promise.all(calls.slice(offset, offset + MAX_PARALLEL_IO_TOOL_CALLS).map(executeCall))))
		}
		for (const call of calls.slice(executableCount)) {
			const toolName = call.name as DietCodeDefaultTool
			const toolCallParams = toToolUseParams(call.input)
			const toolCallBlock: ToolUse = {
				type: "tool_use",
				name: toolName,
				params: toolCallParams,
				partial: false,
				call_id: call.call_id || call.toolUseId,
			}
			const denied = await executionFunnel.execute({
				config: subagentConfig,
				block: toolCallBlock,
				registered: !!this.baseConfig.coordinator.getHandler(toolName),
				handler: this.baseConfig.coordinator.getHandler(toolName),
				lane: "subagent",
				laneMode: this.laneExecutionMode,
				allowedInLane: false,
				laneDenialReason: `Swarm Tool Call Limit Exceeded (${MAX_TOTAL_TOOL_CALLS}). Tool was not executed.`,
			})
			outcomes.push({
				call,
				handler: this.baseConfig.coordinator.getHandler(toolName),
				latestToolCall: formatToolCallPreview(toolName, toolCallParams),
				toolCallParams,
				toolResult: formatResponse.toolError(denied.event.reason),
				executed: false,
				executionFunnelEvent: denied.event,
			})
		}

		const toolResultBlocks: DietCodeUserContent[] = []
		for (const outcome of outcomes) {
			const { call, handler, latestToolCall, toolCallParams, toolResult, executed } = outcome
			const toolName = call.name as DietCodeDefaultTool
			if (executed) {
				this.stats.toolCalls += 1
				this.onProgress?.({ stats: { ...this.stats } })
			} else {
				await this.recordTranscript("tool_call", { toolName, preview: latestToolCall, params: toolCallParams }, "raw")
			}
			const serializedToolResult = serializeToolResult(toolResult)
			const toolDescription =
				handler?.getDescription({
					type: "tool_use",
					name: toolName,
					params: toolCallParams,
					partial: false,
				}) || `[${toolName}]`
			this.recordToolStepInEnvelope(
				toolName,
				latestToolCall,
				serializedToolResult,
				toolCallParams as Record<string, string>,
				outcome.executionFunnelEvent,
			)
			await this.recordTranscript(
				"tool_response",
				{
					toolName,
					preview: latestToolCall,
					resultExcerpt: serializedToolResult.slice(0, 500),
					executionFunnelEvent: outcome.executionFunnelEvent,
				},
				"raw",
			)
			pushSubagentToolResultBlock(toolResultBlocks, call, toolDescription, serializedToolResult)
			if (executed) {
				this.applyRepetitionDetection(toolName, toolCallParams, toolResultBlocks)
			}
			if (executed && serializedToolResult.length > 0) {
				void this.signalCriticalFindingsToSwarm(serializedToolResult)
			}
		}
		return toolResultBlocks
	}

	private applyRepetitionDetection(
		toolName: DietCodeDefaultTool,
		toolCallParams: ToolUse["params"],
		toolResultBlocks: DietCodeUserContent[],
	): void {
		const currentCallKey = `${toolName}:${JSON.stringify(toolCallParams)}`
		if (this.toolCallHistory.at(-1) === currentCallKey) {
			this.totalConsecutiveIdenticalCalls += 1
		} else {
			this.totalConsecutiveIdenticalCalls = 0
		}
		this.toolCallHistory.push(currentCallKey)
		if (this.toolCallHistory.length > 10) this.toolCallHistory.shift()

		if (this.totalConsecutiveIdenticalCalls < this.MAX_CONSECUTIVE_IDENTICAL_CALLS) return

		toolResultBlocks.push({
			type: "text",
			text: `[SELF-CORRECTION NUDGE] You have called the same tool with the same parameters ${this.MAX_CONSECUTIVE_IDENTICAL_CALLS + 1} times in a row. This suggests you are stuck. Please RE-EVALUATE your approach, explore a different architectural layer, or use 'ask_followup_question' to clarify the objective with the parent.`,
		})
		Logger.warn(`[SubagentRunner] Repetition detected for tool ${toolName}; injected nudge.`)
		void this.signalCriticalFindingsToSwarm(
			`TOXIC HOTSPOT DETECTED: Subagent is stuck in a repetition loop with tool '${toolName}'. Potential architectural conflict or context uncertainty at this depth.`,
		)
		this.totalConsecutiveIdenticalCalls = 0
	}

	private async compactConversationForContextWindow(
		conversation: DietCodeStorageMessage[],
		preTokenEstimate: number,
		reason: string,
	): Promise<boolean> {
		const contextManager = new ContextManager()
		const optimizationResult = this.optimizeConversationForContextWindow(contextManager, conversation)
		if (optimizationResult.didOptimize && !optimizationResult.needToTruncate) {
			return true
		}

		const deletedRange = contextManager.getNextTruncationRange(conversation, undefined, "quarter")
		if (deletedRange[1] < deletedRange[0]) {
			return optimizationResult.didOptimize
		}

		const transcriptSequence = this.transcriptRecorder?.getLastSequence() ?? -1
		const artifactPointer = this.transcriptArtifactPath || `pending:${this.transcriptRecorder?.getEvents().length || 0}`
		const compactionEvent: CompactionEventRecord = {
			id: `compaction_${Date.now()}`,
			timestamp: Date.now(),
			executionId: this.envelopeBuilder?.build().executionId || "unknown",
			agentId: this.envelopeBuilder?.build().agentId || "unknown",
			transcriptSequence,
			reason,
			preTokenEstimate,
			postTokenEstimate: Math.floor(preTokenEstimate * 0.75),
			droppedRange: deletedRange,
			preservedSummaryRef: `compaction_summary_${deletedRange[0]}_${deletedRange[1]}`,
			continuityRiskLevel: deletedRange[1] - deletedRange[0] > 4 ? "high" : "medium",
			artifactPointer,
			contentKind: "summary",
		}

		await this.recordTranscript("compaction", compactionEvent as unknown as Record<string, unknown>, "summary")
		this.envelopeBuilder?.recordCompaction(compactionEvent)

		const truncated = contextManager
			.getTruncatedMessages(conversation, deletedRange)
			.map((message: DietCodeStorageMessage) => message as DietCodeStorageMessage)
		if (truncated.length >= conversation.length) {
			return optimizationResult.didOptimize
		}

		conversation.splice(0, conversation.length, ...truncated)
		return true
	}

	private optimizeConversationForContextWindow(
		contextManager: ContextManager,
		conversation: DietCodeStorageMessage[],
	): {
		didOptimize: boolean
		needToTruncate: boolean
	} {
		const timestamp = Date.now()
		const optimizationResult = contextManager.attemptFileReadOptimizationInMemory(conversation, undefined, timestamp)
		if (!optimizationResult.anyContextUpdates) {
			return { didOptimize: false, needToTruncate: true }
		}

		const optimizedConversation = optimizationResult.optimizedConversationHistory.map(
			(message: unknown) => message as DietCodeStorageMessage,
		)
		conversation.splice(0, conversation.length, ...optimizedConversation)
		return { didOptimize: true, needToTruncate: optimizationResult.needToTruncate }
	}

	private shouldCompactBeforeNextRequest(
		requestTotalTokens: number,
		api: ReturnType<typeof buildApiHandler>,
		_modelId: string,
	): boolean {
		const { contextWindow, maxAllowedSize } = getContextWindowInfo(api)
		const useAutoCondense = this.baseConfig.services.stateManager.getGlobalSettingsKey("useAutoCondense")
		if (useAutoCondense) {
			const autoCondenseThreshold = 0.75
			const roundedThreshold = autoCondenseThreshold ? Math.floor(contextWindow * autoCondenseThreshold) : maxAllowedSize
			const thresholdTokens = Math.min(roundedThreshold, maxAllowedSize)
			return requestTotalTokens >= thresholdTokens
		}

		return requestTotalTokens >= maxAllowedSize
	}

	private async *createMessageWithInitialChunkRetry(
		api: ReturnType<typeof buildApiHandler>,
		systemPrompt: string,
		conversation: DietCodeStorageMessage[],
		nativeTools: DietCodeTool[] | undefined,
		providerId: string,
		modelId: string,
	) {
		for (let attempt = 1; attempt <= MAX_INITIAL_STREAM_ATTEMPTS; attempt += 1) {
			const stream = api.createMessage(systemPrompt, conversation, nativeTools)
			const iterator = stream[Symbol.asyncIterator]()

			try {
				const firstChunk = await iterator.next()
				if (!firstChunk.done) {
					yield firstChunk.value
				}

				yield* iterator
				return
			} catch (error) {
				if (checkContextWindowExceededError(error)) {
					const didCompact = await this.compactConversationForContextWindow(
						conversation,
						this.stats.contextTokens,
						"context_window_exceeded",
					)
					if (!didCompact || this.shouldAbort() || attempt >= MAX_INITIAL_STREAM_ATTEMPTS) {
						throw error
					}
					Logger.warn(
						`[SubagentRunner] Context window exceeded on initial stream attempt ${attempt}; compacted conversation and retrying.`,
					)
					continue
				}

				const shouldRetry =
					!this.shouldAbort() &&
					attempt < MAX_INITIAL_STREAM_ATTEMPTS &&
					this.shouldRetryInitialStreamError(error, providerId, modelId)
				if (!shouldRetry) {
					throw error
				}

				const delayMs = INITIAL_STREAM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
				Logger.warn(`[SubagentRunner] Initial stream failed. Retrying attempt ${attempt + 1}.`, error)
				await delay(delayMs)
			}
		}
	}

	private async finalizeResult(result: Omit<SubagentRunResult, "envelope">): Promise<SubagentRunResult> {
		if (this.transcriptRecorder && this.envelopeBuilder) {
			let transcriptDurable = false
			try {
				await this.transcriptRecorder.flush()
				transcriptDurable = true
			} catch (error) {
				Logger.warn("[SubagentRunner] Failed to flush terminal transcript:", error)
				this.envelopeBuilder.recordWarning("Terminal transcript flush failed; in-memory execution result preserved.")
			}
			const built = this.envelopeBuilder.build()
			if (transcriptDurable && built.transcriptArtifactPath) {
				const meta = this.transcriptRecorder.getMeta(built.transcriptArtifactPath)
				this.envelopeBuilder.setTranscriptMeta(meta.artifactPath, meta.eventCount, meta.byteSize)
			}
			await this.invokeTranscriptFlushCallback()
		}
		const envelope = this.envelopeBuilder?.build()
		return { ...result, envelope }
	}

	private async finalizeAndPublish(result: Omit<SubagentRunResult, "envelope">): Promise<SubagentRunResult> {
		const finalized = await this.finalizeResult(result)
		this.onProgress?.({ ...result, stats: { ...result.stats } })
		return finalized
	}

	private async invokeTranscriptFlushCallback(): Promise<void> {
		try {
			await this.onTranscriptFlush?.()
		} catch (error) {
			Logger.warn("[SubagentRunner] Transcript flush callback failed:", error)
			this.envelopeBuilder?.recordWarning("Transcript flush callback failed; execution result preserved in memory.")
		}
	}

	private recordToolStepInEnvelope(
		toolName: string,
		preview: string,
		result: string,
		params: Record<string, string>,
		executionFunnelEvent: ExecutionFunnelEvent,
	): void {
		this.envelopeBuilder?.recordToolStep(toolName, preview, result, params, executionFunnelEvent)
	}

	private hashString(value: string): string {
		let hash = 2166136261
		for (let i = 0; i < value.length; i++) {
			hash ^= value.charCodeAt(i)
			hash = Math.imul(hash, 16777619)
		}
		return (hash >>> 0).toString(36)
	}

	private async signalCriticalFindingsToSwarm(result: string): Promise<void> {
		const parentStreamId = (this.baseConfig as ConfigWithExtensions).getSessionStreamId?.()
		if (!parentStreamId) {
			return
		}

		const criticalKeywords = [
			"CRITICAL:",
			"JOY-ZONING VIOLATION",
			"ARCHITECTURE VIOLATION",
			"SECURITY RISK",
			"TOXIC HOTSPOT",
			"SIGNAL: ARCHITECTURE_VIOLATION",
			"SIGNAL: SECURITY_RISK",
			"GROUNDED SPECIFICATION REFRESH",
			"CONTEXT UNCERTAINTY",
		]
		const upperResult = result.toUpperCase()
		const findingKey = this.hashString(upperResult).slice(0, 16)

		if (this.signaledFindings.has(findingKey) || this.signalingFindings.has(findingKey)) {
			return // De-duplicate identical findings
		}

		if (criticalKeywords.some((keyword) => upperResult.includes(keyword))) {
			const matchingKeywords = criticalKeywords.filter((keyword) => upperResult.includes(keyword))
			this.activeSignals = Array.from(new Set([...this.activeSignals, ...matchingKeywords]))
			this.onProgress?.({ activeSignals: this.activeSignals })
			this.signalingFindings.add(findingKey)

			try {
				const signalId = `${Date.now()}_${++this.signalSequence}`
				const label =
					upperResult.includes("GROUNDED SPECIFICATION REFRESH") || upperResult.includes("CONTEXT UNCERTAINTY")
						? `swarm_nudge_${signalId}`
						: `swarm_finding_${signalId}`
				await orchestrator.storeMemory(parentStreamId, label, result.slice(0, 1500))
				this.signaledFindings.add(findingKey)
			} catch (e) {
				Logger.warn("[SubagentRunner] Failed to signal swarm finding:", e)
			} finally {
				this.signalingFindings.delete(findingKey)
			}
		}
	}
}
