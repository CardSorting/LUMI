import { randomUUID } from "node:crypto"
import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { formatResponse } from "@core/prompts/responses"
import { maybeTransitionToReplanMode } from "@core/task/utils/replanModeTransition"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { telemetryService } from "@services/telemetry"
import { type GatePolicyProvenance, resolveCompletionGateOptions } from "@shared/audit/auditGatePolicyLoader"
import { resolvePlanBaselineMetadata } from "@shared/audit/auditMessages"
import { enrichAuditMetadataWithArtifactPaths, persistAuditWorkspaceArtifacts } from "@shared/audit/auditWorkspaceArtifacts"
import { buildAuditHookMetadata } from "@shared/audit/completionAudit"
import { detectReplanIntent } from "@shared/detectReplanIntent"
import { type TaskAuditMetadata } from "@shared/ExtensionMessage"
import { CoordinationError, CoordinationErrorCode } from "@shared/governance/CoordinationErrors"
import { Logger } from "@shared/services/Logger"
import { DietCodeDefaultTool } from "@shared/tools"
import { buildUserFeedbackContent } from "../../utils/buildUserFeedbackContent"
import { markCompletionAttemptFinished } from "../attemptCompletionUtils"
import { runCompletionFunnelAttempt } from "../completion/CompletionFunnel"
import { type CompletionAuditGateResult, evaluateCompletionAuditGate } from "../completionGatePipeline"
import type { TaskConfig } from "../types/TaskConfig"
import { declareApprovalIntent, type IPartialBlockHandler, type IToolHandler, type ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
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

export class AttemptCompletionHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = DietCodeDefaultTool.ATTEMPT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	getApprovalIntent(block: ToolUse) {
		const command = block.params.command
		return declareApprovalIntent(block, {
			description: command ? `Complete the task and execute: ${command}` : "Submit a task completion attempt",
			requirements: command
				? [
						{
							capability: "command",
							risk: "elevated",
							requestedSideEffects: ["execute completion command"],
							autoApprovalEligible: true,
						},
					]
				: [],
			promptType: command ? "command" : "tool",
			promptMessage: command ?? JSON.stringify({ tool: block.name }),
			notification: command ? `DietCode wants to execute a completion command: ${command}` : undefined,
		})
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

		// Run completion command if provided under normal permit governance
		let commandResult: ToolResponse | undefined
		if (command) {
			const commandHandler = config.coordinator.getHandler(DietCodeDefaultTool.BASH)
			if (!commandHandler) {
				throw new Error("Command execution handler is not registered.")
			}
			const delegatedBlock: ToolUse = {
				type: "tool_use",
				name: DietCodeDefaultTool.BASH,
				call_id: `delegated:${randomUUID()}`,
				params: {
					command,
					requires_approval: "true",
				},
				partial: false,
			}
			const executionFunnel = (await import("@core/task/tools/execution/ExecutionFunnel")).executionFunnel
			commandResult = await executionFunnel.dispatchAuthorizedDelegatedOperation(
				config,
				block,
				delegatedBlock,
				commandHandler,
			)

			const isAuthoritativeToolFailure = (await import("@core/task/tools/execution/ExecutionFunnel"))
				.isAuthoritativeToolFailure
			const isUserDeniedResponse = (res: ToolResponse): boolean => {
				if (typeof res === "string") {
					return res.includes("The user denied this operation")
				}
				if (Array.isArray(res)) {
					return res.some((blk) => blk.type === "text" && blk.text.includes("The user denied this operation"))
				}
				return false
			}

			if (isAuthoritativeToolFailure(commandResult) || isUserDeniedResponse(commandResult)) {
				return commandResult
			}
		}

		const taskDescription = getInitialTaskPreview(config) || ""
		let auditMetadata: TaskAuditMetadata | undefined
		let _planBaseline: TaskAuditMetadata | undefined
		let auditGateResult: CompletionAuditGateResult | undefined

		// Capture hardening and safety evidence without affecting execution.
		auditGateResult = await evaluateCompletionAuditGate(config, {
			result,
			taskDescription,
			logPrefix: "AttemptCompletionHandler",
		})

		if (auditGateResult.status === "advisory_passed" || auditGateResult.status === "advisory_failed") {
			auditMetadata = auditGateResult.auditMetadata
			_planBaseline =
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
		}

		let funnelResult: Awaited<ReturnType<typeof runCompletionFunnelAttempt>>
		try {
			funnelResult = await runCompletionFunnelAttempt(
				config,
				{
					result,
					taskDescription,
					command,
					commandResult,
				},
				{ auditMetadata },
			)
		} catch (error) {
			const coordination =
				error instanceof CoordinationError
					? error
					: new CoordinationError(
							CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE,
							"Central completion funnel failed.",
							"retry",
							undefined,
							error,
						)
			return formatResponse.toolError(
				JSON.stringify({ code: coordination.code, retryClass: coordination.retryClass, message: coordination.message }),
			)
		}

		const prefix = "[attempt_completion] Result: Done"
		switch (funnelResult.kind) {
			case "blocked": {
				const structuredError = JSON.stringify(funnelResult.decision, null, 2)
				config.taskState.lastCompletionDecisionId = funnelResult.decision.decisionId
				config.taskState.lastCompletionDecisionResult = JSON.stringify(formatResponse.toolError(structuredError))
				return formatResponse.toolError(structuredError)
			}
			case "settlement_failed": {
				const structuredError = JSON.stringify(funnelResult.decision, null, 2)
				return formatResponse.toolError(structuredError)
			}
			case "rejected": {
				await config.callbacks.say("user_feedback", funnelResult.feedback, funnelResult.images, funnelResult.files)

				await maybeTransitionToReplanMode({
					feedback: funnelResult.feedback,
					currentMode: config.mode,
					yoloModeToggled: config.yoloModeToggled,
					switchToPlanMode: config.callbacks.switchToPlanMode,
					sayInfo: async (message) => {
						await config.callbacks.say("info", message)
					},
				})

				// Run UserPromptSubmit hook when user provides post-completion feedback
				let hookContextModification: string | undefined
				if (
					funnelResult.feedback ||
					(funnelResult.images && funnelResult.images.length > 0) ||
					(funnelResult.files && funnelResult.files.length > 0)
				) {
					const userContentForHook = await buildUserFeedbackContent(
						funnelResult.feedback,
						funnelResult.images,
						funnelResult.files,
					)

					const hookResult = await config.callbacks.runUserPromptSubmitHook(userContentForHook, "feedback")

					if (hookResult.cancel === true) {
						return formatResponse.toolDenied()
					}

					// Capture hook context modification to add to tool results
					hookContextModification = hookResult.contextModification
				}

				const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
				const replanRequested = detectReplanIntent(funnelResult.feedback)
				toolResults.push(
					{
						type: "text",
						text: replanRequested
							? "The user has provided feedback requesting a scope pivot. Return to PLAN MODE workflow — explore the updated requirements and present a revised plan via plan_mode_respond before implementing."
							: "The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.",
					},
					{
						type: "text",
						text: `<feedback>\n${funnelResult.feedback}\n</feedback>`,
					},
				)

				// Add hook context modification if provided
				if (hookContextModification) {
					toolResults.push({
						type: "text" as const,
						text: `<hook_context source="UserPromptSubmit">\n${hookContextModification}\n</hook_context>`,
					})
				}

				const fileContentString = funnelResult.files?.length ? await processFilesIntoText(funnelResult.files) : ""
				if (fileContentString) {
					toolResults.push({
						type: "text" as const,
						text: fileContentString,
					})
				}

				if (funnelResult.images && funnelResult.images.length > 0) {
					toolResults.push(...formatResponse.imageBlocks(funnelResult.images))
				}

				return [
					{
						type: "text" as const,
						text: prefix,
					},
					...toolResults,
				]
			}
			case "terminal": {
				config.taskState.lastCompletionDecisionId = funnelResult.decision.decisionId
				config.taskState.lastCompletionDecisionResult = JSON.stringify([{ type: "text" as const, text: prefix }])

				markCompletionAttemptFinished(config)
				await this.runTaskCompleteHook(config, block)

				const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
				if (funnelResult.commandResult) {
					if (typeof funnelResult.commandResult === "string") {
						toolResults.push({
							type: "text",
							text: funnelResult.commandResult,
						})
					} else if (Array.isArray(funnelResult.commandResult)) {
						toolResults.push(...funnelResult.commandResult)
					}
				}

				return toolResults.length > 0 ? toolResults : prefix
			}
		}
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
