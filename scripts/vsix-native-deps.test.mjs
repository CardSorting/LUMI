import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { getElectronRebuildArgs } from "./rebuild-electron-better-sqlite3.mjs"
import {
	auditExtensionHealth,
	auditOpenVsxPackaging,
	auditVsixHealth,
	buildDoctorReport,
	extensionHasNativeModule,
	REQUIRED_RUNTIME_PACKAGES,
	summarizeChecks,
	verifyOpenVsxVscodeignore,
	verifyVscodeignoreWhitelist,
	vsixHasNativeModule,
} from "./vsix-native-deps.mjs"

const repoRoot = path.join(import.meta.dirname, "..")

test("REQUIRED_RUNTIME_PACKAGES matches esbuild externals chain", () => {
	assert.deepEqual(REQUIRED_RUNTIME_PACKAGES, ["better-sqlite3", "bindings", "file-uri-to-path"])
})

test("getElectronRebuildArgs skips --build-from-source on Windows", () => {
	assert.deepEqual(getElectronRebuildArgs("win32"), ["-v", "39.2.3", "-w", "better-sqlite3"])
	assert.deepEqual(getElectronRebuildArgs("linux"), ["-v", "39.2.3", "-w", "better-sqlite3", "--build-from-source"])
})

test("verifyVscodeignoreWhitelist passes on this repo", () => {
	const checks = verifyVscodeignoreWhitelist(repoRoot)
	assert.equal(summarizeChecks(checks).ok, true)
})

test("verifyOpenVsxVscodeignore passes on this repo", () => {
	const checks = verifyOpenVsxVscodeignore(repoRoot)
	assert.equal(summarizeChecks(checks).ok, true)
})

test("auditOpenVsxPackaging flags shell scripts in listing", () => {
	const listing = "extension/scripts/proto-lint.sh\nextension/dist/extension.js\n"
	const checks = auditOpenVsxPackaging(listing, "sample.vsix")
	assert.equal(summarizeChecks(checks).ok, false)
})

test("buildDoctorReport full scope includes config checks", () => {
	const report = buildDoctorReport({ repoRoot, distDir: path.join(repoRoot, "dist"), scope: "full" })
	assert.ok(report.configChecks.length >= 3)
	assert.equal(typeof report.ok, "boolean")
})

test("buildDoctorReport install scope skips packaging", () => {
	const report = buildDoctorReport({ repoRoot, distDir: path.join(repoRoot, "dist"), scope: "install" })
	assert.equal(report.configChecks.length, 0)
	assert.equal(report.vsix.length, 0)
})

test("auditExtensionHealth detects missing node_modules", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-doctor-test-"))
	try {
		const checks = auditExtensionHealth(tmp, { ideLabel: "Test" })
		assert.equal(summarizeChecks(checks).ok, false)
		assert.equal(extensionHasNativeModule(tmp), false)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test("vsixHasNativeModule on known good dist VSIX when present", () => {
	const vsixDir = path.join(repoRoot, "dist")
	if (!fs.existsSync(vsixDir)) {
		return
	}
	const vsix = fs
		.readdirSync(vsixDir)
		.filter((f) => f.endsWith(".vsix") && /lumi-(vscode-)?\d+\.\d+\.\d+\.vsix$/.test(f))
		.sort()
		.at(-1)
	if (!vsix) {
		return
	}
	const vsixPath = path.join(vsixDir, vsix)
	assert.equal(vsixHasNativeModule(vsixPath), true)
	assert.equal(summarizeChecks(auditVsixHealth(vsixPath)).ok, true)
})
