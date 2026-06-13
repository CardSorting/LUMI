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
		const activityLogPath = path.join(this.cwd, ".spider", "activity_log.json")
		if (!fs.existsSync(activityLogPath)) return

		try {
			const stats = await fs.promises.stat(activityLogPath)
			const isRecent = Date.now() - stats.mtimeMs < 1000 * 60 * 30 // Within 30 minutes

			if (!isRecent) return

			const raw = await fs.promises.readFile(activityLogPath, "utf-8")
			const entries: Array<{ type?: string; timestamp?: number; reason?: string }> = JSON.parse(raw)

			if (!Array.isArray(entries)) return

			// Count cooldown events in the last 30 minutes
			const recentWindow = Date.now() - 1000 * 60 * 30
			const recentEntries = entries.filter((e) => (e.timestamp || 0) > recentWindow)
			const cooldownCount = recentEntries.filter(
				(e) => e.type === "cooldown" || e.type === "COOLDOWN" || (e.reason || "").toLowerCase().includes("cooldown"),
			).length
			const writeCount = recentEntries.filter((e) => e.type === "write" || e.type === "WRITE").length

			if (cooldownCount >= 3) {
				issues.push({
					id: "DOC-101",
					category: "STATE",
					severity: "MEDIUM",
					message: `Repeated cooldown events detected (${cooldownCount} in last 30m). The project is under sustained heavy workload.`,
					remediable: true,
					remediationHint:
						"Consider a # STABILITY BREAK to allow structural stabilization. Reduce parallel operations.",
				})
			} else if (writeCount > 50) {
				issues.push({
					id: "DOC-101",
					category: "STATE",
					severity: "LOW",
					message: `High write frequency detected (${writeCount} writes in last 30m). Project is under heavy workload.`,
					remediable: true,
					remediationHint:
						"Pause high-frequency operations or use # STABILITY BREAK to allow structural stabilization.",
				})
			} else if (recentEntries.length > 0) {
				issues.push({
					id: "DOC-101",
					category: "STATE",
					severity: "LOW",
					message: "Write frequency is currently active (normal operation rate). Project is under moderate workload.",
					remediable: true,
					remediationHint: "No action needed. Monitor if write frequency increases significantly.",
				})
			}
		} catch {
			// Non-fatal: log might be malformed or unreadable
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
