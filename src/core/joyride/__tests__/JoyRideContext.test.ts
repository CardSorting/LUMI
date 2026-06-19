/**
 * [LAYER: CORE]
 * Workspace snapshot fingerprint tests.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assert } from "chai"
import { buildJoyRideWorkspaceSnapshot } from "../JoyRideContext"

describe("JoyRideContext snapshots", () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "joyride-snap-"))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("should change dependency fingerprint when package.json changes", async () => {
		const pkgPath = path.join(tmpDir, "package.json")
		fs.writeFileSync(pkgPath, '{"name":"a"}')
		const snap1 = await buildJoyRideWorkspaceSnapshot(tmpDir, "vscodeTerminal")
		fs.writeFileSync(pkgPath, '{"name":"b","version":"2.0.0"}')
		const snap2 = await buildJoyRideWorkspaceSnapshot(tmpDir, "vscodeTerminal")
		assert.notEqual(snap1.dependencyFingerprint, snap2.dependencyFingerprint)
	})

	it("should change lockfile fingerprint when package-lock.json appears", async () => {
		const snap1 = await buildJoyRideWorkspaceSnapshot(tmpDir, "vscodeTerminal")
		fs.writeFileSync(path.join(tmpDir, "package-lock.json"), '{"lockfileVersion":3}')
		const snap2 = await buildJoyRideWorkspaceSnapshot(tmpDir, "vscodeTerminal")
		assert.notEqual(snap1.lockfileFingerprint, snap2.lockfileFingerprint)
	})

	it("should change workspace fingerprint when changed file generation changes", async () => {
		const snap1 = await buildJoyRideWorkspaceSnapshot(tmpDir, "vscodeTerminal", 0)
		const snap2 = await buildJoyRideWorkspaceSnapshot(tmpDir, "vscodeTerminal", 5)
		assert.notEqual(snap1.workspaceFingerprint, snap2.workspaceFingerprint)
	})

	it("should change environment fingerprint when terminal mode changes", async () => {
		const snap1 = await buildJoyRideWorkspaceSnapshot(tmpDir, "vscodeTerminal")
		const snap2 = await buildJoyRideWorkspaceSnapshot(tmpDir, "backgroundExec")
		assert.notEqual(snap1.environmentFingerprint, snap2.environmentFingerprint)
	})
})
