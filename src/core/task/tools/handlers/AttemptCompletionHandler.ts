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
import { buildAuditHookMetadata } from "@shared/audit/completionAudit"
import { detectReplanIntent } from "@shared/detectReplanIntent"
import { COMPLETION_RESULT_CHANGES_FLAG, type DietCodeMessage, type TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { DietCodeDefaultTool } from "@shared/tools"
import { finalizeRoadmapSession } from "@/services/roadmap/RoadmapLifecycle"
import { showNotificationForApproval } from "../../utils"
import { buildUserFeedbackContent } from "../../utils/buildUserFeedbackContent"
import {
	buildCompletionGatePassedEnvelope,
	buildCompletionGateReadinessBlock,
	buildCompletionPreflightReadinessBrief,
	buildProactiveCompletionGuidance,
	getLatestCheckpointHashFromMessages,
	markCompletionAttemptFinished,
	markPreflightReadinessHintEmitted,
	markProactiveCompletionGuidanceEmitted,
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
	hashCompletionAuditInput,
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

		// Delegate fast-path eligibility to the decision engine.
		// No local audit-validity or fast-path bypass logic outside the engine.
		const { evaluateCompletionLifecycle } = await import("../completion/completionSnapshotBuilder")
		const decision = evaluateCompletionLifecycle(config, {
			result,
			taskDescription,
			auditCacheKey: hashCompletionAuditInput(result, taskDescription, checkpointHash),
		})

		// ── Action Guard: enforce the binding action contract ──
		// The decision engine determines truth. The action guard enforces truth.
		// The agent only executes the permitted next action.
		// Rejected actions do NOT increment counters, create audit state, or
		// trigger retry loops.
		const { guardAttemptCompletion } = await import("../completion/CompletionActionGuard")
		const guardResult = guardAttemptCompletion(config, decision)
		if (!guardResult.allowed) {
			return guardResult.rejection
		}

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
					config.callbacks.say("info", compliance.advisory).catch((error) => {
						Logger.warn("[AttemptCompletionHandler] Failed to emit forensic advisory:", error)
					})
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
				try {
					await config.callbacks.say("info", auditGateResult.diagnostics, undefined, undefined, false, auditMetadata)
				} catch (error) {
					Logger.warn("[AttemptCompletionHandler] Failed to emit advisory audit diagnostics:", error)
				}
			}
		} else if (auditGateResult.status === "diagnostic_error") {
			Logger.warn(`[AttemptCompletionHandler] ${auditGateResult.diagnostics}`)
		}

		// The canonical action guard allowed completion; latch verification from
		// that decision, never from advisory quality diagnostics.
		latchEngineeringVerified(config, checkpointHash)
		await publishGateLifecycleStatus(config, evaluateGateLifecycle(config))

		if (auditGateResult.status === "advisory_passed") {
			try {
				await config.callbacks.say("info", buildCompletionGatePassedEnvelope(config, auditGateResult.gateDecision.score))
			} catch (error) {
				Logger.warn("[AttemptCompletionHandler] Failed to emit completion diagnostics:", error)
			}
		}

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

			telemetryService.captureTaskCompleted(
				config.ulid,
				getTaskCompletionTelemetry(config, auditMetadata, {
					advisoryMetadata: config.taskState.lastAdvisoryAudit,
					planBaseline,
				}),
			)
			try {
				flushTaskGeneration(getJoyRideCache(), config.taskId, "task_completed")
				await finalizeRoadmapSession(config.cwd, config.taskId)
			} catch (error) {
				Logger.warn("[AttemptCompletionHandler] Roadmap session finalize skipped:", error)
			}
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
				flushTaskGeneration(getJoyRideCache(), config.taskId, "task_completed")
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
