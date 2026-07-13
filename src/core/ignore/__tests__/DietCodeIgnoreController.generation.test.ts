import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "mocha"
import { DietCodeIgnoreController } from "../DietCodeIgnoreController"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

describe("DietCodeIgnoreController policy generations", () => {
	const controllers: DietCodeIgnoreController[] = []
	const tempDirs: string[] = []

	afterEach(async () => {
		await Promise.all(controllers.splice(0).map((controller) => controller.dispose()))
		await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
	})

	async function fixture(): Promise<string> {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dietcode-ignore-generation-"))
		tempDirs.push(dir)
		return dir
	}

	it("increments only when the effective policy changes and invalidates decisions atomically", async () => {
		const cwd = await fixture()
		const policyPath = path.join(cwd, ".dietcodeignore")
		await fs.writeFile(policyPath, "*.secret\n")
		const controller = new DietCodeIgnoreController(cwd)
		controllers.push(controller)
		await controller.initialize()

		const initialGeneration = controller.getPolicyGeneration()
		assert.ok(initialGeneration > 0)
		assert.equal(controller.validateAccess("key.secret"), false)
		assert.equal(controller.validateAccess("file.tmp"), true)

		await fs.writeFile(policyPath, "*.tmp\n")
		assert.equal(await controller.refreshPolicyIfAffected(policyPath), true)
		assert.equal(controller.getPolicyGeneration(), initialGeneration + 1)
		assert.equal(controller.validateAccess("key.secret"), true)
		assert.equal(controller.validateAccess("file.tmp"), false)

		await controller.refreshPolicy()
		assert.equal(controller.getPolicyGeneration(), initialGeneration + 1)
	})

	it("denies an immediate post-mutation read when the policy file was just created", async () => {
		const cwd = await fixture()
		const policyPath = path.join(cwd, ".dietcodeignore")
		const controller = new DietCodeIgnoreController(cwd)
		controllers.push(controller)
		await controller.initialize()
		assert.equal(controller.validateAccess("newly-secret.txt"), true)

		await fs.writeFile(policyPath, "newly-secret.txt\n")
		assert.equal(await controller.refreshPolicyIfAffected(policyPath), true)
		assert.equal(controller.validateAccess("newly-secret.txt"), false)
	})

	it("commits concurrent reloads latest-request-wins", async () => {
		const cwd = await fixture()
		const first = deferred<string>()
		const second = deferred<string>()
		let reads = 0
		const controller = new DietCodeIgnoreController(cwd, {
			readFile: async () => {
				reads++
				return reads === 1 ? first.promise : second.promise
			},
		})
		controllers.push(controller)

		const olderReload = controller.refreshPolicy()
		const newerReload = controller.refreshPolicy()
		second.resolve("*.new\n")
		await newerReload
		first.resolve("*.old\n")
		await olderReload

		assert.equal(controller.getPolicyGeneration(), 1)
		assert.equal(controller.validateAccess("result.new"), false)
		assert.equal(controller.validateAccess("result.old"), true)
	})

	it("keeps the policy file protected even when it is empty", async () => {
		const cwd = await fixture()
		await fs.writeFile(path.join(cwd, ".dietcodeignore"), "")
		const controller = new DietCodeIgnoreController(cwd)
		controllers.push(controller)
		await controller.initialize()

		assert.equal(controller.validateAccess(".dietcodeignore"), false)
		assert.equal(controller.validateAccess("ordinary.txt"), true)
	})

	it("tracks included policy content in the generation", async () => {
		const cwd = await fixture()
		const includePath = path.join(cwd, ".patterns")
		await fs.writeFile(path.join(cwd, ".dietcodeignore"), "!include .patterns\n")
		await fs.writeFile(includePath, "*.first\n")
		const controller = new DietCodeIgnoreController(cwd)
		controllers.push(controller)
		await controller.initialize()

		const initialGeneration = controller.getPolicyGeneration()
		assert.equal(controller.validateAccess("value.first"), false)
		await fs.writeFile(includePath, "*.second\n")
		assert.equal(await controller.refreshPolicyIfAffected(includePath), true)

		assert.equal(controller.getPolicyGeneration(), initialGeneration + 1)
		assert.equal(controller.validateAccess("value.first"), true)
		assert.equal(controller.validateAccess("value.second"), false)
		assert.equal(await controller.refreshPolicyIfAffected(path.join(cwd, "ordinary.ts")), false)
		assert.equal(controller.getPolicyGeneration(), initialGeneration + 1)
	})
})
