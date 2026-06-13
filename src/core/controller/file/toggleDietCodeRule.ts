import type { IController as Controller } from "@core/controller/types"
import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleDietCodeRuleRequest } from "@shared/proto/dietcode/file"
import { RuleScope, ToggleDietCodeRules } from "@shared/proto/dietcode/file"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"

/**
 * Toggles a DietCode rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated DietCode rule toggles
 */
export async function toggleDietCodeRule(
	controller: Controller,
	request: ToggleDietCodeRuleRequest,
): Promise<ToggleDietCodeRules> {
	const { scope, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleDietCodeRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleDietCodeRule")
	}

	// Handle the three different scopes
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalDietCodeRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("globalDietCodeRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localDietCodeRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setWorkspaceState("localDietCodeRulesToggles", toggles)
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
		const ruleFileName = getWorkspaceBasename(rulePath, "Controller.toggleDietCodeRule")
		const isGlobal = scope === RuleScope.GLOBAL
		telemetryService.captureDietCodeRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalDietCodeRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localDietCodeRulesToggles")
	const remoteToggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")

	return ToggleDietCodeRules.create({
		globalDietcodeRulesToggles: { toggles: globalToggles },
		localDietcodeRulesToggles: { toggles: localToggles },
		remoteRulesToggles: { toggles: remoteToggles },
	})
}
