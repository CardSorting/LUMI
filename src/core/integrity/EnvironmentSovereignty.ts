import { exec } from "child_process"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { promisify } from "util"
import { Logger } from "@/shared/services/Logger"

const execAsync = promisify(exec)

export interface EnvironmentLease {
	fingerprint: string
	timestamp: number
	success: boolean
	error?: string
	details?: {
		nodeVersion?: string
		npmVersion?: string
		canWrite?: boolean
		nodePath?: string
	}
}

/**
 * EnvironmentSovereignty: A deterministic gatekeeper for the agent's environment.
 * Implements "Environmental Leases" to prevent redundant high-latency probes.
 */
export class EnvironmentSovereignty {
	private lease: EnvironmentLease | null = null
	private readonly LEASE_DURATION = 1000 * 60 * 60 // 1 hour lease

	constructor(private readonly cwd: string) {}

	/**
	 * Returns the current environment fingerprint based on PATH, USER, and CWD.
	 */
	public getFingerprint(): string {
		const env = process.env
		const data = `${env.PATH}|${env.USER || env.USERNAME}|${this.cwd}`
		return createHash("sha256").update(data).digest("hex")
	}

	/**
	 * Checks if the current lease is valid for the current environment.
	 */
	public isLeaseValid(): boolean {
		if (!this.lease) return false
		if (Date.now() - this.lease.timestamp > this.LEASE_DURATION) return false
		if (this.lease.fingerprint !== this.getFingerprint()) return false
		return true
	}

	/**
	 * Revokes the current lease, forcing a full probe on the next check.
	 */
	public revokeLease(): void {
		this.lease = null
		Logger.warn("[EnvironmentSovereignty] Environmental Lease revoked.")
	}

	/**
	 * Performs a full environment probe or returns the valid cached lease.
	 */
	public async validateEnvironment(): Promise<EnvironmentLease> {
		if (this.isLeaseValid() && this.lease) {
			return this.lease
		}

		Logger.info("[EnvironmentSovereignty] Performing full environmental probe...")
		const fingerprint = this.getFingerprint()
		const lease: EnvironmentLease = {
			fingerprint,
			timestamp: Date.now(),
			success: true,
			details: {},
		}

		try {
			// 1. Runtime Probe
			const { stdout: nodeVer } = await execAsync("node -v")
			const { stdout: npmVer } = await execAsync("npm -v")
			lease.details = lease.details || {}
			lease.details.nodeVersion = nodeVer.trim()
			lease.details.npmVersion = npmVer.trim()

			// 2. Path Probe
			const { stdout: nodePath } = await execAsync(process.platform === "win32" ? "where node" : "which node")
			lease.details.nodePath = nodePath.trim()

			// 3. Permission Probe (CWD)
			const canaryPath = path.join(this.cwd, ".dietcode_canary")
			try {
				await fs.writeFile(canaryPath, `canary-${Date.now()}`)
				await fs.unlink(canaryPath)
				lease.details.canWrite = true
			} catch (e) {
				const error = e as Error
				lease.success = false
				lease.error = `Permission Denied: Cannot write to workspace directory (${this.cwd}).\nError: ${error.message}`
				lease.details.canWrite = false
			}

			// 4. Constraint Probe (NVM alignment)
			try {
				const nvmrcPath = path.join(this.cwd, ".nvmrc")
				await fs.access(nvmrcPath)
				const requiredVer = (await fs.readFile(nvmrcPath, "utf-8")).trim()
				if (lease.details.nodeVersion && !lease.details.nodeVersion.includes(requiredVer)) {
					// We don't block on this, but we log it as a warning in the lease
					Logger.warn(
						`[EnvironmentSovereignty] NVM mismatch: Project requires ${requiredVer}, but found ${lease.details.nodeVersion}`,
					)
				}
			} catch {
				// No .nvmrc, ignore
			}
		} catch (e) {
			const error = e as Error
			lease.success = false
			lease.error = `Environment Probe Failed: Essential tools (node/npm) not found or inaccessible.\nError: ${error.message}`
		}

		this.lease = lease
		if (lease.success) {
			Logger.info(`[EnvironmentSovereignty] Lease issued for ${lease.details?.nodeVersion} at ${lease.details?.nodePath}`)
		} else {
			Logger.error(`[EnvironmentSovereignty] Lease REJECTED: ${lease.error}`)
		}

		return lease
	}
}
