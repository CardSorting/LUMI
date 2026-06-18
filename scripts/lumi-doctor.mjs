#!/usr/bin/env node
/**
 * LUMI Doctor — health check for native database dependencies.
 *
 * Familiar "doctor" pattern (like `brew doctor` / `npm doctor`):
 *   npm run doctor                    # full scan
 *   npm run doctor -- --install-only  # installed extensions only (end users)
 *   npm run doctor:fix                # repair broken installs from dist/*.vsix
 *   npm run doctor -- --ci            # exit 1 on failure (CI)
 *   npm run doctor -- --json          # machine-readable output
 *
 * In the editor (non-technical users):
 *   Command Palette → "LUMI: Check Installation (Health Check)"
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
	auditInstalledExtensions,
	auditVsixFiles,
	buildDoctorReport,
	DEFAULT_EXTENSION_ROOTS,
	formatGithubActionsAnnotations,
	pickRepairVsix,
	printDoctorSection,
	printFixSteps,
	repairExtensionFromVsix,
} from "./vsix-native-deps.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const distDir = path.join(repoRoot, "dist")

const flags = new Set(process.argv.slice(2))
const ciMode = flags.has("--ci")
const jsonMode = flags.has("--json")
const deleteBroken = flags.has("--delete-broken")
const fixMode = flags.has("--fix") || flags.has("--repair")
const installOnly = flags.has("--install-only")

function logHeader() {
	if (jsonMode) {
		return
	}
	console.log("")
	console.log("LUMI Doctor")
	console.log("===========")
	console.log("Checks that LUMI's local database (SQLite) shipped correctly.")
	if (installOnly) {
		console.log("(Install-only mode — checking editors on this machine)")
	}
	console.log("")
	console.log('Tip: In your editor, run Command Palette → "LUMI: Check Installation"')
	console.log("")
}

function printHumanReport(report) {
	const configChecks = report.configChecks ?? []
	const vsixChecks = report.vsix.flatMap((v) => v.checks)
	const extensionChecks = report.extensions.flatMap((e) => e.checks)

	logHeader()

	if (!installOnly) {
		printDoctorSection({ title: "Packaging configuration", checks: configChecks })
	}

	if (installOnly || vsixChecks.length > 0) {
		if (vsixChecks.length === 0 && !installOnly) {
			printDoctorSection({
				title: "Packaged downloads (dist/*.vsix)",
				checks: [
					{
						id: "dist:empty",
						status: "warn",
						title: "No VSIX files in dist/",
						detail: "Fine for end users; maintainers run npm run package:vsix:all",
						fix: ["Run: npm run package:vsix:all"],
					},
				],
			})
		} else if (!installOnly) {
			printDoctorSection({ title: "Packaged downloads (dist/*.vsix)", checks: vsixChecks })
		}
	}

	if (extensionChecks.length === 0) {
		printDoctorSection({
			title: "Installed extensions",
			checks: [
				{
					id: "install:none",
					status: "warn",
					title: "No LUMI installs detected",
					detail: "Checked Antigravity, Cursor, and VS Code extension folders",
				},
			],
		})
	} else {
		printDoctorSection({ title: "Installed extensions", checks: extensionChecks })
	}

	console.log("Summary")
	console.log("───────")
	const icon = report.ok ? "✅" : "❌"
	console.log(`  ${icon}  ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed`)
	console.log("")

	if (!report.ok) {
		printFixSteps(report.checks)
		if (!fixMode && !deleteBroken) {
			console.log("Quick repair:  npm run doctor:fix")
			console.log("In editor:     Command Palette → LUMI: Check Installation")
			console.log("")
		}
	} else if (!ciMode) {
		console.log("All checks passed. LUMI's database components look healthy.")
		console.log("")
	}
}

function runDoctor() {
	const report = buildDoctorReport({
		repoRoot,
		distDir,
		extensionRoots: DEFAULT_EXTENSION_ROOTS,
		scope: installOnly ? "install" : "full",
	})

	if (jsonMode) {
		console.log(JSON.stringify(report, null, 2))
		return report
	}

	printHumanReport(report)
	return report
}

function applyFixes(report) {
	const brokenExtensions = report.extensions.filter((ext) => ext.checks.some((check) => check.status === "fail"))

	if (brokenExtensions.length === 0) {
		console.log("Nothing to repair — all installed extensions passed.")
		return
	}

	for (const ext of brokenExtensions) {
		const vsixPath = pickRepairVsix(distDir, ext.name)
		if (!vsixPath) {
			console.error(`[doctor] cannot repair ${ext.name}: build a VSIX first (npm run package:vsix:all)`)
			process.exitCode = 1
			continue
		}

		repairExtensionFromVsix({ extensionDir: ext.path, vsixPath })
		console.log(`[doctor] repaired ${ext.ideLabel} → ${ext.name}`)
		console.log(`           using ${path.basename(vsixPath)}`)
		console.log("           Reload your editor (Developer: Reload Window).")
	}
}

function applyDeletes() {
	const vsixResults = auditVsixFiles(distDir)
	const extensionResults = auditInstalledExtensions(DEFAULT_EXTENSION_ROOTS)

	for (const result of vsixResults.filter((r) => !r.ok)) {
		fs.rmSync(result.path, { force: true })
		console.log(`[doctor] deleted broken VSIX: ${result.name}`)
	}

	for (const result of extensionResults.filter((r) => !r.ok)) {
		fs.rmSync(result.path, { recursive: true, force: true })
		console.log(`[doctor] deleted broken extension: ${result.name}`)
	}
}

function main() {
	const report = runDoctor()

	if (ciMode && !report.ok) {
		const annotations = formatGithubActionsAnnotations(report.checks)
		if (annotations) {
			console.error(annotations)
		}
		process.exitCode = 1
	}

	if (fixMode && !jsonMode) {
		console.log("Repair")
		console.log("──────")
		applyFixes(report)
		if (!ciMode) {
			const after = runDoctor()
			if (!after.ok) {
				process.exitCode = 1
			}
		}
	}

	if (deleteBroken) {
		applyDeletes()
	}
}

main()
