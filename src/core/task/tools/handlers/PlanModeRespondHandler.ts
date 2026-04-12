import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { findLast, parsePartialArrayString } from "@shared/array"
import { telemetryService } from "@/services/telemetry"
import { CodemariePlanModeResponse } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { CodemarieDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { getTaskCompletionTelemetry } from "../utils"

export class PlanModeRespondHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = CodemarieDefaultTool.PLAN_MODE

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for plan_mode_respond
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const response = block.params.response
		const optionsRaw = block.params.options

		const sharedMessage = {
			response: uiHelpers.removeClosingTag(block, "response", response),
			options: parsePartialArrayString(uiHelpers.removeClosingTag(block, "options", optionsRaw)),
		} satisfies CodemariePlanModeResponse

		await uiHelpers.ask(this.name, JSON.stringify(sharedMessage), true).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const response: string | undefined = block.params.response
		const optionsRaw: string | undefined = block.params.options
		const needsMoreExploration: boolean = block.params.needs_more_exploration === "true"

		// Validate required parameters
		if (!response) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "response")
		}

		config.taskState.consecutiveMistakeCount = 0

		// The plan_mode_respond tool tends to run into this issue where the model realizes mid-tool call that it should have called another tool before calling plan_mode_respond. And it ends the plan_mode_respond tool call with 'Proceeding to reading files...' which doesn't do anything because we restrict to 1 tool call per message. As an escape hatch for the model, we provide it the optionality to tack on a parameter at the end of its response `needs_more_exploration`, which will allow the loop to continue.
		if (needsMoreExploration) {
			config.taskState.currentTurnExplorationCount++

			if (config.taskState.currentTurnExplorationCount > 3) {
				return formatResponse.toolResult(
					`⚠️ RECURSIVE EXPLORATION DETECTED: You have requested "more exploration" multiple times in this turn. To avoid an infinite scanning loop, you MUST now synthesize your current findings and present a plan, or use ask_followup_question if you are truly blocked.`,
				)
			}

			return formatResponse.toolResult(
				`[You have indicated that you need more exploration. Proceed with calling tools to continue the planning process.]`,
			)
		}

		// For safety, if we are in yolo mode and we get a plan_mode_respond tool call we should always continue the loop
		if (config.yoloModeToggled && config.mode === "act") {
			return formatResponse.toolResult(`[Go ahead and execute.]`)
		}

		// Store the number of options for telemetry
		const options = parsePartialArrayString(optionsRaw || "[]")

		const sharedMessage = {
			response: response,
			options: options,
		}

		// Auto-switch to Act mode while in yolo mode
		if (config.mode === "plan" && config.yoloModeToggled && !needsMoreExploration) {
			// Trigger automatic mode switch
			const switchSuccessful = await config.callbacks.switchToActMode()

			if (switchSuccessful) {
				// Complete the plan mode response tool call (this is a unique case where we auto-respond to the user with an ask response)
				const lastPlanMessage = findLast(config.messageState.getCodemarieMessages(), (m: any) => m.ask === this.name)
				if (lastPlanMessage) {
					lastPlanMessage.text = JSON.stringify({
						...sharedMessage,
					} satisfies CodemariePlanModeResponse)
					lastPlanMessage.partial = false
					await config.messageState.saveCodemarieMessagesAndUpdateHistory()
				}

				// we dont need to process any text, options, files or other content here
				return formatResponse.toolResult(`[The user has switched to ACT MODE, so you may now proceed with the task.]`)
			}
			Logger.warn("YOLO MODE: Failed to switch to ACT MODE, continuing with normal plan mode")
		}

		// Set awaiting plan response state
		config.taskState.isAwaitingPlanResponse = true

		// Ask for user response
		let {
			text,
			images,
			files: planResponseFiles,
		} = await config.callbacks.ask(this.name, JSON.stringify(sharedMessage), false)

		config.taskState.isAwaitingPlanResponse = false

		// webview invoke sendMessage will send this marker in order to put webview into the proper state (responding to an ask) and as a flag to extension that the user switched to ACT mode.
		if (text === "PLAN_MODE_TOGGLE_RESPONSE") {
			text = ""
		}

		// Check if options contains the text response
		if (optionsRaw && text && parsePartialArrayString(optionsRaw).includes(text)) {
			telemetryService.captureOptionSelected(config.ulid, options.length, "plan")
			// Valid option selected, don't show user message in UI
			// Update last plan message with selected option
			const lastPlanMessage = findLast(config.messageState.getCodemarieMessages(), (m: any) => m.ask === this.name)
			if (lastPlanMessage) {
				lastPlanMessage.text = JSON.stringify({
					...sharedMessage,
					selected: text,
				} satisfies CodemariePlanModeResponse)
				await config.messageState.saveCodemarieMessagesAndUpdateHistory()
			}
		} else {
			// Option not selected, send user feedback
			if (text || (images && images.length > 0) || (planResponseFiles && planResponseFiles.length > 0)) {
				telemetryService.captureOptionsIgnored(config.ulid, options.length, "plan")
				await config.callbacks.say("user_feedback", text ?? "", images, planResponseFiles)
			}
		}

		let fileContentString = ""
		if (planResponseFiles && planResponseFiles.length > 0) {
			const { processFilesIntoText } = await import("@integrations/misc/extract-text")
			fileContentString = await processFilesIntoText(planResponseFiles)
		}

		telemetryService.captureTaskCompleted(config.ulid, getTaskCompletionTelemetry(config))

		// Handle mode switching response
		if (config.taskState.didRespondToPlanAskBySwitchingMode) {
			const result = formatResponse.toolResult(
				`[The user has switched to ACT MODE, so you may now proceed with the task.]` +
					(text
						? `\n\nThe user also provided the following message when switching to ACT MODE:\n<user_message>\n${text}\n</user_message>`
						: ""),
				images,
				fileContentString,
			)
			// Reset the flag after using it to prevent it from persisting
			config.taskState.didRespondToPlanAskBySwitchingMode = false
			return result
		}
		// if we didn't switch to ACT MODE, then we can just send the user_feedback message
		const layerSummary = await this.getLayerPlanningSummary(config)
		const architecturalCommitment = layerSummary
			? `\n\n[ARCHITECTURAL COMMITMENT SEAL]
By proceeding to ACT mode, you commit to maintaining the integrity of the layers explored:
- DOMAIN files will remain pure, logic-only, and free of side effects.
- CORE will coordinate without implementing low-level infrastructure.
- INFRASTRUCTURE will only implement Domain interfaces via Dependency Inversion.`
			: ""

		return formatResponse.toolResult(
			`<user_message>\n${text}\n</user_message>${layerSummary}${architecturalCommitment}`,
			images,
			fileContentString,
		)
	}

	/**
	 * Generates a summary of layers touched during the current planning session
	 */
	private async getLayerPlanningSummary(config: TaskConfig): Promise<string> {
		const { getLayer, getTargetPath } = require("@/utils/joy-zoning")
		const affectedLayers = new Set<string>()

		// Scan API conversation history for structured tool uses
		const history = config.messageState.getApiConversationHistory()
		for (const msg of history) {
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "tool_use") {
						const input = block.input as any
						const pathParam = getTargetPath(input)
						if (pathParam) {
							const layer = getLayer(pathParam)
							if (layer) affectedLayers.add(layer.toUpperCase())
						}
					}
				}
			}
		}

		if (affectedLayers.size === 0) return ""

		return `\n\n[JOY-ZONING PLANNING DIGEST]
You have explored files in the following layers: **${Array.from(affectedLayers).join(", ")}**.
Before switching to ACT mode, ensure your plan explicitly accounts for these boundaries:
- Domain logic remains pure (no I/O, no UI imports).
- Infrastructure adapters bridge the Domain to external services.
- Core coordinates but does not implement low-level logic.`
	}
}
