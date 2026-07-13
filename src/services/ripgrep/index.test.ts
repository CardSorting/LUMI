import { strict as assert } from "node:assert"
import * as childProcess from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { DietCodeIgnoreController } from "@core/ignore/DietCodeIgnoreController"
import { beforeEach, describe, it } from "mocha"
import { type RipgrepSearchStats, type RipgrepSpawnFunction, regexSearchFiles, resetRipgrepBinaryCacheForTests } from "."

class FakeRipgrepProcess extends EventEmitter {
	readonly stdout = new PassThrough()
	readonly stderr = new PassThrough()
	readonly killSignals: Array<NodeJS.Signals | undefined> = []
	private closed = false

	writeJson(value: unknown): void {
		this.stdout.write(`${JSON.stringify(value)}\n`)
	}

	complete(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
		if (this.closed) return
		this.closed = true
		this.stdout.end()
		this.stderr.end()
		queueMicrotask(() => this.emit("close", code, signal))
	}

	kill(signal?: NodeJS.Signals | number): boolean {
		const normalized = typeof signal === "string" ? signal : undefined
		this.killSignals.push(normalized)
		this.complete(null, normalized ?? "SIGTERM")
		return true
	}

	asChildProcess(): childProcess.ChildProcess {
		return this as unknown as childProcess.ChildProcess
	}
}

class KillErrorRipgrepProcess extends FakeRipgrepProcess {
	override kill(signal?: NodeJS.Signals | number): boolean {
		const normalized = typeof signal === "string" ? signal : undefined
		this.killSignals.push(normalized)
		queueMicrotask(() => this.emit("error", new Error("kill delivery failed")))
		return false
	}
}

function match(filePath: string, line: number, text: string) {
	return {
		type: "match",
		data: {
			path: { text: filePath },
			line_number: line,
			lines: { text },
			submatches: [{ start: 0 }],
		},
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

describe("incremental ripgrep backend", () => {
	beforeEach(() => resetRipgrepBinaryCacheForTests())

	it("caches executable resolution while spawning each distinct backend request", async () => {
		let resolutions = 0
		let spawns = 0
		const resolveBinary = async () => {
			resolutions++
			return "/test/rg"
		}
		const stats: RipgrepSearchStats[] = []
		const spawn: RipgrepSpawnFunction = () => {
			spawns++
			const process = new FakeRipgrepProcess()
			queueMicrotask(() => {
				process.writeJson(match("/workspace/a.ts", 1, "export const a = 1"))
				process.complete()
			})
			return process.asChildProcess()
		}

		const first = await regexSearchFiles("/workspace", "/workspace", "export", undefined, undefined, {
			resolveBinary,
			spawn,
			onStats: (value) => stats.push({ ...value }),
		})
		const second = await regexSearchFiles("/workspace", "/workspace", "export", undefined, undefined, {
			resolveBinary,
			spawn,
			onStats: (value) => stats.push({ ...value }),
		})

		assert.match(first, /Found 1 result/)
		assert.equal(second, first)
		assert.equal(resolutions, 1)
		assert.equal(spawns, 2)
		assert.equal(stats[0].binaryResolutionCacheHit, false)
		assert.equal(stats[1].binaryResolutionCacheHit, true)
	})

	it("reports the first allowed match before backend completion", async () => {
		const process = new FakeRipgrepProcess()
		const firstResult = deferred<void>()
		const spawned = deferred<void>()
		let backendCompleted = false
		const resultPromise = regexSearchFiles("/workspace", "/workspace", "needle", undefined, undefined, {
			resolveBinary: async () => "/test/rg",
			spawn: () => {
				spawned.resolve()
				return process.asChildProcess()
			},
			onFirstResult: (result) => {
				assert.equal(backendCompleted, false)
				assert.equal(result.filePath, "/workspace/first.ts")
				firstResult.resolve()
			},
		}).then((result) => {
			backendCompleted = true
			return result
		})

		await spawned.promise
		process.writeJson(match("/workspace/first.ts", 4, "needle"))
		await firstResult.promise
		assert.equal(backendCompleted, false)
		process.complete()
		assert.match(await resultPromise, /first\.ts/)
	})

	it("kills and awaits the owned process when cancelled", async () => {
		const process = new FakeRipgrepProcess()
		const spawned = deferred<void>()
		const controller = new AbortController()
		let finalStats: RipgrepSearchStats | undefined
		const resultPromise = regexSearchFiles("/workspace", "/workspace", "needle", undefined, undefined, {
			signal: controller.signal,
			resolveBinary: async () => "/test/rg",
			spawn: () => {
				spawned.resolve()
				return process.asChildProcess()
			},
			onStats: (value) => {
				finalStats = { ...value }
			},
		})

		await spawned.promise
		controller.abort()
		await assert.rejects(resultPromise, (error: Error) => error.name === "AbortError")
		assert.deepEqual(process.killSignals, [undefined])
		assert.equal(finalStats?.cancelled, true)
	})

	it("does not settle cancellation on a kill error before process close", async () => {
		const process = new KillErrorRipgrepProcess()
		const spawned = deferred<void>()
		const controller = new AbortController()
		let settled = false
		const resultPromise = regexSearchFiles("/workspace", "/workspace", "needle", undefined, undefined, {
			signal: controller.signal,
			killGraceMs: 0,
			resolveBinary: async () => "/test/rg",
			spawn: () => {
				spawned.resolve()
				return process.asChildProcess()
			},
		})
		void resultPromise.then(
			() => {
				settled = true
			},
			() => {
				settled = true
			},
		)

		await spawned.promise
		controller.abort()
		await Promise.resolve()
		await Promise.resolve()
		assert.equal(settled, false)
		process.complete(null, "SIGKILL")
		await assert.rejects(resultPromise, (error: Error) => error.name === "AbortError")
	})

	it("settles an intentional result limit as bounded success", async () => {
		const process = new FakeRipgrepProcess()
		const spawned = deferred<void>()
		let finalStats: RipgrepSearchStats | undefined
		const resultPromise = regexSearchFiles("/workspace", "/workspace", "needle", undefined, undefined, {
			maxResults: 2,
			resolveBinary: async () => "/test/rg",
			spawn: () => {
				spawned.resolve()
				return process.asChildProcess()
			},
			onStats: (value) => {
				finalStats = { ...value }
			},
		})

		await spawned.promise
		process.writeJson(match("/workspace/a.ts", 1, "needle a"))
		process.writeJson(match("/workspace/b.ts", 2, "needle b"))
		process.writeJson(match("/workspace/c.ts", 3, "needle c"))

		const result = await resultPromise
		assert.match(result, /Found 2 results \(bounded/)
		assert.equal(result.match(/Found (\d+) result/)?.[1], "2")
		assert.match(result, /a\.ts/)
		assert.match(result, /b\.ts/)
		assert.doesNotMatch(result, /c\.ts/)
		assert.equal(process.killSignals.length, 1)
		assert.equal(finalStats?.acceptedResults, 2)
		assert.equal(finalStats?.truncated, true)
	})

	it("bounds stdout accumulation and terminates the producer", async () => {
		const process = new FakeRipgrepProcess()
		const spawned = deferred<void>()
		let finalStats: RipgrepSearchStats | undefined
		const resultPromise = regexSearchFiles("/workspace", "/workspace", "needle", undefined, undefined, {
			maxStdoutBytes: 64,
			resolveBinary: async () => "/test/rg",
			spawn: () => {
				spawned.resolve()
				return process.asChildProcess()
			},
			onStats: (value) => {
				finalStats = { ...value }
			},
		})

		await spawned.promise
		process.stdout.write(Buffer.alloc(1_024, "x"))

		assert.match(await resultPromise, /bounded search output/)
		assert.equal(finalStats?.stdoutBytes, 64)
		assert.equal(finalStats?.truncated, true)
		assert.equal(process.killSignals.length, 1)
	})

	it("reserves room for an honest marker inside the formatted byte cap", async () => {
		const process = new FakeRipgrepProcess()
		const spawned = deferred<void>()
		const resultPromise = regexSearchFiles("/workspace", "/workspace", "needle", undefined, undefined, {
			resolveBinary: async () => "/test/rg",
			spawn: () => {
				spawned.resolve()
				return process.asChildProcess()
			},
		})

		await spawned.promise
		process.writeJson(match("/workspace/large.ts", 1, `needle ${"x".repeat(300_000)}`))
		process.complete()

		const result = await resultPromise
		assert.match(result, /Results truncated due to bounded search output/)
		assert.ok(Buffer.byteLength(result, "utf8") <= 0.25 * 1024 * 1024)
	})

	it("projects matches in deterministic file and location order", async () => {
		const process = new FakeRipgrepProcess()
		const spawned = deferred<void>()
		const resultPromise = regexSearchFiles("/workspace", "/workspace", "needle", undefined, undefined, {
			resolveBinary: async () => "/test/rg",
			spawn: () => {
				spawned.resolve()
				return process.asChildProcess()
			},
		})

		await spawned.promise
		process.writeJson(match("/workspace/z.ts", 9, "needle z"))
		process.writeJson(match("/workspace/a.ts", 2, "needle a"))
		process.complete()

		const result = await resultPromise
		assert.ok(result.indexOf("a.ts") < result.indexOf("z.ts"))
	})

	it("revalidates retained matches when ignore policy generation changes", async () => {
		const process = new FakeRipgrepProcess()
		const spawned = deferred<void>()
		let generation = 0
		let denySecret = false
		let finalStats: RipgrepSearchStats | undefined
		const policy = {
			getPolicyGeneration: () => generation,
			validateAccess: (filePath: string) => !(denySecret && filePath.endsWith("secret.ts")),
		} as unknown as DietCodeIgnoreController
		const resultPromise = regexSearchFiles("/workspace", "/workspace", "needle", undefined, policy, {
			resolveBinary: async () => "/test/rg",
			spawn: () => {
				spawned.resolve()
				return process.asChildProcess()
			},
			onStats: (value) => {
				finalStats = { ...value }
			},
		})

		await spawned.promise
		process.writeJson(match("/workspace/secret.ts", 1, "needle secret"))
		denySecret = true
		generation++
		process.complete()

		const result = await resultPromise
		assert.match(result, /Found 0 results/)
		assert.doesNotMatch(result, /secret\.ts/)
		assert.equal(finalStats?.policyGenerationChanged, true)
		assert.equal(finalStats?.finalPolicyRevalidations, 1)
		assert.equal(finalStats?.acceptedResults, 0)
	})
})
