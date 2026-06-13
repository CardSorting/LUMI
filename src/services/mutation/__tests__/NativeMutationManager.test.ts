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
		it("should validate boundaries correctly", () => {
			assert.strictEqual(isPathInWorkspace(tempWorkspace, path.join(tempWorkspace, "file.ts")), true)
			assert.strictEqual(isPathInWorkspace(tempWorkspace, path.join(tempWorkspace, "subdir", "file.ts")), true)
			assert.strictEqual(isPathInWorkspace(tempWorkspace, path.join(tempWorkspace, "..", "outside.ts")), false)
		})
	})

	describe("NativeMutationManager operations", () => {
		const manager = NativeMutationManager.getInstance()

		it("should fail patch if file does not exist", async () => {
			const res = await manager.applyPatch(tempWorkspace, "nonexistent.ts", "", "search", "replace", "task-1")
			assert.strictEqual(res.ok, false)
			assert.strictEqual(res.error.string_code, "file_not_found")
		})

		it("should apply search-and-replace patch successfully", async () => {
			const filePath = "test-file.ts"
			const fullPath = path.join(tempWorkspace, filePath)
			await fs.writeFile(fullPath, "const foo = 42;\n", "utf8")

			const res = await manager.applyPatch(tempWorkspace, filePath, "", "const foo = 42;", "const foo = 100;", "task-1")

			assert.strictEqual(res.ok, true)
			assert.strictEqual(res.kernel.patched, true)

			const fileContent = await fs.readFile(fullPath, "utf8")
			assert.strictEqual(fileContent, "const foo = 100;\n")
		})

		it("should execute verify command and return exit status", async () => {
			const res = await manager.applyVerify(tempWorkspace, "node -v", "", "task-1")
			assert.strictEqual(res.ok, true)
			assert.strictEqual(res.verify_ran, true)
			assert.strictEqual(res.passed, true)
		})
	})
})
