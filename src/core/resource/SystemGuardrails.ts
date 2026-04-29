import * as fs from "node:fs/promises"
import * as os from "node:os"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

/**
 * SystemGuardrails monitors system resources (memory, CPU, disk) and provides
 * warnings or prevents runaway resource consumption.
 */
export class SystemGuardrails {
	private static instance: SystemGuardrails
	private intervalId?: NodeJS.Timeout

	private readonly MEMORY_THRESHOLD_WARNING = 2 * 1024 * 1024 * 1024 // 2GB
	private readonly MEMORY_THRESHOLD_CRITICAL = 4 * 1024 * 1024 * 1024 // 4GB

	private readonly CPU_LOAD_THRESHOLD_WARNING = 0.8 // 80%
	private readonly CPU_LOAD_THRESHOLD_CRITICAL = 0.95 // 95%

	private readonly DISK_SPACE_THRESHOLD_WARNING = 5 * 1024 * 1024 * 1024 // 5GB

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

		Logger.info("Stability guardrails started")
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

	private async checkResources(): Promise<void> {
		const memory = process.memoryUsage()
		const rss = memory.rss

		if (rss > this.MEMORY_THRESHOLD_CRITICAL) {
			Logger.error(`CRITICAL MEMORY USAGE: ${Math.round(rss / 1024 / 1024)}MB. Exceeds critical threshold of 4GB.`)
		} else if (rss > this.MEMORY_THRESHOLD_WARNING) {
			Logger.warn(`High memory usage detected: ${Math.round(rss / 1024 / 1024)}MB.`)
		}

		// CPU Check
		const load = os.loadavg()[0] / os.cpus().length
		if (load > this.CPU_LOAD_THRESHOLD_CRITICAL) {
			Logger.error(`CRITICAL CPU PRESSURE: ${Math.round(load * 100)}%. System is struggling.`)
		} else if (load > this.CPU_LOAD_THRESHOLD_WARNING) {
			Logger.warn(`High CPU pressure detected: ${Math.round(load * 100)}%.`)
		}

		// Disk Check (DietCode home)
		try {
			const stats = await fs.statfs(HostProvider.get().globalStorageFsPath)
			const freeSpace = stats.bfree * stats.bsize
			if (freeSpace < this.DISK_SPACE_THRESHOLD_WARNING) {
				Logger.warn(`Low disk space in DietCode home: ${Math.round(freeSpace / 1024 / 1024)}MB remaining.`)
			}
		} catch {
			// Ignore if statfs fails
		}
	}

	/**
	 * Perform a one-time check for resource health.
	 */
	public async checkNow(): Promise<{ healthy: boolean; status: Record<string, any> }> {
		const rss = process.memoryUsage().rss
		const load = os.loadavg()[0] / os.cpus().length
		let freeDisk = -1

		try {
			const stats = await fs.statfs(HostProvider.get().globalStorageFsPath)
			freeDisk = stats.bfree * stats.bsize
		} catch {
			/* ignore */
		}

		const healthy = rss <= this.MEMORY_THRESHOLD_CRITICAL && load <= this.CPU_LOAD_THRESHOLD_CRITICAL

		return {
			healthy,
			status: {
				memoryMbs: Math.round(rss / 1024 / 1024),
				cpuPercent: Math.round(load * 100),
				diskFreeMbs: freeDisk > -1 ? Math.round(freeDisk / 1024 / 1024) : "unknown",
			},
		}
	}
}
