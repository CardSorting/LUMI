import { Logger } from "@/shared/services/Logger"
import type { FolderLockOptions, FolderLockResult, FolderLockWithRetryResult } from "./types"

/**
 * Retry configuration for folder lock acquisition
 */
export interface FolderLockRetryConfig {
	initialDelayMs: number
	incrementPerAttemptMs: number
	maxTotalTimeoutMs: number
}

/**
 * Default retry configuration for folder locks:
 * - 500ms initial wait - this is typically enough for most cases
 * - +1s backoff per attempt
 * - 30s max total timeout
 */
export const DEFAULT_RETRY_CONFIG: FolderLockRetryConfig = {
	initialDelayMs: 500,
	incrementPerAttemptMs: 1000,
	maxTotalTimeoutMs: 30000,
}

/**
 * Attempt to acquire a folder lock with retry logic.
 * This is a generic utility that works with any folder path.
 *
 * @param lockTarget - The folder path to lock
 * @param config - Optional retry configuration if defaults are not suitable
 * @returns Promise<boolean> true if lock acquired, false if timeout
 */
export async function tryAcquireFolderLockWithRetry(
	options: FolderLockOptions,
	config?: FolderLockRetryConfig,
): Promise<FolderLockWithRetryResult> {
	return await retryFolderLockAcquisition(async () => {
		try {
			Logger.debug(`Folder lock manager not available - skipping lock acquisition for ${options.lockTarget}`)
			return { acquired: false, skipped: true }
		} catch (error) {
			Logger.error("Error in folder lock acquisition attempt:", error)
			return { acquired: false }
		}
	}, config)
}

/**
 * Release a folder lock safely with error handling.
 * This is a generic utility that works with any folder path.
 *
 * @param lockTarget - The folder path to release
 */
export async function releaseFolderLock(taskId: string, lockTarget: string): Promise<void> {
	try {
		Logger.debug(`Folder lock manager not available - skipping lock release for ${taskId}:${lockTarget}`)
	} catch (error) {
		Logger.error("Error releasing folder lock:", error)
	}
}

/**
 * Acquire a folder lock with no retry
 * @param options - Folder lock options including heldBy
 * @returns Result indicating if lock was acquired and any conflicting lock
 */
export async function acquireFolderLock(options: FolderLockOptions): Promise<FolderLockResult> {
	Logger.debug(`Folder lock manager not available - cannot acquire lock for ${options.heldBy}:${options.lockTarget}`)
	return { acquired: false }
}

/**
 * Retry a folder lock acquisition with exponential backoff.
 * @param operation - Function that attempts to acquire the lock
 * @param config - Optional retry configuration, uses defaults if not provided
 * @returns Promise that resolves with acquisition status and details
 */
export async function retryFolderLockAcquisition(
	operation: () => Promise<FolderLockWithRetryResult>,
	config: FolderLockRetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<FolderLockWithRetryResult> {
	const startTime = Date.now()
	let attemptCount = 0
	let lastResult: FolderLockWithRetryResult | undefined

	while (true) {
		const elapsedTime = Date.now() - startTime

		// Retries = check timeout before starting next attempt
		if (elapsedTime >= config.maxTotalTimeoutMs) {
			Logger.warn(`Folder lock acquisition timed out after ${config.maxTotalTimeoutMs}ms`)
			return lastResult || { acquired: false }
		}

		// Attempt lock acquisition
		try {
			const result = await operation()
			lastResult = result

			// Return immediately if skipped or acquired
			if (result.skipped || result.acquired) {
				if (result.acquired && attemptCount > 0) {
					Logger.debug(`Folder lock acquired after ${attemptCount + 1} attempts (${elapsedTime}ms)`)
				}
				return result
			}
		} catch (error) {
			Logger.error(`Error during folder lock acquisition attempt ${attemptCount + 1}:`, error)
		}

		// Prep for next attempt
		attemptCount++
		const baseDelay = config.initialDelayMs + attemptCount * config.incrementPerAttemptMs
		const remainingTime = config.maxTotalTimeoutMs - (Date.now() - startTime)
		const delay = Math.min(baseDelay, Math.max(0, remainingTime))

		if (delay <= 0) {
			Logger.warn(`Folder lock acquisition timed out after ${config.maxTotalTimeoutMs}ms`)
			return lastResult || { acquired: false }
		}

		Logger.log(`Folder lock held by another instance, retrying in ${delay}ms (attempt ${attemptCount})`)
		await new Promise((resolve) => setTimeout(resolve, delay))
	}
}
