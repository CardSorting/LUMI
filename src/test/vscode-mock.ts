// Mock implementation of VSCode API for unit tests
interface MockTerminalOptions {
	name?: string
}

export const env = {
	machineId: "test-machine-id",
	isTelemetryEnabled: true,
	onDidChangeTelemetryEnabled: (_callback: (enabled: boolean) => void) => {
		// Return a disposable mock
		return {
			dispose: () => {},
		}
	},
	clipboard: {
		readText: () => Promise.resolve("mock-clipboard-content"),
		writeText: () => Promise.resolve(),
	},
}

export const workspace = {
	getConfiguration: (section?: string) => {
		return {
			get: (key: string, defaultValue?: unknown) => {
				// Return default values for common configuration keys
				if (section === "dietcode" && key === "telemetrySetting") {
					return "enabled"
				}
				if (section === "telemetry" && key === "telemetryLevel") {
					return "all"
				}
				return defaultValue
			},
		}
	},
}

// Export other commonly used VSCode API mocks as needed
export const window = {
	showErrorMessage: (_message: string) => Promise.resolve(),
	showWarningMessage: (_message: string) => Promise.resolve(),
	showInformationMessage: (_message: string) => Promise.resolve(),
	createTextEditorDecorationType: (_options: unknown) => ({
		key: "mock-decoration-type",
		dispose: () => {},
	}),
	createOutputChannel: (_name: string) => ({
		appendLine: (message: string) => console.debug(message),
		append: (message: string) => console.debug(message),
		clear: () => {},
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	createTerminal: (options?: MockTerminalOptions) => {
		const term = {
			name: options?.name || "mock-terminal",
			processId: Promise.resolve(1234),
			sendText: (command: string) => {
				const fs = require("fs")
				const os = require("os")
				const path = require("path")

				const exitPathMatch = command.match(/dc-term-exit-[a-zA-Z0-9_-]+/g)
				const outPathMatch = command.match(/dc-term-out-[a-zA-Z0-9_-]+/g)

				if (exitPathMatch || outPathMatch) {
					const tempDir = os.tmpdir()
					const exitFile = exitPathMatch ? path.join(tempDir, exitPathMatch[0]) : null
					const outFile = outPathMatch ? path.join(tempDir, outPathMatch[0]) : null

					setTimeout(() => {
						if (outFile) {
							let outputText = "mock terminal output"
							if (command.includes("echo test")) {
								outputText = "test\n"
							} else if (command.includes("echo 'Line 1'") || command.includes('echo "Line 1"')) {
								outputText = "Line 1\nLine 2\n"
							} else if (command.includes("ls -la")) {
								outputText = "total 0\ndrwxr-xr-x  2 user  group  64 Jul 18 12:00 .\n"
							} else if (command.includes("sleep")) {
								outputText = "Done sleeping\n"
							}
							fs.writeFileSync(outFile, outputText)
						}
						if (exitFile) {
							fs.writeFileSync(exitFile, "0")
						}
					}, 50)
				}
			},
			show: () => {},
			hide: () => {},
			dispose: () => {},
			exitStatus: undefined,
			state: {
				isInteractedWith: false,
				shell: "zsh",
			},
			shellIntegration: {
				executeCommand: (_command: string) => ({
					read: () => ({
						async *[Symbol.asyncIterator]() {
							yield `\x1b]633;C\x07mock output\n\x1b]633;D;0\x07`
						},
					}),
				}),
			},
		}
		return term
	},
	onDidChangeTerminalState: (_callback: (terminal: unknown) => unknown) => ({
		dispose: () => {},
	}),
}

export const commands = {
	executeCommand: (_command: string, ..._args: unknown[]) => Promise.resolve(),
}

export const Uri = {
	file: (path: string) => ({ fsPath: path, toString: () => path }),
	parse: (uri: string) => ({ fsPath: uri, toString: () => uri }),
}

export const ExtensionContextMock = {}
export const StatusBarAlignmentMock = { Left: 1, Right: 2 }
export const ViewColumnMock = { One: 1, Two: 2, Three: 3 }
