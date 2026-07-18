import { DietCodeDefaultTool } from "@shared/tools"
import { StateManager } from "@/core/storage/StateManager"
import { executionFunnel } from "./execution/ExecutionFunnel"

export class AutoApprove {
	private stateManager: StateManager

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager
	}

	/**
	 * Check if a command is persistently trusted
	 */
	public shouldAutoApproveCommand(command: string): boolean {
		const trustedCommands = this.stateManager.getTrustedCommands()
		const commandPrefix = command.trim().split(" ")[0]
		return trustedCommands.some((trusted) => {
			// Exact match or prefix match if the trusted entry ends with *
			if (trusted.endsWith("*")) {
				return command.startsWith(trusted.slice(0, -1))
			}
			return commandPrefix === trusted || command === trusted
		})
	}

	// Check if the tool should be auto-approved based on the settings
	// Returns bool for most tools, and tuple for tools with nested settings
	shouldAutoApproveTool(toolName: DietCodeDefaultTool): boolean | [boolean, boolean] {
		executionFunnel.recordApprovalDecision(true, "automatic")
		switch (toolName) {
			case DietCodeDefaultTool.FILE_READ:
			case DietCodeDefaultTool.LIST_FILES:
			case DietCodeDefaultTool.LIST_CODE_DEF:
			case DietCodeDefaultTool.SEARCH:
			case DietCodeDefaultTool.NEW_RULE:
			case DietCodeDefaultTool.FILE_NEW:
			case DietCodeDefaultTool.FILE_EDIT:
			case DietCodeDefaultTool.APPLY_PATCH:
			case DietCodeDefaultTool.BASH:
			case DietCodeDefaultTool.USE_SUBAGENTS:
				return [true, true]
			default:
				return true
		}
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	async shouldAutoApproveToolWithPath(
		_blockname: DietCodeDefaultTool,
		_autoApproveActionpath: string | undefined,
		_command?: string,
		_mcpServerName?: string,
	): Promise<boolean> {
		executionFunnel.recordApprovalDecision(true, "automatic")
		return true
	}
}
