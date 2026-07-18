/**
 * ExecutionFunnel — the single auditable authority for tool execution.
 *
 * Registration, task/lane admission, plan-mode enforcement, mutation fencing,
 * roadmap protection, policy enforcement, PreToolUse hooks, cancellation,
 * dispatch, retries/timeouts/concurrency, result classification, post-policy
 * observation, and publication of one terminal outcome live here.
 *
 * Handlers are operation adapters. They may validate operation-specific input
 * and request explicit user consent, but they do not grant execution authority.
 * Parent, sibling, and subagent execution must all enter through this funnel.
 */

import { AsyncLocalStorage } from "node:async_hooks"
import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { PreToolUseHookCancellationError } from "@core/hooks/PreToolUseHookCancellationError"
import type { DietCodeIgnoreController } from "@core/ignore/DietCodeIgnoreController"
import {
	EXECUTION_FUNNEL_SCHEMA_VERSION,
	type ExecutionFunnelEvent,
	type ExecutionFunnelPhase,
	type ExecutionFunnelReasonCode,
	type ExecutionFunnelStage,
} from "@shared/execution/executionFunnelEvent"
import type { LaneExecutionMode } from "@shared/subagent/governedExecution"
import { DietCodeDefaultTool } from "@shared/tools"
import { SafeNumber } from "@shared/utils/SafeNumber"
import { createLockAuthority } from "@/core/governance/LockAuthority"
import type { SpiderEngine } from "@/core/policy/spider/SpiderEngine"
import { Logger } from "@/shared/services/Logger"
import type { TaskState } from "../../TaskState"
import { getToolInvocationContext, resolveInvocationResultTarget } from "../siblings/ToolInvocationContext"
import type { TaskConfig } from "../types/TaskConfig"
import type { ToolResponse } from "../types/ToolContracts"

/** Local read/diagnostic tools with workspace I/O authority. */
export const IO_AUTHORITY_TOOLS = new Set<DietCodeDefaultTool>([
	DietCodeDefaultTool.FILE_READ,
	DietCodeDefaultTool.LIST_FILES,
	DietCodeDefaultTool.SEARCH,
	DietCodeDefaultTool.LIST_CODE_DEF,
	DietCodeDefaultTool.STABILITY_DIAGNOSE,
])

/** Tools that directly change workspace files. */
export const LOCAL_MUTATION_TOOLS = new Set<DietCodeDefaultTool>([
	DietCodeDefaultTool.FILE_NEW,
	DietCodeDefaultTool.FILE_EDIT,
	DietCodeDefaultTool.NEW_RULE,
	DietCodeDefaultTool.APPLY_PATCH,
	DietCodeDefaultTool.DIETCODE_KERNEL,
])

const PLAN_MODE_RESTRICTED_TOOLS = new Set<DietCodeDefaultTool>([
	DietCodeDefaultTool.FILE_NEW,
	DietCodeDefaultTool.FILE_EDIT,
	DietCodeDefaultTool.NEW_RULE,
	DietCodeDefaultTool.APPLY_PATCH,
])

const NON_MUTATING_MODES: LaneExecutionMode[] = [
	"read_only",
	"audit_only",
	"planning_only",
	"documentation_only",
	"diagnostic_only",
]

const TOOL_FAILURE_RESULT_PATTERN =
	/The tool execution failed with the following error:|The user denied this operation\.|Tool was interrupted and not executed|Skipping tool due to user rejecting/
const USER_DENIAL_RESULT_PATTERN = /The user denied this operation\.|user reject|user denied/i

export function isIoAuthorityTool(toolName: string): boolean {
	return IO_AUTHORITY_TOOLS.has(toolName as DietCodeDefaultTool)
}

export function isLocalMutationTool(toolName: string): boolean {
	return LOCAL_MUTATION_TOOLS.has(toolName as DietCodeDefaultTool)
}

export function getDeclaredMutationPaths(block: ToolUse): string[] {
	if (block.name !== DietCodeDefaultTool.APPLY_PATCH) return block.params.path?.trim() ? [block.params.path.trim()] : []
	const targets = new Set<string>()
	for (const line of block.params.input?.split("\n") ?? []) {
		const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s+(.+)$/.exec(line.trim())
		if (match?.[1]) targets.add(match[1].trim())
	}
	return [...targets]
}

export function hasWorkspaceLocalIoAuthority(isSubagentExecution: boolean, isLocatedInWorkspace: boolean): boolean {
	return isSubagentExecution || isLocatedInWorkspace
}

export function shouldBypassGuardForParentIoTool(toolName: string): boolean {
	return isIoAuthorityTool(toolName)
}

export function isNonMutatingLaneMode(mode: LaneExecutionMode): boolean {
	return NON_MUTATING_MODES.includes(mode)
}

export function shouldBypassGuardForLaneIoTool(mode: LaneExecutionMode, toolName: string): boolean {
	return isNonMutatingLaneMode(mode) && isIoAuthorityTool(toolName)
}

export function shouldUseIoAuthorityReadFastPath(toolName: string, laneMode?: LaneExecutionMode): boolean {
	if (!isIoAuthorityTool(toolName)) return false
	return laneMode === undefined || isNonMutatingLaneMode(laneMode)
}

export function computeFastIoReservedSlots(poolCapacity: number): number {
	if (poolCapacity <= 1) return 0
	return Math.min(Math.max(1, Math.floor(poolCapacity / 3)), poolCapacity - 1)
}

export function shouldSkipPreToolUseForParentIoTool(toolName: string, isSubagentExecution: boolean): boolean {
	return !isSubagentExecution && isIoAuthorityTool(toolName)
}

export function shouldSkipPreToolUseForLaneIoTool(mode: LaneExecutionMode, toolName: string): boolean {
	return shouldBypassGuardForLaneIoTool(mode, toolName)
}

export function shouldDeferParentGuardPostExecution(toolName: string, isSubagentExecution: boolean): boolean {
	return !isSubagentExecution && !isIoAuthorityTool(toolName)
}

export function shouldDeferLaneGuardPostExecution(mode: LaneExecutionMode, toolName: string): boolean {
	return !shouldBypassGuardForLaneIoTool(mode, toolName)
}

export function resolveSessionSpiderEngine(config: TaskConfig): SpiderEngine | undefined {
	return config.universalGuard?.getSpiderEngine()
}

export function shouldCloseBrowserBetweenTools(toolName: string, hasActiveBrowserSession: boolean): boolean {
	return hasActiveBrowserSession && toolName !== DietCodeDefaultTool.BROWSER
}

export function shouldSkipLayerInjectionForParentIoTool(toolName: string): boolean {
	return isIoAuthorityTool(toolName)
}

export function appendSessionStabilityContext(config: TaskConfig, relPath: string, fileText: string): string {
	const guard = config.universalGuard
	if (!guard || config.isSubagentExecution) return fileText

	const nodes = guard.engine.getNodes()
	const absPath = path.resolve(config.cwd, relPath)
	let node = nodes.get(relPath) ?? nodes.get(absPath)
	if (!node) {
		for (const [key, candidate] of nodes) {
			if (key === relPath || key.endsWith(`/${relPath}`) || key.endsWith(`\\${relPath}`)) {
				node = candidate
				break
			}
		}
	}
	if (!node) return fileText

	const intentMatch = fileText.match(/\[INTEGRITY_INTENT:\s*(.*?)\]/)
	const intent = intentMatch ? intentMatch[1] : "Not explicitly documented."
	return (
		fileText +
		`\n\n[STABILITY_CONTEXT]\n` +
		`Layer: ${node.layer?.toUpperCase() || "UNKNOWN"}\n` +
		`Architectural Intent: ${intent}\n` +
		`Metrics: Logic Density: ${SafeNumber.format(node.logicDensity, 2)}, I/O Entropy: ${SafeNumber.format(node.ioEntropy, 2)}\n` +
		`Status: ${node.orphaned ? "ORPHANED" : "INTEGRATED"}\n`
	)
}

export interface ExecuteOptions {
	/** Set to zero when the backend owns timeout/cancellation. */
	timeoutMs?: number
	maxRetries?: number
	backoffMs?: number
	concurrencyGroup?: string
}

interface ReliabilityContext {
	taskId: string
	permitId: string
	stages: ExecutionFunnelStage[]
}

interface CircuitState {
	failures: number
	lastFailureTime: number
}

class ExecutionReliability {
	private readonly activeOperations = new Map<string, number>()
	private readonly queues = new Map<string, Array<() => void>>()
	private readonly circuits = new Map<string, CircuitState>()
	private readonly storage = new AsyncLocalStorage<ReliabilityContext>()
	private readonly maxConcurrency = 5
	private readonly circuitOpenThreshold = 20
	private readonly circuitResetMs = 30_000
	private readonly defaultTimeoutMs = 60_000

	runWithPermit<T>(context: ReliabilityContext, operation: () => Promise<T>): Promise<T> {
		return this.storage.run(context, operation)
	}

	assertActivePermit(taskId: string): void {
		const context = this.storage.getStore()
		if (!context || context.taskId !== taskId || !context.permitId) {
			throw new Error("Tool dispatch rejected: no current ExecutionFunnel permit.")
		}
	}

	recordApproval(approved: boolean, source: "user" | "subagent_authority" | "automatic"): void {
		const context = this.storage.getStore()
		if (!context) return
		context.stages.push(
			approved
				? pass("approval", `${source} approval admitted the operation`)
				: fail("approval", `${source} approval denied the operation`, true),
		)
	}

	async execute<T>(taskId: string, operation: () => Promise<T>, options: ExecuteOptions = {}): Promise<T> {
		const context = this.storage.getStore()
		if (context && context.taskId !== taskId) {
			throw new Error("Execution permit task mismatch; nested operation rejected.")
		}
		const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
		const maxRetries = options.maxRetries ?? 3
		const backoffMs = options.backoffMs ?? 500
		const concurrencyGroup = options.concurrencyGroup ?? "default"
		const circuitKey = `${taskId}:${concurrencyGroup}`
		let attempts = 0

		while (attempts < maxRetries) {
			if (this.isCircuitOpen(circuitKey)) {
				context?.stages.push(fail("reliability.circuit", `Task-scoped ${concurrencyGroup} circuit is open`, true))
				throw new Error(`[ExecutionFunnel] Circuit is OPEN for task ${taskId} (${concurrencyGroup}).`)
			}
			try {
				const result = await this.withConcurrency(concurrencyGroup, () => {
					const running = operation()
					return timeoutMs > 0 ? this.withTimeout(taskId, running, timeoutMs) : running
				})
				this.onSuccess(circuitKey)
				context?.stages.push(pass("reliability", `Operation completed after ${attempts + 1} attempt(s)`))
				return result
			} catch (error) {
				attempts++
				const retryable = this.isRetryableError(error)
				if (attempts >= maxRetries || !retryable) {
					this.onFailure(circuitKey)
					Logger.error(`[ExecutionFunnel] Task ${taskId} failed permanently after ${attempts} attempts:`, error)
					throw error
				}
				const delay = backoffMs * 2 ** (attempts - 1)
				context?.stages.push(pass("reliability.retry", `Retry ${attempts}/${maxRetries} after ${delay}ms`))
				await new Promise<void>((resolve) => setTimeout(resolve, delay))
			}
		}
		throw new Error(`[ExecutionFunnel] Task ${taskId} failed after max retries`)
	}

	private async withConcurrency<T>(group: string, operation: () => Promise<T>): Promise<T> {
		if ((this.activeOperations.get(group) ?? 0) >= this.maxConcurrency) {
			await new Promise<void>((resolve) => {
				const queue = this.queues.get(group) ?? []
				queue.push(resolve)
				this.queues.set(group, queue)
			})
		}
		this.activeOperations.set(group, (this.activeOperations.get(group) ?? 0) + 1)
		try {
			return await operation()
		} finally {
			this.activeOperations.set(group, Math.max(0, (this.activeOperations.get(group) ?? 1) - 1))
			const queue = this.queues.get(group)
			const next = queue?.shift()
			if (queue?.length === 0) this.queues.delete(group)
			next?.()
		}
	}

	private async withTimeout<T>(taskId: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		const timeout = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(
				() => reject(new Error(`[ExecutionFunnel] Task ${taskId} timed out after ${timeoutMs}ms`)),
				timeoutMs,
			)
		})
		try {
			return await Promise.race([promise, timeout])
		} finally {
			if (timeoutId) clearTimeout(timeoutId)
		}
	}

	private isRetryableError(error: unknown): boolean {
		const message = (error instanceof Error ? error.message : String(error)).toUpperCase()
		return [
			"ABORTED",
			"CONTENTION",
			"DEADLINE EXCEEDED",
			"SQLITE_BUSY",
			"SQLITE_LOCKED",
			"TIMEOUT",
			"RATE_LIMIT",
			"UNAVAILABLE",
		].some((token) => message.includes(token))
	}

	private isCircuitOpen(key: string): boolean {
		const state = this.circuits.get(key)
		if (!state || state.failures < this.circuitOpenThreshold) return false
		if (Date.now() - state.lastFailureTime < this.circuitResetMs) return true
		this.circuits.delete(key)
		return false
	}

	private onSuccess(key: string): void {
		const state = this.circuits.get(key)
		if (!state) return
		state.failures = Math.max(0, state.failures - 1)
		if (state.failures === 0) this.circuits.delete(key)
	}

	private onFailure(key: string): void {
		const state = this.circuits.get(key) ?? { failures: 0, lastFailureTime: 0 }
		state.failures++
		state.lastFailureTime = Date.now()
		this.circuits.set(key, state)
	}
}

export interface ExecutionFunnelInput {
	config: TaskConfig
	block: ToolUse
	registered: boolean
	lane?: "parent" | "sibling" | "subagent"
	laneMode?: LaneExecutionMode
	allowedInLane?: boolean
	laneDenialReason?: string
	signal?: AbortSignal
	collisionCheck?: () => Promise<string | undefined>
	operation: () => Promise<ToolResponse>
	/** Non-authoritative result enrichment that must settle before terminal classification. */
	postProcess?: (result: ToolResponse) => Promise<ToolResponse>
}

export interface ExecutionFunnelOutcome {
	event: ExecutionFunnelEvent
	result?: ToolResponse
	warning?: string
	error?: unknown
}

interface MutableDecision {
	config: TaskConfig
	block: ToolUse
	invocationId: string
	invocationKey: string
	ownsInvocation: boolean
	permitId?: string
	lane: "parent" | "sibling" | "subagent"
	stages: ExecutionFunnelStage[]
	startedAt: number
}

function pass(stage: string, reason: string): ExecutionFunnelStage {
	return { stage, result: "passed", reason, decisive: false }
}

function fail(stage: string, reason: string, decisive = false): ExecutionFunnelStage {
	return { stage, result: "failed", reason, decisive }
}

function skip(stage: string, reason: string): ExecutionFunnelStage {
	return { stage, result: "skipped", reason, decisive: false }
}

function na(stage: string, reason: string): ExecutionFunnelStage {
	return { stage, result: "not_applicable", reason, decisive: false }
}

function resultContains(result: unknown, pattern: RegExp): boolean {
	const stack: unknown[] = [result]
	const seen = new Set<object>()
	for (let visited = 0; stack.length > 0 && visited < 4_096; visited++) {
		const value = stack.pop()
		if (typeof value === "string" && pattern.test(value)) return true
		if (value && typeof value === "object" && !seen.has(value)) {
			seen.add(value)
			for (const [key, nested] of Object.entries(value)) if (key !== "data") stack.push(nested)
		}
	}
	return false
}

export function isAuthoritativeToolFailure(result: unknown): boolean {
	return resultContains(result, TOOL_FAILURE_RESULT_PATTERN)
}

export class ExecutionFunnel {
	private readonly reliability = new ExecutionReliability()
	private readonly activeInvocations = new Set<string>()
	private sequence = 0

	/** Reliability is part of this authority, not an independent handler gate. */
	executeReliableAction<T>(taskId: string, operation: () => Promise<T>, options: ExecuteOptions = {}): Promise<T> {
		return this.reliability.execute(taskId, operation, options)
	}

	/** Coordinator dispatch is fail-closed when callers bypass this funnel. */
	assertActivePermit(taskId: string): void {
		this.reliability.assertActivePermit(taskId)
	}

	/** The only handler dispatch primitive used by coordinators and governed lanes. */
	dispatchAuthorizedOperation(
		config: TaskConfig,
		block: ToolUse,
		handler: { execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> },
	): Promise<ToolResponse> {
		this.assertActivePermit(config.ulid)
		return handler.execute(config, block)
	}

	/** Approval is a funnel stage even though handlers provide the operation-specific prompt. */
	recordApprovalDecision(approved: boolean, source: "user" | "subagent_authority" | "automatic"): void {
		this.reliability.recordApproval(approved, source)
	}

	/** Handlers report consent facts here; only the funnel mutates turn rejection state. */
	recordUserDecision(taskState: TaskState, approved: boolean): void {
		taskState.didRejectTool = !approved
		this.recordApprovalDecision(approved, "user")
	}

	getCurrentEvent(config: TaskConfig): ExecutionFunnelEvent | undefined {
		return this.getCurrentEventFromState(config.taskState)
	}

	getCurrentEventFromState(taskState: Pick<TaskState, "executionFunnelEventJson">): ExecutionFunnelEvent | undefined {
		const value = taskState.executionFunnelEventJson
		if (!value) return undefined
		try {
			return JSON.parse(value) as ExecutionFunnelEvent
		} catch {
			return undefined
		}
	}

	/** Records failures that occur while a transport adapter is preparing the canonical TaskConfig. */
	recordPreparationFailure(
		taskState: TaskState,
		taskId: string,
		block: ToolUse,
		lane: "parent" | "sibling" | "subagent",
		error: unknown,
	): ExecutionFunnelEvent {
		const invocationId = block.call_id?.trim() || `${lane}:${block.name}:preparation:${++this.sequence}`
		const existing = this.getCurrentEventFromState(taskState)
		if (existing?.invocationId === invocationId && existing.terminal) return existing
		const completedAt = Date.now()
		const reason = error instanceof Error ? error.message : String(error)
		const event: ExecutionFunnelEvent = Object.freeze({
			schemaVersion: EXECUTION_FUNNEL_SCHEMA_VERSION,
			taskId,
			invocationId,
			toolName: block.name,
			lane,
			phase: "failed",
			kind: "failure",
			reasonCode: "preparation_failed",
			terminal: true,
			reason,
			stages: [fail("adapter.preparation", reason, true)],
			workspaceRevision: taskState.workspaceContentVersion,
			evaluatedAt: completedAt,
			completedAt,
		})
		taskState.executionFunnelEventJson = JSON.stringify(event)
		if (lane !== "subagent") taskState.didAlreadyUseTool = true
		taskState.executionFunnelHistory = [...(taskState.executionFunnelHistory ?? []).slice(-24), event]
		return event
	}

	/** Sole projection used by the stream/presentation adapters after dispatch. */
	getTurnControl(
		taskState: Pick<TaskState, "executionFunnelEventJson" | "didRejectTool" | "didAlreadyUseTool">,
		parallelEnabled: boolean,
	): { rejected: boolean; toolBudgetExhausted: boolean; suppressFurtherContent: boolean } {
		const event = this.getCurrentEventFromState(taskState)
		const rejected = event ? event.phase === "denied" : taskState.didRejectTool
		const terminalInvocation = event ? event.terminal : taskState.didAlreadyUseTool
		const toolBudgetExhausted = !parallelEnabled && terminalInvocation
		return { rejected, toolBudgetExhausted, suppressFurtherContent: rejected || toolBudgetExhausted }
	}

	async execute(input: ExecutionFunnelInput): Promise<ExecutionFunnelOutcome> {
		const { config, block } = input
		const lane = input.lane ?? (config.isSubagentExecution ? "subagent" : "parent")
		const requestedInvocationId = block.call_id?.trim() || `${lane}:${block.name}:${++this.sequence}`
		const invocationKey = `${config.taskId}:${requestedInvocationId}`
		const priorInvocation = config.taskState.executionFunnelHistory?.find(
			(event) => event.invocationId === requestedInvocationId && event.terminal,
		)
		const duplicateInvocation = priorInvocation !== undefined || this.activeInvocations.has(invocationKey)
		const invocationId = duplicateInvocation ? `${requestedInvocationId}:replay:${++this.sequence}` : requestedInvocationId
		const decision: MutableDecision = {
			config,
			block,
			invocationId,
			invocationKey,
			ownsInvocation: false,
			lane,
			stages: [],
			startedAt: Date.now(),
		}
		this.publish(decision, "evaluating", "allow", "authorized", false, "Execution admission is being evaluated.")
		if (duplicateInvocation) {
			return this.block(
				decision,
				"duplicate_invocation",
				"invocation.idempotency",
				priorInvocation
					? `Invocation '${requestedInvocationId}' already has a terminal ${priorInvocation.phase} outcome; replay was rejected.`
					: `Invocation '${requestedInvocationId}' is already executing; concurrent replay was rejected.`,
			)
		}
		this.activeInvocations.add(invocationKey)
		decision.ownsInvocation = true
		decision.stages.push(pass("invocation.idempotency", "No terminal outcome exists for this invocation ID"))
		try {
			if (!input.registered) {
				return this.block(
					decision,
					"unregistered_tool",
					"registration",
					`No handler registered for tool '${block.name}'.`,
				)
			}
			decision.stages.push(pass("registration", `Handler registered for '${block.name}'`))
			if (!block.params.path && block.params.absolutePath) {
				block.params.path = block.params.absolutePath
				decision.stages.push(pass("parameters.normalization", "Normalized absolutePath to the canonical path field"))
			} else {
				decision.stages.push(na("parameters.normalization", "No global parameter normalization required"))
			}
			const browserSession = config.services.browserSession
			if (browserSession && shouldCloseBrowserBetweenTools(block.name, browserSession.hasActiveSession())) {
				void browserSession.closeBrowser().catch(() => undefined)
				decision.stages.push(pass("browser.lifecycle", "Previous browser session close was scheduled"))
			} else {
				decision.stages.push(na("browser.lifecycle", "No browser lifecycle transition required"))
			}

			if (config.taskState.didRejectTool) {
				return this.block(
					decision,
					"prior_user_rejection",
					"task.user_rejection",
					"Skipping tool because the user rejected a previous tool in this turn.",
					"deny",
					"denied",
				)
			}
			decision.stages.push(pass("task.user_rejection", "No prior user rejection applies"))

			if (lane !== "subagent" && !config.enableParallelToolCalling && config.taskState.didAlreadyUseTool) {
				return this.block(
					decision,
					"single_tool_budget_exhausted",
					"task.tool_budget",
					`A tool has already executed in this non-parallel turn; '${block.name}' was not run.`,
				)
			}
			decision.stages.push(pass("task.tool_budget", "Invocation is within the turn tool budget"))

			if (input.allowedInLane === false) {
				return this.block(
					decision,
					"lane_tool_denied",
					"lane.authority",
					input.laneDenialReason || `Tool '${block.name}' is not authorized in this governed lane.`,
				)
			}
			decision.stages.push(
				input.laneMode
					? pass("lane.authority", `${input.laneMode} lane admitted tool`)
					: na("lane.authority", "Parent invocation"),
			)

			const cancelled = this.cancellationReason(input)
			if (cancelled) return this.block(decision, "task_cancelled", "cancellation.initial", cancelled, "cancel", "cancelled")
			decision.stages.push(pass("cancellation.initial", "Task and invocation signals are active"))

			if (!isIoAuthorityTool(block.name) && block.params.path) {
				const { getLayer } = require("@/utils/joy-zoning")
				block.layer = getLayer(path.resolve(config.cwd, block.params.path))
				decision.stages.push(pass("target.layer", `Resolved target layer as ${block.layer || "unknown"}`))
			} else {
				decision.stages.push(na("target.layer", "Layer injection is unnecessary for this invocation"))
			}

			const planBlock = this.evaluatePlanMode(config, block)
			if (planBlock) {
				return this.block(decision, "plan_mode_restriction", "plan_mode", planBlock)
			}
			decision.stages.push(pass("plan_mode", "Mode and target layer authorize this tool"))

			const mutation = isLocalMutationTool(block.name)
			decision.stages.push(
				pass(
					"classification",
					mutation
						? "Workspace mutation"
						: isIoAuthorityTool(block.name)
							? "Workspace query"
							: "Side-effect or control tool",
				),
			)
			const fencingError = await this.verifyFencing(config, mutation)
			if (fencingError) return this.block(decision, "stale_fencing_token", "mutation.fencing", fencingError)
			decision.stages.push(
				mutation
					? pass("mutation.fencing", "Mutation fencing authority is current")
					: na("mutation.fencing", "Not a local workspace mutation"),
			)

			if (input.collisionCheck) {
				const collision = await input.collisionCheck()
				if (collision) return this.block(decision, "lane_collision", "lane.collision", collision)
				decision.stages.push(pass("lane.collision", "No governed lane collision detected"))
			} else {
				decision.stages.push(na("lane.collision", "No collision provider for this invocation"))
			}

			const roadmapError = await this.preflightRoadmapWrite(config, block)
			if (roadmapError) return this.block(decision, "roadmap_write_denied", "roadmap.preflight", roadmapError)
			decision.stages.push(pass("roadmap.preflight", "Roadmap policy allows the operation"))

			const guard = config.universalGuard
			const guardBypass = input.laneMode
				? shouldBypassGuardForLaneIoTool(input.laneMode, block.name)
				: shouldBypassGuardForParentIoTool(block.name)
			let guardWarning: string | undefined
			if (guard && !guardBypass) {
				guard.setMode(config.mode)
				const policy = await guard.guardPreExecution(block)
				if (!policy.success) {
					return this.block(
						decision,
						"policy_denied",
						"policy.pre_execution",
						policy.error || "Execution denied by policy.",
					)
				}
				guardWarning = policy.warning
				decision.stages.push(pass("policy.pre_execution", policy.warning || "Policy admitted the operation"))
			} else {
				decision.stages.push(skip("policy.pre_execution", "Workspace I/O authority fast path"))
			}

			try {
				await this.runPreToolUseHook(config, block, input.laneMode)
				decision.stages.push(pass("hook.pre_tool_use", "PreToolUse hook admitted the operation"))
			} catch (error) {
				if (error instanceof PreToolUseHookCancellationError) {
					return this.block(decision, "hook_cancelled", "hook.pre_tool_use", error.message, "cancel", "cancelled")
				}
				throw error
			}

			const finalCancellation = this.cancellationReason(input)
			if (finalCancellation) {
				return this.block(decision, "task_cancelled", "cancellation.final", finalCancellation, "cancel", "cancelled")
			}
			decision.stages.push(pass("cancellation.final", "Authority remained current through admission"))

			decision.permitId = `${config.taskId}:${invocationId}:${decision.startedAt}`
			this.publish(
				decision,
				"authorized",
				"allow",
				"authorized",
				false,
				"All execution gates passed; one dispatch permit issued.",
			)
			this.publish(decision, "executing", "allow", "authorized", false, "The authorized operation is executing.")

			try {
				const rawResult = await this.reliability.runWithPermit(
					{ taskId: config.ulid, permitId: decision.permitId, stages: decision.stages },
					input.operation,
				)
				decision.stages.push(pass("dispatch", "Authorized handler returned exactly one result"))
				const rawDenied = resultContains(rawResult, USER_DENIAL_RESULT_PATTERN)
				const rawFailed = isAuthoritativeToolFailure(rawResult)
				const result = input.postProcess && !rawDenied && !rawFailed ? await input.postProcess(rawResult) : rawResult
				decision.stages.push(
					input.postProcess && !rawDenied && !rawFailed
						? pass("result.post_process", "Authorized result enrichment completed")
						: skip("result.post_process", "No successful-result enrichment was required"),
				)
				const operationFailed = rawFailed || isAuthoritativeToolFailure(result)
				const postHookCancellation = await this.runPostToolUseHook(
					config,
					block,
					result,
					!operationFailed,
					decision.startedAt,
				)
				if (postHookCancellation) {
					decision.stages.push(fail("hook.post_tool_use", postHookCancellation, true))
					await config.callbacks.cancelTask()
					return {
						result,
						event: this.publish(decision, "cancelled", "cancel", "hook_cancelled", true, postHookCancellation),
					}
				}
				decision.stages.push(pass("hook.post_tool_use", "PostToolUse hook completed without cancellation"))

				if (guard && !guardBypass) {
					const post = async () => {
						const policy = await guard.guardPostExecution(block, result)
						if (policy.warning) Logger.debug(`[ExecutionFunnel] Post-execution policy diagnostic:\n${policy.warning}`)
					}
					if (
						input.laneMode
							? shouldDeferLaneGuardPostExecution(input.laneMode, block.name)
							: shouldDeferParentGuardPostExecution(block.name, config.isSubagentExecution)
					) {
						void post().catch((error) =>
							Logger.warn("[ExecutionFunnel] Deferred post-policy diagnostic failed:", error),
						)
						decision.stages.push(pass("policy.post_execution", "Post-policy diagnostic scheduled"))
					} else {
						await post()
						decision.stages.push(pass("policy.post_execution", "Post-policy diagnostic completed"))
					}
				} else {
					decision.stages.push(skip("policy.post_execution", "Workspace I/O authority fast path"))
				}

				if (resultContains(result, USER_DENIAL_RESULT_PATTERN)) {
					return {
						result,
						event: this.publish(decision, "denied", "deny", "user_denied", true, "The user denied the operation."),
						warning: guardWarning,
					}
				}
				if (operationFailed) {
					return {
						result,
						event: this.publish(
							decision,
							"failed",
							"failure",
							"operation_failed",
							true,
							"The operation returned an authoritative failure result.",
						),
						warning: guardWarning,
					}
				}
				if (mutation) {
					config.taskState.workspaceStateVersion = (config.taskState.workspaceStateVersion ?? 0) + 1
					config.taskState.workspaceContentVersion = (config.taskState.workspaceContentVersion ?? 0) + 1
					decision.stages.push(pass("workspace.revision", "Workspace revision advanced after successful mutation"))
				}
				return {
					result,
					event: this.publish(
						decision,
						"succeeded",
						"success",
						"operation_succeeded",
						true,
						"The operation completed successfully.",
					),
					warning: guardWarning,
				}
			} catch (error) {
				const cancellation = this.cancellationReason(input)
				if (cancellation || error instanceof PreToolUseHookCancellationError) {
					return {
						error,
						event: this.publish(
							decision,
							"cancelled",
							"cancel",
							"task_cancelled",
							true,
							cancellation || (error as Error).message,
						),
					}
				}
				decision.stages.push(fail("dispatch", error instanceof Error ? error.message : String(error), true))
				return {
					error,
					event: this.publish(
						decision,
						"failed",
						"failure",
						"operation_failed",
						true,
						error instanceof Error ? error.message : String(error),
					),
				}
			}
		} catch (error) {
			decision.stages.push(fail("funnel.internal", error instanceof Error ? error.message : String(error), true))
			return {
				error,
				event: this.publish(
					decision,
					"failed",
					"failure",
					"operation_failed",
					true,
					error instanceof Error ? error.message : String(error),
				),
			}
		}
	}

	private block(
		decision: MutableDecision,
		reasonCode: ExecutionFunnelReasonCode,
		stage: string,
		reason: string,
		kind: "block" | "deny" | "cancel" = "block",
		phase: "blocked" | "denied" | "cancelled" = "blocked",
	): ExecutionFunnelOutcome {
		decision.stages.push(fail(stage, reason, true))
		return { event: this.publish(decision, phase, kind, reasonCode, true, reason) }
	}

	private publish(
		decision: MutableDecision,
		phase: ExecutionFunnelPhase,
		kind: ExecutionFunnelEvent["kind"],
		reasonCode: ExecutionFunnelReasonCode,
		terminal: boolean,
		reason: string,
	): ExecutionFunnelEvent {
		const previous = this.getCurrentEvent(decision.config)
		if (previous?.invocationId === decision.invocationId && previous.terminal) return previous
		const now = Date.now()
		const event: ExecutionFunnelEvent = Object.freeze({
			schemaVersion: EXECUTION_FUNNEL_SCHEMA_VERSION,
			taskId: decision.config.taskId,
			invocationId: decision.invocationId,
			permitId: decision.permitId,
			toolName: decision.block.name,
			lane: decision.lane,
			phase,
			kind,
			reasonCode,
			terminal,
			reason,
			stages: decision.stages.map((stage) => Object.freeze({ ...stage })),
			workspaceRevision: decision.config.taskState.workspaceContentVersion,
			evaluatedAt: now,
			completedAt: terminal ? now : undefined,
		})
		decision.config.taskState.executionFunnelEventJson = JSON.stringify(event)
		const invocationContext = getToolInvocationContext()
		if (invocationContext?.invocationId === decision.invocationId) invocationContext.executionFunnelEvent = event
		if (terminal) {
			if (decision.ownsInvocation) this.activeInvocations.delete(decision.invocationKey)
			if (decision.lane !== "subagent") decision.config.taskState.didAlreadyUseTool = true
			const history = decision.config.taskState.executionFunnelHistory ?? []
			decision.config.taskState.executionFunnelHistory = [...history.slice(-24), event]
		}
		return event
	}

	private cancellationReason(input: ExecutionFunnelInput): string | undefined {
		if (input.config.taskState.abort) return "Task cancellation is active; the operation was not executed."
		if (input.signal?.aborted || input.config.taskSignal?.aborted) {
			return "Invocation cancellation is active; the operation was not executed."
		}
		return undefined
	}

	private evaluatePlanMode(config: TaskConfig, block: ToolUse): string | undefined {
		if (!config.strictPlanModeEnabled || config.mode !== "plan") return undefined
		let targetPath: string | undefined
		try {
			const { getTargetPath } = require("@/utils/joy-zoning")
			targetPath = getTargetPath(block.params)
		} catch {
			targetPath = block.params.path
		}
		const layer = targetPath ? config.universalGuard?.getLayerForPath(targetPath) : undefined
		const layerRestricted =
			(layer === "domain" || layer === "core") &&
			(block.name === DietCodeDefaultTool.BASH || block.name === DietCodeDefaultTool.MCP_USE)
		if (!PLAN_MODE_RESTRICTED_TOOLS.has(block.name) && !layerRestricted) return undefined
		if (layerRestricted) {
			return `Tool '${block.name}' targets the ${layer?.toUpperCase()} layer and is restricted in PLAN MODE.`
		}
		return `Tool '${block.name}' is not available in PLAN MODE. Finalize the plan before executing mutations.`
	}

	private async verifyFencing(config: TaskConfig, mutation: boolean): Promise<string | undefined> {
		if (!mutation || !config.taskState.activeLockClaim) return undefined
		const activeClaim = config.taskState.activeLockClaim
		const claim = ("lockClaim" in activeClaim ? activeClaim.lockClaim : activeClaim) as
			| import("@shared/governance/lockTypes").LockClaim
			| undefined
		if (!claim) return "Mutating governed lane is missing its durable lock claim."
		try {
			await createLockAuthority().assertCurrentFencingToken(claim.resourceKey, String(claim.fencingToken), config.cwd)
			return undefined
		} catch (error) {
			return error instanceof Error ? error.message : String(error)
		}
	}

	private async preflightRoadmapWrite(config: TaskConfig, block: ToolUse): Promise<string | undefined> {
		if (!isLocalMutationTool(block.name)) return undefined
		try {
			const { preflightRoadmapWrite, targetsRoadmapFile } = require("@/services/roadmap/RoadmapNativeBridge")
			if (!targetsRoadmapFile(block.name, block.params)) return undefined
			const preflight = await preflightRoadmapWrite(block.name, block.params, config.cwd)
			return preflight.block ? preflight.message || "Roadmap write blocked." : undefined
		} catch {
			const { getRoadmapConfig } = require("@/services/roadmap/RoadmapConfig")
			const roadmapConfig = getRoadmapConfig()
			return roadmapConfig.enabled && roadmapConfig.fail_closed_completion_gates
				? "ROADMAP write guard failed — the target could not be verified safely."
				: undefined
		}
	}

	private async runPreToolUseHook(config: TaskConfig, block: ToolUse, laneMode?: LaneExecutionMode): Promise<void> {
		const fastPath = laneMode
			? shouldSkipPreToolUseForLaneIoTool(laneMode, block.name)
			: shouldSkipPreToolUseForParentIoTool(block.name, config.isSubagentExecution)
		if (fastPath || block.name === DietCodeDefaultTool.ATTEMPT || !config.hooksEnabled) return

		const { executeHook } = await import("@core/hooks/hook-executor")
		const pendingToolInfo: Record<string, unknown> = { tool: block.name }
		for (const key of ["path", "command", "regex", "url", "tool_name", "server_name", "uri"] as const) {
			if (block.params[key]) pendingToolInfo[key] = block.params[key]
		}
		for (const key of ["content", "diff"] as const) {
			if (typeof block.params[key] === "string") pendingToolInfo[key] = block.params[key]?.slice(0, 200)
		}
		const result = await executeHook({
			hookName: "PreToolUse",
			hookInput: { preToolUse: { toolName: block.name, parameters: block.params } },
			isCancellable: true,
			say: config.callbacks.say,
			setActiveHookExecution: config.callbacks.setActiveHookExecution,
			clearActiveHookExecution: config.callbacks.clearActiveHookExecution,
			messageStateHandler: config.messageState,
			taskId: config.taskId,
			hooksEnabled: true,
			toolName: block.name,
			pendingToolInfo,
		})
		if (result.cancel === true) {
			await config.callbacks.clearActiveHookExecution()
			await config.callbacks.cancelTask()
			throw new PreToolUseHookCancellationError(result.errorMessage || "PreToolUse hook requested cancellation")
		}
		if (config.taskState.abort) throw new PreToolUseHookCancellationError("Task was aborted during PreToolUse")
		if (result.contextModification) this.addHookContext(config, result.contextModification, "PreToolUse")
	}

	private async runPostToolUseHook(
		config: TaskConfig,
		block: ToolUse,
		result: ToolResponse,
		success: boolean,
		startedAt: number,
	): Promise<string | undefined> {
		if (block.name === DietCodeDefaultTool.ATTEMPT || !config.hooksEnabled) return undefined
		const { executeHook } = await import("@core/hooks/hook-executor")
		const hookResult = await executeHook({
			hookName: "PostToolUse",
			hookInput: {
				postToolUse: {
					toolName: block.name,
					parameters: block.params,
					result: typeof result === "string" ? result : JSON.stringify(result),
					success,
					executionTimeMs: Date.now() - startedAt,
				},
			},
			isCancellable: true,
			say: config.callbacks.say,
			setActiveHookExecution: config.callbacks.setActiveHookExecution,
			clearActiveHookExecution: config.callbacks.clearActiveHookExecution,
			messageStateHandler: config.messageState,
			taskId: config.taskId,
			hooksEnabled: true,
			toolName: block.name,
		})
		if (hookResult.contextModification) this.addHookContext(config, hookResult.contextModification, "PostToolUse")
		return hookResult.cancel === true ? hookResult.errorMessage || "PostToolUse hook requested cancellation" : undefined
	}

	private addHookContext(config: TaskConfig, rawContext: string, source: string): void {
		const context = rawContext.trim()
		if (!context) return
		const lines = context.split("\n")
		const match = /^([A-Z_]+):\s*(.*)/.exec(lines[0])
		const contextType = match?.[1]?.toLowerCase() || "general"
		const content = match ? [match[2], ...lines.slice(1).filter((line) => line.trim())].filter(Boolean).join("\n") : context
		resolveInvocationResultTarget(config.taskState.userMessageContent).push({
			type: "text",
			text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
		})
	}
}

/** Process-wide composition root; all circuit state remains task-scoped. */
export const executionFunnel = new ExecutionFunnel()

export async function refreshIgnorePolicyAfterToolMutation(
	block: ToolUse,
	cwd: string,
	controller: Pick<DietCodeIgnoreController, "refreshPolicy" | "refreshPolicyIfAffected">,
	localMutation: boolean,
): Promise<void> {
	const command = block.params.command ?? ""
	const readOnlyCommand =
		/^\s*(?:pwd|ls|find|rg|grep|git\s+(?:status|diff|log)|npm\s+(?:test|run\s+(?:test|typecheck|build)))/.test(command)
	if (block.name === DietCodeDefaultTool.BASH && readOnlyCommand) return
	if (block.name === DietCodeDefaultTool.BASH || block.name === DietCodeDefaultTool.MCP_USE) {
		await controller.refreshPolicy()
		return
	}
	if (!localMutation) return
	const targets = new Set<string>()
	if (block.name === DietCodeDefaultTool.APPLY_PATCH) {
		for (const line of block.params.input?.split("\n") ?? []) {
			const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s+(.+)$/.exec(line.trim())
			if (match?.[1]) targets.add(path.resolve(cwd, match[1]))
		}
	} else if (block.params.path?.trim()) {
		targets.add(path.resolve(cwd, block.params.path))
	}
	if (targets.size === 0) await controller.refreshPolicy()
	else for (const target of targets) await controller.refreshPolicyIfAffected(target)
}
