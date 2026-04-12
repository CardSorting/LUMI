import path from "node:path"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"

export interface TerminalInfo {
	terminal: vscode.Terminal
	busy: boolean
	lastCommand: string
	id: number
	shellPath?: string
	lastActive: number
	pendingCwdChange?: string
	cwdResolved?: {
		resolve: () => void
		reject: (error: Error) => void
	}
}

// Although vscode.window.terminals provides a list of all open terminals, there's no way to know whether they're busy or not (exitStatus does not provide useful information for most commands). In order to prevent creating too many terminals, we need to keep track of terminals through the life of the extension, as well as session specific terminals for the life of a task (to get latest unretrieved output).
// Since we have promises keeping track of terminal processes, we get the added benefit of keep track of busy terminals even after a task is closed.

let terminals: TerminalInfo[] = []
let nextTerminalId = 1

function isTerminalClosed(terminal: vscode.Terminal): boolean {
	return terminal.exitStatus !== undefined
}

export const TerminalRegistry = {
	createTerminal(cwd?: string | vscode.Uri | undefined, shellPath?: string): TerminalInfo {
		const iconPath = vscode.Uri.file(path.join(HostProvider.get().extensionFsPath, "assets", "icons", "icon.svg"))
		const terminalOptions: vscode.TerminalOptions = {
			cwd,
			name: "Codemarie",
			iconPath,
			env: {
				CODEMARIE_ACTIVE: "true",
				CLINE_ACTIVE: "true",
			},
		}

		// If a specific shell path is provided, use it
		if (shellPath) {
			terminalOptions.shellPath = shellPath
		}

		const terminal = vscode.window.createTerminal(terminalOptions)
		nextTerminalId++
		const newInfo: TerminalInfo = {
			terminal,
			busy: false,
			lastCommand: "",
			id: nextTerminalId,
			shellPath,
			lastActive: Date.now(),
		}
		terminals.push(newInfo)
		return newInfo
	},

	getTerminal(id: number): TerminalInfo | undefined {
		const terminalInfo = terminals.find((t) => t.id === id)
		if (terminalInfo && isTerminalClosed(terminalInfo.terminal)) {
			this.removeTerminal(id)
			return undefined
		}
		return terminalInfo
	},

	updateTerminal(id: number, updates: Partial<TerminalInfo>) {
		const terminal = this.getTerminal(id)
		if (terminal) {
			Object.assign(terminal, updates)
		}
	},

	removeTerminal(id: number) {
		terminals = terminals.filter((t) => t.id !== id)
	},

	getAllTerminals(): TerminalInfo[] {
		terminals = terminals.filter((t) => !isTerminalClosed(t.terminal))
		return terminals
	},
}
