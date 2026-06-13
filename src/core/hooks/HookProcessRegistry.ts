import { Logger } from "@/shared/services/Logger"
import type { IHookProcess } from "./IHookProcess"

/**
 * Global registry for tracking active hook processes.
 *
 * Purpose:
 * - Prevents zombie processes by tracking all running hooks
 * - Enables cleanup on extension deactivation
 * - Provides visibility into active hook executions
 *
 * Usage:
 * - HookProcess automatically registers/unregisters itself
 * - Extension deactivation calls terminateAll()
 * - Can query active count for monitoring/debugging
 */
const activeProcesses = new Set<IHookProcess>()

export const HookProcessRegistry = {
	/**
	 * Register a hook process as active.
	 * Called by HookProcess when execution starts.
	 */
	register(process: IHookProcess): void {
		activeProcesses.add(process)
	},

	/**
	 * Unregister a hook process (completed or failed).
	 * Called by HookProcess when execution ends.
	 */
	unregister(process: IHookProcess): void {
		activeProcesses.delete(process)
	},

	/**
	 * Terminate all active hook processes.
	 * Called during extension deactivation to prevent zombie processes.
	 */
	async terminateAll(): Promise<void> {
		const processes = Array.from(activeProcesses)
		if (processes.length > 0) {
			Logger.log(`[HookProcessRegistry] Terminating ${processes.length} active hook process(es)`)
			await Promise.all(processes.map((p) => p.terminate()))
			activeProcesses.clear()
		}
	},

	/**
	 * Get the number of currently active hook processes.
	 * Useful for monitoring and debugging.
	 */
	getActiveCount(): number {
		return activeProcesses.size
	},

	/**
	 * Clear the registry (for testing only).
	 * @internal
	 */
	resetForTesting(): void {
		activeProcesses.clear()
	},
}
