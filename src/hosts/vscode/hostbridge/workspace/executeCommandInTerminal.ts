import path from "node:path"
import { ExecuteCommandInTerminalRequest, ExecuteCommandInTerminalResponse } from "@shared/proto/host/workspace"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

/**
 * Executes a command in a new terminal
 * @param request The request containing the command to execute
 * @returns Response indicating success
 */
export async function executeCommandInTerminal(
	request: ExecuteCommandInTerminalRequest,
): Promise<ExecuteCommandInTerminalResponse> {
	try {
		// Create terminal with fixed options
		const iconPath = vscode.Uri.file(path.join(HostProvider.get().extensionFsPath, "assets", "icons", "icon.svg"))
		const terminalOptions: vscode.TerminalOptions = {
			name: "Codemarie",
			iconPath,
			env: {
				CODEMARIE_ACTIVE: "true",
				CLINE_ACTIVE: "true",
			},
		}

		// Create a new terminal
		const terminal = vscode.window.createTerminal(terminalOptions)

		// Show the terminal to the user
		terminal.show()

		// Send the command to the terminal
		terminal.sendText(request.command, true)

		return ExecuteCommandInTerminalResponse.create({
			success: true,
		})
	} catch (error) {
		Logger.error("Error executing command in terminal:", error)
		return ExecuteCommandInTerminalResponse.create({
			success: false,
		})
	}
}
