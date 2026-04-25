import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { telemetryService } from "@services/telemetry"
import { findLastIndex } from "@shared/array"
import { COMPLETION_RESULT_CHANGES_FLAG } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { DietCodeDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import { buildUserFeedbackContent } from "../../utils/buildUserFeedbackContent"
import { SubagentBuilder } from "../subagent/SubagentBuilder"
import { SubagentRunner } from "../subagent/SubagentRunner"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { getTaskCompletionTelemetry } from "../utils"
import { ToolResultUtils } from "../utils/ToolResultUtils"

const TASK_PREVIEW_MAX_CHARS = 8000

function getInitialTaskPreview(config: TaskConfig): string | undefined {
	const firstTaskMessage = config.messageState
		.getDietCodeMessages()
		.find((message) => message.say === "task")
		?.text?.trim()
	if (!firstTaskMessage) {
		return undefined
	}
	if (firstTaskMessage.length <= TASK_PREVIEW_MAX_CHARS) {
		return firstTaskMessage
	}
	return `${firstTaskMessage.slice(0, TASK_PREVIEW_MAX_CHARS)}\n...[truncated]`
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

		// Double-check completion: reject attempt_completion calls that haven't been re-verified
		if (config.doubleCheckCompletionEnabled && !config.taskState.doubleCheckCompletionPending) {
			config.taskState.doubleCheckCompletionPending = true
			// Remove the partial completion_result message that was shown during streaming
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "completion_result")

			const taskPreview = getInitialTaskPreview(config)
			const taskSection = taskPreview ? `\n\n<initial_task>\n${taskPreview}\n</initial_task>` : ""

			return formatResponse.toolError(
				"Before completing, re-verify your work against the original task requirements. Check that:\n" +
					"1. All requested changes have been made\n" +
					"2. No steps were skipped or partially completed\n" +
					"3. Edge cases and error handling are addressed\n" +
					"4. The solution matches what was asked for, not just what was convenient\n" +
					"5. Output files contain exactly what was specified--no extra columns, fields, debug output, or commentary\n" +
					"6. If the task specifies numerical thresholds or accuracy targets, verify your result meets the criteria. If close but not passing, iterate rather than declaring completion" +
					taskSection +
					"\n\nIf everything checks out, call attempt_completion again with your final result.",
			)
		}
		// Reset so the next attempt_completion pair triggers double-check again
		config.taskState.doubleCheckCompletionPending = false

		// V225: Sovereign Forensic Gate
		// If Knowledge Ledger (.wiki/) hasn't been updated, spawn a Forensic Sub-Agent
		if (config.universalGuard && !config.isSubagentExecution) {
			let compliance = await config.universalGuard.checkForensicCompliance()
			if (!compliance.compliant) {
				await config.callbacks.say(
					"subagent",
					"🔍 **FORENSIC AUDIT REQUIRED**: Technical changes detected without Knowledge Ledger synchronization. Initiating autonomous documentation pass...",
				)

				// Pass 6: Dual-Pass Forensic Verification Loop
				let forensicResult = await this.runForensicSubagent(config, result)
				compliance = await config.universalGuard.checkForensicCompliance()

				if (!compliance.compliant && forensicResult) {
					await config.callbacks.say(
						"subagent",
						`⚠️ **FORENSIC AUDIT FAILED**: ${compliance.reason}\nInitiating corrective second pass...`,
					)
					// Feedback-driven second pass
					const feedback = `Your previous documentation update was REJECTED by the UniversalGuard.\nReason: ${compliance.reason}\n\nPlease perform a corrective pass to ensure all technical changes are mirrored in the Knowledge Ledger (.wiki/) and changelog.md.`
					forensicResult = await this.runForensicSubagent(config, result, feedback)
					compliance = await config.universalGuard.checkForensicCompliance()
				}

				if (!compliance.compliant) {
					return formatResponse.toolError(
						`🛡️ **SOVEREIGN FORENSIC GATE**: Documentation verification failed.\nReason: ${compliance.reason}\n\nThe specialized Forensic Sub-Agent failed to synchronize the Ledger. Please review the substrate health before manually attempting further changes.`,
					)
				}

				await config.callbacks.say("subagent", "✅ **FORENSIC GATE PASSED**: Knowledge Ledger is in sync.")
				// Fall through to actual completion
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

			const lastCompletionResultMessageIndex = findLastIndex(dietcodeMessages, (m: any) => m.say === "completion_result")
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

		let commandResult: any
		const lastMessage = config.messageState.getDietCodeMessages().at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask !== "command") {
				// haven't sent a command message yet so first send completion_result then command
				const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
				await config.callbacks.saveCheckpoint(true, completionMessageTs)
				await addNewChangesFlagToLastCompletionResultMessage()
				telemetryService.captureTaskCompleted(config.ulid, getTaskCompletionTelemetry(config))
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
			const [userRejected, execCommandResult] = await config.callbacks.executeCommandTool(command!, undefined) // no timeout for attempt_completion command

			if (userRejected) {
				config.taskState.didRejectTool = true
				return execCommandResult
			}
			// user didn't reject, but the command may have output
			commandResult = execCommandResult
		} else {
			// Send the complete completion_result message (partial was already removed above)
			const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
			await config.callbacks.saveCheckpoint(true, completionMessageTs)
			await addNewChangesFlagToLastCompletionResultMessage()
			telemetryService.captureTaskCompleted(config.ulid, getTaskCompletionTelemetry(config))
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
			toolResults.push(
				{
					type: "text",
					text: "The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.",
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

			await executeHook({
				hookName: "TaskComplete",
				hookInput: {
					taskComplete: {
						taskMetadata: {
							taskId: config.taskId,
							ulid: config.ulid,
							result: block.params.result || "",
							command: block.params.command || "",
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
	/**
	 * V225: Runs an autonomous Forensic Sub-Agent to handle Knowledge Ledger updates.
	 */
	private async runForensicSubagent(
		config: TaskConfig,
		originalResult: string,
		feedback?: string,
	): Promise<string | undefined> {
		try {
			await config.callbacks.say("subagent", "🛡️ **SOVEREIGN FORENSIC GATE**: Initiating Autonomous Forensic Phase...")

			const builder = new SubagentBuilder(config, "forensic-architect")
			builder.setAllowedTools([
				DietCodeDefaultTool.FILE_READ,
				DietCodeDefaultTool.FILE_EDIT,
				DietCodeDefaultTool.FILE_NEW,
				DietCodeDefaultTool.LIST_FILES,
				DietCodeDefaultTool.SEARCH,
				DietCodeDefaultTool.SOVEREIGN_DIAGNOSE,
				DietCodeDefaultTool.SOVEREIGN_SWEEP,
				DietCodeDefaultTool.BASH,
			])
			const runner = new SubagentRunner(config, builder)

			const impact = config.universalGuard?.getSessionImpactSummary() || "No impact data available."

			const prompt = `You are the Spider-Link Forensic Architect.
Your mission is to master the structural graph of the codebase and synchronize the Knowledge Ledger (.wiki/) as the **Definitive Architectural Bridge** for human collaborators.

### 🛑 OMNI-BRIDGE PROTOCOL (HIERARCHICAL TAXONOMY)
You MUST organize the \`.wiki/\` directory into a strict hierarchical taxonomy to ensure it is approachable and parsable. Do NOT dump everything into the root.

**1. Onboarding (\`.wiki/onboarding/\`)**
- \`getting-started.md\`: Actionable setup, environment requirements, and first-run instructions.
- \`walkthrough.md\`: A guided, human-readable tour of the codebase.
- \`troubleshooting.md\`: Document known pitfalls and setup errors.

**2. Architecture (\`.wiki/architecture/\`)**
- \`overview.md\`: Dependency graphs, visual Mermaid diagrams, and structural mentorship (the "Why").
- \`directories.md\`: Dictionary of every top-level directory's purpose and constraints.
- \`schemas.md\`: Explicit mapping of core service interfaces and data models.
- \`decisions.md\`: Architectural Decision Records (ADRs) to prevent regression.
- \`risk-map.md\`: Explicit outline of fragile, high-risk areas ("If you touch X, test Y").

**3. Agent (\`.wiki/agent/\`)**
- \`agent-memory.md\`: A highly condensed, machine-readable brief of absolute strict constraints for future autonomous agents.
- \`patterns.md\`: Step-by-step guides for common tasks to be executed by agents or devs.

**4. Root (\`.wiki/\`)**
- \`index.md\`: The primary dashboard and Table of Contents routing to the sub-directories.
- \`changelog.md\`: The continuous ledger of granular structural changes.

### 🛑 STRICT ACTION MANDATE
- **ZERO CONVERSATION**: No fluff. No conversational acknowledgments.
- **IMMEDIATE EXECUTION**: Your very first action MUST be a technical tool call (\`diagnose_sovereignty\`, \`list_dir\`, or \`git status\`).
- **KNOWLEDGE BASE INITIALIZATION**: If the \`.wiki/\` directory is missing or flat, initialize the full hierarchical taxonomy immediately: \`index.md\`, \`onboarding/getting-started.md\`, \`architecture/overview.md\`, etc.

### 🚫 ANTI-STALL MANDATE
- **CRITICAL**: Do NOT attempt to read massive git logs or full repository diffs. This causes system stalls and information overload.
- If you use git, limit it to \`git status\` or \`git log -n 5 --oneline\`.
- Your primary source of truth is the **physical code** and the **Spider Engine**, not git history.

### 🏗️ ENVIRONMENTAL AWARENESS
- You must document what the workspace **is** and **how it works**, not just what was changed in this commit.
- Identify the active tech stack, entry points, core service layers, and architectural "Gravity Centers" impacted by your work.
- Master the relationship between modified logic and the surrounding environment.

### 🛡️ SPIDER ENGINE REFERENCE
You have direct access to the Spider Engine, the structural authority of DietCode.
- **Built-in Tool: 'diagnose_sovereignty'**: Use this to generate a comprehensive structural audit of impacted files.
- **Built-in Tool: 'sovereign_integrity_sweep'**: Use this to verify that all citations in the wiki are grounded in the physical substrate.
- **CLI Manual Access**: If you need deeper granularity, run 'npx tsx scripts/agent-spider.ts <command>':
  - 'status': View graph health and entropy.
  - 'blast-radius <file>': Identify critical dependents impacted by your changes.
  - 'find-symbol <name>': Locate the physical definition of any symbol.
  - 'find-usage <symbol>': See every file that consumes a specific symbol.
  - 're-seed': Force-sync the graph if it diverges from reality.

### 🛡️ SPIDER-LINK MANDATE
1. **Environmental Deep-Dive**: Use 'diagnose_sovereignty' or 'blast-radius' to master the import/export graph.
2. **Physical Verification**: Read the core files involved in this session. Do NOT rely on summaries. See the code with your own eyes.
3. **Changelog Mastery**: Update '.wiki/changelog.md' with **Granular Citations**. 
   - **Format per File**: 
     - \`- **Path**: \`relative/path.ts\`\`
     - \`  - **Logic Shift**: [Granular detail of internal logic changes]\`
     - \`  - **Structural Impact**: [Changes to exports, imports, or blast radius]\`
   - **MANDATE**: The **Metabolic Citations Gauge** is active. Files with high churn REQUIRE longer, more technical descriptions. If you provide a superficial summary for a complex change, the Sovereign Forensic Gate will REJECT your completion.
4. **Graph Persistence**: Ensure '.wiki/index.md' and related files maintain structural parity with the physical codebase.

Do NOT provide conversational fluff. The Sovereign Forensic Gate now performs algorithmic granularity checks based on metabolic pressure. Be technically exhaustive.`

			const subagentResult = await runner.run(prompt, (update) => {
				if (update.status === "failed") {
					Logger.error("[ForensicSubagent] Failed:", update.error)
				}
			})

			return subagentResult.status === "completed" ? subagentResult.result : undefined
		} catch (error) {
			Logger.error("[ForensicSubagent] Unexpected error:", error)
			return undefined
		}
	}
}
