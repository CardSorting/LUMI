import { resolveWorkspacePath } from "@core/workspace"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { DietCodeDefaultTool } from "@shared/tools"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir, isLocatedInPath, isLocatedInWorkspace } from "@/utils/path"

export class AutoApprove {
	private stateManager: StateManager
	// Cache for workspace paths - populated on first access and reused for the task lifetime
	// NOTE: This assumes that the task has a fixed set of workspace roots(which is currently true).
	private workspacePathsCache: { paths: string[] } | null = null
	private isMultiRootScenarioCache: boolean | null = null

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager
	}

	/**
	 * Get workspace information with caching to avoid repeated API calls
	 * Cache is task-scoped since each task gets a new AutoApprove instance
	 */
	private async getWorkspaceInfo(): Promise<{
		workspacePaths: { paths: string[] }
		isMultiRootScenario: boolean
	}> {
		// Check if we already have cached values
		if (this.workspacePathsCache === null || this.isMultiRootScenarioCache === null) {
			// First time - fetch and cache for the lifetime of this task
			this.workspacePathsCache = await HostProvider.workspace.getWorkspacePaths({})
			this.isMultiRootScenarioCache = isMultiRootEnabled(this.stateManager) && this.workspacePathsCache.paths.length > 1
		}

		return {
			workspacePaths: this.workspacePathsCache,
			isMultiRootScenario: this.isMultiRootScenarioCache,
		}
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
		// Check persistent trust list
		const trustedTools = this.stateManager.getTrustedTools()
		if (trustedTools.includes(toolName)) {
			return [true, true]
		}

		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
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

				case DietCodeDefaultTool.BROWSER:
				case DietCodeDefaultTool.WEB_FETCH:
				case DietCodeDefaultTool.WEB_SEARCH:
				case DietCodeDefaultTool.MCP_ACCESS:
				case DietCodeDefaultTool.MCP_USE:
					return true
			}
		}

		if (this.stateManager.getGlobalSettingsKey("autoApproveAllToggled")) {
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
				case DietCodeDefaultTool.BROWSER:
				case DietCodeDefaultTool.WEB_FETCH:
				case DietCodeDefaultTool.WEB_SEARCH:
				case DietCodeDefaultTool.MCP_ACCESS:
				case DietCodeDefaultTool.MCP_USE:
					return true
			}
		}

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		switch (toolName) {
			case DietCodeDefaultTool.FILE_READ:
			case DietCodeDefaultTool.LIST_FILES:
			case DietCodeDefaultTool.LIST_CODE_DEF:
			case DietCodeDefaultTool.SEARCH:
			case DietCodeDefaultTool.USE_SUBAGENTS:
				return [autoApprovalSettings.actions.readFiles, autoApprovalSettings.actions.readFilesExternally ?? false]
			case DietCodeDefaultTool.NEW_RULE:
			case DietCodeDefaultTool.FILE_NEW:
			case DietCodeDefaultTool.FILE_EDIT:
			case DietCodeDefaultTool.APPLY_PATCH:
				return [autoApprovalSettings.actions.editFiles, autoApprovalSettings.actions.editFilesExternally ?? false]
			case DietCodeDefaultTool.BASH:
				return [
					autoApprovalSettings.actions.executeSafeCommands ?? false,
					autoApprovalSettings.actions.executeAllCommands ?? false,
				]
			case DietCodeDefaultTool.BROWSER:
				return autoApprovalSettings.actions.useBrowser
			case DietCodeDefaultTool.WEB_FETCH:
			case DietCodeDefaultTool.WEB_SEARCH:
				return autoApprovalSettings.actions.useBrowser
			case DietCodeDefaultTool.MCP_ACCESS:
			case DietCodeDefaultTool.MCP_USE:
				return autoApprovalSettings.actions.useMcp
		}
		return false
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	async shouldAutoApproveToolWithPath(
		blockname: DietCodeDefaultTool,
		autoApproveActionpath: string | undefined,
		command?: string,
		mcpServerName?: string,
	): Promise<boolean> {
		// Check persistent command trust first if applicable
		if (blockname === DietCodeDefaultTool.BASH && command) {
			if (this.shouldAutoApproveCommand(command)) {
				return true
			}
		}

		// Check persistent MCP server trust
		if ((blockname === DietCodeDefaultTool.MCP_USE || blockname === DietCodeDefaultTool.MCP_ACCESS) && mcpServerName) {
			const trustedMcpServers = this.stateManager.getTrustedMcpServers()
			if (trustedMcpServers.includes(mcpServerName)) {
				return true
			}
		}

		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
			return true
		}
		if (this.stateManager.getGlobalSettingsKey("autoApproveAllToggled")) {
			return true
		}

		// Safe-yolo mode: auto-approve read-only tools and trusted commands/MCP
		if (this.stateManager.getGlobalSettingsKey("safeYoloModeToggled")) {
			// Read-only tools are already handled by shouldAutoApproveTool if it returns true
			// BASH and MCP are handled above if they are trusted
			// Here we check if the tool itself is considered "safe-listable"
			const isReadOnly = [
				DietCodeDefaultTool.FILE_READ,
				DietCodeDefaultTool.LIST_FILES,
				DietCodeDefaultTool.LIST_CODE_DEF,
				DietCodeDefaultTool.SEARCH,
				DietCodeDefaultTool.NEW_RULE,
			].includes(blockname)

			if (isReadOnly) {
				return true
			}
		}

		let isLocalRead = false
		if (autoApproveActionpath) {
			// Use cached workspace info instead of fetching every time
			const { isMultiRootScenario } = await this.getWorkspaceInfo()

			if (isMultiRootScenario) {
				// Multi-root: check if file is in ANY workspace
				isLocalRead = await isLocatedInWorkspace(autoApproveActionpath)
			} else {
				// Single-root: use existing logic
				const cwd = await getCwd(getDesktopDir())
				// When called with a string cwd, resolveWorkspacePath returns a string
				const absolutePath = resolveWorkspacePath(
					cwd,
					autoApproveActionpath,
					"AutoApprove.shouldAutoApproveToolWithPath",
				) as string
				isLocalRead = isLocatedInPath(cwd, absolutePath)
			}
		} else {
			// If we do not get a path for some reason, default to a (safer) false return
			isLocalRead = false
		}

		// Get auto-approve settings for local and external edits
		const autoApproveResult = this.shouldAutoApproveTool(blockname)
		const [autoApproveLocal, autoApproveExternal] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		if ((isLocalRead && autoApproveLocal) || (!isLocalRead && autoApproveLocal && autoApproveExternal)) {
			return true
		}
		return false
	}
}
