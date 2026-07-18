import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { flushTaskGeneration, getJoyRideCache } from "@core/joyride"
import { formatResponse } from "@core/prompts/responses"
import { maybeTransitionToReplanMode } from "@core/task/utils/replanModeTransition"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { telemetryService } from "@services/telemetry"
import { findLastIndex } from "@shared/array"
import { type GatePolicyProvenance, resolveCompletionGateOptions } from "@shared/audit/auditGatePolicyLoader"
import { resolvePlanBaselineMetadata } from "@shared/audit/auditMessages"
import { buildPreCompletionChecklistBlock, buildPreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { enrichAuditMetadataWithArtifactPaths, persistAuditWorkspaceArtifacts } from "@shared/audit/auditWorkspaceArtifacts"
import { buildAuditHookMetadata, scheduleCompletionAuditPersistence } from "@shared/audit/completionAudit"
import { detectReplanIntent } from "@shared/detectReplanIntent"
import { COMPLETION_RESULT_CHANGES_FLAG, type DietCodeMessage, type TaskAuditMetadata } from "@shared/ExtensionMessage"
import { CoordinationError, CoordinationErrorCode } from "@shared/governance/CoordinationErrors"
import { Logger } from "@shared/services/Logger"
import { DietCodeDefaultTool } from "@shared/tools"
import {
	createTaskGenerationId,
	createTaskLifecycleIntentId,
	getTaskLifecycleAuthority,
} from "@/core/task/lifecycle/TaskLifecycleFunnel"
import { finalizeRoadmapSession } from "@/services/roadmap/RoadmapLifecycle"
import { buildUserFeedbackContent } from "../../utils/buildUserFeedbackContent"
import {
	buildCompletionGateReadinessBlock,
	buildCompletionPreflightReadinessBrief,
	buildProactiveCompletionGuidance,
	markCompletionAttemptFinished,
	markPreflightReadinessHintEmitted,
	markProactiveCompletionGuidanceEmitted,
	shouldEmitPreflightReadinessHint,
	shouldEmitProactiveCompletionGuidance,
	shouldRejectDoubleCheckCompletion,
	validateCompletionResultQuality,
} from "../attemptCompletionUtils"
import { runCompletionFunnelAttempt } from "../completion/CompletionFunnel"
import {
	type CompletionAuditGateResult,
	evaluateCompletionAuditGate,
	evaluateGatePreflightReadinessAsync,
	runCompletionPreflightChecks,
} from "../completionGatePipeline"
import { executionFunnel } from "../execution/ExecutionFunnel"
import type { TaskConfig } from "../types/TaskConfig"
import { declareApprovalIntent, type IPartialBlockHandler, type IToolHandler, type ToolResponse } from "../types/ToolContracts"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { getTaskCompletionTelemetry } from "../utils"
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

function scheduleRoadmapFinalization(config: TaskConfig): void {
	const scope = "roadmap-finalization"
	config.latencyTracker?.mark("persistence_scheduled", { scope })
	void finalizeRoadmapSession(config.cwd, config.taskId)
		.then(() => config.latencyTracker?.mark("persistence_completed", { scope }))
		.catch((error) => {
			config.latencyTracker?.mark("persistence_failed", { scope })
			Logger.warn("[AttemptCompletionHandler] Deferred roadmap finalization skipped:", error)
		})
}

function schedulePendingCompletionAuditPersistence(config: TaskConfig): void {
	const pending = config.taskState.pendingCompletionAuditPersistence
	if (!pending) return
	config.taskState.pendingCompletionAuditPersistence = undefined
	scheduleCompletionAuditPersistence(config.taskId, pending, config.latencyTracker)
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

		const taskDescription = getInitialTaskPreview(config) || ""
		const successResponse = [{ type: "text" as const, text: "[attempt_completion] Result: Done" }]
		let funnelResult: Awaited<ReturnType<typeof runCompletionFunnelAttempt>>
		try {
			funnelResult = await runCompletionFunnelAttempt(config, { result, taskDescription })
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
		const completionDecision = funnelResult.decision
		Logger.info(
			`[AttemptCompletionHandler] Completion funnel decision: status=${completionDecision.status}, code=${completionDecision.code}`,
		)

		if (funnelResult.kind === "blocked") {
			config.latencyTracker?.mark("authoritative_completion_decided", {
				invocationId: block.call_id,
				toolName: block.name,
				scope: "rejected",
			})

			// Increment quality counters instead of model mistake counter
			if (completionDecision.status === "blocked_recoverable") {
				if (completionDecision.code === "ROADMAP_REMEDIATION_REQUIRED" || completionDecision.code === "AUDIT_REQUIRED") {
					config.taskState.executionQualityCounters.recoverableCompletionBlocks++
				} else {
					config.taskState.executionQualityCounters.prematureCompletionAttempts++
				}
			} else if (completionDecision.status === "blocked_hard") {
				config.taskState.executionQualityCounters.prematureCompletionAttempts++
			}

			const structuredError = JSON.stringify(completionDecision, null, 2)
			config.taskState.lastCompletionDecisionId = completionDecision.decisionId
			config.taskState.lastCompletionDecisionResult = JSON.stringify(formatResponse.toolError(structuredError))
			return formatResponse.toolError(structuredError)
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
					Logger.debug(`[AttemptCompletionHandler] Forensic advisory:\n${compliance.advisory}`)
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
				Logger.debug(`[AttemptCompletionHandler] Advisory audit diagnostics:\n${auditGateResult.diagnostics}`)
			}
		} else if (auditGateResult.status === "diagnostic_error") {
			Logger.warn(`[AttemptCompletionHandler] ${auditGateResult.diagnostics}`)
		}

		config.latencyTracker?.mark("authoritative_completion_decided", {
			invocationId: block.call_id,
			toolName: block.name,
			scope: "authoritative-result",
		})
		if (auditGateResult.status === "advisory_passed") {
			Logger.debug(
				`[AttemptCompletionHandler] Completion diagnostics passed with score ${auditGateResult.gateDecision.score}.`,
			)
		}

		// Cache terminal success response for idempotency
		config.taskState.lastCompletionDecisionId = completionDecision.decisionId
		config.taskState.lastCompletionDecisionResult = JSON.stringify(successResponse)

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
				config.latencyTracker?.mark("result_presentation_started", { scope: "authoritative-result" })
				const completionMessageTs = await config.callbacks.say(
					"completion_result",
					result,
					undefined,
					undefined,
					false,
					auditMetadata,
				)
				config.latencyTracker?.mark("result_presentation_completed", { scope: "authoritative-result" })
				schedulePendingCompletionAuditPersistence(config)
				await config.callbacks.saveCheckpoint(true, completionMessageTs)
				await addNewChangesFlagToLastCompletionResultMessage()
			} else {
				// we already sent a command message, meaning the complete completion message has also been sent
				schedulePendingCompletionAuditPersistence(config)
				await config.callbacks.saveCheckpoint(true)
			}

			// Attempt completion is a special tool where we want to update the focus chain list before the user provides response
			if (!block.partial && config.focusChainSettings.enabled) {
				await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
			}

			// Execute the command
			const [userRejected, execCommandResult] = await executionFunnel.executeReliableAction(
				config.taskId,
				config.taskState.executionGeneration,
				() => config.callbacks.executeCommandTool(command, undefined),
				{ concurrencyGroup: "shell", timeoutMs: 0, maxRetries: 1 },
			)

			if (userRejected) {
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
				scheduleRoadmapFinalization(config)
			} catch (error) {
				Logger.warn("[AttemptCompletionHandler] Roadmap session finalize skipped:", error)
			}
		} else {
			// Send the complete completion_result message (partial was already removed above)
			config.latencyTracker?.mark("result_presentation_started", { scope: "authoritative-result" })
			const completionMessageTs = await config.callbacks.say(
				"completion_result",
				result,
				undefined,
				undefined,
				false,
				auditMetadata,
			)
			config.latencyTracker?.mark("result_presentation_completed", { scope: "authoritative-result" })
			schedulePendingCompletionAuditPersistence(config)
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
				scheduleRoadmapFinalization(config)
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

		// The user rejected completion and provided feedback.
		// Reactivate the task lifecycle so the agent can execute tools to resolve the feedback.
		try {
			const authority = getTaskLifecycleAuthority(config.taskState)
			const currentLifecycle =
				authority.readProjection(config.taskState) ?? (await authority.restore(config.taskState, config.taskId))
			if (currentLifecycle && currentLifecycle.state === "terminal") {
				await authority.submit(config.taskState, {
					type: "ResumeWithGeneration",
					intentId: createTaskLifecycleIntentId(),
					taskId: config.taskId,
					generationId: currentLifecycle.generationId,
					newGenerationId: createTaskGenerationId(),
					cause: {
						source: "task",
						reason: "The user rejected the completion attempt and provided feedback.",
					},
				})
				Logger.info(`[AttemptCompletionHandler] Reactivated task ${config.taskId} for feedback resolution.`)
			}
		} catch (error) {
			Logger.error("[AttemptCompletionHandler] Failed to reactivate task lifecycle:", error)
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
