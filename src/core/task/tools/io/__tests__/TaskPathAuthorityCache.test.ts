import { strict as assert } from "node:assert"
import path from "node:path"
import { describe, it } from "mocha"
import { TaskPathAuthorityCache } from "../TaskPathAuthorityCache"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function missing(target: string): NodeJS.ErrnoException {
	const error = new Error(`ENOENT: ${target}`) as NodeJS.ErrnoException
	error.code = "ENOENT"
	return error
}

class FakeIgnorePolicy {
	generation = 1
	blocked = false
	evaluations = 0

	getPolicyGeneration(): number {
		return this.generation
	}

	validateAccess(): boolean {
		this.evaluations++
		return !this.blocked
	}
}

describe("TaskPathAuthorityCache", () => {
	it("reuses task-generation path and policy evidence and exposes a synchronous peek", async () => {
		const policy = new FakeIgnorePolicy()
		const calls = new Map<string, number>()
		const cache = new TaskPathAuthorityCache({
			cwd: "/workspace",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 7,
			getWorkspaceRoots: () => [{ name: "workspace", path: "/workspace" }],
			realpath: async (target) => {
				calls.set(target, (calls.get(target) ?? 0) + 1)
				return target
			},
		})

		const first = await cache.resolve({ path: "src/a.ts" })
		const second = await cache.resolve({ path: "src/a.ts" })

		assert.equal(first, second)
		assert.equal(cache.peek({ path: "src/a.ts" }), first)
		assert.equal(calls.get("/workspace"), 1)
		assert.equal(calls.get("/workspace/src/a.ts"), 1)
		assert.equal(policy.evaluations, 1)
		assert.equal(first.filesystemGeneration, 7)
		assert.equal(first.contained, true)
		assert.equal(first.ignoreAllowed, true)
		assert.equal(cache.getStats().cacheHits, 1)
	})

	it("singleflights concurrent identical resolutions", async () => {
		const policy = new FakeIgnorePolicy()
		const targetStarted = deferred<void>()
		const targetResult = deferred<string>()
		let targetCalls = 0
		const cache = new TaskPathAuthorityCache({
			cwd: "/workspace",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			realpath: async (target) => {
				if (target === "/workspace") return target
				targetCalls++
				targetStarted.resolve()
				return targetResult.promise
			},
		})

		const first = cache.resolve({ path: "src/a.ts" })
		await targetStarted.promise
		const second = cache.resolve({ path: "src/a.ts" })
		assert.equal(targetCalls, 1)
		targetResult.resolve("/workspace/src/a.ts")

		const [a, b] = await Promise.all([first, second])
		assert.equal(a, b)
		assert.equal(cache.getStats().coalescedWaiters, 1)
	})

	it("overlaps independent root and existing-target canonicalization", async () => {
		const policy = new FakeIgnorePolicy()
		const rootStarted = deferred<void>()
		const targetStarted = deferred<void>()
		const release = deferred<void>()
		const cache = new TaskPathAuthorityCache({
			cwd: "/workspace",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			realpath: async (target) => {
				if (target === "/workspace") rootStarted.resolve()
				if (target === "/workspace/src/a.ts") targetStarted.resolve()
				await release.promise
				return target
			},
		})

		const pending = cache.resolve({ path: "src/a.ts" })
		await Promise.all([rootStarted.promise, targetStarted.promise])
		release.resolve()
		const result = await pending

		assert.equal(result.canonicalTarget, "/workspace/src/a.ts")
		assert.equal(cache.getStats().realpathCalls, 2)
	})

	it("re-evaluates policy generations without repeating canonical filesystem work", async () => {
		const policy = new FakeIgnorePolicy()
		let realpathCalls = 0
		const cache = new TaskPathAuthorityCache({
			cwd: "/workspace",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 3,
			realpath: async (target) => {
				realpathCalls++
				return target
			},
		})

		const allowed = await cache.resolve({ path: "src/a.ts" })
		policy.blocked = true
		policy.generation++
		const blocked = await cache.resolve({ path: "src/a.ts" })

		assert.equal(allowed.ignoreAllowed, true)
		assert.equal(blocked.ignoreAllowed, false)
		assert.equal(blocked.policyGeneration, 2)
		assert.equal(realpathCalls, 2, "root and target should each be canonicalized once")
		assert.equal(policy.evaluations, 2)
		assert.equal(cache.getStats().evidenceCacheHits, 1)
	})

	it("does not confuse a sibling prefix with workspace containment", async () => {
		const policy = new FakeIgnorePolicy()
		const cache = new TaskPathAuthorityCache({
			cwd: "/repo",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			getWorkspaceRoots: () => [{ name: "repo", path: "/repo" }],
			realpath: async (target) => target,
		})

		const result = await cache.resolve({ path: "/repo-other/secret.ts" })
		assert.equal(result.lexicallyContained, false)
		assert.equal(result.contained, false)
		assert.equal(result.external, true)
		assert.equal(result.ignoreApplicable, false)
		assert.equal(policy.evaluations, 0)
	})

	it("detects a lexical in-workspace symlink that canonically escapes", async () => {
		const policy = new FakeIgnorePolicy()
		const cache = new TaskPathAuthorityCache({
			cwd: "/repo",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			realpath: async (target) => (target === "/repo/link" ? "/outside/secret.ts" : target),
		})

		const result = await cache.resolve({ path: "link" })
		assert.equal(result.lexicallyContained, true)
		assert.equal(result.contained, false)
		assert.equal(result.external, true)
		assert.equal(result.ignoreApplicable, true)
		assert.equal(policy.evaluations, 1)
	})

	it("applies ignore policy to an external lexical symlink that canonically enters the workspace", async () => {
		const evaluatedPaths: string[] = []
		const policy = {
			getPolicyGeneration: () => 1,
			validateAccess: (filePath: string) => {
				evaluatedPaths.push(filePath)
				return filePath !== "/repo/private.secret"
			},
		}
		const cache = new TaskPathAuthorityCache({
			cwd: "/repo",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			realpath: async (target) => (target === "/outside/link" ? "/repo/private.secret" : target),
		})

		const result = await cache.resolve({ path: "/outside/link" })
		assert.equal(result.lexicallyContained, false)
		assert.equal(result.contained, true)
		assert.equal(result.external, false)
		assert.equal(result.ignoreApplicable, true)
		assert.equal(result.ignoreAllowed, false)
		assert.deepEqual(evaluatedPaths, ["/repo/private.secret"])
	})

	it("resolves inline named multi-root paths and returns handler-ready display data", async () => {
		const policy = new FakeIgnorePolicy()
		const cache = new TaskPathAuthorityCache({
			cwd: "/work/frontend",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			getWorkspaceRoots: () => [
				{ name: "frontend", path: "/work/frontend" },
				{ name: "backend", path: "/work/backend" },
			],
			realpath: async (target) => target,
		})

		const result = await cache.resolve({ path: "@backend:src/index.ts" })
		assert.equal(result.workspaceHint, "backend")
		assert.equal(result.workspaceHintMatched, true)
		assert.deepEqual(result.selectedWorkspaceRoot, { name: "backend", path: "/work/backend" })
		assert.equal(result.absolutePath, "/work/backend/src/index.ts")
		assert.equal(result.normalizedWorkspaceRelativePath, "src/index.ts")
		assert.equal(result.displayPath, "@backend:src/index.ts")
		assert.equal(result.contained, true)
	})

	it("canonicalizes a missing target from one nearest-existing-ancestor walk", async () => {
		const policy = new FakeIgnorePolicy()
		const calls: string[] = []
		const cache = new TaskPathAuthorityCache({
			cwd: "/repo",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			realpath: async (target) => {
				calls.push(target)
				if (target === "/repo") return "/canonical/repo"
				throw missing(target)
			},
		})

		const result = await cache.resolve({ path: "new/nested/file.ts" })
		assert.equal(result.targetExists, false)
		assert.equal(result.nearestExistingAncestor, "/canonical/repo")
		assert.equal(result.canonicalTarget, "/canonical/repo/new/nested/file.ts")
		assert.equal(calls.length, 4)
		assert.deepEqual(new Set(calls), new Set(["/repo", "/repo/new/nested/file.ts", "/repo/new/nested", "/repo/new"]))
		assert.equal(cache.getStats().realpathCacheHits + cache.getStats().coalescedWaiters > 0, true)
	})

	it("discards an old filesystem generation and returns only the retried generation", async () => {
		const policy = new FakeIgnorePolicy()
		const firstTargetStarted = deferred<void>()
		const firstTargetResult = deferred<string>()
		let filesystemGeneration = 1
		let targetCalls = 0
		const cache = new TaskPathAuthorityCache({
			cwd: "/repo",
			ignorePolicy: policy,
			getFilesystemGeneration: () => filesystemGeneration,
			realpath: async (target) => {
				if (target === "/repo") return target
				targetCalls++
				if (targetCalls === 1) {
					firstTargetStarted.resolve()
					return firstTargetResult.promise
				}
				return target
			},
		})

		const pending = cache.resolve({ path: "src/a.ts" })
		await firstTargetStarted.promise
		filesystemGeneration = 2
		firstTargetResult.resolve("/repo/src/a.ts")
		const result = await pending

		assert.equal(result.filesystemGeneration, 2)
		assert.equal(targetCalls, 2)
		assert.equal(cache.peek({ path: "src/a.ts" }), result)
		assert.equal(cache.getStats().staleGenerationDiscards, 1)
	})

	it("cannot return evidence captured under a replaced workspace identity", async () => {
		const policy = new FakeIgnorePolicy()
		const oldTargetStarted = deferred<void>()
		const oldTargetResult = deferred<string>()
		let roots = [{ name: "repo", path: "/repo" }]
		const cache = new TaskPathAuthorityCache({
			cwd: "/repo",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			getWorkspaceRoots: () => roots,
			realpath: async (target) => {
				if (target === "/repo/src/a.ts") {
					oldTargetStarted.resolve()
					return oldTargetResult.promise
				}
				return target
			},
		})

		const pending = cache.resolve({ path: "src/a.ts" })
		await oldTargetStarted.promise
		roots = [{ name: "other", path: "/other" }]
		oldTargetResult.resolve("/repo/src/a.ts")
		const result = await pending

		assert.equal(result.absolutePath, "/other/src/a.ts")
		assert.equal(result.canonicalTarget, "/other/src/a.ts")
		assert.equal(result.selectedWorkspaceRoot.path, "/other")
		assert.equal(cache.getStats().staleGenerationDiscards, 1)
	})

	it("settles a cancelled waiter without waiting for active filesystem work", async () => {
		const policy = new FakeIgnorePolicy()
		const targetStarted = deferred<void>()
		const targetResult = deferred<string>()
		const cache = new TaskPathAuthorityCache({
			cwd: "/repo",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			realpath: async (target) => {
				if (target === "/repo") return target
				targetStarted.resolve()
				return targetResult.promise
			},
		})
		const abort = new AbortController()
		const pending = cache.resolve({ path: "large/tree" }, abort.signal)
		await targetStarted.promise

		abort.abort(new Error("task cancelled"))
		await assert.rejects(pending, /task cancelled/)
		assert.equal(cache.getStats().cancellations, 1)
		assert.equal(cache.getStats().inFlight > 0, true, "the controlled backend must still be unresolved")

		targetResult.resolve("/repo/large/tree")
		const completed = await cache.resolve({ path: "large/tree" })
		assert.equal(completed.canonicalTarget, "/repo/large/tree")
	})

	it("bounds decision entries and prevents late admission after disposal", async () => {
		const policy = new FakeIgnorePolicy()
		const lateStarted = deferred<void>()
		const lateResult = deferred<string>()
		const cache = new TaskPathAuthorityCache({
			cwd: "/repo",
			ignorePolicy: policy,
			getFilesystemGeneration: () => 1,
			maxEntries: 2,
			realpath: async (target) => {
				if (target === "/repo") return target
				if (target === "/repo/late.ts") {
					lateStarted.resolve()
					return lateResult.promise
				}
				return target
			},
		})

		await cache.resolve({ path: "a.ts" })
		await cache.resolve({ path: "b.ts" })
		await cache.resolve({ path: "c.ts" })
		assert.equal(cache.getStats().entries, 2)
		assert.equal(cache.peek({ path: "a.ts" }), undefined)

		const late = cache.resolve({ path: "late.ts" })
		await lateStarted.promise
		cache.dispose()
		lateResult.resolve(path.join("/repo", "late.ts"))
		await assert.rejects(late, /disposed/)
		assert.equal(cache.getStats().entries, 0)
	})
})
