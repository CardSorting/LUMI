import { ToolParamName, ToolUse } from "@core/assistant-message"
import { DietCodeIgnoreController } from "@core/ignore/DietCodeIgnoreController"
import { DietCodeDefaultTool } from "@shared/tools"
import { UniversalGuard } from "../../policy/UniversalGuard"

export type ValidationResult = { ok: true } | { ok: false; error: string; hint?: string }

/**
 * ToolValidator: A production-ready gatekeeper that enforces security
 * (ignore rules) and architectural (Joy-Zoning) policy.
 */
export class ToolValidator {
	constructor(
		private readonly ignoreController: DietCodeIgnoreController,
		private readonly guard: UniversalGuard,
	) {}

	/**
	 * General pre-flight validation for a tool block.
	 */
	public async validate(block: ToolUse, ...requiredParams: ToolParamName[]): Promise<ValidationResult> {
		// 1. Parameter Integrity
		for (const p of requiredParams) {
			const val = (block.params as any)?.[p]
			if (val === undefined || val === null || String(val).trim() === "") {
				return { ok: false, error: `Missing required parameter '${p}' for tool '${block.name}'.` }
			}
		}

		const params = block.params as any

		// 2. Security Audit
		if (params.path) {
			const ignoreResult = await this.checkDietCodeIgnorePath(params.path)
			if (!ignoreResult.ok) return ignoreResult
		}

		// 3. Architectural Audit (for writes and patches)
		if (
			(block.name === DietCodeDefaultTool.FILE_NEW ||
				block.name === DietCodeDefaultTool.FILE_EDIT ||
				block.name === DietCodeDefaultTool.APPLY_PATCH) &&
			params.path &&
			(params.content || params.diff || params.patch)
		) {
			const editContent = params.content || params.diff || params.patch
			return await this.checkArchitecturalPurity(params.path, editContent)
		}

		return { ok: true }
	}

	/**
	 * Real-world asynchronous .dietcodeignore check.
	 */
	public async checkDietCodeIgnorePath(filePath: string): Promise<ValidationResult> {
		const isAccessible = this.ignoreController.validateAccess(filePath)
		if (!isAccessible) {
			return {
				ok: false,
				error: `Access to '${filePath}' is RESTRICTED by .dietcodeignore policies.`,
			}
		}
		return { ok: true }
	}

	/**
	 * Real-world command validation using .dietcodeignore patterns.
	 */
	public validateCommand(command: string): ValidationResult {
		const ignoredFile = this.ignoreController.validateCommand(command)
		if (ignoredFile) {
			return {
				ok: false,
				error: `Command attempts to access RESTRICTED file: '${ignoredFile}'`,
			}
		}
		return { ok: true }
	}

	/**
	 * Architectural awareness check for write operations.
	 * Shift-right: full guardPreExecution runs once in ToolExecutor — avoid duplicate pre-exec here.
	 */
	public async checkArchitecturalPurity(_filePath: string, _content: string): Promise<ValidationResult> {
		return { ok: true }
	}
}
