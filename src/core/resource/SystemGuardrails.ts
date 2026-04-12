import { Logger } from "@/shared/services/Logger"

/**
 * SystemGuardrails monitors system resources (memory) and provides warnings
 * or prevents runaway resource consumption.
 */
export class SystemGuardrails {
	private static instance: SystemGuardrails
	private intervalId?: NodeJS.Timeout

	private readonly MEMORY_THRESHOLD_WARNING = 2 * 1024 * 1024 * 1024 // 2GB
	private readonly MEMORY_THRESHOLD_CRITICAL = 4 * 1024 * 1024 * 1024 // 4GB

	private constructor() {}

	public static getInstance(): SystemGuardrails {
		if (!SystemGuardrails.instance) {
			SystemGuardrails.instance = new SystemGuardrails()
		}
		return SystemGuardrails.instance
	}

	/**
	 * Start monitoring system resources.
	 */
	public start(intervalMs = 60000): void {
		if (this.intervalId) return

		this.intervalId = setInterval(() => {
			this.checkResources()
		}, intervalMs)

		// Unref to allow process to exit even if interval is running
		this.intervalId.unref()

		Logger.info("System guardrails started")
	}

	/**
	 * Stop monitoring system resources.
	 */
	public stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId)
			this.intervalId = undefined
		}
	}

	private checkResources(): void {
		const memory = process.memoryUsage()
		const rss = memory.rss

		if (rss > this.MEMORY_THRESHOLD_CRITICAL) {
			Logger.error(`CRITICAL MEMORY USAGE: ${Math.round(rss / 1024 / 1024)}MB. Exceeds critical threshold of 4GB.`)
		} else if (rss > this.MEMORY_THRESHOLD_WARNING) {
			Logger.warn(`High memory usage detected: ${Math.round(rss / 1024 / 1024)}MB.`)
		}
	}

	/**
	 * Perform a one-time check for resource health.
	 */
	public checkNow(): { memoryOk: boolean; message: string } {
		const rss = process.memoryUsage().rss
		const mb = Math.round(rss / 1024 / 1024)

		if (rss > this.MEMORY_THRESHOLD_CRITICAL) {
			return { memoryOk: false, message: `Critical memory usage: ${mb}MB` }
		}
		return { memoryOk: true, message: `Memory usage healthy: ${mb}MB` }
	}
}
