import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { formatResponse } from "@core/prompts/responses"
import { maybeTransitionToReplanMode } from "@core/task/utils/replanModeTransition"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { telemetryService } from "@services/telemetry"
import { buildGateBlockEventSummary, enrichAuditMetadataWithGateDecision } from "@shared/audit/auditGateCatalog"
import {
	applyWorkspaceAuditPolicy,
	type GatePolicyProvenance,
	resolveCompletionGateContext,
	resolveCompletionGateOptions,
} from "@shared/audit/auditGatePolicyLoader"
import { buildPreCompletionChecklist, evaluateCompletionGate } from "@shared/audit/auditGateReport"
import { getLatestPlanAuditFromMessages } from "@shared/audit/auditMessages"
import { enrichAuditMetadataWithArtifactPaths, persistAuditWorkspaceArtifacts } from "@shared/audit/auditWorkspaceArtifacts"
import {
	buildAuditHookMetadata,
	buildCompletionGateMessage,
	buildDoubleCheckAuditSection,
	runAdvisoryAudit,
	runCompletionAudit,
} from "@shared/audit/completionAudit"
import { parseIntentThresholdOverrides } from "@shared/audit/gatePolicy"
import { detectReplanIntent } from "@shared/detectReplanIntent"
import { COMPLETION_RESULT_CHANGES_FLAG, type DietCodeMessage, type TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { DietCodeDefaultTool } from "@shared/tools"
import { evaluateRoadmapCompletionBlock, failClosedCompletionMessage } from "@/services/roadmap/RoadmapCompletionGate"
import { finalizeRoadmapSession } from "@/services/roadmap/RoadmapLifecycle"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import { showNotificationForApproval } from "../../utils"
import { buildUserFeedbackContent } from "../../utils/buildUserFeedbackContent"
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

async function applyWorkspaceAuditPolicyForTask(config: TaskConfig, metadata: TaskAuditMetadata): Promise<TaskAuditMetadata> {
	return applyWorkspaceAuditPolicy(config.cwd, metadata, config)
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

		config.taskState.consecutiveMistakeCount = 0

		// Roadmap Governance: Kanban Completion Gates
		const roadmapService = RoadmapService.getInstance()
		if (roadmapService.isEnabled()) {
			try {
				const block = await evaluateRoadmapCompletionBlock(config.cwd)
				if (block.blocked) {
					config.taskState.consecutiveMistakeCount++
					return formatResponse.toolError(block.message || failClosedCompletionMessage())
				}
			} catch (error) {
				Logger.error("[AttemptCompletionHandler] Failed to evaluate Roadmap Governance Gates:", error)
				if (roadmapService.getConfig().fail_closed_completion_gates) {
					config.taskState.consecutiveMistakeCount++
					return formatResponse.toolError(failClosedCompletionMessage())
				}
			}
		}

		// Double-check completion: reject attempt_completion calls that haven't been re-verified
		if (config.doubleCheckCompletionEnabled && !config.taskState.doubleCheckCompletionPending) {
			config.taskState.doubleCheckCompletionPending = true
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "completion_result")

			const taskPreview = getInitialTaskPreview(config)
			const taskSection = taskPreview ? `\n\n<initial_task>\n${taskPreview}\n</initial_task>` : ""

			let auditPreviewSection = ""
			try {
				const previewAudit = await runAdvisoryAudit(config.taskId, taskPreview || "", result, taskPreview || "")
				const policyAppliedAudit = await applyWorkspaceAuditPolicyForTask(config, previewAudit)
				config.taskState.lastAdvisoryAudit = policyAppliedAudit
				auditPreviewSection = buildDoubleCheckAuditSection(policyAppliedAudit)
				auditPreviewSection += buildPreCompletionChecklist(
					policyAppliedAudit,
					await buildAuditGateOptions(config, {
						planBaselineMetadata: getLatestPlanAuditFromMessages(config.messageState.getDietCodeMessages()),
					}),
				)
			} catch (error) {
				Logger.warn("[AttemptCompletionHandler] Pre-completion audit preview failed:", error)
			}

			return formatResponse.toolError(
				"Before completing, re-verify your work against the original task requirements. Check that:\n" +
					"1. All requested changes have been made\n" +
					"2. No steps were skipped or partially completed\n" +
					"3. Edge cases and error handling are addressed\n" +
					"4. The solution matches what was asked for, not just what was convenient\n" +
					"5. Output files contain exactly what was specified--no extra columns, fields, debug output, or commentary\n" +
					"6. If the task specifies numerical thresholds or accuracy targets, verify your result meets the criteria. If close but not passing, iterate rather than declaring completion" +
					taskSection +
					auditPreviewSection +
					"\n\nIf everything checks out, call attempt_completion again with your final result.",
			)
		}
		// Reset so the next attempt_completion pair triggers double-check again
		config.taskState.doubleCheckCompletionPending = false

		// V225: Sovereign Forensic Gate (Passive)
		// We perform a non-blocking check for Knowledge Ledger compliance.
		// If non-compliant, we provide a passive advisory to the agent.
		if (config.universalGuard) {
			const compliance = await config.universalGuard.checkForensicCompliance()
			if (!compliance.compliant && compliance.advisory) {
				await config.callbacks.say("info", compliance.advisory)
			}
		}

		// Show notification if enabled
		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		// Show notification if enabled
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

		// Run task audit to capture hardening & safety metrics (before emitting completion_result)
		let auditMetadata: TaskAuditMetadata | undefined
		let planBaseline: TaskAuditMetadata | undefined
		try {
			const taskDescription = getInitialTaskPreview(config) || ""
			planBaseline = getLatestPlanAuditFromMessages(config.messageState.getDietCodeMessages())
			auditMetadata = await runCompletionAudit(config.taskId, taskDescription, result, taskDescription)
			auditMetadata = await applyWorkspaceAuditPolicyForTask(config, auditMetadata)

			const gateContext = await resolveCompletionGateContext(config, config.cwd, {
				planBaselineMetadata: planBaseline,
				lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
			})
			const gateOptions = gateContext.options
			const gateDecision = evaluateCompletionGate(auditMetadata, gateOptions)

			telemetryService.captureAuditGateEvaluation(config.ulid, {
				taskId: config.taskId,
				blocked: gateDecision.blocked,
				score: gateDecision.score,
				effectiveThreshold: gateDecision.effectiveThreshold,
				grade: gateDecision.grade,
				reasonCodes: gateDecision.reasons.map((reason) => reason.code),
				suppressedViolationCount: auditMetadata.suppressed_violations?.length ?? 0,
				workspacePolicyApplied: gateContext.policyProvenance.workspacePolicyApplied,
			})

			if (gateDecision.blocked) {
				config.taskState.consecutiveMistakeCount++
				config.taskState.completionGateBlockCount = (config.taskState.completionGateBlockCount ?? 0) + 1
				let enrichedAudit = enrichAuditMetadataWithGateDecision(
					auditMetadata,
					gateDecision,
					config.taskState.completionGateBlockCount,
				)
				enrichedAudit = await persistAuditArtifactsIfEnabled(
					config,
					enrichedAudit,
					"gate_block",
					gateOptions,
					gateContext.policyProvenance,
				)
				config.taskState.lastCompletionAudit = enrichedAudit

				if (config.autoApprovalSettings.enableNotifications) {
					showSystemNotification({
						subtitle: "Completion Gate Blocked",
						message: `Hardening audit failed (${gateDecision.score}/100, threshold ${gateDecision.effectiveThreshold})`,
					})
				}

				try {
					await config.callbacks.say(
						"info",
						buildGateBlockEventSummary(gateDecision, config.taskState.completionGateBlockCount),
						undefined,
						undefined,
						false,
						enrichedAudit,
					)
				} catch (error) {
					Logger.warn("[AttemptCompletionHandler] Failed to emit gate block audit event:", error)
				}
				return formatResponse.toolError(
					buildCompletionGateMessage(auditMetadata, {
						scoreThreshold: config.auditCompletionGateThreshold,
						criticalOnly: config.auditCompletionGateCriticalOnly,
						intentAdjustedThreshold: config.auditIntentThresholdAdjustmentsEnabled,
						intentThresholdOverrides: parseIntentThresholdOverrides(config.auditIntentThresholdOverrides),
						advisoryMetadata: config.taskState.lastAdvisoryAudit,
						planBaselineMetadata: planBaseline,
						gateDecision,
					}),
				)
			}

			if (auditMetadata) {
				auditMetadata = await persistAuditArtifactsIfEnabled(
					config,
					auditMetadata,
					"completion",
					gateOptions,
					gateContext.policyProvenance,
				)
				config.taskState.lastCompletionAudit = auditMetadata
			}
		} catch (error) {
			Logger.error("[AttemptCompletionHandler] Failed to run task audit:", error)
		}

		let commandResult: ToolResponse | undefined
		const lastMessage = config.messageState.getDietCodeMessages().at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask !== "command") {
				// haven't sent a command message yet so first send completion_result then command
				const completionMessageTs = await config.callbacks.say(
					"completion_result",
					result,
					undefined,
					undefined,
					false,
					auditMetadata,
				)
				await config.callbacks.saveCheckpoint(true, completionMessageTs)
				await addNewChangesFlagToLastCompletionResultMessage()
				telemetryService.captureTaskCompleted(
					config.ulid,
					getTaskCompletionTelemetry(config, auditMetadata, {
						advisoryMetadata: config.taskState.lastAdvisoryAudit,
						planBaseline,
					}),
				)
			} else {
				// we already sent a command message, meaning the complete completion message has also been sent
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
		} else {
			// Send the complete completion_result message (partial was already removed above)
			const completionMessageTs = await config.callbacks.say(
				"completion_result",
				result,
				undefined,
				undefined,
				false,
				auditMetadata,
			)
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
				await finalizeRoadmapSession(config.cwd, config.taskId)
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
