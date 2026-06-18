import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
	auditExtensionHealth,
	auditVsixHealth,
	buildDoctorReport,
	extensionHasNativeModule,
	REQUIRED_RUNTIME_PACKAGES,
	summarizeChecks,
	verifyVscodeignoreWhitelist,
	vsixHasNativeModule,
} from "./vsix-native-deps.mjs"

const repoRoot = path.join(import.meta.dirname, "..")

test("REQUIRED_RUNTIME_PACKAGES matches esbuild externals chain", () => {
	assert.deepEqual(REQUIRED_RUNTIME_PACKAGES, ["better-sqlite3", "bindings", "file-uri-to-path"])
})

test("verifyVscodeignoreWhitelist passes on this repo", () => {
	const checks = verifyVscodeignoreWhitelist(repoRoot)
	assert.equal(summarizeChecks(checks).ok, true)
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
	const vsix = fs.readdirSync(vsixDir).find((f) => f.endsWith(".vsix") && f.includes("lumi"))
	if (!vsix) {
		return
	}
	const vsixPath = path.join(vsixDir, vsix)
	assert.equal(vsixHasNativeModule(vsixPath), true)
	assert.equal(summarizeChecks(auditVsixHealth(vsixPath)).ok, true)
})
