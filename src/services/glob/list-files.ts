import fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { arePathsEqual } from "@utils/path"
import { globby, type Options } from "globby"
import ignore from "ignore"
import { Logger } from "@/shared/services/Logger"

const DEFAULT_IGNORE_DIRECTORIES = [
	"node_modules",
	"__pycache__",
	"env",
	"venv",
	"target/dependency",
	"build/dependencies",
	"dist",
	"out",
	"bundle",
	"vendor",
	"tmp",
	"temp",
	"deps",
	"Pods",
]
const DEFAULT_GITIGNORE_SCAN_DIRECTORIES = [...DEFAULT_IGNORE_DIRECTORIES, "flow-typed", "coverage", ".git"]

export const LIST_FILES_TRAVERSAL_CONCURRENCY = 4
export const LIST_FILES_GLOB_CONCURRENCY = 4
const DEFAULT_LIST_TIMEOUT_MS = 10_000
const MAX_LIST_TIMEOUT_MS = 60_000

export interface ListFilesStats {
	directoryReadOperations: number
	activeOperations: number
	maxActiveOperations: number
	configuredTraversalConcurrency: number
	configuredGlobConcurrency: number
	maxPotentialFilesystemConcurrency: number
	gitignoreScanOperations: number
	gitignoreFilesRead: number
	ignorePolicyEvaluations: number
	directoriesQueued: number
	resultsProduced: number
	truncated: boolean
	cancelled: boolean
	timedOut: boolean
	firstUsefulResultMs?: number
	durationMs: number
}

export type ListFilesGlobFunction = (pattern: string, options: Options) => Promise<string[]>

export interface ListFilesExecutionOptions {
	signal?: AbortSignal
	concurrency?: number
	timeoutMs?: number
	onFirstResult?: (filePath: string) => void
	onStats?: (stats: Readonly<ListFilesStats>) => void
	now?: () => number
	/** Deterministic backend seam used by focused tests. */
	glob?: ListFilesGlobFunction
}

function abortError(): Error {
	const error = new Error("File listing aborted")
	error.name = "AbortError"
	return error
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError()
}

function isRestrictedPath(absolutePath: string): boolean {
	const root = process.platform === "win32" ? path.parse(absolutePath).root : "/"
	if (arePathsEqual(absolutePath, root)) return true
	return arePathsEqual(absolutePath, os.homedir())
}

function isTargetingHiddenDirectory(absolutePath: string): boolean {
	return path.basename(absolutePath).startsWith(".")
}

function buildIgnorePatterns(absolutePath: string): string[] {
	const patterns = [...DEFAULT_IGNORE_DIRECTORIES]
	if (!isTargetingHiddenDirectory(absolutePath)) patterns.push(".*")
	return patterns.map((directory) => `**/${directory}/**`)
}

export async function listFiles(
	dirPath: string,
	recursive: boolean,
	limit: number,
	execution: ListFilesExecutionOptions = {},
): Promise<[string[], boolean]> {
	const now = execution.now ?? performance.now.bind(performance)
	const startedAt = now()
	const traversalConcurrency = normalizeBoundedNumber(execution.concurrency, LIST_FILES_TRAVERSAL_CONCURRENCY, 16, 1)
	const stats: ListFilesStats = {
		directoryReadOperations: 0,
		activeOperations: 0,
		maxActiveOperations: 0,
		configuredTraversalConcurrency: traversalConcurrency,
		configuredGlobConcurrency: LIST_FILES_GLOB_CONCURRENCY,
		maxPotentialFilesystemConcurrency: traversalConcurrency * LIST_FILES_GLOB_CONCURRENCY,
		gitignoreScanOperations: 0,
		gitignoreFilesRead: 0,
		ignorePolicyEvaluations: 0,
		directoriesQueued: 0,
		resultsProduced: 0,
		truncated: false,
		cancelled: false,
		timedOut: false,
		durationMs: 0,
	}
	let timeout: ReturnType<typeof setTimeout> | undefined
	let stoppedByTimeout = false
	let firstResultReported = false

	try {
		throwIfAborted(execution.signal)
		const absolutePath = path.resolve(dirPath)
		if (isRestrictedPath(absolutePath) || limit <= 0) return [[], false]
		const timeoutMs = normalizeBoundedNumber(execution.timeoutMs, DEFAULT_LIST_TIMEOUT_MS, MAX_LIST_TIMEOUT_MS)
		if (recursive && timeoutMs > 0) {
			timeout = setTimeout(() => {
				stoppedByTimeout = true
				stats.timedOut = true
			}, timeoutMs)
			timeout.unref?.()
		}
		// An injected traversal backend owns its fixture policy. Production loads
		// repository ignore evidence once instead of making globby rescan every
		// .gitignore before every breadth-level directory request.
		const isGitignored =
			recursive && !execution.glob
				? await loadGitignoreSnapshot(absolutePath, execution.signal, () => stoppedByTimeout, stats)
				: () => false
		throwIfAborted(execution.signal)
		if (stoppedByTimeout) {
			stats.truncated = true
			Logger.warn("Globbing timed out while loading repository ignore policy")
			return [[], true]
		}

		const options: Options = {
			cwd: absolutePath,
			dot: true,
			absolute: true,
			markDirectories: true,
			gitignore: false,
			ignore: recursive ? buildIgnorePatterns(absolutePath) : undefined,
			expandDirectories: false,
			concurrency: LIST_FILES_GLOB_CONCURRENCY,
			onlyFiles: false,
			suppressErrors: true,
		}
		const glob = execution.glob ?? ((pattern, globOptions) => globby(pattern, globOptions) as Promise<string[]>)

		const reportFirstResult = (filePath: string): void => {
			if (firstResultReported) return
			firstResultReported = true
			stats.firstUsefulResultMs = Math.max(0, now() - startedAt)
			try {
				execution.onFirstResult?.(filePath)
			} catch {
				// Progress reporting is advisory and fail-open.
			}
		}

		const runGlob = async (pattern: string): Promise<string[]> => {
			throwIfAborted(execution.signal)
			if (stoppedByTimeout) return []
			stats.directoryReadOperations++
			stats.activeOperations++
			stats.maxActiveOperations = Math.max(stats.maxActiveOperations, stats.activeOperations)
			try {
				const discovered = await glob(pattern, options)
				throwIfAborted(execution.signal)
				const ordered = discovered
					.filter((filePath) => {
						stats.ignorePolicyEvaluations++
						return !isGitignored(filePath)
					})
					.sort()
				if (ordered[0]) reportFirstResult(ordered[0])
				return ordered
			} finally {
				stats.activeOperations--
			}
		}

		let filePaths: string[]
		if (recursive) {
			filePaths = await globbyLevelByLevel(
				limit,
				runGlob,
				() => stoppedByTimeout || execution.signal?.aborted === true,
				() => execution.signal?.aborted === true,
				traversalConcurrency,
				stats,
				reportFirstResult,
			)
		} else {
			const discovered = await runGlob("*")
			throwIfAborted(execution.signal)
			filePaths = discovered.slice(0, limit)
			if (filePaths[0]) reportFirstResult(filePaths[0])
		}

		if (execution.signal?.aborted) {
			stats.cancelled = true
			throw abortError()
		}
		if (stoppedByTimeout) Logger.warn("Globbing timed out, returning settled partial results")
		stats.resultsProduced = filePaths.length
		stats.truncated = filePaths.length >= limit || stoppedByTimeout
		return [filePaths, filePaths.length >= limit || stoppedByTimeout]
	} finally {
		if (timeout) clearTimeout(timeout)
		if (execution.signal?.aborted) stats.cancelled = true
		stats.durationMs = Math.max(0, now() - startedAt)
		try {
			execution.onStats?.({ ...stats })
		} catch {
			// Instrumentation is advisory and fail-open.
		}
	}
}

async function loadGitignoreSnapshot(
	root: string,
	signal: AbortSignal | undefined,
	isTimedOut: () => boolean,
	stats: ListFilesStats,
): Promise<(filePath: string) => boolean> {
	throwIfAborted(signal)
	stats.gitignoreScanOperations++
	const ignoreFiles = await globby("**/.gitignore", {
		cwd: root,
		absolute: true,
		dot: true,
		expandDirectories: false,
		onlyFiles: true,
		followSymbolicLinks: false,
		suppressErrors: true,
		concurrency: LIST_FILES_GLOB_CONCURRENCY,
		ignore: DEFAULT_GITIGNORE_SCAN_DIRECTORIES.map((directory) => `**/${directory}/**`),
	})
	throwIfAborted(signal)
	if (isTimedOut()) return () => false
	ignoreFiles.sort((left, right) => {
		const leftDepth = path.relative(root, left).split(path.sep).length
		const rightDepth = path.relative(root, right).split(path.sep).length
		if (leftDepth !== rightDepth) return leftDepth - rightDepth
		return left < right ? -1 : left > right ? 1 : 0
	})

	const policy = ignore()
	for (let offset = 0; offset < ignoreFiles.length; offset += LIST_FILES_GLOB_CONCURRENCY) {
		throwIfAborted(signal)
		if (isTimedOut()) return () => false
		const batch = ignoreFiles.slice(offset, offset + LIST_FILES_GLOB_CONCURRENCY)
		const contents = await Promise.allSettled(
			batch.map(async (ignoreFile) => {
				const content = await fs.readFile(ignoreFile, { encoding: "utf8", signal })
				stats.gitignoreFilesRead++
				return { ignoreFile, content }
			}),
		)
		for (const outcome of contents) {
			if (outcome.status === "rejected") {
				if (signal?.aborted) throw abortError()
				throw new Error(`Unable to read repository ignore file: ${String(outcome.reason)}`)
			}
			const base = toPosixPath(path.relative(root, path.dirname(outcome.value.ignoreFile)))
			const rebasedPatterns = outcome.value.content
				.split(/\r?\n/)
				.filter((line) => line.length > 0 && !line.startsWith("#"))
				.map((line) => rebaseGitignorePattern(base, line))
			policy.add(rebasedPatterns)
		}
	}

	return (filePath: string): boolean => {
		const relativePath = path.relative(root, filePath)
		if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return false
		const directorySuffix = filePath.endsWith("/") || filePath.endsWith(path.sep) ? "/" : ""
		return policy.ignores(`${toPosixPath(relativePath)}${directorySuffix}`)
	}
}

function rebaseGitignorePattern(base: string, line: string): string {
	if (!base) return line
	const negative = line.startsWith("!")
	const pattern = negative ? line.slice(1) : line
	const anchored = pattern.startsWith("/")
	const normalizedPattern = anchored ? pattern.slice(1) : pattern
	const appliesAtAnyDepth = !anchored && !normalizedPattern.includes("/")
	const rebased = appliesAtAnyDepth ? path.posix.join(base, "**", normalizedPattern) : path.posix.join(base, normalizedPattern)
	return negative ? `!${rebased}` : rebased
}

function toPosixPath(filePath: string): string {
	return filePath.replace(/\\/g, "/")
}

function normalizeBoundedNumber(value: number | undefined, fallback: number, maximum: number, minimum = 0): number {
	if (value === undefined || !Number.isFinite(value)) return fallback
	return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

/**
 * Deterministic breadth-first traversal. Independent directory reads overlap in
 * bounded batches, but each batch is committed in queue order so the limited
 * result set does not depend on backend completion order.
 */
async function globbyLevelByLevel(
	limit: number,
	runGlob: (pattern: string) => Promise<string[]>,
	shouldStopAdmission: () => boolean,
	isCancelled: () => boolean,
	concurrency: number,
	stats: ListFilesStats,
	onFirstResult: (filePath: string) => void,
): Promise<string[]> {
	const results = new Set<string>()
	let patterns = ["*"]
	stats.directoriesQueued = 1

	while (patterns.length > 0 && results.size < limit && !shouldStopAdmission()) {
		const nextPatterns: string[] = []
		for (let offset = 0; offset < patterns.length && results.size < limit && !shouldStopAdmission(); offset += concurrency) {
			const batch = patterns.slice(offset, offset + concurrency)
			// Active calls always settle before this function returns; cancellation
			// prevents further admission instead of abandoning an in-flight traversal.
			const batchOutcomes = await Promise.allSettled(batch.map((pattern) => runGlob(pattern)))
			for (const outcome of batchOutcomes) {
				if (outcome.status === "rejected") {
					if (!isCancelled()) Logger.warn(`Directory listing operation failed: ${String(outcome.reason)}`)
					continue
				}
				const filesAtLevel = outcome.value
				for (const file of filesAtLevel) {
					if (results.size >= limit || isCancelled()) break
					if (results.has(file)) continue
					results.add(file)
					onFirstResult(file)
					if (file.endsWith("/")) {
						const escapedFile = file.replace(/\(/g, "\\(").replace(/\)/g, "\\)")
						nextPatterns.push(`${escapedFile}*`)
					}
				}
				if (results.size >= limit || isCancelled()) break
			}
		}
		stats.directoriesQueued += nextPatterns.length
		patterns = nextPatterns
	}

	return Array.from(results).slice(0, limit)
}
