#!/usr/bin/env node
/**
 * Native dependency health checks for LUMI packaging, installs, and CI.
 *
 * better-sqlite3 is externalized in esbuild and must ship inside every VSIX /
 * installed extension folder (see .vscodeignore whitelist).
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** Packages required at extension runtime (must match esbuild externals + sqlite chain). */
export const REQUIRED_RUNTIME_PACKAGES = ["better-sqlite3", "bindings", "file-uri-to-path"]

export const VSIX_NATIVE_MODULE_MARKER = "extension/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

export const INSTALLED_NATIVE_MODULE_RELATIVE = "node_modules/better-sqlite3/build/Release/better_sqlite3.node"

export const MIN_NATIVE_BINARY_BYTES = 100_000

export const ELECTRON_VERSION = "39.2.3"

export const DEFAULT_EXTENSION_ROOTS = [
	{ id: "antigravity", label: "Antigravity IDE", dir: path.join(os.homedir(), ".antigravity-ide", "extensions") },
	{ id: "cursor", label: "Cursor", dir: path.join(os.homedir(), ".cursor", "extensions") },
	{ id: "vscode", label: "VS Code", dir: path.join(os.homedir(), ".vscode", "extensions") },
]

export const LUMI_EXTENSION_FOLDER_PATTERN = /(?:cardsorting\.lumi|lumi-vscode|dietcode)/i

/** Paths that trigger Open VSX binary/shell scanners — must not ship in VSIX. */
export const OPENVSX_DENIED_VSIX_MARKERS = [
	"extension/scripts/",
	"extension/test_workspace/",
	"test_extension.node",
	"/deps/download.sh",
	"extension/.dietcode/",
]

/** Required .vscodeignore rules for Open VSX pre-publish hardening. */
export const OPENVSX_VSCODEIGNORE_MARKERS = [
	"scripts/**",
	"test_workspace/**",
	"**/*.sh",
	"!node_modules/better-sqlite3/package.json",
	"!node_modules/better-sqlite3/lib/**",
	"!node_modules/better-sqlite3/build/Release/better_sqlite3.node",
]

/**
 * @typedef {"pass" | "warn" | "fail"} CheckStatus
 * @typedef {{ id: string, status: CheckStatus, title: string, detail?: string, fix?: string[] }} HealthCheck
 */

export function rebuildBetterSqlite3(repoRoot) {
	console.log(`[vsix] rebuilding better-sqlite3 for Electron ${ELECTRON_VERSION}...`)
	execFileSync("npm", ["run", "rebuild:electron:better-sqlite3"], {
		stdio: "inherit",
		cwd: repoRoot,
	})
}

function listVsixEntries(vsixPath) {
	if (!fs.existsSync(vsixPath)) {
		return ""
	}
	return execFileSync("unzip", ["-l", vsixPath], { encoding: "utf8" })
}

function packagePathInVsix(packageName) {
	return `extension/node_modules/${packageName}/package.json`
}

function nativeBinaryPathInExtension(extensionDir) {
	return path.join(extensionDir, INSTALLED_NATIVE_MODULE_RELATIVE)
}

function nativeBinaryPathInVsixListing(listing) {
	return listing.includes(VSIX_NATIVE_MODULE_MARKER)
}

function packagePresentInVsix(listing, packageName) {
	return listing.includes(packagePathInVsix(packageName))
}

function packagePresentInExtension(extensionDir, packageName) {
	return fs.existsSync(path.join(extensionDir, "node_modules", packageName, "package.json"))
}

/**
 * @returns {HealthCheck[]}
 */
export function auditVsixHealth(vsixPath) {
	const checks = []
	const name = path.basename(vsixPath)

	if (!fs.existsSync(vsixPath)) {
		checks.push({
			id: `${name}:exists`,
			status: "fail",
			title: `${name} not found`,
			fix: ["Run: npm run package:vsix:all"],
		})
		return checks
	}

	const listing = listVsixEntries(vsixPath)

	for (const pkg of REQUIRED_RUNTIME_PACKAGES) {
		checks.push({
			id: `${name}:pkg:${pkg}`,
			status: packagePresentInVsix(listing, pkg) ? "pass" : "fail",
			title: `${name} includes ${pkg}`,
			detail: packagePresentInVsix(listing, pkg) ? undefined : "Package missing from VSIX",
			fix: packagePresentInVsix(listing, pkg)
				? undefined
				: ["Re-package with: npm run package:vsix:all", "Do not use vsce --no-dependencies"],
		})
	}

	const hasBinary = nativeBinaryPathInVsixListing(listing)
	checks.push({
		id: `${name}:binary`,
		status: hasBinary ? "pass" : "fail",
		title: `${name} includes SQLite native binary`,
		detail: hasBinary ? undefined : "better_sqlite3.node is missing",
		fix: hasBinary ? undefined : ["Run: npm run package:vsix:openvsx", "Then reinstall the new VSIX"],
	})

	checks.push(...auditOpenVsxPackaging(listing, name))

	return checks
}

/**
 * @param {string} listing
 * @param {string} vsixName
 * @returns {HealthCheck[]}
 */
export function auditOpenVsxPackaging(listing, vsixName = "vsix") {
	/** @type {HealthCheck[]} */
	const checks = []

	for (const marker of OPENVSX_DENIED_VSIX_MARKERS) {
		const hit = listing.includes(marker)
		checks.push({
			id: `${vsixName}:openvsx:${marker}`,
			status: hit ? "fail" : "pass",
			title: hit ? `${vsixName} ships forbidden path (${marker})` : `${vsixName} excludes ${marker}`,
			detail: hit ? "Remove from .vscodeignore allow-list or repackage" : undefined,
			fix: hit ? ["Update .vscodeignore Open VSX hardening rules", "Run: npm run package:vsix:all"] : undefined,
		})
	}

	const shellScripts = (listing.match(/extension\/[^\n]*\.sh/g) ?? []).length
	checks.push({
		id: `${vsixName}:openvsx:shell-scripts`,
		status: shellScripts === 0 ? "pass" : "fail",
		title:
			shellScripts === 0 ? `${vsixName} includes no shell scripts` : `${vsixName} includes ${shellScripts} shell script(s)`,
		fix: shellScripts === 0 ? undefined : ['Ensure "**/*.sh" is in .vscodeignore', "Run: npm run package:vsix:all"],
	})

	return checks
}

/**
 * @returns {HealthCheck[]}
 */
export function verifyOpenVsxVscodeignore(repoRoot) {
	const ignorePath = path.join(repoRoot, ".vscodeignore")
	if (!fs.existsSync(ignorePath)) {
		return [
			{
				id: "openvsx:vscodeignore:missing",
				status: "fail",
				title: ".vscodeignore exists for Open VSX hardening",
				fix: ["Restore .vscodeignore from the repository"],
			},
		]
	}

	const ignore = fs.readFileSync(ignorePath, "utf8")
	/** @type {HealthCheck[]} */
	const checks = []

	for (const marker of OPENVSX_VSCODEIGNORE_MARKERS) {
		checks.push({
			id: `openvsx:vscodeignore:${marker}`,
			status: ignore.includes(marker) ? "pass" : "fail",
			title: `.vscodeignore includes Open VSX rule: ${marker}`,
			detail: ignore.includes(marker) ? undefined : `Add "${marker}" to .vscodeignore`,
			fix: ignore.includes(marker) ? undefined : [`Add "${marker}" to .vscodeignore`],
		})
	}

	return checks
}

/**
 * @returns {HealthCheck[]}
 */
export function auditExtensionHealth(extensionDir, { ideLabel = "Editor" } = {}) {
	const checks = []
	const name = path.basename(extensionDir)
	const display = `${ideLabel} → ${name}`

	for (const pkg of REQUIRED_RUNTIME_PACKAGES) {
		const present = packagePresentInExtension(extensionDir, pkg)
		checks.push({
			id: `${name}:pkg:${pkg}`,
			status: present ? "pass" : "fail",
			title: `${display} has ${pkg}`,
			detail: present ? undefined : "Required package folder is missing",
			fix: present ? undefined : ["Run: npm run doctor -- --fix", "Or reinstall from Extensions → ⋯ → Install from VSIX…"],
		})
	}

	const binaryPath = nativeBinaryPathInExtension(extensionDir)
	let binaryStatus = "fail"
	let binaryDetail = "Native SQLite binary is missing"
	if (fs.existsSync(binaryPath)) {
		const size = fs.statSync(binaryPath).size
		if (size >= MIN_NATIVE_BINARY_BYTES) {
			binaryStatus = "pass"
			binaryDetail = undefined
		} else {
			binaryStatus = "warn"
			binaryDetail = `Binary exists but is unusually small (${size} bytes)`
		}
	}

	checks.push({
		id: `${name}:binary`,
		status: binaryStatus,
		title: `${display} SQLite native binary`,
		detail: binaryDetail,
		fix:
			binaryStatus === "pass"
				? undefined
				: ["Run: npm run doctor -- --fix", "If that fails, delete the extension folder and reinstall from a fresh VSIX"],
	})

	return checks
}

export function vsixHasNativeModule(vsixPath) {
	return auditVsixHealth(vsixPath).every((check) => check.status !== "fail")
}

export function extensionHasNativeModule(extensionDir) {
	return (
		auditExtensionHealth(extensionDir).every((check) => check.status !== "fail") &&
		fs.existsSync(nativeBinaryPathInExtension(extensionDir))
	)
}

export function assertVsixHasNativeModule(vsixPath) {
	const failed = auditVsixHealth(vsixPath).filter((check) => check.status === "fail")
	if (failed.length > 0) {
		throw new Error(`Packaged VSIX failed native dependency checks:\n${failed.map((c) => `  - ${c.title}`).join("\n")}`)
	}
	console.log(`[vsix] verified native dependencies in ${path.basename(vsixPath)}`)
}

export function discoverVsixFiles(distDir, { version } = {}) {
	if (!fs.existsSync(distDir)) {
		return []
	}

	if (version) {
		return [`lumi-vscode-${version}.vsix`, `lumi-${version}.vsix`]
			.map((entry) => path.join(distDir, entry))
			.filter((entry) => fs.existsSync(entry))
	}

	return fs
		.readdirSync(distDir)
		.filter((entry) => entry.endsWith(".vsix") && /^lumi(-vscode)?-\d+\.\d+\.\d+\.vsix$/.test(entry))
		.map((entry) => path.join(distDir, entry))
		.sort((a, b) => a.localeCompare(b))
}

export function discoverLumiExtensions(extensionsRoots = DEFAULT_EXTENSION_ROOTS) {
	const results = []

	for (const root of extensionsRoots) {
		if (!fs.existsSync(root.dir)) {
			continue
		}

		for (const entry of fs.readdirSync(root.dir)) {
			const extensionDir = path.join(root.dir, entry)
			if (!fs.statSync(extensionDir).isDirectory()) {
				continue
			}
			if (!LUMI_EXTENSION_FOLDER_PATTERN.test(entry)) {
				continue
			}
			results.push({
				path: extensionDir,
				name: entry,
				ideId: root.id,
				ideLabel: root.label,
			})
		}
	}

	return results.sort((a, b) => a.name.localeCompare(b.name))
}

export function pickRepairVsix(distDir, extensionFolderName) {
	const candidates = discoverVsixFiles(distDir)
	if (candidates.length === 0) {
		return null
	}

	const lower = extensionFolderName.toLowerCase()
	const openVsx = candidates.find((file) => /[/\\]lumi-\d/.test(file) && !file.includes("lumi-vscode"))
	const marketplace = candidates.find((file) => file.includes("lumi-vscode"))

	if (lower.includes("cardsorting.lumi") || /\.lumi-/.test(lower)) {
		return openVsx ?? marketplace ?? candidates.at(-1)
	}
	return marketplace ?? openVsx ?? candidates.at(-1)
}

export function repairExtensionFromVsix({ extensionDir, vsixPath }) {
	if (!vsixPath || !fs.existsSync(vsixPath)) {
		throw new Error(`No repair VSIX found for ${path.basename(extensionDir)}`)
	}

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-repair-"))
	try {
		execFileSync("unzip", ["-q", vsixPath, "-d", tmpDir], { stdio: "pipe" })
		const extracted = path.join(tmpDir, "extension")
		if (!fs.existsSync(extracted)) {
			throw new Error(`VSIX ${path.basename(vsixPath)} has no extension/ folder`)
		}

		fs.rmSync(extensionDir, { recursive: true, force: true })
		fs.cpSync(extracted, extensionDir, { recursive: true })
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	}

	return vsixPath
}

/**
 * @param {HealthCheck[]} checks
 */
export function summarizeChecks(checks) {
	const pass = checks.filter((c) => c.status === "pass").length
	const warn = checks.filter((c) => c.status === "warn").length
	const fail = checks.filter((c) => c.status === "fail").length
	return { pass, warn, fail, total: checks.length, ok: fail === 0 }
}

const STATUS_ICON = { pass: "✅", warn: "⚠️ ", fail: "❌" }

/**
 * @param {{ title: string, checks: HealthCheck[], summary?: ReturnType<typeof summarizeChecks> }} section
 */
export function printDoctorSection({ title, checks }) {
	console.log(title)
	console.log("─".repeat(title.length))
	if (checks.length === 0) {
		console.log("  (nothing to check)")
		console.log("")
		return summarizeChecks([])
	}

	for (const check of checks) {
		console.log(`  ${STATUS_ICON[check.status]}  ${check.title}`)
		if (check.detail) {
			console.log(`      ${check.detail}`)
		}
	}
	console.log("")
	return summarizeChecks(checks)
}

export function printFixSteps(checks) {
	const failed = checks.filter((c) => c.status !== "pass" && c.fix?.length)
	if (failed.length === 0) {
		return
	}

	console.log("How to fix")
	console.log("──────────")
	let step = 1
	for (const check of failed) {
		console.log(`\n${check.title}:`)
		for (const line of check.fix ?? []) {
			console.log(`  ${step}. ${line}`)
			step++
		}
	}
	console.log("")
}

export function formatGithubActionsAnnotations(checks) {
	const lines = []
	for (const check of checks) {
		if (check.status === "pass") {
			continue
		}
		const level = check.status === "fail" ? "error" : "warning"
		lines.push(`::${level} title=${check.title}::${check.detail ?? check.title}`)
	}
	return lines.join("\n")
}

// Legacy helpers used by older audit entrypoints
export function auditVsixFiles(distDir) {
	return discoverVsixFiles(distDir).map((vsixPath) => ({
		path: vsixPath,
		name: path.basename(vsixPath),
		ok: vsixHasNativeModule(vsixPath),
		checks: auditVsixHealth(vsixPath),
	}))
}

export function auditInstalledExtensions(extensionsRoots) {
	const roots =
		typeof extensionsRoots[0] === "string"
			? extensionsRoots.map((dir) => ({ id: "unknown", label: "Editor", dir }))
			: extensionsRoots

	return discoverLumiExtensions(roots).map((ext) => ({
		path: ext.path,
		name: ext.name,
		ok: extensionHasNativeModule(ext.path),
		hasNodeModules: fs.existsSync(path.join(ext.path, "node_modules")),
		ideLabel: ext.ideLabel,
		checks: auditExtensionHealth(ext.path, { ideLabel: ext.ideLabel }),
	}))
}

export function verifyVscodeignoreWhitelist(repoRoot) {
	const ignorePath = path.join(repoRoot, ".vscodeignore")
	if (!fs.existsSync(ignorePath)) {
		return [
			{
				id: "vscodeignore:missing",
				status: "fail",
				title: ".vscodeignore file exists",
				fix: ["Restore .vscodeignore from the repository"],
			},
		]
	}

	const ignore = fs.readFileSync(ignorePath, "utf8")
	/** @type {HealthCheck[]} */
	const checks = []

	const SQLITE_RUNTIME_MARKERS = [
		"!node_modules/better-sqlite3/package.json",
		"!node_modules/better-sqlite3/lib/**",
		"!node_modules/better-sqlite3/build/Release/better_sqlite3.node",
	]

	for (const pkg of REQUIRED_RUNTIME_PACKAGES) {
		if (pkg === "better-sqlite3") {
			for (const marker of SQLITE_RUNTIME_MARKERS) {
				checks.push({
					id: `vscodeignore:${marker}`,
					status: ignore.includes(marker) ? "pass" : "fail",
					title: `.vscodeignore whitelists better-sqlite3 runtime: ${marker}`,
					detail: ignore.includes(marker) ? undefined : `Expected line: ${marker}`,
					fix: ignore.includes(marker) ? undefined : [`Add "${marker}" to .vscodeignore`],
				})
			}
			continue
		}

		const needle = `!node_modules/${pkg}/**`
		checks.push({
			id: `vscodeignore:${pkg}`,
			status: ignore.includes(needle) ? "pass" : "fail",
			title: `.vscodeignore whitelists ${pkg}`,
			detail: ignore.includes(needle) ? undefined : `Expected line: ${needle}`,
			fix: ignore.includes(needle) ? undefined : [`Add "${needle}" to .vscodeignore`],
		})
	}

	return checks
}

/**
 * Build a structured doctor report (shared by CLI and CI).
 */
export function buildDoctorReport({ repoRoot, distDir, extensionRoots = DEFAULT_EXTENSION_ROOTS, scope = "full" }) {
	const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version
	const configChecks =
		scope === "install" ? [] : [...verifyVscodeignoreWhitelist(repoRoot), ...verifyOpenVsxVscodeignore(repoRoot)]
	const vsixPaths = scope === "install" ? [] : discoverVsixFiles(distDir, { version: pkgVersion })
	const extensions = discoverLumiExtensions(extensionRoots)

	const vsixChecks = vsixPaths.flatMap((vsixPath) => auditVsixHealth(vsixPath))
	const extensionChecks = extensions.flatMap((ext) => auditExtensionHealth(ext.path, { ideLabel: ext.ideLabel }))

	const allChecks = [...configChecks, ...vsixChecks, ...extensionChecks]
	const overall = summarizeChecks(allChecks)

	return {
		ok: overall.ok,
		scope,
		summary: overall,
		packaging: summarizeChecks(vsixChecks),
		installs: summarizeChecks(extensionChecks),
		config: summarizeChecks(configChecks),
		configChecks,
		checks: allChecks,
		vsix: vsixPaths.map((p) => ({ path: p, name: path.basename(p), checks: auditVsixHealth(p) })),
		extensions: extensions.map((ext) => ({
			...ext,
			checks: auditExtensionHealth(ext.path, { ideLabel: ext.ideLabel }),
		})),
	}
}

export function printAuditReport({ vsixResults, extensionResults }) {
	const vsixChecks = vsixResults.flatMap((r) => r.checks ?? [])
	const extensionChecks = extensionResults.flatMap((r) => r.checks ?? [])
	printDoctorSection({ title: "Packaged downloads (dist/*.vsix)", checks: vsixChecks })
	printDoctorSection({ title: "Installed extensions", checks: extensionChecks })
}
