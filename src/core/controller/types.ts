import { SpiderEngine } from "@core/policy/spider/SpiderEngine"
import { StateManager } from "@core/storage/StateManager"
import { ChatContent } from "@shared/ChatContent"
import { Mode } from "@shared/storage/types"
import { DietCodeAccountService } from "@/services/account/DietCodeAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { McpHub } from "@/services/mcp/McpHub"
import { Task } from "../task"

/**
 * IController defines the interface for the main application controller
 * to prevent circular dependencies between handlers and the controller class.
 */
export interface IController {
	task?: Task
	readonly stateManager: StateManager
	mcpHub: McpHub
	accountService: DietCodeAccountService
	authService: AuthService
	ocaAuthService: OcaAuthService
	getSpiderEngine(): Promise<SpiderEngine>
	createTask(prompt: string): Promise<string>
	updateBackgroundCommandState(isRunning: boolean, taskId?: string): void
	toggleActModeForYoloMode(): Promise<boolean>
	togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean>
	// Add other methods used by handlers/Task here
}
