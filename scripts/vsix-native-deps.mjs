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
import AdmZip from "adm-zip"

/** Packages required at extension runtime (must match esbuild externals + sqlite chain). */
export const REQUIRED_RUNTIME_PACKAGES = ["better-sqlite3", "bindings", "file-uri-to-path"]

export const VSIX_NATIVE_MODULE_MARKER = "extension/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

export const INSTALLED_NATIVE_MODULE_RELATIVE = "node_modules/better-sqlite3/build/Release/better_sqlite3.node"

export const MIN_NATIVE_BINARY_BYTES = 100_000

export const ELECTRON_VERSION = "39.2.3"
export const EXPECTED_ELECTRON_ABI = 140

export const NATIVE_VSIX_TARGETS = ["win32-x64", "win32-arm64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]

export function detectBinaryAbi(binaryPath) {
	try {
		execFileSync(process.execPath, ["-e", `require('${binaryPath}')`], { stdio: "pipe" })
		return Number.parseInt(process.versions.modules, 10)
	} catch (error) {
		const stderr = error.stderr?.toString() || error.message || ""
		const match = stderr.match(/NODE_MODULE_VERSION\s+(\d+)/)
		if (match) {
			return Number.parseInt(match[1], 10)
		}
		return null
	}
}

export function detectBinaryBufferAbi(buffer) {
	const tmpPath = path.join(os.tmpdir(), `lumi-abi-check-${Date.now()}-${Math.random().toString(36).slice(2)}.node`)
	try {
		fs.writeFileSync(tmpPath, buffer)
		return detectBinaryAbi(tmpPath)
	} catch {
		return null
	} finally {
		try {
			if (fs.existsSync(tmpPath)) {
				fs.unlinkSync(tmpPath)
			}
		} catch {}
	}
}

const HOST_TARGETS = new Map([
	["win32:x64", "win32-x64"],
	["win32:arm64", "win32-arm64"],
	["linux:x64", "linux-x64"],
	["linux:arm64", "linux-arm64"],
	["darwin:x64", "darwin-x64"],
	["darwin:arm64", "darwin-arm64"],
])

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
	execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "rebuild:electron:better-sqlite3"], {
		stdio: "inherit",
		cwd: repoRoot,
	})
}

function listVsixEntries(vsixPath) {
	if (!fs.existsSync(vsixPath)) {
		return ""
	}
	return new AdmZip(vsixPath)
		.getEntries()
		.map((entry) => entry.entryName)
		.join("\n")
}

function readVsixNativeBinary(vsixPath) {
	if (!fs.existsSync(vsixPath)) {
		return null
	}
	try {
		return new AdmZip(vsixPath).getEntry(VSIX_NATIVE_MODULE_MARKER)?.getData() ?? null
	} catch {
		return null
	}
}

export function nativeTargetForHost(platform = process.platform, arch = process.arch) {
	const target = HOST_TARGETS.get(`${platform}:${arch}`)
	if (!target) {
		throw new Error(`Unsupported native extension host: ${platform}-${arch}`)
	}
	return target
}

export function inferVsixTarget(vsixPath) {
	const name = path.basename(vsixPath, ".vsix")
	return NATIVE_VSIX_TARGETS.find((target) => name.endsWith(`-${target}`)) ?? null
}

/**
 * Identify the operating system and CPU encoded in a native Node module.
 * This intentionally validates file headers rather than trusting the build host.
 */
export function detectNativeBinaryTarget(binary) {
	if (!Buffer.isBuffer(binary) || binary.length < 64) {
		return null
	}

	// Portable Executable (Windows): DOS header -> PE signature -> machine.
	if (binary[0] === 0x4d && binary[1] === 0x5a) {
		const peOffset = binary.readUInt32LE(0x3c)
		if (peOffset + 6 > binary.length || binary.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
			return null
		}
		const machine = binary.readUInt16LE(peOffset + 4)
		if (machine === 0x8664) return "win32-x64"
		if (machine === 0xaa64) return "win32-arm64"
		return null
	}

	// ELF (Linux): e_machine follows the common 16-byte identification block.
	if (binary.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
		const machine = binary[5] === 2 ? binary.readUInt16BE(18) : binary.readUInt16LE(18)
		if (machine === 0x3e) return "linux-x64"
		if (machine === 0xb7) return "linux-arm64"
		return null
	}

	// 64-bit Mach-O (macOS). Native modules are expected to be thin binaries.
	const magic = binary.readUInt32BE(0)
	if (magic === 0xcffaedfe || magic === 0xfeedfacf) {
		const littleEndian = magic === 0xcffaedfe
		const cpuType = littleEndian ? binary.readUInt32LE(4) : binary.readUInt32BE(4)
		if (cpuType === 0x01000007) return "darwin-x64"
		if (cpuType === 0x0100000c) return "darwin-arm64"
	}

	return null
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

	const declaredTarget = inferVsixTarget(vsixPath)
	const binaryTarget = hasBinary ? detectNativeBinaryTarget(readVsixNativeBinary(vsixPath)) : null
	checks.push({
		id: `${name}:binary-target`,
		status: declaredTarget && binaryTarget === declaredTarget ? "pass" : "fail",
		title:
			declaredTarget && binaryTarget === declaredTarget
				? `${name} native binary matches ${declaredTarget}`
				: `${name} native binary target is valid`,
		detail:
			declaredTarget && binaryTarget === declaredTarget
				? undefined
				: !declaredTarget
					? "A VSIX containing native code cannot be published as universal"
					: binaryTarget
						? `VSIX declares ${declaredTarget}, but better_sqlite3.node is ${binaryTarget}`
						: "Could not identify the better_sqlite3.node platform/architecture",
		fix:
			declaredTarget && binaryTarget === declaredTarget
				? undefined
				: ["Package on the matching operating system with: npm run package:vsix:all"],
	})

	let abiStatus = "fail"
	let abiDetail = "Could not verify binary ABI version"
	if (hasBinary) {
		const binaryBuffer = readVsixNativeBinary(vsixPath)
		if (binaryBuffer) {
			const actualAbi = detectBinaryBufferAbi(binaryBuffer)
			if (actualAbi === EXPECTED_ELECTRON_ABI) {
				abiStatus = "pass"
				abiDetail = undefined
			} else {
				abiDetail = `Expected Electron ABI ${EXPECTED_ELECTRON_ABI}, but found ABI ${actualAbi ?? "unknown"}`
			}
		}
	}
	checks.push({
		id: `${name}:binary-abi`,
		status: abiStatus,
		title: `${name} SQLite native binary matches Electron ABI ${EXPECTED_ELECTRON_ABI}`,
		detail: abiDetail,
		fix: abiStatus === "pass" ? undefined : ["Run: npm run rebuild:electron:better-sqlite3", "Then re-package the VSIX"],
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
			const expectedTarget = nativeTargetForHost()
			const actualTarget = detectNativeBinaryTarget(fs.readFileSync(binaryPath))
			if (actualTarget === expectedTarget) {
				const actualAbi = detectBinaryAbi(binaryPath)
				if (actualAbi === EXPECTED_ELECTRON_ABI) {
					binaryStatus = "pass"
					binaryDetail = undefined
				} else {
					binaryStatus = "fail"
					binaryDetail = `Platform matches (${actualTarget}), but ABI is ${actualAbi ?? "unknown"} (expected Electron ABI ${EXPECTED_ELECTRON_ABI})`
				}
			} else {
				binaryDetail = actualTarget
					? `Expected ${expectedTarget}, but installed binary is ${actualTarget}`
					: `Expected ${expectedTarget}, but the binary format is unrecognized`
			}
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
		return fs
			.readdirSync(distDir)
			.filter((entry) => {
				const universal = entry === `lumi-vscode-${version}.vsix` || entry === `lumi-${version}.vsix`
				const targeted = entry.startsWith(`lumi-vscode-${version}-`) || entry.startsWith(`lumi-${version}-`)
				return entry.endsWith(".vsix") && (universal || (targeted && inferVsixTarget(entry) !== null))
			})
			.map((entry) => path.join(distDir, entry))
			.sort((a, b) => a.localeCompare(b))
	}

	return fs
		.readdirSync(distDir)
		.filter(
			(entry) =>
				entry.endsWith(".vsix") &&
				/^lumi(-vscode)?-\d+\.\d+\.\d+(?:-(win32|linux|darwin)-(x64|arm64))?\.vsix$/.test(entry),
		)
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

export function pickRepairVsix(distDir, extensionFolderName, target = nativeTargetForHost()) {
	const versionMatch = extensionFolderName.match(/-(\d+\.\d+\.\d+(?:-universal)?)$/)
	const version = versionMatch ? versionMatch[1].replace("-universal", "") : null

	let candidates = discoverVsixFiles(distDir).filter((file) => inferVsixTarget(file) === target)
	if (candidates.length === 0) {
		return null
	}

	if (version) {
		const versionCandidates = candidates.filter((file) => path.basename(file).includes(`-${version}`))
		if (versionCandidates.length > 0) {
			candidates = versionCandidates
		}
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
	const expectedTarget = nativeTargetForHost()
	const actualTarget = inferVsixTarget(vsixPath)
	if (actualTarget !== expectedTarget) {
		throw new Error(`Cannot install ${actualTarget ?? "universal"} VSIX on ${expectedTarget}`)
	}

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-repair-"))
	try {
		new AdmZip(vsixPath).extractAllTo(tmpDir, true)
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
