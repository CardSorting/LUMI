import * as fs from "fs"
import * as path from "path"

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
 * StabilityDoctor: Performs deep environment-level health checks.
 * Ensures the environment for JoyZoning is stable.
 */
export class StabilityDoctor {
	constructor(private cwd: string) {}

	/**
	 * Performs a full diagnostic scan.
	 */
	public async diagnose(): Promise<DoctorReport> {
		const issues: DiagnosticIssue[] = []

		await this.checkStaleLocks(issues)
		await this.checkProjectIntegrity(issues)
		await this.checkMcpStability(issues)
		await this.checkActivitySaturation(issues)
		await this.checkDiagnosticCacheBloat(issues)

		return {
			healthy: issues.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH").length === 0,
			issues,
			timestamp: Date.now(),
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
							remediationHint: "Delete the stale lock file to unlock resources.",
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
					remediationHint: "The project structure is damaged. Restore the configuration file.",
				})
			}
		}
	}

	private async checkMcpStability(issues: DiagnosticIssue[]) {
		// Example: check for MCP settings file
		const settingsPath = path.join(this.cwd, ".vscode", "dietcode_mcp_settings.json")
		if (fs.existsSync(settingsPath)) {
			try {
				const content = await fs.promises.readFile(settingsPath, "utf-8")
				JSON.parse(content)
			} catch (_e) {
				issues.push({
					id: "DOC-003",
					category: "STATE",
					severity: "MEDIUM",
					message: "MCP settings file is corrupted (invalid JSON).",
					remediable: true,
					remediationHint: "Reset or repair the MCP settings JSON manually.",
				})
			}
		}
	}

	private async checkActivitySaturation(issues: DiagnosticIssue[]) {
		// V140: Sensing 'High-Velocity Fatigue'
		if (fs.existsSync(path.join(this.cwd, ".spider", "activity_log.json"))) {
			// In a full implementation, we would parse the log to find repeated cooldowns
			// For now, we audit the existence of the activity log
			const stats = await fs.promises.stat(path.join(this.cwd, ".spider", "activity_log.json"))
			if (Date.now() - stats.mtimeMs < 1000 * 60 * 30) {
				// High-Velocity: Increase window to 30m
				issues.push({
					id: "DOC-101",
					category: "STATE",
					severity: "LOW",
					message: "Write frequency is currently high (high operation rate). Project is under heavy workload.",
					remediable: true,
					remediationHint:
						"Pause high-frequency operations or use # STABILITY BREAK to allow structural stabilization.",
				})
			}
		}
	}

	private async checkDiagnosticCacheBloat(issues: DiagnosticIssue[]) {
		const cachePath = path.join(this.cwd, ".spider", "anomaly_registry.json")
		if (fs.existsSync(cachePath)) {
			const stats = await fs.promises.stat(cachePath)
			if (stats.size > 1024 * 1024 * 5) {
				// Silent High-Velocity: > 5MB of anomalies
				issues.push({
					id: "DOC-102",
					category: "STATE",
					severity: "MEDIUM",
					message: "Diagnostic history cache (AnomalyRegistry) is bloating (large state file).",
					remediable: true,
					remediationHint: "Run 'DietCode: Audit Cache' to prune stale data.",
				})
			}
		}
	}
}
