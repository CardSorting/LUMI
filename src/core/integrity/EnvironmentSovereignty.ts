import { exec } from "child_process"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"
import { Logger } from "@/shared/services/Logger"
import { StateManager } from "../storage/StateManager"

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
		shell?: string
		diskSpaceGB?: string
		hasNodeModules?: boolean
		memoryFreeGB?: string
		// Pass 3 additions
		detectedProjectTypes?: string[]
		toolchain?: Record<string, { version?: string; path?: string; status: "found" | "missing" | "broken" }>
		manifests?: string[]
		// Pass 4 additions
		hostname?: string
		shadowingAlerts?: string[]
	}
}

/**
 * EnvironmentSovereignty: A deterministic gatekeeper for the agent's environment.
 * Implements "Environmental Leases" (L0-L2 tiered validation) with support for
 * multi-language discovery, binary integrity, and machine-anchored fingerprints.
 */
export class EnvironmentSovereignty {
	private lease: EnvironmentLease | null = null
	private probePromise: Promise<EnvironmentLease> | null = null
	private readonly LEASE_DURATION = 1000 * 60 * 60 // 1 hour lease

	private static readonly PROJECT_MARKERS: Record<string, { manifest: string; probe: string }> = {
		node: { manifest: "package.json", probe: "node -v" },
		python: { manifest: "requirements.txt", probe: "python3 --version" },
		rust: { manifest: "Cargo.toml", probe: "cargo --version" },
		go: { manifest: "go.mod", probe: "go version" },
		dart: { manifest: "pubspec.yaml", probe: "dart --version" },
		ruby: { manifest: "Gemfile", probe: "ruby -v" },
	}

	constructor(
		private readonly cwd: string,
		private readonly stateManager?: StateManager,
	) {}

	/**
	 * Returns the current environment fingerprint based on PATH, USER, CWD, Runtime, and Machine ID.
	 */
	public getFingerprint(): string {
		const env = process.env
		const data = [
			os.hostname(), // Machine anchor
			env.PATH,
			env.USER || env.USERNAME,
			this.cwd,
			process.platform,
			process.arch,
			process.version, // Node version
		].join("|")
		return createHash("sha256").update(data).digest("hex")
	}

	/**
	 * L0 Check: Immediate cache validation.
	 */
	private getL0Lease(): EnvironmentLease | null {
		if (this.lease) return this.lease
		if (this.stateManager) {
			const persisted = this.stateManager.getGlobalStateKey("environmentalLease")
			if (persisted) {
				return persisted as EnvironmentLease
			}
		}
		return null
	}

	/**
	 * L1 Check: Deterministic fingerprint validation.
	 */
	public isLeaseValid(lease: EnvironmentLease | null): boolean {
		if (!lease) return false
		if (Date.now() - lease.timestamp > this.LEASE_DURATION) return false
		if (lease.fingerprint !== this.getFingerprint()) return false
		return true
	}

	/**
	 * Revokes the current lease, forcing a full probe on the next check.
	 */
	public revokeLease(): void {
		this.lease = null
		if (this.stateManager) {
			this.stateManager.setGlobalState("environmentalLease", undefined)
		}
		Logger.warn("[EnvironmentSovereignty] Environmental Lease revoked.")
	}

	/**
	 * Performs a tiered environment probe (L0 -> L1 -> L2).
	 */
	public async validateEnvironment(): Promise<EnvironmentLease> {
		if (this.probePromise) {
			return this.probePromise
		}

		// Tier L0/L1: Persistent Check
		const cachedLease = this.getL0Lease()
		if (this.isLeaseValid(cachedLease)) {
			this.lease = cachedLease
			return cachedLease as EnvironmentLease
		}

		this.probePromise = this.performFullProbe()
		try {
			const result = await this.probePromise
			return result
		} finally {
			this.probePromise = null
		}
	}

	private static readonly VERSION_MANIFESTS: Record<string, string[]> = {
		node: [".nvmrc", ".node-version"],
		python: [".python-version", "Pipfile"],
		rust: ["rust-toolchain", "rust-toolchain.toml"],
		ruby: [".ruby-version", ".tool-versions"],
	}

	private static readonly MGMT_TOOLS: Record<string, string> = {
		nvm: "nvm --version",
		rustup: "rustup --version",
		pyenv: "pyenv --version",
		asdf: "asdf --version",
	}

	// ... constructor ...

	private async performFullProbe(): Promise<EnvironmentLease> {
		// Tier L2: Full Forensic Probe
		Logger.info("[EnvironmentSovereignty] Performing Industrial Forensic Probe (L2)...")
		const fingerprint = this.getFingerprint()
		const lease: EnvironmentLease = {
			fingerprint,
			timestamp: Date.now(),
			success: true,
			details: {
				hostname: os.hostname(),
				detectedProjectTypes: [],
				toolchain: {},
				manifests: [],
				shadowingAlerts: [],
			},
		}

		try {
			// 1. Basic Metadata & Permission Probe
			lease.details!.shell = process.env.SHELL || (process.platform === "win32" ? "cmd" : "unknown")
			lease.details!.memoryFreeGB = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2)
			if (process.platform !== "win32") {
				const { stdout: dfOut } = await execAsync(`df -h "${this.cwd}" | tail -1 | awk '{print $4}'`)
				lease.details!.diskSpaceGB = dfOut.trim()
			} else {
				// Windows fallback via PowerShell
				try {
					const drive = path.parse(this.cwd).root.split(":")[0]
					const { stdout: psOut } = await execAsync(`powershell -Command "(Get-PSDrive ${drive}).Free / 1GB"`)
					lease.details!.diskSpaceGB = `${Number.parseFloat(psOut.trim()).toFixed(2)}GB`
				} catch {
					lease.details!.diskSpaceGB = "Unknown"
				}
			}

			const canaryPath = path.join(this.cwd, ".dietcode_canary")
			try {
				await fs.writeFile(canaryPath, `canary-${Date.now()}`)
				await fs.unlink(canaryPath)
				lease.details!.canWrite = true
			} catch (e) {
				lease.success = false
				lease.error = `Permission Denied: Cannot write to workspace directory (${this.cwd}).`
				lease.details!.canWrite = false
			}

			// 2. Substrate & Git Probe
			try {
				await execAsync("git --version")
			} catch (e) {
				lease.success = false
				lease.error = "Git Not Found: Architecture requires git for state tracking."
			}

			// 3. Multi-Language Discovery & Deep Manifest Scanning
			const rootFiles = await fs.readdir(this.cwd)

			// 3a. Marker-based Discovery
			for (const [type, config] of Object.entries(EnvironmentSovereignty.PROJECT_MARKERS)) {
				const hasMarker =
					rootFiles.includes(config.manifest) ||
					(EnvironmentSovereignty.VERSION_MANIFESTS[type]?.some((m) => rootFiles.includes(m)) ?? false)

				if (hasMarker) {
					lease.details!.detectedProjectTypes!.push(type)
					if (rootFiles.includes(config.manifest)) lease.details!.manifests!.push(config.manifest)

					// Register all relevant version manifests found
					EnvironmentSovereignty.VERSION_MANIFESTS[type]?.forEach((m) => {
						if (rootFiles.includes(m)) lease.details!.manifests!.push(m)
					})

					try {
						const { stdout } = await execAsync(config.probe)
						lease.details!.toolchain![type] = {
							status: "found",
							version: stdout.trim(),
						}
						// Binary Shadowing Check
						const { stdout: binPath } = await execAsync(
							process.platform === "win32" ? `where ${type}` : `which ${type}`,
						)
						lease.details!.toolchain![type].path = binPath.trim()

						if (lease.details!.toolchain![type].path!.startsWith(this.cwd)) {
							lease.details!.shadowingAlerts!.push(
								`⚠️ CAUTION: ${type} binary is located inside workspace: ${lease.details!.toolchain![type].path}`,
							)
						}
					} catch (e) {
						lease.details!.toolchain![type] = { status: "missing" }
						if (type === "node") {
							lease.success = false
							lease.error = "Node.js toolchain missing in a Node project."
						}
					}
				}
			}

			// 3b. Management Tool Probes
			for (const [tool, cmd] of Object.entries(EnvironmentSovereignty.MGMT_TOOLS)) {
				try {
					const { stdout } = await execAsync(cmd)
					lease.details!.toolchain![tool] = { status: "found", version: stdout.trim() }
				} catch {
					// Silent skip for mgmt tools
				}
			}

			// 4. Runtime Integrity Check
			if (lease.details!.toolchain!.node?.status === "found") {
				const execPath = process.execPath
				const nodeBinPath = lease.details!.toolchain!.node.path
				if (nodeBinPath && !execPath.includes(path.basename(nodeBinPath))) {
					lease.details!.shadowingAlerts!.push(
						`⚠️ INTEGRITY: Active Node binary (${execPath}) differs from PATH Node (${nodeBinPath}).`,
					)
				}
				lease.details!.nodeVersion = lease.details!.toolchain!.node.version
				lease.details!.nodePath = nodeBinPath
				lease.details!.hasNodeModules = rootFiles.includes("node_modules")
			}
		} catch (e) {
			const error = e as Error
			lease.success = false
			lease.error = `Industrial Forensic Failure: ${error.message}`
		}

		this.lease = lease
		if (this.stateManager) {
			this.stateManager.setGlobalState("environmentalLease", lease)
		}

		if (lease.success) {
			Logger.info(
				`[EnvironmentSovereignty] Industrial lease issued for ${lease.details!.hostname}. Detected: ${lease.details?.detectedProjectTypes?.join(", ")}`,
			)
		} else {
			Logger.error(`[EnvironmentSovereignty] Lease REJECTED: ${lease.error}`)
		}

		return lease
	}
}
