import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "mocha"
import * as sinon from "sinon"
import { type ListFilesGlobFunction, type ListFilesStats, listFiles } from "./list-files"

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

describe("bounded list-files traversal", () => {
	it("overlaps independent breadth-level reads within the configured bound", async () => {
		const releaseChildren = deferred<void>()
		let active = 0
		let maxActive = 0
		const childStarts: string[] = []
		let finalStats: ListFilesStats | undefined
		const glob: ListFilesGlobFunction = async (pattern) => {
			if (pattern === "*") {
				return ["/workspace/a/", "/workspace/b/", "/workspace/c/", "/workspace/d/", "/workspace/root.ts"]
			}
			childStarts.push(pattern)
			active++
			maxActive = Math.max(maxActive, active)
			await releaseChildren.promise
			active--
			return [`${pattern.slice(0, -1)}child.ts`]
		}

		const listing = listFiles("/workspace", true, 20, {
			glob,
			concurrency: 2,
			onStats: (stats) => {
				finalStats = { ...stats }
			},
		})
		while (childStarts.length < 2) await Promise.resolve()
		assert.equal(childStarts.length, 2)
		assert.equal(maxActive, 2)
		releaseChildren.resolve()

		const [files] = await listing
		assert.equal(files.length, 9)
		assert.equal(childStarts.length, 4)
		assert.equal(maxActive, 2)
		assert.equal(finalStats?.maxActiveOperations, 2)
		assert.equal(finalStats?.activeOperations, 0)
		assert.equal(finalStats?.configuredTraversalConcurrency, 2)
		assert.equal(finalStats?.configuredGlobConcurrency, 4)
		assert.equal(finalStats?.maxPotentialFilesystemConcurrency, 8)
	})

	it("stops admission on cancellation and awaits active directory reads", async () => {
		const childA = deferred<string[]>()
		const childB = deferred<string[]>()
		const started = deferred<void>()
		const controller = new AbortController()
		const calls: string[] = []
		let activeChildren = 0
		let settled = false
		let finalStats: ListFilesStats | undefined
		const glob: ListFilesGlobFunction = async (pattern) => {
			calls.push(pattern)
			if (pattern === "*") return ["/workspace/a/", "/workspace/b/", "/workspace/c/"]
			activeChildren++
			if (activeChildren === 2) started.resolve()
			return pattern.includes("/a/") ? childA.promise : childB.promise
		}

		const listing = listFiles("/workspace", true, 20, {
			signal: controller.signal,
			glob,
			concurrency: 2,
			onStats: (stats) => {
				finalStats = { ...stats }
			},
		}).finally(() => {
			settled = true
		})
		await started.promise
		controller.abort()
		await Promise.resolve()
		assert.equal(settled, false)
		childA.resolve(["/workspace/a/a.ts"])
		childB.resolve(["/workspace/b/b.ts"])

		await assert.rejects(listing, (error: Error) => error.name === "AbortError")
		assert.equal(
			calls.some((pattern) => pattern.includes("/c/")),
			false,
		)
		assert.equal(finalStats?.cancelled, true)
		assert.equal(finalStats?.activeOperations, 0)
	})

	it("clears its deadline timer after successful settlement", async () => {
		const clock = sinon.useFakeTimers({ now: 0 })
		try {
			const [files] = await listFiles("/workspace", true, 20, {
				glob: async () => ["/workspace/a.ts"],
				timeoutMs: 10_000,
				now: () => clock.now,
			})
			assert.deepEqual(files, ["/workspace/a.ts"])
			assert.equal(clock.countTimers(), 0)
		} finally {
			clock.restore()
		}
	})

	it("bounds results before admitting deeper traversal", async () => {
		const calls: string[] = []
		let firstResult: string | undefined
		const [files, didHitLimit] = await listFiles("/workspace", true, 3, {
			glob: async (pattern) => {
				calls.push(pattern)
				return ["/workspace/a/", "/workspace/b/", "/workspace/c/", "/workspace/d/"]
			},
			onFirstResult: (filePath) => {
				firstResult = filePath
			},
		})

		assert.deepEqual(files, ["/workspace/a/", "/workspace/b/", "/workspace/c/"])
		assert.equal(didHitLimit, true)
		assert.equal(firstResult, "/workspace/a/")
		assert.deepEqual(calls, ["*"])
	})

	it("commits concurrent directory results in deterministic queue order", async () => {
		const childA = deferred<string[]>()
		const childB = deferred<string[]>()
		const childrenStarted = deferred<void>()
		let started = 0
		const listing = listFiles("/workspace", true, 20, {
			concurrency: 2,
			glob: async (pattern) => {
				if (pattern === "*") return ["/workspace/b/", "/workspace/a/"]
				started++
				if (started === 2) childrenStarted.resolve()
				return pattern.includes("/a/") ? childA.promise : childB.promise
			},
		})

		await childrenStarted.promise
		childB.resolve(["/workspace/b/b.ts"])
		await Promise.resolve()
		childA.resolve(["/workspace/a/a.ts"])

		const [files] = await listing
		assert.deepEqual(files, ["/workspace/a/", "/workspace/b/", "/workspace/a/a.ts", "/workspace/b/b.ts"])
	})

	it("loads repository ignore policy once and prevents ignored traversal", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "dietcode-list-ignore-"))
		let finalStats: ListFilesStats | undefined
		try {
			await fs.mkdir(path.join(root, "ignored"))
			await fs.mkdir(path.join(root, "visible", "deep"), { recursive: true })
			await fs.writeFile(path.join(root, ".gitignore"), "ignored/\n*.log\n")
			await fs.writeFile(path.join(root, "visible", ".gitignore"), "*.secret\n")
			await fs.writeFile(path.join(root, "ignored", "secret.ts"), "secret")
			await fs.writeFile(path.join(root, "visible", "keep.ts"), "keep")
			await fs.writeFile(path.join(root, "visible", "drop.log"), "drop")
			await fs.writeFile(path.join(root, "visible", "deep", "drop.secret"), "drop")

			const [files] = await listFiles(root, true, 100, {
				onStats: (stats) => {
					finalStats = { ...stats }
				},
			})

			assert.equal(
				files.some((file) => file.includes(`${path.sep}ignored`)),
				false,
			)
			assert.equal(files.includes(path.join(root, "visible", "keep.ts")), true)
			assert.equal(files.includes(path.join(root, "visible", "drop.log")), false)
			assert.equal(files.includes(path.join(root, "visible", "deep", "drop.secret")), false)
			assert.equal(finalStats?.gitignoreScanOperations, 1)
			assert.equal(finalStats?.gitignoreFilesRead, 2)
			assert.ok((finalStats?.ignorePolicyEvaluations ?? 0) > 0)
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	it("does not apply repository ignore policy to non-recursive listings", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "dietcode-list-flat-"))
		let finalStats: ListFilesStats | undefined
		try {
			await fs.writeFile(path.join(root, ".gitignore"), "*.log\n")
			await fs.writeFile(path.join(root, "visible.log"), "visible")
			const [files] = await listFiles(root, false, 100, {
				onStats: (stats) => {
					finalStats = { ...stats }
				},
			})

			assert.equal(files.includes(path.join(root, "visible.log")), true)
			assert.equal(finalStats?.gitignoreScanOperations, 0)
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	it("returns settled partial results with an honest truncation flag on timeout", async () => {
		const clock = sinon.useFakeTimers({ now: 0 })
		const child = deferred<string[]>()
		const childStarted = deferred<void>()
		try {
			const listing = listFiles("/workspace", true, 20, {
				glob: async (pattern) => {
					if (pattern === "*") return ["/workspace/a/"]
					childStarted.resolve()
					return child.promise
				},
				timeoutMs: 10,
				now: () => clock.now,
			})
			await childStarted.promise
			await clock.tickAsync(10)
			child.resolve(["/workspace/a/settled.ts"])

			const [files, truncated] = await listing
			assert.deepEqual(files, ["/workspace/a/", "/workspace/a/settled.ts"])
			assert.equal(truncated, true)
			assert.equal(clock.countTimers(), 0)
		} finally {
			clock.restore()
		}
	})
})
