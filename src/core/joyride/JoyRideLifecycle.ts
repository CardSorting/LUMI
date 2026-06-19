/**
 * [LAYER: CORE]
 * JoyRide lifecycle helpers — centralized task/workspace flush and shutdown.
 */

import type { JoyRideCache } from "./JoyRideCache"
import { JOYRIDE_REASON } from "./JoyRideReasonCodes"
import type { JoyRideInvalidationReason } from "./types"

export function registerTaskLifecycle(cache: JoyRideCache, taskId: string, generation = 0): void {
	cache.registerTask(taskId, generation)
}

export async function withTaskCacheScope<T>(
	cache: JoyRideCache,
	taskId: string,
	generation: number,
	fn: () => Promise<T>,
): Promise<T> {
	registerTaskLifecycle(cache, taskId, generation)
	try {
		return await fn()
	} finally {
		// Caller decides when to flush; scope only registers generation.
	}
}

export function bumpTaskGeneration(cache: JoyRideCache, taskId: string, _reason = JOYRIDE_REASON.STALE_TASK_GENERATION): number {
	return cache.bumpTaskGeneration(taskId)
}

export function flushTaskGeneration(
	cache: JoyRideCache,
	taskId: string,
	reason: JoyRideInvalidationReason = "task_completed",
): number {
	return cache.flushTask(taskId, reason)
}

export function flushWorkspace(
	cache: JoyRideCache,
	workspaceFingerprint: string,
	reason: JoyRideInvalidationReason = "workspace_drift",
): number {
	return cache.invalidateWorkspace(workspaceFingerprint, reason)
}

export function shutdownJoyRide(cache: JoyRideCache, reason: JoyRideInvalidationReason = "workspace_closed"): number {
	return cache.shutdown(reason)
}
