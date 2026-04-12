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
import { CodemarieRulesToggles } from "@shared/codemarie-rules"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { Controller } from "@/core/controller"
import { Logger } from "@/shared/services/Logger"
import { parseYamlFrontmatter } from "./frontmatter"
import { evaluateRuleConditionals, type RuleEvaluationContext } from "./rule-conditionals"

export const getGlobalCodemarieRules = async (
	globalCodemarieRulesFilePath: string,
	toggles: CodemarieRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	let combinedContent = ""
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	// 1. Get file-based rules
	if (await fileExistsAtPath(globalCodemarieRulesFilePath)) {
		if (await isDirectory(globalCodemarieRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalCodemarieRulesFilePath)
				// Note: ruleNamePrefix explicitly set to "global" for clarity (matches the default)
				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(
					rulesFilePaths,
					globalCodemarieRulesFilePath,
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
				Logger.error(`Failed to read .codemarierules directory at ${globalCodemarieRulesFilePath}`)
			}
		} else {
			Logger.error(`${globalCodemarieRulesFilePath} is not a directory`)
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
		instructions: formatResponse.codemarieRulesGlobalDirectoryInstructions(globalCodemarieRulesFilePath, combinedContent),
		activatedConditionalRules,
	}
}

export const getLocalCodemarieRules = async (
	cwd: string,
	toggles: CodemarieRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	const codemarieRulesFilePath = path.resolve(cwd, GlobalFileNames.codemarieRules)

	let instructions: string | undefined
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	if (await fileExistsAtPath(codemarieRulesFilePath)) {
		if (await isDirectory(codemarieRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(codemarieRulesFilePath, [
					[".codemarierules", "workflows"],
					[".codemarierules", "hooks"],
					[".codemarierules", "skills"],
				])

				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(rulesFilePaths, cwd, toggles, {
					evaluationContext: opts?.evaluationContext,
					ruleNamePrefix: "workspace",
				})
				if (rulesFilesTotal.content) {
					instructions = formatResponse.codemarieRulesLocalDirectoryInstructions(cwd, rulesFilesTotal.content)
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read .codemarierules directory at ${codemarieRulesFilePath}`)
			}
		} else {
			try {
				if (codemarieRulesFilePath in toggles && toggles[codemarieRulesFilePath] !== false) {
					const raw = (await fs.readFile(codemarieRulesFilePath, "utf8")).trim()
					if (raw) {
						// Keep single-file .codemarierules behavior consistent with directory/remote rules:
						// - Parse YAML frontmatter (fail-open on parse errors)
						// - Evaluate conditionals against the request's evaluation context
						const parsed = parseYamlFrontmatter(raw)
						if (parsed.hadFrontmatter && parsed.parseError) {
							// Fail-open: preserve the raw contents so the LLM can still see the author's intent.
							instructions = formatResponse.codemarieRulesLocalFileInstructions(cwd, raw)
						} else {
							const { passed, matchedConditions } = evaluateRuleConditionals(
								parsed.data,
								opts?.evaluationContext ?? {},
							)
							if (passed) {
								instructions = formatResponse.codemarieRulesLocalFileInstructions(cwd, parsed.body.trim())
								if (parsed.hadFrontmatter && Object.keys(matchedConditions).length > 0) {
									activatedConditionalRules.push({
										name: `${RULE_SOURCE_PREFIX.workspace}:${GlobalFileNames.codemarieRules}`,
										matchedConditions,
									})
								}
							}
						}
					}
				}
			} catch {
				Logger.error(`Failed to read .codemarierules file at ${codemarieRulesFilePath}`)
			}
		}
	}

	return { instructions, activatedConditionalRules }
}

export async function refreshCodemarieRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: CodemarieRulesToggles
	localToggles: CodemarieRulesToggles
}> {
	// Global toggles
	const globalCodemarieRulesToggles = controller.stateManager.getGlobalSettingsKey("globalCodemarieRulesToggles")
	const globalCodemarieRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalCodemarieRulesFilePath, globalCodemarieRulesToggles)
	controller.stateManager.setGlobalState("globalCodemarieRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localCodemarieRulesToggles = controller.stateManager.getWorkspaceStateKey("localCodemarieRulesToggles")
	const localCodemarieRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.codemarieRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localCodemarieRulesFilePath, localCodemarieRulesToggles, "", [
		[".codemarierules", "workflows"],
		[".codemarierules", "hooks"],
		[".codemarierules", "skills"],
	])
	controller.stateManager.setWorkspaceState("localCodemarieRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
