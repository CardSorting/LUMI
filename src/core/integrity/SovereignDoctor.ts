import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface DiagnosticIssue {
	id: string
	category: "INFRASTRUCTURE" | "CONFIG" | "STATE"
	severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
	message: string
	remediable: boolean
	remediationHint?: string
}

export interface DoctorReport {
	healthy: boolean
	issues: DiagnosticIssue[]
	timestamp: number
}

/**
 * SovereignDoctor: Performs deep environment-level health checks.
 * Ensures the substrate for JoyZoning is stable.
 */
export class SovereignDoctor {
	constructor(private cwd: string) {}

	/**
	 * Performs a full diagnostic scan.
	 */
	public async diagnose(): Promise<DoctorReport> {
		const issues: DiagnosticIssue[] = []

		await this.checkStaleLocks(issues)
		await this.checkProjectIntegrity(issues)
		await this.checkMcpStability(issues)

		return {
			healthy: issues.filter(i => i.severity === "CRITICAL" || i.severity === "HIGH").length === 0,
			issues,
			timestamp: Date.now()
		}
	}

	private async checkStaleLocks(issues: DiagnosticIssue[]) {
		try {
			// Scan for any residual lock files in root
			const files = await fs.promises.readdir(this.cwd)
			for (const file of files) {
				if (file.endsWith(".lock")) {
					const stats = await fs.promises.stat(path.join(this.cwd, file))
					const ageMinutes = (Date.now() - stats.mtimeMs) / (1000 * 60)
					
					if (ageMinutes > 15) {
						issues.push({
							id: "DOC-001",
							category: "INFRASTRUCTURE",
							severity: "MEDIUM",
							message: `Stale lock file detected: ${file} (Age: ${Math.round(ageMinutes)}m)`,
							remediable: true,
							remediationHint: "Delete the stale lock file to unlock resources."
						})
					}
				}
			}
		} catch {
			// Ignore
		}
	}

	private async checkProjectIntegrity(issues: DiagnosticIssue[]) {
		const criticalFiles = ["package.json", "tsconfig.json"]
		for (const file of criticalFiles) {
			if (!fs.existsSync(path.join(this.cwd, file))) {
				issues.push({
					id: "DOC-002",
					category: "CONFIG",
					severity: "HIGH",
					message: `Critical project configuration file missing: ${file}`,
					remediable: false,
					remediationHint: "The project structure is damaged. Restore the configuration file."
				})
			}
		}
	}

	private async checkMcpStability(issues: DiagnosticIssue[]) {
		// Example: check for MCP settings file
		const settingsPath = path.join(this.cwd, ".vscode", "codemarie_mcp_settings.json")
		if (fs.existsSync(settingsPath)) {
			try {
				const content = await fs.promises.readFile(settingsPath, "utf-8")
				JSON.parse(content)
			} catch (e) {
				issues.push({
					id: "DOC-003",
					category: "STATE",
					severity: "MEDIUM",
					message: "MCP settings file is corrupted (invalid JSON).",
					remediable: true,
					remediationHint: "Reset or repair the MCP settings JSON manually."
				})
			}
		}
	}
}
