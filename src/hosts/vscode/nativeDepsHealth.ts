import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import * as vscode from "vscode"

export const REQUIRED_PACKAGES = ["better-sqlite3", "bindings", "file-uri-to-path"] as const

export const TROUBLESHOOTING_URL = "https://docs.dietcode.io/troubleshooting/extension-wont-start"

export const HEALTH_OUTPUT_CHANNEL_NAME = "LUMI Health"

export type HealthStatus = "pass" | "warn" | "fail"

export type InstallationHealthCheck = {
	id: string
	status: HealthStatus
	title: string
	detail?: string
	fix?: string[]
}

export type NativeDepsHealthResult = {
	ok: boolean
	missingPackages: string[]
	loadError?: string
}

const MIN_NATIVE_BINARY_BYTES = 100_000

const STATUS_LABEL: Record<HealthStatus, string> = {
	pass: "OK",
	warn: "WARN",
	fail: "FAIL",
}

let healthOutputChannel: vscode.OutputChannel | undefined

export function getHealthOutputChannel(): vscode.OutputChannel {
	if (!healthOutputChannel) {
		healthOutputChannel = vscode.window.createOutputChannel(HEALTH_OUTPUT_CHANNEL_NAME)
	}
	return healthOutputChannel
}

export function registerHealthOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	const channel = getHealthOutputChannel()
	context.subscriptions.push(channel)
	return channel
}

export function checkExtensionNativeDeps(extensionPath: string): NativeDepsHealthResult {
	const extensionRequire = createRequire(path.join(extensionPath, "package.json"))
	const missingPackages: string[] = []

	for (const packageName of REQUIRED_PACKAGES) {
		try {
			extensionRequire.resolve(packageName, { paths: [extensionPath] })
		} catch {
			missingPackages.push(packageName)
		}
	}

	if (missingPackages.length > 0) {
		return { ok: false, missingPackages }
	}

	try {
		extensionRequire(extensionRequire.resolve("better-sqlite3", { paths: [extensionPath] }))
		return { ok: true, missingPackages: [] }
	} catch (error) {
		return {
			ok: false,
			missingPackages,
			loadError: error instanceof Error ? error.message : String(error),
		}
	}
}

export function auditCurrentInstallation(extensionPath: string): InstallationHealthCheck[] {
	const checks: InstallationHealthCheck[] = []
	const extensionRequire = createRequire(path.join(extensionPath, "package.json"))

	for (const packageName of REQUIRED_PACKAGES) {
		let status: HealthStatus = "fail"
		let detail: string | undefined = "Not found in this extension folder"
		try {
			extensionRequire.resolve(packageName, { paths: [extensionPath] })
			status = "pass"
			detail = undefined
		} catch {
			// keep fail
		}
		checks.push({
			id: `pkg:${packageName}`,
			status,
			title: `Database dependency: ${packageName}`,
			detail,
			fix:
				status === "pass"
					? undefined
					: ["Open Extensions → ⋯ → Install from VSIX… and pick a fresh LUMI download", `See: ${TROUBLESHOOTING_URL}`],
		})
	}

	const binaryPath = path.join(extensionPath, "node_modules/better-sqlite3/build/Release/better_sqlite3.node")
	let binaryStatus: HealthStatus = "fail"
	let binaryDetail = "Native SQLite driver file is missing"
	if (fs.existsSync(binaryPath)) {
		const size = fs.statSync(binaryPath).size
		if (size >= MIN_NATIVE_BINARY_BYTES) {
			binaryStatus = "pass"
			binaryDetail = `Found (${Math.round(size / 1024)} KB)`
		} else {
			binaryStatus = "warn"
			binaryDetail = `File exists but looks too small (${size} bytes)`
		}
	}

	checks.push({
		id: "binary",
		status: binaryStatus,
		title: "SQLite native driver (better_sqlite3.node)",
		detail: binaryDetail,
		fix:
			binaryStatus === "pass"
				? undefined
				: ["Reinstall LUMI from a VSIX file (see troubleshooting guide)", "If you build from source: npm run doctor:fix"],
	})

	const loadResult = checkExtensionNativeDeps(extensionPath)
	checks.push({
		id: "load",
		status: loadResult.ok ? "pass" : "fail",
		title: "Database driver loads successfully",
		detail: loadResult.ok ? undefined : (loadResult.loadError ?? "Module could not be loaded"),
		fix: loadResult.ok ? undefined : ["Reinstall LUMI using Install from VSIX…", `Guide: ${TROUBLESHOOTING_URL}`],
	})

	const nodeModulesPath = path.join(extensionPath, "node_modules")
	checks.push({
		id: "node_modules",
		status: fs.existsSync(nodeModulesPath) ? "pass" : "fail",
		title: "Extension includes node_modules",
		detail: fs.existsSync(nodeModulesPath) ? undefined : "Install appears incomplete (common with broken Open VSX builds)",
		fix: fs.existsSync(nodeModulesPath) ? undefined : ["Install from VSIX instead of a broken marketplace copy"],
	})

	return checks
}

export function summarizeInstallationChecks(checks: InstallationHealthCheck[]) {
	const pass = checks.filter((c) => c.status === "pass").length
	const warn = checks.filter((c) => c.status === "warn").length
	const fail = checks.filter((c) => c.status === "fail").length
	return { pass, warn, fail, total: checks.length, ok: fail === 0 }
}

export function formatInstallationHealthReport({
	checks,
	extensionPath,
	extensionVersion,
	hostName,
	hostVersion,
}: {
	checks: InstallationHealthCheck[]
	extensionPath: string
	extensionVersion: string
	hostName: string
	hostVersion: string
}): string {
	const summary = summarizeInstallationChecks(checks)
	const lines = [
		"LUMI Installation Health Check",
		"==============================",
		"",
		`Editor:     ${hostName} ${hostVersion}`,
		`Extension:  ${extensionVersion}`,
		`Location:   ${extensionPath}`,
		"",
		"Checks",
		"------",
	]

	for (const check of checks) {
		lines.push(`[${STATUS_LABEL[check.status]}] ${check.title}`)
		if (check.detail) {
			lines.push(`       ${check.detail}`)
		}
	}

	lines.push("")
	lines.push(
		`Summary: ${summary.ok ? "Healthy" : "Needs attention"} — ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed`,
	)

	if (!summary.ok) {
		lines.push("")
		lines.push("Recommended next steps")
		lines.push("----------------------")
		let step = 1
		for (const check of checks) {
			if (check.status === "pass" || !check.fix?.length) {
				continue
			}
			for (const fix of check.fix) {
				lines.push(`${step}. ${fix}`)
				step++
			}
		}
	}

	lines.push("")
	lines.push(`Help: ${TROUBLESHOOTING_URL}`)
	return lines.join("\n")
}

export async function runInstallationHealthCheck(context: vscode.ExtensionContext): Promise<boolean> {
	const channel = getHealthOutputChannel()
	const checks = auditCurrentInstallation(context.extensionPath)
	const summary = summarizeInstallationChecks(checks)
	const hostVersion = vscode.version
	const hostName = vscode.env.appName || "VS Code compatible editor"

	const report = formatInstallationHealthReport({
		checks,
		extensionPath: context.extensionPath,
		extensionVersion: context.extension.packageJSON.version ?? "unknown",
		hostName,
		hostVersion,
	})

	channel.clear()
	channel.appendLine(report)
	channel.show(true)

	if (summary.ok && summary.warn === 0) {
		const choice = await vscode.window.showInformationMessage(
			"LUMI installation looks healthy. See the LUMI Health panel for details.",
			"Open guide",
		)
		if (choice === "Open guide") {
			await vscode.env.openExternal(vscode.Uri.parse(TROUBLESHOOTING_URL))
		}
		return true
	}

	const choice = await vscode.window.showWarningMessage(
		summary.fail > 0
			? "LUMI found problems with this installation. See the LUMI Health panel for step-by-step fixes."
			: "LUMI found minor installation warnings. See the LUMI Health panel for details.",
		"How to fix",
		"Copy report",
	)

	if (choice === "How to fix") {
		await vscode.env.openExternal(vscode.Uri.parse(TROUBLESHOOTING_URL))
	}

	if (choice === "Copy report") {
		await vscode.env.clipboard.writeText(report)
		void vscode.window.showInformationMessage("Health report copied to clipboard.")
	}

	return summary.ok
}

export async function showNativeDepsFailure(result: NativeDepsHealthResult): Promise<void> {
	const missingSummary =
		result.missingPackages.length > 0 ? result.missingPackages.join(", ") : "better-sqlite3 (database driver)"

	const detail = result.loadError ? `\n\nTechnical detail: ${result.loadError}` : ""

	const choice = await vscode.window.showErrorMessage(
		`LUMI could not start because a required component is missing (${missingSummary}). ` +
			"This usually means the extension install is incomplete — common with some Open VSX downloads." +
			detail,
		"How to fix",
		"Copy details",
	)

	if (choice === "How to fix") {
		await vscode.env.openExternal(vscode.Uri.parse(TROUBLESHOOTING_URL))
	}

	if (choice === "Copy details") {
		const text = [
			"LUMI native dependency check failed",
			`Missing: ${missingSummary}`,
			result.loadError ? `Error: ${result.loadError}` : "",
			`Help: ${TROUBLESHOOTING_URL}`,
			"Maintainer fix: npm run doctor:fix",
		]
			.filter(Boolean)
			.join("\n")
		await vscode.env.clipboard.writeText(text)
		void vscode.window.showInformationMessage("Error details copied to clipboard.")
	}
}

export function nativeDepsFailureMessage(result: NativeDepsHealthResult): string {
	const missing = result.missingPackages.length > 0 ? result.missingPackages.join(", ") : "better-sqlite3"
	return `LUMI native dependency check failed (missing: ${missing})`
}
