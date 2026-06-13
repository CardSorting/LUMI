import { ChildProcess, spawn } from "child_process"
import { EventEmitter } from "events"
import { Logger } from "@/shared/services/Logger"
import { resolveWindowsPowerShellExecutable } from "@/utils/powershell"
import { HookProcessRegistry } from "./HookProcessRegistry"
import type { IHookProcess } from "./IHookProcess"
import { escapeShellPath } from "./shell-escape"

// Maximum total output size (stdout + stderr combined)
const MAX_HOOK_OUTPUT_SIZE = 1024 * 1024 // 1MB

interface HookLaunchConfig {
	command: string
	args: string[]
	shell: boolean
	detached: boolean
}

export async function getHookLaunchConfig(
	scriptPath: string,
	resolvePowerShellExecutable: () => Promise<string> = resolveWindowsPowerShellExecutable,
): Promise<HookLaunchConfig> {
	if (process.platform === "win32") {
		const powerShellExecutable = await resolvePowerShellExecutable()
		return {
			command: powerShellExecutable,
			args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
			shell: false,
			detached: false,
		}
	}

	const escapedScriptPath = escapeShellPath(scriptPath)
	return {
		command: escapedScriptPath,
		args: [],
		shell: true,
		detached: true,
	}
}

/**
 * HookProcess manages the execution of a hook script with streaming output capabilities.
 * Similar to StandaloneTerminalProcess but specialized for hook execution.
 *
 * Key features:
 * - Real-time stdout/stderr streaming via line events
 * - Separate handling of visual output vs. JSON response
 * - 30-second execution timeout
 * - 1MB output size limit (prevents memory issues)
 * - Process lifecycle management with abort support
 */
export class HookProcess extends EventEmitter implements IHookProcess {
	private childProcess: ChildProcess | null = null
	private buffer = ""
	private fullOutput = ""
	private lastRetrievedIndex = 0
	private exitCode: number | null = null
	private isCompleted = false
	private timeoutHandle: NodeJS.Timeout | null = null // 30-second execution timeout

	// Separate buffers for stdout and stderr
	private stdoutBuffer = ""
	private stderrBuffer = ""

	// Output size tracking
	private stdoutSize = 0
	private stderrSize = 0
	private outputTruncated = false

	// Track registration state to prevent leaks and ensure cleanup
	private isRegistered = false

	constructor(
		private readonly scriptPath: string,
		private readonly timeoutMs: number = 30000,
		private readonly abortSignal?: AbortSignal,
		private readonly cwd?: string,
	) {
		super()
	}

	/**
	 * Execute the hook script with the given JSON input
	 * @param inputJson The JSON string to pass to the hook via stdin
	 */
	async run(inputJson: string): Promise<void> {
		// Wrap in try/finally to guarantee cleanup even if errors occur
		try {
			return await new Promise((resolve, reject) => {
				// Register this process for tracking
				HookProcessRegistry.register(this)
				this.isRegistered = true

				let abortHandler: (() => void) | undefined

				const cleanup = () => {
					if (this.timeoutHandle) {
						clearTimeout(this.timeoutHandle)
						this.timeoutHandle = null
					}
					if (this.abortSignal && abortHandler) {
						this.abortSignal.removeEventListener("abort", abortHandler)
					}
					this.safeUnregister()
				}

				const settle = (complete: () => void): boolean => {
					if (this.isCompleted) {
						return false
					}
					this.isCompleted = true
					cleanup()
					complete()
					return true
				}

				const rejectOnce = (error: Error, killSignal?: NodeJS.Signals) => {
					const shouldKill = Boolean(killSignal && this.childProcess)
					if (
						settle(() => {
							if (shouldKill) {
								this.killProcessTree(killSignal!)
							}
							reject(error)
						})
					) {
						return
					}
				}

				// Check if already aborted
				if (this.abortSignal?.aborted) {
					rejectOnce(new Error("Hook execution cancelled"))
					return
				}

				// Set up abort handler. It must settle even if abort arrives before spawn finishes.
				abortHandler = () => {
					rejectOnce(new Error("Hook execution cancelled by user"), "SIGTERM")
				}

				if (this.abortSignal) {
					this.abortSignal.addEventListener("abort", abortHandler, { once: true })
				}

				// Windows executes hooks with PowerShell directly.
				// Unix executes hook files through the shell for shebang support.
				void (async () => {
					try {
						const launchConfig = await getHookLaunchConfig(this.scriptPath)
						if (this.isCompleted) {
							return
						}
						if (this.abortSignal?.aborted) {
							abortHandler?.()
							return
						}

						this.childProcess = spawn(launchConfig.command, launchConfig.args, {
							stdio: ["pipe", "pipe", "pipe"],
							shell: launchConfig.shell,
							detached: launchConfig.detached,
							cwd: this.cwd, // Execute from the determined workspace root
							windowsHide: true,
						})

						let didEmitEmptyLine = false

						// Set up timeout
						this.timeoutHandle = setTimeout(() => {
							rejectOnce(
								new Error(
									`Hook execution timed out after ${this.timeoutMs}ms. The hook script at '${this.scriptPath}' took too long to complete.`,
								),
								"SIGTERM",
							)
						}, this.timeoutMs)

						// Handle stdout
						this.childProcess.stdout?.on("data", (data) => {
							const output = data.toString()
							this.stdoutBuffer += output
							this.handleOutput(output, didEmitEmptyLine, "stdout")
							if (!didEmitEmptyLine && output) {
								this.emit("line", "", "stdout") // Signal start of output
								didEmitEmptyLine = true
							}
						})

						// Handle stderr
						this.childProcess.stderr?.on("data", (data) => {
							const output = data.toString()
							this.stderrBuffer += output
							this.handleOutput(output, didEmitEmptyLine, "stderr")
							if (!didEmitEmptyLine && output) {
								this.emit("line", "", "stderr") // Signal start of output
								didEmitEmptyLine = true
							}
						})

						// Handle process completion
						this.childProcess.on("close", (code, signal) => {
							if (this.isCompleted) {
								cleanup()
								return
							}
							this.exitCode = code
							this.emitRemainingBuffer()

							settle(() => {
								this.emit("completed", code, signal)

								if (code === 0) {
									resolve()
								} else {
									reject(new Error(`Hook exited with code ${code}${signal ? `, signal ${signal}` : ""}`))
								}
							})
						})

						// Handle process errors
						this.childProcess.on("error", (error) => {
							settle(() => {
								this.emit("error", error)
								reject(error)
							})
						})

						// Send input to the process
						try {
							this.childProcess.stdin?.write(inputJson)
							this.childProcess.stdin?.end()
						} catch (error) {
							rejectOnce(new Error(`Failed to write input to hook: ${error}`), "SIGTERM")
						}
					} catch (error) {
						rejectOnce(error instanceof Error ? error : new Error(String(error)))
					}
				})()
			})
		} finally {
			// Guaranteed cleanup even if process setup fails or throws
			this.safeUnregister()
		}
	}

	/**
	 * Safely unregister from the process registry.
	 * This is idempotent and prevents double-unregistration issues.
	 */
	private safeUnregister(): void {
		if (this.isRegistered) {
			HookProcessRegistry.unregister(this)
			this.isRegistered = false
		}
	}

	private killProcessTree(signal: NodeJS.Signals): void {
		if (!this.childProcess) {
			return
		}

		const pid = this.childProcess.pid
		try {
			if (pid && process.platform !== "win32") {
				process.kill(-pid, signal)
			} else {
				this.childProcess.kill(signal)
			}
		} catch (error) {
			try {
				this.childProcess.kill(signal)
			} catch (fallbackError) {
				Logger.debug(`[HookProcess] Error sending ${signal}: ${error}; fallback failed: ${fallbackError}`)
			}
		}
	}

	/**
	 * Handle output data and emit line events.
	 * Enforces 1MB total output limit to prevent memory issues.
	 */
	private handleOutput(data: string, _didEmitEmptyLine: boolean, stream: "stdout" | "stderr"): void {
		// Check output size limit
		const dataSize = Buffer.byteLength(data)
		const currentTotalSize = this.stdoutSize + this.stderrSize

		if (currentTotalSize + dataSize > MAX_HOOK_OUTPUT_SIZE) {
			if (!this.outputTruncated) {
				this.outputTruncated = true
				const truncationMsg = "\n\n[Output truncated: exceeded 1MB limit]"
				this.emit("line", truncationMsg, stream)
				Logger.warn(`[HookProcess] Output exceeded ${MAX_HOOK_OUTPUT_SIZE} bytes, truncating`)
			}
			return // Drop further output
		}

		// Track size by stream
		if (stream === "stdout") {
			this.stdoutSize += dataSize
		} else {
			this.stderrSize += dataSize
		}

		// Store full output
		this.fullOutput += data

		// Emit lines immediately
		this.emitLines(data, stream)
	}

	/**
	 * Emit complete lines from buffered output
	 */
	private emitLines(chunk: string, stream: "stdout" | "stderr"): void {
		this.buffer += chunk
		let lineEndIndex = this.buffer.indexOf("\n")
		while (lineEndIndex !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line, stream)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
			lineEndIndex = this.buffer.indexOf("\n")
		}
		this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
	}

	/**
	 * Emit any remaining buffered output when process completes
	 */
	private emitRemainingBuffer(): void {
		if (this.buffer) {
			const remainingBuffer = this.buffer.trimEnd()
			if (remainingBuffer) {
				// Determine which stream this came from based on content
				// This is a fallback; in practice, line events should capture most output
				this.emit("line", remainingBuffer, "stdout")
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	/**
	 * Get unretrieved output (for compatibility with terminal process interface)
	 */
	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return unretrieved.trimEnd()
	}

	/**
	 * Get the complete stdout buffer (for JSON parsing)
	 */
	getStdout(): string {
		return this.stdoutBuffer
	}

	/**
	 * Get the complete stderr buffer (for error reporting)
	 */
	getStderr(): string {
		return this.stderrBuffer
	}

	/**
	 * Get the exit code
	 */
	getExitCode(): number | null {
		return this.exitCode
	}

	/**
	 * Check if process has completed
	 */
	hasCompleted(): boolean {
		return this.isCompleted
	}

	/**
	 * Terminate the process and its entire process tree.
	 * Uses process groups on Unix to kill child processes.
	 * Implements graceful shutdown with 2-second timeout before force kill.
	 */
	async terminate(): Promise<void> {
		if (!this.childProcess || this.isCompleted) {
			// Still ensure unregistration even if process already completed
			this.safeUnregister()
			return
		}

		const pid = this.childProcess.pid
		if (!pid) {
			return
		}

		try {
			// On Unix, kill process group (negative PID kills all children)
			// On Windows, just kill the process (tree-kill would be better but adds dependency)
			if (process.platform !== "win32") {
				// Kill process group with SIGTERM for graceful shutdown
				process.kill(-pid, "SIGTERM")
			} else {
				// On Windows, just kill the process
				this.childProcess.kill("SIGTERM")
			}

			// Wait up to 2 seconds for graceful shutdown
			const gracefulTimeout = new Promise((resolve) => setTimeout(resolve, 2000))
			const processExit = new Promise((resolve) => {
				this.childProcess?.once("exit", resolve)
			})

			await Promise.race([processExit, gracefulTimeout])

			// Force kill if still running
			if (!this.isCompleted) {
				if (process.platform !== "win32") {
					process.kill(-pid, "SIGKILL")
				} else {
					this.childProcess?.kill("SIGKILL")
				}
			}
		} catch (error) {
			// Process might already be dead, which is fine
			Logger.debug(`[HookProcess] Error during termination: ${error}`)
		} finally {
			// Clear timeout regardless
			if (this.timeoutHandle) {
				clearTimeout(this.timeoutHandle)
				this.timeoutHandle = null
			}
			// Ensure unregistration even if termination fails
			this.safeUnregister()
		}
	}
}
