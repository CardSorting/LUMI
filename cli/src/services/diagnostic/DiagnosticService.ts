import { execSync } from "node:child_process"

export interface DiagnosticResult {
	name: string
	status: "ok" | "warning" | "error"
	message: string
	remediation?: string
}

export class DiagnosticService {
	private static instance: DiagnosticService

	public static getInstance(): DiagnosticService {
		if (!DiagnosticService.instance) {
			DiagnosticService.instance = new DiagnosticService()
		}
		return DiagnosticService.instance
	}

	public async runAllDiagnostics(): Promise<DiagnosticResult[]> {
		const results: DiagnosticResult[] = []

		// 1. Check Node.js version
		results.push(this.checkNodeVersion())

		// 2. Check ripgrep (rg)
		results.push(await this.checkTool("rg", "ripgrep", "brew install ripgrep"))

		// 3. Check fd
		results.push(await this.checkTool("fd", "fd-find", "brew install fd"))

		// 4. Check Network Connectivity
		results.push(await this.checkNetwork())

		// 5. Check Config Integrity
		results.push(await this.checkConfigIntegrity())

		// 6. Check API Tokens
		results.push(await this.checkApiTokens())

		// 7. Check Memory Health
		results.push(this.checkMemoryHealth())

		return results
	}

	public async runRepair(diagnostics: DiagnosticResult[]): Promise<DiagnosticResult[]> {
		const results: DiagnosticResult[] = []

		for (const diag of diagnostics) {
			if (diag.status === "ok") continue

			if (diag.name === "Configuration Integrity") {
				results.push(await this.repairConfig())
			} else if (diag.name === "API Tokens") {
				results.push({
					name: "API Tokens Repair",
					status: "warning",
					message: "Unable to auto-repair tokens. Please run `codemarie auth` or `codemarie config`.",
				})
			} else {
				results.push({
					name: diag.name,
					status: "warning",
					message: "No auto-repair available for this issue.",
				})
			}
		}

		return results
	}

	private checkNodeVersion(): DiagnosticResult {
		const majorVersion = Number.parseInt(process.versions.node.split(".")[0], 10)
		if (majorVersion >= 20) {
			return {
				name: "Node.js Version",
				status: "ok",
				message: `v${process.versions.node}`,
			}
		}
		return {
			name: "Node.js Version",
			status: "error",
			message: `v${process.versions.node} (Required: >=20)`,
			remediation: "Please update Node.js to version 20 or later.",
		}
	}

	private async checkTool(command: string, name: string, remediation: string): Promise<DiagnosticResult> {
		try {
			execSync(`${command} --version`, { stdio: "ignore" })
			return {
				name,
				status: "ok",
				message: "Installed",
			}
		} catch {
			return {
				name,
				status: "error",
				message: "Not found in PATH",
				remediation: `Please install ${name}: \`${remediation}\``,
			}
		}
	}

	private async checkNetwork(): Promise<DiagnosticResult> {
		try {
			// Check connectivity to a common endpoint (Google/Anthropic)
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 5000)
			await fetch("https://api.anthropic.com", { method: "HEAD", signal: controller.signal })
			clearTimeout(timeoutId)
			return {
				name: "Network Connectivity",
				status: "ok",
				message: "Connected",
			}
		} catch {
			return {
				name: "Network Connectivity",
				status: "warning",
				message: "Failed to reach Anthropic API",
				remediation: "Check your internet connection or proxy settings.",
			}
		}
	}

	private async checkConfigIntegrity(): Promise<DiagnosticResult> {
		try {
			const { StateManager } = await import("@/core/storage/StateManager")
			const state = StateManager.get()
			const config = state.getApiConfiguration()
			if (config) {
				return {
					name: "Configuration Integrity",
					status: "ok",
					message: "Valid",
				}
			}
		} catch {
			return {
				name: "Configuration Integrity",
				status: "error",
				message: "Configuration file corrupted or inaccessible",
				remediation: "Run `codemarie auth` to reconfigure.",
			}
		}
		return {
			name: "Configuration Integrity",
			status: "warning",
			message: "No configuration found",
			remediation: "Run `codemarie auth` to get started.",
		}
	}

	private async repairConfig(): Promise<DiagnosticResult> {
		try {
			const { StateManager } = await import("@/core/storage/StateManager")
			StateManager.get()
			return {
				name: "Configuration Repair",
				status: "ok",
				message: "Configuration state re-initialized. Self-healing should have triggered if backups were available.",
			}
		} catch (error) {
			return {
				name: "Configuration Repair",
				status: "error",
				message: `Failed to repair configuration: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	private checkMemoryHealth(): DiagnosticResult {
		try {
			const { SystemGuardrails } = require("@/core/resource/SystemGuardrails")
			const health = SystemGuardrails.getInstance().checkNow()
			return {
				name: "System Memory",
				status: health.memoryOk ? "ok" : "warning",
				message: health.message,
			}
		} catch {
			return {
				name: "System Memory",
				status: "warning",
				message: "Failed to perform memory check",
			}
		}
	}

	private async checkApiTokens(): Promise<DiagnosticResult> {
		try {
			const { StateManager } = await import("@/core/storage/StateManager")
			const config = StateManager.get().getApiConfiguration() as Record<string, unknown>
			const provider = config.actModeApiProvider || config.planModeApiProvider

			if (!provider) {
				return {
					name: "API Tokens",
					status: "warning",
					message: "No provider configured",
				}
			}

			// Simple sanity checks for known providers
			if (provider === "anthropic" && (config.apiKey as string) && !(config.apiKey as string).startsWith("sk-ant-")) {
				return {
					name: "API Tokens",
					status: "warning",
					message: "Anthropic key has unusual format",
					remediation: "Check if your Anthropic API key is correct.",
				}
			}
			if (provider === "openai" && (config.openAiApiKey as string) && !(config.openAiApiKey as string).startsWith("sk-")) {
				return {
					name: "API Tokens",
					status: "warning",
					message: "OpenAI key has unusual format",
					remediation: "Check if your OpenAI API key is correct.",
				}
			}

			return {
				name: "API Tokens",
				status: "ok",
				message: "Configured",
			}
		} catch {
			return {
				name: "API Tokens",
				status: "error",
				message: "Failed to check tokens",
			}
		}
	}
}
