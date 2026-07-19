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
	shellIntegrationFailed?: boolean
	cwd?: string
}

// Although vscode.window.terminals provides a list of all open terminals, there's no way to know whether they're busy or not (exitStatus does not provide useful information for most commands). In order to prevent creating too many terminals, we need to keep track of terminals through the life of the extension, as well as session specific terminals for the life of a task (to get latest unretrieved output).
// Since we have promises keeping track of terminal processes, we get the added benefit of keep track of busy terminals even after a task is closed.

let terminals: TerminalInfo[] = []
let nextTerminalId = 1

function isTerminalClosed(terminal: vscode.Terminal): boolean {
	return terminal.exitStatus !== undefined || !vscode.window.terminals.includes(terminal)
}

export const TerminalRegistry = {
	createTerminal(cwd?: string | vscode.Uri | undefined, shellPath?: string): TerminalInfo {
		const iconPath = vscode.Uri.file(path.join(HostProvider.get().extensionFsPath, "assets", "icons", "icon.svg"))
		const terminalOptions: vscode.TerminalOptions = {
			cwd,
			name: "DietCode",
			iconPath,
			env: {
				DIETCODE_ACTIVE: "true",
				CLINE_ACTIVE: "true",
				BASH_ENV: "",
				ENV: "",
				PYTHONINSPECT: "",
				DEBIAN_FRONTEND: "noninteractive",
				DEBCONF_NONINTERACTIVE_SEEN: "true",
				GCM_INTERACTIVE: "Never",
				GIT_PAGER: "cat",
				GIT_TERMINAL_PROMPT: "0",
				MANPAGER: "cat",
				PAGER: "cat",
				PIP_NO_INPUT: "1",
				PIP_DISABLE_PIP_VERSION_CHECK: "1",
				SYSTEMD_PAGER: "cat",
				NPM_CONFIG_YES: "true",
				YARN_YES: "true",
				POETRY_NO_INTERACTION: "1",
				CARGO_TERM_PROGRESS_WHEN: "never",
				HOMEBREW_NO_ANALYTICS: "1",
				HOMEBREW_NO_AUTO_UPDATE: "1",
				HOMEBREW_NO_ENV_HINTS: "1",
			},
		}

		// If a specific shell path is provided, use it
		if (shellPath) {
			terminalOptions.shellPath = shellPath
		}

		let terminal: vscode.Terminal
		try {
			terminal = vscode.window.createTerminal(terminalOptions)
		} catch (error) {
			// Fall back to default terminal shell if configured shellPath fails
			if (terminalOptions.shellPath) {
				delete terminalOptions.shellPath
				terminal = vscode.window.createTerminal(terminalOptions)
			} else {
				throw error
			}
		}

		let initialCwd: string | undefined
		if (cwd) {
			initialCwd = cwd instanceof vscode.Uri ? cwd.fsPath : cwd
		}
		const newInfo: TerminalInfo = {
			terminal,
			busy: false,
			lastCommand: "",
			id: nextTerminalId++,
			shellPath,
			lastActive: Date.now(),
			cwd: initialCwd,
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

// Keep the registry in sync with closed terminals in real-time
vscode.window.onDidCloseTerminal((closedTerminal) => {
	terminals = terminals.filter((t) => t.terminal !== closedTerminal)
})
