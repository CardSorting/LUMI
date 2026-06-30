import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import AdmZip from "adm-zip"
import { getElectronRebuildArgs } from "./rebuild-electron-better-sqlite3.mjs"
import {
	auditExtensionHealth,
	auditOpenVsxPackaging,
	auditVsixHealth,
	buildDoctorReport,
	detectNativeBinaryTarget,
	discoverVsixFiles,
	extensionHasNativeModule,
	inferVsixTarget,
	nativeTargetForHost,
	pickRepairVsix,
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
	assert.deepEqual(getElectronRebuildArgs("win32", "x64"), ["-v", "39.2.3", "-w", "better-sqlite3", "--arch", "x64"])
	assert.deepEqual(getElectronRebuildArgs("linux", "arm64"), [
		"-v",
		"39.2.3",
		"-w",
		"better-sqlite3",
		"--arch",
		"arm64",
		"--build-from-source",
	])
})

test("nativeTargetForHost maps supported extension hosts", () => {
	assert.equal(nativeTargetForHost("win32", "x64"), "win32-x64")
	assert.equal(nativeTargetForHost("darwin", "arm64"), "darwin-arm64")
	assert.throws(() => nativeTargetForHost("freebsd", "x64"), /Unsupported native extension host/)
})

test("inferVsixTarget rejects universal filenames", () => {
	assert.equal(inferVsixTarget("lumi-2.8.0-win32-x64.vsix"), "win32-x64")
	assert.equal(inferVsixTarget("lumi-2.8.0.vsix"), null)
})

test("detectNativeBinaryTarget identifies PE, ELF, and Mach-O headers", () => {
	const pe = Buffer.alloc(128)
	pe.write("MZ", 0, "ascii")
	pe.writeUInt32LE(64, 0x3c)
	pe.write("PE\0\0", 64, "ascii")
	pe.writeUInt16LE(0x8664, 68)
	assert.equal(detectNativeBinaryTarget(pe), "win32-x64")

	const elf = Buffer.alloc(64)
	Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(elf)
	elf[5] = 1
	elf.writeUInt16LE(0xb7, 18)
	assert.equal(detectNativeBinaryTarget(elf), "linux-arm64")

	const mach = Buffer.alloc(64)
	mach.writeUInt32BE(0xcffaedfe, 0)
	mach.writeUInt32LE(0x0100000c, 4)
	assert.equal(detectNativeBinaryTarget(mach), "darwin-arm64")
})

test("pickRepairVsix only selects the host target", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-repair-picker-"))
	try {
		for (const name of ["lumi-2.8.0-linux-x64.vsix", "lumi-2.8.0-win32-x64.vsix"]) {
			fs.writeFileSync(path.join(tmp, name), "fixture")
		}
		assert.equal(path.basename(pickRepairVsix(tmp, "cardsorting.lumi-2.8.0", "win32-x64")), "lumi-2.8.0-win32-x64.vsix")
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test("discoverVsixFiles exposes universal packages to the failing audit", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-vsix-discovery-"))
	try {
		for (const name of ["lumi-2.8.1.vsix", "lumi-2.8.1-win32-x64.vsix", "lumi-2.8.0.vsix"]) {
			fs.writeFileSync(path.join(tmp, name), "fixture")
		}
		assert.deepEqual(
			discoverVsixFiles(tmp, { version: "2.8.1" }).map((file) => path.basename(file)),
			["lumi-2.8.1-win32-x64.vsix", "lumi-2.8.1.vsix"],
		)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test("auditVsixHealth rejects universal native packages and target mismatches", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-vsix-target-audit-"))
	try {
		const pe = Buffer.alloc(128)
		pe.write("MZ", 0, "ascii")
		pe.writeUInt32LE(64, 0x3c)
		pe.write("PE\0\0", 64, "ascii")
		pe.writeUInt16LE(0x8664, 68)

		for (const name of ["lumi-2.8.1.vsix", "lumi-2.8.1-linux-x64.vsix"]) {
			const zip = new AdmZip()
			for (const pkg of REQUIRED_RUNTIME_PACKAGES) {
				zip.addFile(`extension/node_modules/${pkg}/package.json`, Buffer.from("{}"))
			}
			zip.addFile("extension/node_modules/better-sqlite3/build/Release/better_sqlite3.node", pe)
			zip.writeZip(path.join(tmp, name))

			const targetCheck = auditVsixHealth(path.join(tmp, name)).find((check) => check.id.endsWith(":binary-target"))
			assert.equal(targetCheck?.status, "fail")
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
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

test("vsixHasNativeModule on known good targeted dist VSIX when present", () => {
	const vsixDir = path.join(repoRoot, "dist")
	if (!fs.existsSync(vsixDir)) {
		return
	}
	const vsix = fs
		.readdirSync(vsixDir)
		.filter((f) => f.endsWith(".vsix") && /lumi-(vscode-)?\d+\.\d+\.\d+-(win32|linux|darwin)-(x64|arm64)\.vsix$/.test(f))
		.sort()
		.at(-1)
	if (!vsix) {
		return
	}
	const vsixPath = path.join(vsixDir, vsix)
	assert.equal(vsixHasNativeModule(vsixPath), true)
	const checks = auditVsixHealth(vsixPath)
	assert.equal(summarizeChecks(checks).ok, true)
	assert.equal(checks.find((check) => check.id.endsWith(":binary-target"))?.detail, undefined)
})
