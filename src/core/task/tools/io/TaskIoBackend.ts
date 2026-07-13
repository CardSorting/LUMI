import type { ToolUse } from "@core/assistant-message"
import type { TaskIoWorkClass } from "@core/task/latency/TaskLatencyTracker"
import { getToolInvocationContext, getToolInvocationSignal } from "../siblings/ToolInvocationContext"
import type { TaskConfig } from "../types/TaskConfig"
import { buildIoCoalesceKey, getIoRequestCoalescer, type IoCoalesceDisposition } from "./IoRequestCoalescer"
import { acquireParentIoSlot, type ParentIoWorkClass } from "./ParentIoBulkhead"
import type { PathAuthorityRecord } from "./TaskPathAuthorityCache"

export interface TaskIoBackendCallbacks {
	firstUsefulResult(): void
	incrementCounter(name: Parameters<NonNullable<TaskConfig["latencyTracker"]>["incrementCounter"]>[0], amount?: number): void
}

function invocationDetail(block: ToolUse): { invocationId: string; sequence?: number; toolName: string } {
	const context = getToolInvocationContext()
	return {
		invocationId: context?.invocationId ?? block.call_id ?? `${block.name}:single`,
		sequence: context?.sequence,
		toolName: block.name,
	}
}

function markStage(
	config: TaskConfig,
	block: ToolUse,
	stage: Parameters<NonNullable<TaskConfig["latencyTracker"]>["markIoStage"]>[0],
): void {
	config.latencyTracker?.markIoStage(stage, invocationDetail(block))
}

function toTrackerClass(workClass: ParentIoWorkClass): TaskIoWorkClass {
	return workClass === "small-read" ? "small-read" : workClass
}

/**
 * Execute validated parent I/O with task-owned cancellation, singleflight before
 * admission, and one bounded backend budget. Approval and policy checks remain
 * outside this helper and therefore run for every invocation.
 */
export async function executeTaskIoBackend<T>(
	config: TaskConfig,
	block: ToolUse,
	authority: PathAuthorityRecord | undefined,
	workClass: ParentIoWorkClass,
	execute: (callbacks: TaskIoBackendCallbacks, signal?: AbortSignal) => Promise<T>,
): Promise<T> {
	const tracker = config.latencyTracker
	const signal = getToolInvocationSignal() ?? config.taskSignal
	const detail = invocationDetail(block)
	const trackerClass = toTrackerClass(workClass)
	const firstUsefulResult = (): void => {
		markStage(config, block, "first_useful_result")
		tracker?.markOnce("useful_io_started", detail)
	}
	const callbacks: TaskIoBackendCallbacks = {
		firstUsefulResult,
		incrementCounter: (name, amount = 1) => tracker?.incrementCounter(name, amount),
	}

	markStage(config, block, "cache_lookup")
	const coalescer = getIoRequestCoalescer(config.taskId)
	const key =
		authority?.contained && authority.ignoreAllowed
			? buildIoCoalesceKey(block, {
					canonicalAbsoluteTarget: authority.canonicalTarget,
					filesystemGeneration: authority.filesystemGeneration,
					policyGeneration: authority.policyGeneration,
					workspaceIdentity: authority.workspaceIdentity,
				})
			: null
	markStage(config, block, "coalescer_admitted")

	const runLeader = async (): Promise<T> => {
		markStage(config, block, "backend_requested")
		tracker?.recordIoClassQueued(trackerClass)
		let release: (() => void) | undefined
		let active = false
		try {
			release = await acquireParentIoSlot(true, Boolean(config.taskState.swarmRuntime), { workClass, signal })
			active = true
			tracker?.recordIoClassStarted(trackerClass)
			markStage(config, block, "backend_started")
			const value = await execute(callbacks, signal)
			firstUsefulResult()
			markStage(config, block, "backend_completed")
			tracker?.markOnce("useful_io_completed", detail)
			tracker?.recordIoClassCompleted(trackerClass)
			active = false
			return value
		} catch (error) {
			if (signal?.aborted) {
				tracker?.recordIoClassCancelled(trackerClass, active ? "active" : "queued")
				active = false
			}
			throw error
		} finally {
			if (release) {
				markStage(config, block, "backend_completed")
				tracker?.markOnce("useful_io_completed", detail)
			}
			if (active) {
				tracker?.recordIoClassCompleted(trackerClass)
				active = false
			}
			release?.()
		}
	}

	if (!key) return runLeader()
	let disposition: IoCoalesceDisposition | undefined
	const value = await coalescer.coalesce(key, runLeader, signal, (next) => {
		disposition = next
		if (next === "cache_hit") tracker?.incrementCounter("cacheHits")
		else tracker?.incrementCounter("cacheMisses")
		if (next === "coalesced_waiter") tracker?.incrementCounter("coalescedWaiters")
	})
	if (disposition !== "leader") {
		// Cached/waiting invocations did no backend work of their own. Complete their
		// trace at shared-result availability without fabricating another spawn/read.
		markStage(config, block, "backend_requested")
		markStage(config, block, "backend_started")
		firstUsefulResult()
		markStage(config, block, "backend_completed")
	}
	return value
}
