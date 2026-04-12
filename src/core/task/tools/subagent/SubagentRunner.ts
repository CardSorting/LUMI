import * as path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { ApiHandler, buildApiHandler } from "@core/api"
import { parseAssistantMessageV2, ToolUse } from "@core/assistant-message"
import { discoverSkills, getAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import { formatResponse } from "@core/prompts/responses"
import { PromptRegistry } from "@core/prompts/system-prompt"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { StreamResponseHandler } from "@core/task/StreamResponseHandler"
import { ModelInfo } from "@shared/api"
import {
	CodemarieAssistantToolUseBlock,
	CodemarieStorageMessage,
	CodemarieTextContentBlock,
	CodemarieUserContent,
} from "@shared/messages"
import { Logger } from "@shared/services/Logger"
import { CodemarieDefaultTool, CodemarieTool } from "@shared/tools"
import { ContextManager } from "@/core/context/context-management/ContextManager"
import { checkContextWindowExceededError } from "@/core/context/context-management/context-error-handling"
import { getContextWindowInfo } from "@/core/context/context-management/context-window-utils"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { HostRegistryInfo } from "@/registry"
import { CodemarieError, CodemarieErrorType } from "@/services/error"
import { ApiFormat } from "@/shared/proto/codemarie/models"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "@/utils/cost"
import { isNextGenModelFamily } from "@/utils/model-utils"
import { UniversalGuard } from "../../../policy/UniversalGuard"
import { TaskState } from "../../TaskState"
import { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import { SubagentBuilder } from "./SubagentBuilder"
import { SwarmConsensusHandler } from "./SwarmConsensusHandler"

const MAX_EMPTY_ASSISTANT_RETRIES = 3
const MAX_INITIAL_STREAM_ATTEMPTS = 3
const INITIAL_STREAM_RETRY_BASE_DELAY_MS = 250

export type SubagentRunStatus = "completed" | "failed"

export interface SubagentRunResult {
	status: SubagentRunStatus
	result?: string
	error?: string
	stats: SubagentRunStats
}

interface ConfigWithExtensions extends TaskConfig {
	getSessionStreamId?: () => string
	guard?: UniversalGuard
}

interface SubagentProgressUpdate {
	stats?: SubagentRunStats
	latestToolCall?: string
	status?: "running" | "completed" | "failed"
	result?: string
	error?: string
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

function toAssistantToolUseBlock(call: SubagentToolCall): CodemarieAssistantToolUseBlock {
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
	toolResultBlocks: CodemarieUserContent[],
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
	private readonly allowedTools: CodemarieDefaultTool[]
	private activeApiAbort: (() => void) | undefined
	private abortRequested = false
	private recursionDepth = 0
	private activeCommandExecutions = 0
	private toolCallHistory: string[] = []
	private totalConsecutiveIdenticalCalls = 0
	private readonly MAX_CONSECUTIVE_IDENTICAL_CALLS = 3
	private signaledFindings = new Set<string>()
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
	private abortingCommands = false

	constructor(
		private baseConfig: TaskConfig,
		private agent: SubagentBuilder,
	) {
		this.apiHandler = this.agent.getApiHandler()
		this.allowedTools = this.agent.getAllowedTools()
	}

	setRecursionDepth(depth: number): void {
		this.recursionDepth = depth
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
				await this.baseConfig.callbacks.cancelRunningCommandTool()
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

	async run(prompt: string, onProgress: (update: SubagentProgressUpdate) => void): Promise<SubagentRunResult> {
		this.abortRequested = false
		const state = new TaskState()
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

		onProgress({ status: "running", stats })

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
			const discoveredSkills = await discoverSkills(this.baseConfig.cwd)
			const availableSkills = getAvailableSkills(discoveredSkills)
			const configuredSkillNames = this.agent.getConfiguredSkills()
			const skills =
				configuredSkillNames !== undefined
					? configuredSkillNames
							.map((skillName) => {
								const skill = availableSkills.find((candidate) => candidate.name === skillName)
								if (!skill) {
									Logger.warn(`[SubagentRunner] Configured skill '${skillName}' not found for subagent run.`)
								}
								return skill
							})
							.filter((skill): skill is (typeof availableSkills)[number] => Boolean(skill))
					: availableSkills

			const context: SystemPromptContext = {
				providerInfo,
				cwd: this.baseConfig.cwd,
				ide: host?.platform || "Unknown",
				skills,
				focusChainSettings: this.baseConfig.focusChainSettings,
				browserSettings: this.baseConfig.browserSettings,
				yoloModeToggled: false,
				enableNativeToolCalls: nativeToolCallsRequested,
				enableParallelToolCalling: false,
				isSubagentRun: true,
				mode: mode as "plan" | "act", // Subagents inherit the parent's mode context
				parentMode: mode as "plan" | "act",
			}

			const promptRegistry = PromptRegistry.getInstance()
			const generatedSystemPrompt = await promptRegistry.get(context)

			// Fluid Orchestration: Inject parent stream context for subagent awareness
			const parentStreamId = (this.baseConfig as ConfigWithExtensions).getSessionStreamId?.()
			if (parentStreamId) {
				try {
					const compressed = await orchestrator.getCompressedContext(parentStreamId)
					this.agent.setParentStreamContext(compressed)
				} catch (err) {
					Logger.error("[SubagentRunner] Failed to fetch parent context:", err)
				}
			}

			const systemPrompt = this.agent.buildSystemPrompt(generatedSystemPrompt)
			const useNativeToolCalls = !!promptRegistry.nativeTools?.length
			const nativeTools = useNativeToolCalls ? this.agent.buildNativeTools(context) : undefined
			const workspaceMetadataEnvironmentBlock = await this.getWorkspaceMetadataEnvironmentBlock()

			if (useNativeToolCalls && (!nativeTools || nativeTools.length === 0)) {
				const error = "Subagent tool requires native tool calling support."
				onProgress({ status: "failed", error, stats })
				return { status: "failed", error, stats }
			}

			if (this.shouldAbort()) {
				await this.abort()
				const error = "Subagent run cancelled."
				onProgress({ status: "failed", error, stats: { ...stats } })
				return { status: "failed", error, stats }
			}

			const conversation: CodemarieStorageMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: prompt,
						} as CodemarieTextContentBlock,
						// Server-side task loop checks require workspace metadata to be present in the
						// initial user message of subagent runs.
						...(workspaceMetadataEnvironmentBlock
							? [
									{
										type: "text",
										text: workspaceMetadataEnvironmentBlock,
									} as CodemarieTextContentBlock,
								]
							: []),
					],
				},
			]

			while (true) {
				if (
					usageState.lastRequest &&
					this.shouldCompactBeforeNextRequest(usageState.lastRequest.totalTokens, api, providerInfo.model.id)
				) {
					const didCompact = this.compactConversationForContextWindow(conversation)
					if (didCompact) {
						Logger.warn("[SubagentRunner] Proactively compacted context before next subagent request.")
					}
					// Prevent repeated compaction attempts off the same token sample.
					usageState.lastRequest = undefined
				}

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
								onProgress({ status: "failed", error, stats: { ...stats } })
								return { status: "failed", error, stats }
							}
							if (stats.maxCost && stats.totalCost > stats.maxCost) {
								const error = `Swarm Cost Budget Exceeded ($${stats.maxCost}). Terminating subagent to prevent runaway costs.`
								Logger.warn(`[SubagentRunner] ${error}`)
								onProgress({ status: "failed", error, stats: { ...stats } })
								return { status: "failed", error, stats }
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
						onProgress({ status: "failed", error, stats: { ...stats } })
						return { status: "failed", error, stats }
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
				const assistantContent: (CodemarieTextContentBlock | CodemarieAssistantToolUseBlock)[] = []
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
				}

				if (finalizedToolCalls.length === 0) {
					emptyAssistantResponseRetries += 1
					if (emptyAssistantResponseRetries > MAX_EMPTY_ASSISTANT_RETRIES) {
						const error = "Subagent did not call attempt_completion."
						onProgress({ status: "failed", error, stats: { ...stats } })
						return { status: "failed", error, stats }
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

				const toolResultBlocks = [] as CodemarieUserContent[]
				for (const call of finalizedToolCalls) {
					const toolName = call.name as CodemarieDefaultTool
					const toolCallParams = toToolUseParams(call.input)

					if (toolName === CodemarieDefaultTool.ATTEMPT) {
						if (toolCallParams?.result) {
							await this.signalCriticalFindingsToSwarm(toolCallParams.result)
						}
						const completionResult = toolCallParams.result?.trim()
						if (!completionResult) {
							const missingResultError = formatResponse.missingToolParameterError("result")
							pushSubagentToolResultBlock(toolResultBlocks, call, toolName, missingResultError)
							continue
						}

						stats.toolCalls += 1
						onProgress({ stats: { ...stats } })
						onProgress({ status: "completed", result: completionResult, stats: { ...stats } })
						await this.signalCriticalFindingsToSwarm(completionResult)
						await SwarmConsensusHandler.handleSignal(this.baseConfig, completionResult)
						return { status: "completed", result: completionResult, stats }
					}

					if (!this.allowedTools.includes(toolName)) {
						const deniedResult = formatResponse.toolError(`Tool '${toolName}' is not available inside subagent runs.`)
						pushSubagentToolResultBlock(toolResultBlocks, call, toolName, deniedResult)
						continue
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

					const subagentConfig = this.createSubagentTaskConfig()
					const handler = this.baseConfig.coordinator.getHandler(toolName)
					let toolResult: unknown

					if (!handler) {
						toolResult = formatResponse.toolError(`No handler registered for tool '${toolName}'.`)
					} else {
						try {
							toolResult = await handler.execute(subagentConfig, toolCallBlock)
						} catch (error) {
							toolResult = formatResponse.toolError((error as Error).message)
						}
					}

					stats.toolCalls += 1
					onProgress({ stats: { ...stats } })

					const serializedToolResult = serializeToolResult(toolResult)
					const toolDescription = handler?.getDescription(toolCallBlock) || `[${toolName}]`
					pushSubagentToolResultBlock(toolResultBlocks, call, toolDescription, serializedToolResult)

					// Phase 5: Cross-Swarm Memory Signalling
					// If the tool execution revealed something architecturally significant, signal it via orchestrator
					if (serializedToolResult.length > 0) {
						await this.signalCriticalFindingsToSwarm(serializedToolResult)
					}

					// Phase 6: Repetition Detection & Self-Correction
					const currentCallKey = `${toolName}:${JSON.stringify(toolCallParams)}`
					if (
						this.toolCallHistory.length > 0 &&
						this.toolCallHistory[this.toolCallHistory.length - 1] === currentCallKey
					) {
						this.totalConsecutiveIdenticalCalls += 1
					} else {
						this.totalConsecutiveIdenticalCalls = 0
					}
					this.toolCallHistory.push(currentCallKey)
					if (this.toolCallHistory.length > 10) this.toolCallHistory.shift()

					if (this.totalConsecutiveIdenticalCalls >= this.MAX_CONSECUTIVE_IDENTICAL_CALLS) {
						const nudge = `[SELF-CORRECTION NUDGE] You have called the same tool with the same parameters ${this.MAX_CONSECUTIVE_IDENTICAL_CALLS + 1} times in a row. This suggests you are stuck. Please RE-EVALUATE your approach, explore a different architectural layer, or use 'ask_followup_question' to clarify the objective with the parent.`
						toolResultBlocks.push({
							type: "text",
							text: nudge,
						})
						Logger.warn(`[SubagentRunner] Repetition detected for tool ${toolName}; injected nudge.`)

						// Phase 4: Autonomous Toxic Hotspot Signaling
						this.signalCriticalFindingsToSwarm(
							`TOXIC HOTSPOT DETECTED: Subagent is stuck in a repetition loop with tool '${toolName}'. Potential architectural conflict or context uncertainty at this depth.`,
						).catch((e) => Logger.warn("[SubagentRunner] Failed to signal toxic hotspot:", e))

						this.totalConsecutiveIdenticalCalls = 0 // Reset after nudge
					}
				}

				conversation.push({
					role: "user",
					content: toolResultBlocks,
				})

				await delay(0)
			}
		} catch (error) {
			if (this.shouldAbort()) {
				const cancelledError = "Subagent run cancelled."
				onProgress({ status: "failed", error: cancelledError, stats: { ...stats } })
				return { status: "failed", error: cancelledError, stats }
			}

			const errorText = (error as Error).message || "Subagent execution failed."
			Logger.error("[SubagentRunner] run failed", error)
			onProgress({ status: "failed", error: errorText, stats: { ...stats } })
			return { status: "failed", error: errorText, stats }
		} finally {
			this.activeApiAbort = undefined
		}
	}

	private createSubagentTaskConfig(): TaskConfig {
		const baseCallbacks = this.baseConfig.callbacks
		const { ToolExecutorCoordinator } = require("../ToolExecutorCoordinator")
		const coordinator = new ToolExecutorCoordinator()
		const validator = new ToolValidator(
			this.baseConfig.services.codemarieIgnoreController,
			// biome-ignore lint/style/noNonNullAssertion: Guard is guaranteed to exist by SubagentToolHandler validation.
			(this.baseConfig as ConfigWithExtensions).guard!,
		) // Add guard from config

		for (const tool of this.allowedTools) {
			coordinator.registerByName(tool, validator)
		}

		const subagentTaskState = new TaskState()
		subagentTaskState.recursionDepth = this.recursionDepth

		return {
			...this.baseConfig,
			api: this.apiHandler,
			coordinator,
			taskState: subagentTaskState,
			messageState: this.baseConfig.messageState, // Use parent's message state handler but they will have their own stream
			recursionDepth: this.recursionDepth,
			isSubagentExecution: true,
			vscodeTerminalExecutionMode: "backgroundExec",
			callbacks: {
				...baseCallbacks,
				say: async () => undefined,
				sayAndCreateMissingParamError: async (_toolName, paramName) =>
					formatResponse.toolError(formatResponse.missingToolParameterError(paramName)),
				executeCommandTool: async (command: string, timeoutSeconds: number | undefined) => {
					this.activeCommandExecutions += 1
					try {
						return await baseCallbacks.executeCommandTool(command, timeoutSeconds, {
							useBackgroundExecution: true,
							suppressUserInteraction: true,
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
		const parsedError = CodemarieError.transform(error, modelId, providerId)
		const isAuthError = parsedError.isErrorType(CodemarieErrorType.Auth)
		const isBalanceError = parsedError.isErrorType(CodemarieErrorType.Balance)

		if (isAuthError || isBalanceError) {
			return false
		}

		return true
	}

	private compactConversationForContextWindow(conversation: CodemarieStorageMessage[]): boolean {
		const contextManager = new ContextManager()
		const optimizationResult = this.optimizeConversationForContextWindow(contextManager, conversation)
		if (optimizationResult.didOptimize && !optimizationResult.needToTruncate) {
			return true
		}

		const deletedRange = contextManager.getNextTruncationRange(conversation, undefined, "quarter")
		if (deletedRange[1] < deletedRange[0]) {
			return optimizationResult.didOptimize
		}

		const truncated = contextManager
			.getTruncatedMessages(conversation, deletedRange)
			.map((message) => message as CodemarieStorageMessage)
		if (truncated.length >= conversation.length) {
			return optimizationResult.didOptimize
		}

		conversation.splice(0, conversation.length, ...truncated)
		return true
	}

	private optimizeConversationForContextWindow(
		contextManager: ContextManager,
		conversation: CodemarieStorageMessage[],
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
			(message) => message as CodemarieStorageMessage,
		)
		conversation.splice(0, conversation.length, ...optimizedConversation)
		return { didOptimize: true, needToTruncate: optimizationResult.needToTruncate }
	}

	private shouldCompactBeforeNextRequest(
		requestTotalTokens: number,
		api: ReturnType<typeof buildApiHandler>,
		modelId: string,
	): boolean {
		const { contextWindow, maxAllowedSize } = getContextWindowInfo(api)
		const useAutoCondense = this.baseConfig.services.stateManager.getGlobalSettingsKey("useAutoCondense")
		if (useAutoCondense && isNextGenModelFamily(modelId)) {
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
		conversation: CodemarieStorageMessage[],
		nativeTools: CodemarieTool[] | undefined,
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
					const didCompact = this.compactConversationForContextWindow(conversation)
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

		if (this.signaledFindings.has(findingKey)) {
			return // De-duplicate identical findings
		}

		if (criticalKeywords.some((keyword) => upperResult.includes(keyword))) {
			try {
				const label =
					upperResult.includes("GROUNDED SPECIFICATION REFRESH") || upperResult.includes("CONTEXT UNCERTAINTY")
						? `swarm_nudge_${Date.now()}`
						: `swarm_finding_${Date.now()}`
				await orchestrator.storeMemory(parentStreamId, label, result.slice(0, 1500))
				this.signaledFindings.add(findingKey)
			} catch (e) {
				Logger.warn("[SubagentRunner] Failed to signal swarm finding:", e)
			}
		}
	}
}
