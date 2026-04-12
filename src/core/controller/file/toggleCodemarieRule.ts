import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleCodemarieRuleRequest } from "@shared/proto/codemarie/file"
import { RuleScope, ToggleCodemarieRules } from "@shared/proto/codemarie/file"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Toggles a Codemarie rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Codemarie rule toggles
 */
export async function toggleCodemarieRule(
	controller: Controller,
	request: ToggleCodemarieRuleRequest,
): Promise<ToggleCodemarieRules> {
	const { scope, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleCodemarieRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleCodemarieRule")
	}

	// Handle the three different scopes
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalCodemarieRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("globalCodemarieRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localCodemarieRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setWorkspaceState("localCodemarieRulesToggles", toggles)
			break
		}
		case RuleScope.REMOTE: {
			const toggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("remoteRulesToggles", toggles)
			break
		}
		default:
			throw new Error(`Invalid scope: ${scope}`)
	}

	// Track rule toggle telemetry with current task context
	if (controller.task?.ulid) {
		// Extract just the filename for privacy (no full paths)
		const ruleFileName = getWorkspaceBasename(rulePath, "Controller.toggleCodemarieRule")
		const isGlobal = scope === RuleScope.GLOBAL
		telemetryService.captureCodemarieRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalCodemarieRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localCodemarieRulesToggles")
	const remoteToggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")

	return ToggleCodemarieRules.create({
		globalCodemarieRulesToggles: { toggles: globalToggles },
		localCodemarieRulesToggles: { toggles: localToggles },
		remoteRulesToggles: { toggles: remoteToggles },
	})
}
