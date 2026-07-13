import * as childProcess from "node:child_process"
import * as path from "node:path"
import { StringDecoder } from "node:string_decoder"
import { DietCodeIgnoreController } from "@core/ignore/DietCodeIgnoreController"
import { getBinaryLocation } from "@/utils/fs"

export interface SearchResult {
	filePath: string
	line: number
	column: number
	match: string
	beforeContext: string[]
	afterContext: string[]
}

export interface RipgrepSearchStats {
	binaryResolutionCacheHit: boolean
	spawnCount: number
	stdoutBytes: number
	stderrBytes: number
	stderrTruncated: boolean
	parsedLines: number
	parseErrors: number
	matchEvents: number
	acceptedResults: number
	droppedResults: number
	bytesCopied: number
	truncated: boolean
	cancelled: boolean
	policyGenerationChanged: boolean
	finalPolicyRevalidations: number
	firstUsefulResultMs?: number
	durationMs: number
}

export type RipgrepSpawnFunction = (command: string, args: string[]) => childProcess.ChildProcess

export interface RegexSearchExecutionOptions {
	signal?: AbortSignal
	onFirstResult?: (result: Readonly<SearchResult>) => void
	onStats?: (stats: Readonly<RipgrepSearchStats>) => void
	maxResults?: number
	maxStdoutBytes?: number
	maxStderrBytes?: number
	maxJsonLineBytes?: number
	killGraceMs?: number
	now?: () => number
	/** Test seam. A stable function identity shares the same binary-resolution cache. */
	resolveBinary?: () => Promise<string>
	/** Test seam. Production always uses direct child_process.spawn without a shell. */
	spawn?: RipgrepSpawnFunction
}

const MAX_RESULTS = 300
const MAX_RIPGREP_MB = 0.25
const MAX_BYTE_SIZE = MAX_RIPGREP_MB * 1024 * 1024
const TRUNCATION_MESSAGE = "\n[Results truncated due to bounded search output. Please use a more specific search pattern.]"
const MAX_RESULT_CONTENT_BYTES = MAX_BYTE_SIZE - Buffer.byteLength(TRUNCATION_MESSAGE, "utf8")
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024
const DEFAULT_MAX_JSON_LINE_BYTES = 512 * 1024
const DEFAULT_KILL_GRACE_MS = 250
const MAX_KILL_GRACE_MS = 5_000

let cachedBinaryResolver: (() => Promise<string>) | undefined
let cachedBinaryPromise: Promise<string> | undefined
const defaultBinaryResolver = () => getBinaryLocation("rg")

/** Reset process-independent executable discovery between deterministic tests. */
export function resetRipgrepBinaryCacheForTests(): void {
	cachedBinaryResolver = undefined
	cachedBinaryPromise = undefined
}

async function resolveRipgrepBinary(resolver: () => Promise<string>): Promise<{ binaryPath: string; cacheHit: boolean }> {
	const cacheHit = cachedBinaryResolver === resolver && cachedBinaryPromise !== undefined
	if (!cacheHit) {
		const resolution = Promise.resolve().then(resolver)
		cachedBinaryResolver = resolver
		cachedBinaryPromise = resolution
		void resolution.catch(() => {
			if (cachedBinaryPromise === resolution) {
				cachedBinaryResolver = undefined
				cachedBinaryPromise = undefined
			}
		})
	}
	const binaryPromise = cachedBinaryPromise
	if (!binaryPromise) throw new Error("ripgrep binary resolution was not initialized")
	return { binaryPath: await binaryPromise, cacheHit }
}

function abortError(message = "Ripgrep search aborted"): Error {
	const error = new Error(message)
	error.name = "AbortError"
	return error
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw abortError()
	}
}

type PendingContext = { filePath: string; line: number; text: string }

interface RipgrepJsonEvent {
	type?: unknown
	data?: {
		path?: { text?: unknown }
		line_number?: unknown
		lines?: { text?: unknown }
		submatches?: Array<{ start?: unknown }>
	}
}

async function execRipgrep(
	binaryPath: string,
	args: string[],
	dietcodeIgnoreController: DietCodeIgnoreController | undefined,
	options: RegexSearchExecutionOptions,
	stats: RipgrepSearchStats,
	startedAt: number,
): Promise<{ results: SearchResult[]; truncated: boolean }> {
	const maxResults = normalizeBoundedInteger(options.maxResults, MAX_RESULTS)
	const maxStdoutBytes = normalizeBoundedInteger(options.maxStdoutBytes, DEFAULT_MAX_STDOUT_BYTES)
	const maxStderrBytes = normalizeBoundedInteger(options.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES)
	const maxJsonLineBytes = normalizeBoundedInteger(options.maxJsonLineBytes, DEFAULT_MAX_JSON_LINE_BYTES)
	const configuredKillGrace = options.killGraceMs
	const killGraceMs =
		configuredKillGrace === undefined || !Number.isFinite(configuredKillGrace)
			? DEFAULT_KILL_GRACE_MS
			: Math.min(MAX_KILL_GRACE_MS, Math.max(0, Math.floor(configuredKillGrace)))
	const spawn = options.spawn ?? ((command, spawnArgs) => childProcess.spawn(command, spawnArgs))
	const now = options.now ?? performance.now.bind(performance)

	throwIfAborted(options.signal)
	stats.spawnCount++
	const rgProcess = spawn(binaryPath, args)
	const stdout = rgProcess.stdout
	const stderr = rgProcess.stderr
	if (!stdout || !stderr) {
		try {
			rgProcess.kill()
		} catch {
			// A malformed injected backend may not support termination.
		}
		throw new Error("ripgrep process did not expose piped stdout/stderr")
	}

	return await new Promise((resolve, reject) => {
		const decoder = new StringDecoder("utf8")
		const results: SearchResult[] = []
		let currentResult: SearchResult | undefined
		let pendingContext: PendingContext[] = []
		let carry = ""
		let stderrOutput = ""
		let settled = false
		let firstResultReported = false
		let termination: "limit" | "cancel" | undefined
		let killTimer: ReturnType<typeof setTimeout> | undefined

		const isAccessible = (filePath: string): boolean => {
			if (!dietcodeIgnoreController) return true
			return dietcodeIgnoreController.validateAccess(filePath)
		}

		const finalizeCurrentResult = (): void => {
			if (!currentResult) return
			if (results.length < maxResults) {
				results.push(currentResult)
			} else {
				stats.droppedResults++
				stats.truncated = true
			}
			currentResult = undefined
		}

		const cleanup = (): void => {
			if (killTimer) {
				clearTimeout(killTimer)
				killTimer = undefined
			}
			options.signal?.removeEventListener("abort", onAbort)
			stdout.removeListener("data", onStdoutData)
			stderr.removeListener("data", onStderrData)
			rgProcess.removeListener("error", onProcessError)
			rgProcess.removeListener("close", onProcessClose)
		}

		const requestTermination = (reason: "limit" | "cancel"): void => {
			if (termination) return
			termination = reason
			if (reason === "cancel") {
				stats.cancelled = true
			} else {
				stats.truncated = true
			}

			// Stop retaining output immediately, but continue draining the pipe while
			// the owned process settles so no backend survives the returned promise.
			stdout.removeListener("data", onStdoutData)
			stdout.resume()
			if (killGraceMs > 0) {
				killTimer = setTimeout(() => {
					try {
						rgProcess.kill("SIGKILL")
					} catch {
						// The process may already have closed between the timer and kill.
					}
				}, killGraceMs)
				killTimer.unref?.()
			}
			try {
				rgProcess.kill()
			} catch {
				// The close/error event remains the authoritative settlement signal.
			}
		}

		const reportFirstResult = (result: SearchResult): void => {
			if (firstResultReported) return
			firstResultReported = true
			stats.firstUsefulResultMs = Math.max(0, now() - startedAt)
			try {
				// The live result can still receive trailing context. Isolate advisory
				// consumers from that mutation and from the canonical result buffer.
				options.onFirstResult?.({
					...result,
					beforeContext: [...result.beforeContext],
					afterContext: [...result.afterContext],
				})
			} catch {
				// Progress reporting is advisory and must never fail execution.
			}
		}

		const processJsonLine = (line: string): void => {
			if (!line) return
			stats.parsedLines++
			let parsed: RipgrepJsonEvent
			try {
				parsed = JSON.parse(line) as RipgrepJsonEvent
			} catch {
				stats.parseErrors++
				return
			}

			if (parsed.type === "context") {
				const filePath = parsed.data?.path?.text
				const lineNumber = parsed.data?.line_number
				const text = parsed.data?.lines?.text
				if (typeof filePath !== "string" || typeof lineNumber !== "number" || typeof text !== "string") return
				if (!isAccessible(filePath)) return
				if (currentResult && currentResult.filePath === filePath && lineNumber > currentResult.line) {
					if (currentResult.afterContext.length < 2) currentResult.afterContext.push(text)
				} else {
					pendingContext.push({ filePath, line: lineNumber, text })
					if (pendingContext.length > 2) pendingContext = pendingContext.slice(-2)
				}
				return
			}

			if (parsed.type !== "match") return
			stats.matchEvents++
			finalizeCurrentResult()

			const filePath = parsed.data?.path?.text
			const lineNumber = parsed.data?.line_number
			const matchText = parsed.data?.lines?.text
			if (typeof filePath !== "string" || typeof lineNumber !== "number" || typeof matchText !== "string") {
				stats.droppedResults++
				pendingContext = []
				return
			}
			if (!isAccessible(filePath)) {
				stats.droppedResults++
				pendingContext = []
				return
			}
			if (results.length >= maxResults) {
				stats.droppedResults++
				pendingContext = []
				requestTermination("limit")
				return
			}

			const submatchStart = parsed.data?.submatches?.[0]?.start
			currentResult = {
				filePath,
				line: lineNumber,
				column: typeof submatchStart === "number" ? submatchStart : 0,
				match: matchText,
				beforeContext: pendingContext
					.filter((context) => context.filePath === filePath && context.line < lineNumber)
					.map((context) => context.text)
					.slice(-1),
				afterContext: [],
			}
			pendingContext = []
			reportFirstResult(currentResult)
		}

		const processDecodedText = (text: string): void => {
			if (!text || termination) return
			stats.bytesCopied += Buffer.byteLength(text, "utf8")
			carry += text
			if (Buffer.byteLength(carry, "utf8") > maxJsonLineBytes && !carry.includes("\n")) {
				requestTermination("limit")
				return
			}

			let newlineIndex = carry.indexOf("\n")
			while (newlineIndex !== -1 && !termination) {
				let line = carry.slice(0, newlineIndex)
				carry = carry.slice(newlineIndex + 1)
				if (line.endsWith("\r")) line = line.slice(0, -1)
				if (Buffer.byteLength(line, "utf8") > maxJsonLineBytes) {
					requestTermination("limit")
					return
				}
				processJsonLine(line)
				newlineIndex = carry.indexOf("\n")
			}
		}

		function onStdoutData(data: Buffer | string): void {
			if (termination) return
			const buffer = typeof data === "string" ? Buffer.from(data) : data
			const remaining = maxStdoutBytes - stats.stdoutBytes
			if (remaining <= 0) {
				requestTermination("limit")
				return
			}
			const accepted = buffer.byteLength > remaining ? buffer.subarray(0, remaining) : buffer
			stats.stdoutBytes += accepted.byteLength
			processDecodedText(decoder.write(accepted))
			if (accepted.byteLength < buffer.byteLength && !termination) requestTermination("limit")
		}

		function onStderrData(data: Buffer | string): void {
			const buffer = typeof data === "string" ? Buffer.from(data) : data
			stats.stderrBytes += buffer.byteLength
			const retainedBytes = Buffer.byteLength(stderrOutput, "utf8")
			if (retainedBytes >= maxStderrBytes) {
				stats.stderrTruncated = true
				return
			}
			const remaining = maxStderrBytes - retainedBytes
			const accepted = buffer.byteLength > remaining ? buffer.subarray(0, remaining) : buffer
			stderrOutput += accepted.toString("utf8")
			if (accepted.byteLength < buffer.byteLength) stats.stderrTruncated = true
		}

		function onAbort(): void {
			requestTermination("cancel")
		}

		const finish = (error?: Error): void => {
			if (settled) return
			settled = true
			cleanup()
			if (error) {
				reject(error)
				return
			}
			stats.acceptedResults = results.length
			resolve({ results, truncated: stats.truncated })
		}

		function onProcessError(error: Error): void {
			// A failed termination request can emit error while the child is still
			// alive. Keep ownership and the SIGKILL escalation until close settles.
			if (termination) return
			finish(new Error(`ripgrep process error: ${error.message}`))
		}

		function onProcessClose(code: number | null, signal: NodeJS.Signals | null): void {
			if (!termination) {
				processDecodedText(decoder.end())
				if (carry && !termination) processJsonLine(carry.endsWith("\r") ? carry.slice(0, -1) : carry)
			}
			finalizeCurrentResult()
			if (termination === "cancel") {
				finish(abortError())
				return
			}
			if (termination === "limit") {
				finish()
				return
			}
			if (code !== 0 && code !== 1) {
				const signalSuffix = signal ? ` (signal ${signal})` : ""
				finish(new Error(`ripgrep process exited with code ${code}${signalSuffix}: ${stderrOutput}`))
				return
			}
			finish()
		}

		stdout.on("data", onStdoutData)
		stderr.on("data", onStderrData)
		rgProcess.once("error", onProcessError)
		rgProcess.once("close", onProcessClose)
		options.signal?.addEventListener("abort", onAbort, { once: true })
		if (options.signal?.aborted) onAbort()
	})
}

export async function regexSearchFiles(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
	dietcodeIgnoreController?: DietCodeIgnoreController,
	options: RegexSearchExecutionOptions = {},
): Promise<string> {
	const now = options.now ?? performance.now.bind(performance)
	const startedAt = now()
	const stats: RipgrepSearchStats = {
		binaryResolutionCacheHit: false,
		spawnCount: 0,
		stdoutBytes: 0,
		stderrBytes: 0,
		stderrTruncated: false,
		parsedLines: 0,
		parseErrors: 0,
		matchEvents: 0,
		acceptedResults: 0,
		droppedResults: 0,
		bytesCopied: 0,
		truncated: false,
		cancelled: false,
		policyGenerationChanged: false,
		finalPolicyRevalidations: 0,
		durationMs: 0,
	}

	try {
		throwIfAborted(options.signal)
		const policyGenerationAtStart = dietcodeIgnoreController?.getPolicyGeneration()
		const resolver = options.resolveBinary ?? defaultBinaryResolver
		const { binaryPath, cacheHit } = await resolveRipgrepBinary(resolver)
		stats.binaryResolutionCacheHit = cacheHit
		throwIfAborted(options.signal)

		const args = ["--json", "-e", regex, "--glob", filePattern || "*", "--context", "1", directoryPath]
		const execution = await execRipgrep(binaryPath, args, dietcodeIgnoreController, options, stats, startedAt)
		let finalResults = execution.results
		if (
			dietcodeIgnoreController &&
			policyGenerationAtStart !== undefined &&
			dietcodeIgnoreController.getPolicyGeneration() !== policyGenerationAtStart
		) {
			stats.policyGenerationChanged = true
			stats.finalPolicyRevalidations = finalResults.length
			const revalidated = finalResults.filter((result) => dietcodeIgnoreController.validateAccess(result.filePath))
			stats.droppedResults += finalResults.length - revalidated.length
			finalResults = revalidated
		}
		stats.acceptedResults = finalResults.length
		return formatResults(
			finalResults,
			cwd,
			execution.truncated,
			normalizeBoundedInteger(options.maxResults, MAX_RESULTS),
			stats,
		)
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw error
		throw Error("Error calling ripgrep", { cause: error })
	} finally {
		stats.durationMs = Math.max(0, now() - startedAt)
		try {
			options.onStats?.({ ...stats })
		} catch {
			// Instrumentation is advisory and fail-open.
		}
	}
}

function normalizeBoundedInteger(value: number | undefined, maximum: number): number {
	if (value === undefined || !Number.isFinite(value)) return maximum
	return Math.min(maximum, Math.max(1, Math.floor(value)))
}

function formatResults(
	results: SearchResult[],
	cwd: string,
	backendTruncated: boolean,
	maxResults: number,
	stats?: RipgrepSearchStats,
): string {
	const orderedResults = [...results].sort((left, right) => {
		if (left.filePath !== right.filePath) return left.filePath < right.filePath ? -1 : 1
		if (left.line !== right.line) return left.line - right.line
		if (left.column !== right.column) return left.column - right.column
		if (left.match === right.match) return 0
		return left.match < right.match ? -1 : 1
	})
	const groupedResults = new Map<string, SearchResult[]>()
	for (const result of orderedResults.slice(0, maxResults)) {
		const relativeFilePath = path.relative(cwd, result.filePath)
		const existing = groupedResults.get(relativeFilePath)
		if (existing) existing.push(result)
		else groupedResults.set(relativeFilePath, [result])
	}

	const chunks: string[] = []
	let byteSize = 0
	let outputTruncated = backendTruncated
	const append = (value: string): boolean => {
		const bytes = Buffer.byteLength(value, "utf8")
		if (byteSize + bytes >= MAX_RESULT_CONTENT_BYTES) {
			outputTruncated = true
			return false
		}
		chunks.push(value)
		byteSize += bytes
		if (stats) stats.bytesCopied += bytes
		return true
	}

	if (backendTruncated || results.length >= maxResults) {
		append(`Found ${results.length.toLocaleString()} results (bounded; additional matches may have been omitted).\n\n`)
	} else {
		append(`Found ${results.length === 1 ? "1 result" : `${results.length.toLocaleString()} results`}.\n\n`)
	}

	outer: for (const [filePath, fileResults] of groupedResults) {
		if (!append(`${filePath.replace(/\\/g, "/")}\n│----\n`)) break
		for (let resultIndex = 0; resultIndex < fileResults.length; resultIndex++) {
			const result = fileResults[resultIndex]
			for (const line of result.beforeContext) {
				if (!append(`│${line?.trimEnd() ?? ""}\n`)) break outer
			}
			if (!append(`│${result.match?.trimEnd() ?? ""}\n`)) break outer
			for (const line of result.afterContext) {
				if (!append(`│${line?.trimEnd() ?? ""}\n`)) break outer
			}
			if (resultIndex < fileResults.length - 1 && !append("│----\n")) break outer
		}
		if (!append("│----\n\n")) break
	}

	if (outputTruncated) {
		chunks.push(TRUNCATION_MESSAGE)
		if (stats) stats.bytesCopied += Buffer.byteLength(TRUNCATION_MESSAGE, "utf8")
	}
	if (stats) stats.truncated = outputTruncated
	return chunks.join("").trim()
}
