import {
	ActivatedConditionalRule,
	getRemoteRulesTotalContentWithMetadata,
	getRuleFilesTotalContentWithMetadata,
	RULE_SOURCE_PREFIX,
	RuleLoadResultWithInstructions,
	synchronizeRuleToggles,
} from "@core/context/instructions/user-instructions/rule-helpers"
import { formatResponse } from "@core/prompts/responses"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { StateManager } from "@core/storage/StateManager"
import { DietCodeRulesToggles } from "@shared/dietcode-rules"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { IController } from "@/core/controller/types"
import { Logger } from "@/shared/services/Logger"
import { parseYamlFrontmatter } from "./frontmatter"
import { evaluateRuleConditionals, type RuleEvaluationContext } from "./rule-conditionals"

export const getGlobalDietCodeRules = async (
	globalDietCodeRulesFilePath: string,
	toggles: DietCodeRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	let combinedContent = ""
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	// 1. Get file-based rules
	if (await fileExistsAtPath(globalDietCodeRulesFilePath)) {
		if (await isDirectory(globalDietCodeRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalDietCodeRulesFilePath)
				// Note: ruleNamePrefix explicitly set to "global" for clarity (matches the default)
				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(
					rulesFilePaths,
					globalDietCodeRulesFilePath,
					toggles,
					{
						evaluationContext: opts?.evaluationContext,
						ruleNamePrefix: "global",
					},
				)
				if (rulesFilesTotal.content) {
					combinedContent = rulesFilesTotal.content
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read .dietcoderules directory at ${globalDietCodeRulesFilePath}`)
			}
		} else {
			Logger.error(`${globalDietCodeRulesFilePath} is not a directory`)
		}
	}

	// 2. Append remote config rules
	const stateManager = StateManager.get()
	const remoteConfigSettings = stateManager.getRemoteConfigSettings()
	const remoteRules = remoteConfigSettings.remoteGlobalRules || []
	const remoteToggles = stateManager.getGlobalStateKey("remoteRulesToggles") || {}
	const remoteResult = getRemoteRulesTotalContentWithMetadata(remoteRules, remoteToggles, {
		evaluationContext: opts?.evaluationContext,
	})
	if (remoteResult.content) {
		if (combinedContent) combinedContent += "\n\n"
		combinedContent += remoteResult.content
		activatedConditionalRules.push(...remoteResult.activatedConditionalRules)
	}

	// 3. Return formatted instructions
	if (!combinedContent) {
		return { instructions: undefined, activatedConditionalRules: [] }
	}

	return {
		instructions: formatResponse.dietcodeRulesGlobalDirectoryInstructions(globalDietCodeRulesFilePath, combinedContent),
		activatedConditionalRules,
	}
}

export const getLocalDietCodeRules = async (
	cwd: string,
	toggles: DietCodeRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	const dietcodeRulesFilePath = path.resolve(cwd, GlobalFileNames.dietcodeRules)

	let instructions: string | undefined
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	if (await fileExistsAtPath(dietcodeRulesFilePath)) {
		if (await isDirectory(dietcodeRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(dietcodeRulesFilePath, [
					[".dietcoderules", "workflows"],
					[".dietcoderules", "hooks"],
					[".dietcoderules", "skills"],
				])

				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(rulesFilePaths, cwd, toggles, {
					evaluationContext: opts?.evaluationContext,
					ruleNamePrefix: "workspace",
				})
				if (rulesFilesTotal.content) {
					instructions = formatResponse.dietcodeRulesLocalDirectoryInstructions(cwd, rulesFilesTotal.content)
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read .dietcoderules directory at ${dietcodeRulesFilePath}`)
			}
		} else {
			try {
				if (dietcodeRulesFilePath in toggles && toggles[dietcodeRulesFilePath] !== false) {
					const raw = (await fs.readFile(dietcodeRulesFilePath, "utf8")).trim()
					if (raw) {
						// Keep single-file .dietcoderules behavior consistent with directory/remote rules:
						// - Parse YAML frontmatter (fail-open on parse errors)
						// - Evaluate conditionals against the request's evaluation context
						const parsed = parseYamlFrontmatter(raw)
						if (parsed.hadFrontmatter && parsed.parseError) {
							// Fail-open: preserve the raw contents so the LLM can still see the author's intent.
							instructions = formatResponse.dietcodeRulesLocalFileInstructions(cwd, raw)
						} else {
							const { passed, matchedConditions } = evaluateRuleConditionals(
								parsed.data,
								opts?.evaluationContext ?? {},
							)
							if (passed) {
								instructions = formatResponse.dietcodeRulesLocalFileInstructions(cwd, parsed.body.trim())
								if (parsed.hadFrontmatter && Object.keys(matchedConditions).length > 0) {
									activatedConditionalRules.push({
										name: `${RULE_SOURCE_PREFIX.workspace}:${GlobalFileNames.dietcodeRules}`,
										matchedConditions,
									})
								}
							}
						}
					}
				}
			} catch {
				Logger.error(`Failed to read .dietcoderules file at ${dietcodeRulesFilePath}`)
			}
		}
	}

	return { instructions, activatedConditionalRules }
}

export async function refreshDietCodeRulesToggles(
	controller: IController,
	workingDirectory: string,
): Promise<{
	globalToggles: DietCodeRulesToggles
	localToggles: DietCodeRulesToggles
}> {
	// Global toggles
	const globalDietCodeRulesToggles = controller.stateManager.getGlobalSettingsKey("globalDietCodeRulesToggles")
	const globalDietCodeRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalDietCodeRulesFilePath, globalDietCodeRulesToggles)
	controller.stateManager.setGlobalState("globalDietCodeRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localDietCodeRulesToggles = controller.stateManager.getWorkspaceStateKey("localDietCodeRulesToggles")
	const localDietCodeRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.dietcodeRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localDietCodeRulesFilePath, localDietCodeRulesToggles, "", [
		[".dietcoderules", "workflows"],
		[".dietcoderules", "hooks"],
		[".dietcoderules", "skills"],
	])
	controller.stateManager.setWorkspaceState("localDietCodeRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
