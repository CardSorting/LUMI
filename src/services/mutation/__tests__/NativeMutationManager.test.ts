import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import { isPathInWorkspace, NativeMutationManager } from "../NativeMutationManager"

describe("NativeMutationManager", () => {
	const tempWorkspace = path.join(__dirname, "temp-test-workspace-" + Date.now())

	before(async () => {
		await fs.mkdir(tempWorkspace, { recursive: true })
	})

	after(async () => {
		await fs.rm(tempWorkspace, { recursive: true, force: true })
	})

	describe("isPathInWorkspace", () => {
		it("should validate boundaries correctly", async () => {
			assert.strictEqual(await isPathInWorkspace(tempWorkspace, path.join(tempWorkspace, "file.ts")), true)
			assert.strictEqual(await isPathInWorkspace(tempWorkspace, path.join(tempWorkspace, "subdir", "file.ts")), true)
			assert.strictEqual(await isPathInWorkspace(tempWorkspace, path.join(tempWorkspace, "..", "outside.ts")), false)
		})
	})

	describe("NativeMutationManager operations", () => {
		const manager = NativeMutationManager.getInstance()

		it("should fail patch if file does not exist", async () => {
			const res = await manager.applyPatch(tempWorkspace, "nonexistent.ts", "", "search", "replace", "task-1")
			assert.strictEqual(res.ok, false)
			assert.strictEqual(res.error.string_code, "file_not_found")
		})

		it("should apply search-and-replace patch successfully and bump revision", async () => {
			const filePath = "test-file.ts"
			const fullPath = path.join(tempWorkspace, filePath)
			await fs.writeFile(fullPath, "const foo = 42;\n", "utf8")

			const res = await manager.applyPatch(tempWorkspace, filePath, "", "const foo = 42;", "const foo = 100;", "")

			assert.strictEqual(res.ok, true)
			assert.strictEqual(res.kernel.patched, true)
			assert.ok(res.kernel.revisionAfter > res.kernel.revisionBefore)

			const fileContent = await fs.readFile(fullPath, "utf8")
			assert.strictEqual(fileContent, "const foo = 100;\n")
		})

		it("should execute verify command and return exit status", async () => {
			const res = await manager.applyVerify(tempWorkspace, "node -v", "", "task-1")
			assert.strictEqual(res.ok, true)
			assert.strictEqual(res.verify_ran, true)
			assert.strictEqual(res.passed, true)
		})

		it("should enforce coherence checks and fail on token requirement if taskId is specified", async () => {
			const filePath = "test-coherence.ts"
			const fullPath = path.join(tempWorkspace, filePath)
			await fs.writeFile(fullPath, "let status = 'init';\n", "utf8")

			const res = await manager.applyPatch(
				tempWorkspace,
				filePath,
				"",
				"let status = 'init';",
				"let status = 'changed';",
				"task-coherence",
			)

			assert.strictEqual(res.ok, false)
			assert.strictEqual(res.error.string_code, "token_required")
		})

		it("should pass coherence check when correct token is supplied", async () => {
			const filePath = "test-coherence-ok.ts"
			const fullPath = path.join(tempWorkspace, filePath)
			await fs.writeFile(fullPath, "let val = 10;\n", "utf8")

			// Get a status/coherence token
			const statusRes = await manager.getStatus(tempWorkspace, "task-ok")
			assert.strictEqual(statusRes.ok, true)
			const token = statusRes.result.coherenceToken
			assert.ok(token.tokenId)

			const res = await manager.applyPatch(
				tempWorkspace,
				filePath,
				"",
				"let val = 10;",
				"let val = 20;",
				"task-ok",
				token.tokenId,
				token.workspaceRevision,
			)

			assert.strictEqual(res.ok, true)
			assert.strictEqual(res.kernel.patched, true)
		})

		it("should report driftDetected when a tracked file is modified externally", async () => {
			const filePath = "test-drift.ts"
			const fullPath = path.join(tempWorkspace, filePath)
			await fs.writeFile(fullPath, "const a = 1;\n", "utf8")

			// Read file to auto-track it
			await manager.autoTrackFileRead(tempWorkspace, fullPath, "task-drift")

			// Modify file externally directly on fs
			await fs.writeFile(fullPath, "const a = 99;\n", "utf8")

			const statusRes = await manager.getStatus(tempWorkspace, "task-drift")
			assert.strictEqual(statusRes.ok, true)
			assert.strictEqual(statusRes.result.driftDetected, true)
			assert.ok(statusRes.result.affectedFiles.length > 0)
		})
	})
})
