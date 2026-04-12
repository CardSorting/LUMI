import { ToolParamName, ToolUse } from "@core/assistant-message"
import { CodemarieIgnoreController } from "@core/ignore/CodemarieIgnoreController"
import { CodemarieDefaultTool } from "@shared/tools"
import { UniversalGuard } from "../../policy/UniversalGuard"

export type ValidationResult = { ok: true } | { ok: false; error: string; hint?: string }

/**
 * ToolValidator: A production-ready gatekeeper that enforces security
 * (ignore rules) and architectural (Joy-Zoning) policy.
 */
export class ToolValidator {
	constructor(
		private readonly ignoreController: CodemarieIgnoreController,
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
			const ignoreResult = await this.checkCodemarieIgnorePath(params.path)
			if (!ignoreResult.ok) return ignoreResult
		}

		// 3. Architectural Audit (for writes and patches)
		if (
			(block.name === CodemarieDefaultTool.FILE_NEW ||
				block.name === CodemarieDefaultTool.FILE_EDIT ||
				block.name === CodemarieDefaultTool.APPLY_PATCH) &&
			params.path &&
			(params.content || params.diff || params.patch)
		) {
			const editContent = params.content || params.diff || params.patch
			return await this.checkArchitecturalPurity(params.path, editContent)
		}

		return { ok: true }
	}

	/**
	 * Real-world asynchronous .codemarieignore check.
	 */
	public async checkCodemarieIgnorePath(filePath: string): Promise<ValidationResult> {
		const isAccessible = this.ignoreController.validateAccess(filePath)
		if (!isAccessible) {
			return {
				ok: false,
				error: `Access to '${filePath}' is RESTRICTED by .codemarieignore policies.`,
			}
		}
		return { ok: true }
	}

	/**
	 * Real-world command validation using .codemarieignore patterns.
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
	 * Uses the UniversalGuard's pre-execution validation for real AST analysis
	 * instead of fragile emoji-prefix string matching.
	 */
	public async checkArchitecturalPurity(filePath: string, content: string): Promise<ValidationResult> {
		// Get layer context for actionable guidance
		const layerContext = this.guard.getLayerContext(filePath)

		// Build a synthetic tool block for the guard's pre-execution check
		const syntheticBlock = {
			type: "tool_use" as const,
			name: CodemarieDefaultTool.FILE_NEW,
			params: { path: filePath, content },
			partial: false,
		}

		const result = await this.guard.guardPreExecution(syntheticBlock as any)

		if (!result.success) {
			return {
				ok: false,
				error: `🏗️ ARCHITECTURAL CORRECTION REQUIRED\n${layerContext}\n\n${result.error}`,
				hint: result.correctionHint,
			}
		}

		// If there's a warning (degraded enforcement), allow but log the hint for agent awareness
		// Note: ok: true means the write proceeds; the warning is surfaced separately by ToolExecutor
		if (result.warning) {
			// Surface the warning through a structured hint if possible,
			// though ToolExecutor normally handles the result.warning injection.
			return { ok: true }
		}

		return { ok: true }
	}
}
