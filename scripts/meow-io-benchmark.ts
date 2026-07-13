/**
 * Deterministic local MEOW/ACC I/O workload.
 *
 * This is fixture evidence, not a production latency claim. "Cold" clears the
 * task-local caches used by this harness; it cannot evict the host OS page cache.
 * The ten service rows intentionally stress backends directly. Runtime task
 * budgets (total 4, search/traversal 2) are covered by deterministic pool tests.
 */

import * as childProcess from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { monitorEventLoopDelay } from "node:perf_hooks"

const mutableChildProcess = require("node:child_process") as typeof import("node:child_process")

type Counts = {
	stat: number
	lstat: number
	realpath: number
	access: number
	readdir: number
	open: number
	readFile: number
	bytesRead: number
	processSpawns: number
	maxConcurrency: number
}

type WorkloadEvidence = Counts & {
	name: string
	wallMs: number
	readyToDispatchMs: number
	dispatchToBackendStartMs: number | null
	timeToFirstUsefulMs: number
	backendDurationMs: number
	resultProcessingMs: number
	eventLoopDelayMaxMs: number
	cacheHits: number
	cacheMisses: number
	coalescedWaiters: number
	backendExecutions: number
	cancellationSettlementMs: number | null
	resultBytes: number
}

const originalAsync = new Map<string, (...args: any[]) => Promise<any>>()
const originalSpawn = mutableChildProcess.spawn
let currentProbe: Probe | undefined

class Probe {
	readonly readyAt = performance.now()
	dispatchEnteredAt?: number
	backendStartedAt?: number
	firstUsefulAt?: number
	active = 0
	counts: Counts = {
		stat: 0,
		lstat: 0,
		realpath: 0,
		access: 0,
		readdir: 0,
		open: 0,
		readFile: 0,
		bytesRead: 0,
		processSpawns: 0,
		maxConcurrency: 0,
	}

	backendStart(): void {
		this.backendStartedAt ??= performance.now()
	}

	dispatchEnter(): void {
		this.dispatchEnteredAt ??= performance.now()
	}

	firstUseful(): void {
		this.firstUsefulAt ??= performance.now()
	}

	begin(): () => void {
		this.backendStart()
		this.active++
		this.counts.maxConcurrency = Math.max(this.counts.maxConcurrency, this.active)
		let ended = false
		return () => {
			if (ended) return
			ended = true
			this.active = Math.max(0, this.active - 1)
		}
	}
}

function installIoProbe(): void {
	for (const operation of ["stat", "lstat", "realpath", "access", "readdir", "open", "readFile"] as const) {
		const original = (fsp as any)[operation] as (...args: any[]) => Promise<any>
		originalAsync.set(operation, original)
		;(fsp as any)[operation] = async (...args: any[]) => {
			const probe = currentProbe
			if (!probe) return original(...args)
			probe.counts[operation]++
			const end = probe.begin()
			try {
				const value = await original(...args)
				if (operation === "readFile") {
					probe.counts.bytesRead +=
						typeof value === "string" ? Buffer.byteLength(value) : Buffer.isBuffer(value) ? value.byteLength : 0
				}
				return value
			} finally {
				end()
			}
		}
	}

	;(mutableChildProcess as any).spawn = (...args: any[]) => {
		const probe = currentProbe
		if (!probe) return (originalSpawn as any)(...args)
		probe.counts.processSpawns++
		const end = probe.begin()
		const child = (originalSpawn as any)(...args)
		child.once("close", end)
		child.once("error", end)
		return child
	}
}

function restoreIoProbe(): void {
	for (const [operation, original] of originalAsync) (fsp as any)[operation] = original
	;(mutableChildProcess as any).spawn = originalSpawn
}

function bytes(value: unknown): number {
	if (typeof value === "string") return Buffer.byteLength(value)
	if (Array.isArray(value)) return value.reduce((total, item) => total + bytes(item), 0)
	return Buffer.byteLength(JSON.stringify(value ?? null))
}

async function fixture(): Promise<{ root: string; files: string[] }> {
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), "meow-io-"))
	const files: string[] = []
	for (let directory = 0; directory < 24; directory++) {
		const dir = path.join(root, `dir-${String(directory).padStart(2, "0")}`)
		await fsp.mkdir(dir)
		for (let file = 0; file < 24; file++) {
			const target = path.join(dir, `file-${String(file).padStart(2, "0")}.ts`)
			const content = `export const fixture_${directory}_${file} = "needle-${file % 4}"\n`.repeat(12)
			await fsp.writeFile(target, content)
			files.push(target)
		}
	}
	await fsp.writeFile(path.join(root, "large.ts"), 'export const repeated = "backpressure-needle"\n'.repeat(8_000))
	return { root, files }
}

async function main(): Promise<void> {
	const rgPath = childProcess.spawnSync("sh", ["-c", "command -v rg"], { encoding: "utf8" }).stdout.trim()
	if (!rgPath) throw new Error("ripgrep is required for the MEOW I/O benchmark")
	const data = await fixture()
	installIoProbe()

	// Require after installing probes so CommonJS-transpiled module property
	// lookups observe the wrappers above.
	const { HostProvider } = require("../src/hosts/host-provider") as typeof import("../src/hosts/host-provider")
	if (!HostProvider.isInitialized()) {
		HostProvider.initialize(
			(() => undefined) as any,
			(() => undefined) as any,
			(() => undefined) as any,
			(() => undefined) as any,
			{} as any,
			() => undefined,
			async () => "",
			async () => rgPath,
			process.cwd(),
			data.root,
		)
	}

	const { extractFileContent } =
		require("../src/integrations/misc/extract-file-content") as typeof import("../src/integrations/misc/extract-file-content")
	const { listFiles } = require("../src/services/glob/list-files") as typeof import("../src/services/glob/list-files")
	const { regexSearchFiles } = require("../src/services/ripgrep") as typeof import("../src/services/ripgrep")
	const { IoRequestCoalescer } =
		require("../src/core/task/tools/io/IoRequestCoalescer") as typeof import("../src/core/task/tools/io/IoRequestCoalescer")
	const { disposeIoRequestCoalescer } =
		require("../src/core/task/tools/io/IoRequestCoalescer") as typeof import("../src/core/task/tools/io/IoRequestCoalescer")
	const { TaskPathAuthorityCache } =
		require("../src/core/task/tools/io/TaskPathAuthorityCache") as typeof import("../src/core/task/tools/io/TaskPathAuthorityCache")
	const { executeTaskIoBackend } =
		require("../src/core/task/tools/io/TaskIoBackend") as typeof import("../src/core/task/tools/io/TaskIoBackend")
	const { TaskLatencyTracker } =
		require("../src/core/task/latency/TaskLatencyTracker") as typeof import("../src/core/task/latency/TaskLatencyTracker")
	const { runWithToolInvocationContext } =
		require("../src/core/task/tools/siblings/ToolInvocationContext") as typeof import("../src/core/task/tools/siblings/ToolInvocationContext")

	const evidence: Record<"cold" | "warm", WorkloadEvidence[]> = { cold: [], warm: [] }
	const activeHandlesBeforeSuite = ((process as any)._getActiveHandles?.() as unknown[] | undefined)?.length ?? null
	let generation = 0
	const coalescer = new IoRequestCoalescer(60_000, 256, generation)

	const read = async (target: string, firstUseful: () => void) => {
		const result = await extractFileContent(target, false, {
			onFirstBytes: firstUseful,
			onStats: (stats) => {
				const probe = currentProbe
				if (!probe) return
				probe.counts.stat += stats.metadataCalls
				probe.counts.bytesRead += stats.bytesRead
			},
		})
		firstUseful()
		return result.text
	}
	const list = async (firstUseful: () => void, signal?: AbortSignal) => {
		const result = await (listFiles as any)(data.root, true, 200, { signal, onFirstResult: firstUseful })
		firstUseful()
		return result
	}
	const search = async (query: string, firstUseful: () => void, signal?: AbortSignal) => {
		const result = await (regexSearchFiles as any)(data.root, data.root, query, "*.ts", undefined, {
			signal,
			onFirstResult: firstUseful,
		})
		firstUseful()
		return result
	}

	const measure = async (phase: "cold" | "warm", name: string, run: (probe: Probe) => Promise<unknown>): Promise<void> => {
		const probe = new Probe()
		probe.dispatchEnter()
		const loop = monitorEventLoopDelay({ resolution: 1 })
		loop.enable()
		currentProbe = probe
		const beforeStats = coalescer.getStats()
		let result: unknown
		let cancellationSettlementMs: number | null = null
		try {
			result = await run(probe)
			if (result && typeof result === "object" && "cancellationSettlementMs" in (result as any)) {
				cancellationSettlementMs = (result as any).cancellationSettlementMs
			}
		} finally {
			currentProbe = undefined
			loop.disable()
		}
		const backendCompletedAt = performance.now()
		const resultBytes = bytes(result)
		const completedAt = performance.now()
		const afterStats = coalescer.getStats()
		evidence[phase].push({
			name,
			wallMs: Number((completedAt - probe.readyAt).toFixed(3)),
			readyToDispatchMs: Number(((probe.dispatchEnteredAt ?? probe.readyAt) - probe.readyAt).toFixed(3)),
			dispatchToBackendStartMs:
				probe.backendStartedAt === undefined
					? null
					: Number((probe.backendStartedAt - (probe.dispatchEnteredAt ?? probe.readyAt)).toFixed(3)),
			timeToFirstUsefulMs: Number(((probe.firstUsefulAt ?? completedAt) - probe.readyAt).toFixed(3)),
			backendDurationMs: Number((backendCompletedAt - (probe.backendStartedAt ?? probe.readyAt)).toFixed(3)),
			resultProcessingMs: Number((completedAt - backendCompletedAt).toFixed(3)),
			eventLoopDelayMaxMs: Number((loop.max / 1e6).toFixed(3)),
			cacheHits: afterStats.cacheHits - beforeStats.cacheHits,
			cacheMisses: afterStats.cacheMisses - beforeStats.cacheMisses,
			coalescedWaiters: afterStats.coalescedWaiters - beforeStats.coalescedWaiters,
			backendExecutions: afterStats.executions - beforeStats.executions,
			cancellationSettlementMs,
			resultBytes,
			...probe.counts,
		})
	}

	const suite = async (phase: "cold" | "warm") => {
		if (phase === "warm") {
			await coalescer.coalesce(`g:${generation}:read:${data.files[20]}`, () => read(data.files[20], () => undefined))
			await coalescer.coalesce(`g:${generation}:search:fixture_1_1`, () => search("fixture_1_1", () => undefined))
		}
		await measure(phase, "01-one-small-read", async (probe) => read(data.files[0], () => probe.firstUseful()))
		await measure(phase, "02-sixteen-independent-reads", async (probe) =>
			Promise.all(data.files.slice(0, 16).map((file) => read(file, () => probe.firstUseful()))),
		)
		await measure(phase, "03-repeated-identical-read", async (probe) => {
			const key = `g:${generation}:read:${data.files[20]}`
			return Promise.all(
				Array.from({ length: 16 }, () => coalescer.coalesce(key, () => read(data.files[20], () => probe.firstUseful()))),
			)
		})
		await measure(phase, "04-large-tree-list", async (probe) => list(() => probe.firstUseful()))
		await measure(phase, "05-four-independent-searches", async (probe) =>
			Promise.all([0, 1, 2, 3].map((index) => search(`fixture_${index}_${index}`, () => probe.firstUseful()))),
		)
		await measure(phase, "06-repeated-identical-search", async (probe) => {
			const key = `g:${generation}:search:fixture_1_1`
			return Promise.all(
				Array.from({ length: 8 }, () => coalescer.coalesce(key, () => search("fixture_1_1", () => probe.firstUseful()))),
			)
		})
		await measure(phase, "07-mixed-read-list-search", async (probe) =>
			Promise.all([
				read(data.files[30], () => probe.firstUseful()),
				read(data.files[31], () => probe.firstUseful()),
				list(() => probe.firstUseful()),
				search("fixture_2_2", () => probe.firstUseful()),
			]),
		)
		await measure(phase, "08-mutation-then-read", async (probe) => {
			await fsp.appendFile(data.files[40], "// mutation\n")
			generation++
			return Promise.all([read(data.files[40], () => probe.firstUseful()), read(data.files[41], () => probe.firstUseful())])
		})
		await measure(phase, "09-cancel-large-search", async (probe) => {
			const controller = new AbortController()
			const started = performance.now()
			const pending = search("fixture_|backpressure-needle", () => probe.firstUseful(), controller.signal)
			setImmediate(() => controller.abort())
			try {
				await pending
			} catch {
				// Cancellation is the expected optimized outcome.
			}
			return { cancellationSettlementMs: Number((performance.now() - started).toFixed(3)) }
		})
		await measure(phase, "10-bounded-large-result", async (probe) => {
			try {
				return await search("backpressure-needle", () => probe.firstUseful())
			} catch (error) {
				return { error: error instanceof Error ? error.message : String(error) }
			}
		})
	}

	const integratedTaskId = "meow-io-integrated-trace"
	const authorityCache = new TaskPathAuthorityCache({
		cwd: data.root,
		ignorePolicy: { getPolicyGeneration: () => 1, validateAccess: () => true },
		getFilesystemGeneration: () => 0,
	})
	const integratedTrace = async (phase: "cold" | "warm") => {
		const tracker = new TaskLatencyTracker()
		const invocationId = `integrated-${phase}`
		const toolBlock = {
			type: "tool_use",
			name: "read_file",
			params: { path: path.relative(data.root, data.files[0]) },
			partial: false,
		} as const
		const detail = { invocationId, sequence: phase === "cold" ? 0 : 1, toolName: toolBlock.name }
		tracker.markIoStage("scheduler_ready", detail)
		tracker.markIoStage("dispatch_entered", detail)
		tracker.markIoStage("parameters_validated", detail)
		const beforeAuthority = authorityCache.getStats()
		const resolvedAuthority = await authorityCache.resolve({ path: toolBlock.params.path })
		const afterAuthority = authorityCache.getStats()
		tracker.incrementCounter("pathAuthorityCacheHits", afterAuthority.cacheHits - beforeAuthority.cacheHits)
		tracker.incrementCounter("pathAuthorityCacheMisses", afterAuthority.cacheMisses - beforeAuthority.cacheMisses)
		tracker.incrementCounter("realpathCalls", afterAuthority.realpathCalls - beforeAuthority.realpathCalls)
		tracker.incrementCounter(
			"ignorePolicyEvaluations",
			afterAuthority.ignorePolicyEvaluations - beforeAuthority.ignorePolicyEvaluations,
		)
		tracker.markIoStage("authority_resolved", detail)
		tracker.markIoStage("path_normalized", detail)
		tracker.markIoStage("workspace_containment_verified", detail)
		tracker.markIoStage("ignore_policy_resolved", detail)

		const taskConfig = { taskId: integratedTaskId, taskState: {}, latencyTracker: tracker } as any
		await runWithToolInvocationContext(
			{
				invocationId,
				sequence: detail.sequence,
				capturePresentation: true,
				resultContent: [],
				presentationEvents: [],
			},
			() =>
				executeTaskIoBackend(taskConfig, toolBlock as any, resolvedAuthority, "small-read", async (io, signal) => {
					const result = await extractFileContent(resolvedAuthority.absolutePath, false, {
						signal,
						onFirstBytes: io.firstUsefulResult,
						onStats: (stats) => {
							io.incrementCounter("fileOpenCalls", stats.fileOpens)
							io.incrementCounter("statCalls", stats.metadataCalls)
							io.incrementCounter("fileReadCalls", stats.readOperations)
							io.incrementCounter("bytesRead", stats.bytesRead)
							io.incrementCounter("bytesCopied", stats.bytesCopied)
						},
					})
					return result.text
				}),
		)
		tracker.markIoStage("envelope_completed", detail)
		tracker.markIoStage("projection_ready", detail)
		const snapshot = tracker.snapshot()
		return { ioDurations: snapshot.tools[0]?.ioDurations, counters: snapshot.ioCounters }
	}

	try {
		await suite("cold")
		await suite("warm")
		const criticalPathTrace = { cold: await integratedTrace("cold"), warm: await integratedTrace("warm") }
		authorityCache.dispose()
		disposeIoRequestCoalescer(integratedTaskId)
		await new Promise<void>((resolve) => setImmediate(resolve))
		await new Promise<void>((resolve) => setImmediate(resolve))
		const activeHandles = ((process as any)._getActiveHandles?.() as unknown[] | undefined)?.length ?? null
		console.log(
			JSON.stringify(
				{
					kind: "deterministic-local-fixture",
					note: "Cold clears harness task caches only; OS page cache is uncontrolled. Service rows call backends directly; runtime class caps are tested separately.",
					fixture: { files: data.files.length + 1, rootDepth: 2 },
					activeHandlesBeforeSuite,
					activeHandlesAfterSuite: activeHandles,
					activeHandleDelta:
						activeHandlesBeforeSuite === null || activeHandles === null
							? null
							: activeHandles - activeHandlesBeforeSuite,
					criticalPathTrace,
					evidence,
				},
				null,
				2,
			),
		)
	} finally {
		authorityCache.dispose()
		disposeIoRequestCoalescer(integratedTaskId)
		restoreIoProbe()
		await fs.promises.rm(data.root, { recursive: true, force: true })
		HostProvider.reset()
	}
}

void main().catch((error) => {
	restoreIoProbe()
	console.error(error)
	process.exitCode = 1
})
