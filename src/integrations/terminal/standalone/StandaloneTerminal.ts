/**
 * StandaloneTerminal - A terminal wrapper for standalone environments.
 *
 * This class provides a terminal abstraction that works outside of VSCode,
 * implementing the ITerminal interface for compatibility with the terminal manager.
 */

import { type ChildProcess, spawn } from "child_process"
import { Logger } from "@/shared/services/Logger"
import type { ITerminal, StandaloneTerminalOptions } from "../types"

/**
 * A standalone terminal implementation that doesn't depend on VSCode.
 * Used in CLI and JetBrains environments.
 */
export class StandaloneTerminal implements ITerminal {
	/** Terminal name */
	name: string

	/** Promise that resolves to the process ID */
	processId: Promise<number | undefined>

	/** Terminal creation options */
	creationOptions: StandaloneTerminalOptions

	/** Exit status (if terminal has exited) */
	exitStatus: { code: number } | undefined

	/** Terminal state */
	state: { isInteractedWith: boolean }

	/** Current working directory */
	_cwd: string

	/** Shell path */
	_shellPath: string | undefined

	/** Active child process */
	_process: ChildProcess | null = null

	/** Process ID of the active process */
	_processId: number | null = null

	/** Shell integration adapter for compatibility with VS Code terminal callers */
	shellIntegration: {
		cwd: { fsPath: string }
		executeCommand: (command: string) => {
			read: () => AsyncGenerator<string, void, unknown>
		}
	}

	constructor(options: StandaloneTerminalOptions = {}) {
		this.name = options.name || `Terminal ${Math.floor(Math.random() * 10000)}`
		this.processId = Promise.resolve(Math.floor(Math.random() * 100000))
		this.creationOptions = options
		this.exitStatus = undefined
		this.state = { isInteractedWith: false }
		this._cwd = options.cwd || process.cwd()
		this._shellPath = options.shellPath

		this.shellIntegration = {
			cwd: { fsPath: this._cwd },
			executeCommand: (command: string) => ({
				read: () => this.readShellIntegrationCommand(command),
			}),
		}

		Logger.log(`[StandaloneTerminal] Created terminal: ${this.name} in ${this._cwd}`)
	}

	/**
	 * Send text to the terminal.
	 * @param text The text to send
	 * @param addNewLine Whether to add a newline (default: true)
	 */
	sendText(text: string, addNewLine = true): void {
		Logger.log(`[StandaloneTerminal] sendText: ${text}`)

		// If we have an active process, send input to it
		if (this._process && !this._process.killed) {
			try {
				this._process.stdin?.write(text + (addNewLine ? "\n" : ""))
			} catch (error) {
				Logger.error(`[StandaloneTerminal] Error sending text to process:`, error)
			}
		} else {
			// For compatibility with old behavior, we could spawn a new process
			Logger.log(`[StandaloneTerminal] No active process to send text to`)
		}
	}

	/**
	 * Show the terminal (no-op in standalone mode).
	 */
	show(): void {
		Logger.log(`[StandaloneTerminal] show: ${this.name}`)
		this.state.isInteractedWith = true
	}

	/**
	 * Hide the terminal (no-op in standalone mode).
	 */
	hide(): void {
		Logger.log(`[StandaloneTerminal] hide: ${this.name}`)
	}

	/**
	 * Dispose of the terminal and kill any running process.
	 */
	dispose(): void {
		Logger.log(`[StandaloneTerminal] dispose: ${this.name}`)
		if (this._process && !this._process.killed) {
			this._process.kill("SIGTERM")
		}
	}

	private async *readShellIntegrationCommand(command: string): AsyncGenerator<string, void, unknown> {
		const shell = this._shellPath || this.getDefaultShell()
		const args = this.getShellArgs(shell, command)
		const chunks: string[] = []
		const waiters: Array<() => void> = []
		let done = false
		let spawnError: Error | undefined

		const notify = () => {
			while (waiters.length > 0) {
				waiters.shift()?.()
			}
		}

		const child = spawn(shell, args, {
			cwd: this._cwd,
			env: {
				...process.env,
				TERM: "xterm-256color",
				PAGER: "cat",
				GIT_PAGER: "cat",
			},
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		})

		this._process = child
		this._processId = child.pid ?? null
		this.processId = Promise.resolve(child.pid)
		this.state.isInteractedWith = true

		child.stdout?.on("data", (data: Buffer) => {
			chunks.push(data.toString())
			notify()
		})
		child.stderr?.on("data", (data: Buffer) => {
			chunks.push(data.toString())
			notify()
		})
		child.once("error", (error: Error) => {
			spawnError = error
			done = true
			notify()
		})
		child.once("close", (code: number | null) => {
			this.exitStatus = typeof code === "number" ? { code } : undefined
			done = true
			notify()
		})

		while (!done || chunks.length > 0) {
			const chunk = chunks.shift()
			if (chunk !== undefined) {
				yield chunk
				continue
			}
			if (spawnError) {
				throw spawnError
			}
			await new Promise<void>((resolve) => waiters.push(resolve))
		}

		if (spawnError) {
			throw spawnError
		}
	}

	private getDefaultShell(): string {
		if (process.platform === "win32") {
			return process.env.COMSPEC || "cmd.exe"
		}
		return process.env.SHELL || "/bin/sh"
	}

	private getShellArgs(shell: string, command: string): string[] {
		const basename = shell.split(/[\\/]/).pop()?.toLowerCase() || shell.toLowerCase()
		if (basename === "cmd.exe" || basename === "cmd") {
			return ["/d", "/s", "/c", command]
		}
		if (basename.includes("powershell") || basename === "pwsh") {
			return ["-NoProfile", "-Command", command]
		}
		return ["-lc", command]
	}
}
