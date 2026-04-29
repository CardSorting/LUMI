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
		detectedProjectTypes?: string[]
		toolchain?: Record<string, { version?: string; path?: string; status: "found" | "missing" | "broken" }>
		manifests?: string[]
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

	public getFingerprint(): string {
		const env = process.env
		const data = [
			os.hostname(),
			env.PATH,
			env.USER || env.USERNAME,
			this.cwd,
			process.platform,
			process.arch,
			process.version,
			"v2",
		].join("|")
		return createHash("sha256").update(data).digest("hex")
	}

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

	public isLeaseValid(lease: EnvironmentLease | null): boolean {
		if (!lease) return false
		if (Date.now() - lease.timestamp > this.LEASE_DURATION) return false
		if (lease.fingerprint !== this.getFingerprint()) return false
		return true
	}

	public revokeLease(): void {
		this.lease = null
		if (this.stateManager) {
			this.stateManager.setGlobalState("environmentalLease", undefined)
		}
		Logger.warn("[EnvironmentSovereignty] Environmental Lease revoked.")
	}

	public async validateEnvironment(): Promise<EnvironmentLease> {
		if (this.probePromise) {
			return this.probePromise
		}

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

	private async performFullProbe(): Promise<EnvironmentLease> {
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

		const details = lease.details!

		try {
			details.shell = process.env.SHELL || (process.platform === "win32" ? "cmd" : "unknown")
			details.memoryFreeGB = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2)

			if (process.platform !== "win32") {
				const { stdout: dfOut } = await execAsync(`df -h "${this.cwd}" | tail -1 | awk '{print $4}'`)
				details.diskSpaceGB = dfOut.trim()
			} else {
				try {
					const drive = path.parse(this.cwd).root.split(":")[0]
					const { stdout: psOut } = await execAsync(`powershell -Command "(Get-PSDrive ${drive}).Free / 1GB"`)
					details.diskSpaceGB = `${Number.parseFloat(psOut.trim()).toFixed(2)}GB`
				} catch {
					details.diskSpaceGB = "Unknown"
				}
			}

			const canaryPath = path.join(this.cwd, ".dietcode_canary")
			try {
				await fs.writeFile(canaryPath, `canary-${Date.now()}`)
				await fs.unlink(canaryPath)
				details.canWrite = true
			} catch {
				lease.success = false
				lease.error = `Permission Denied: Cannot write to workspace directory (${this.cwd}).`
				details.canWrite = false
			}

			try {
				await execAsync("git --version")
			} catch {
				lease.success = false
				lease.error = "Git Not Found: Architecture requires git for state tracking."
			}

			const rootFiles = await fs.readdir(this.cwd)

			// 1. Detect project types based on markers
			for (const [type, config] of Object.entries(EnvironmentSovereignty.PROJECT_MARKERS)) {
				const hasMarker =
					rootFiles.includes(config.manifest) ||
					(EnvironmentSovereignty.VERSION_MANIFESTS[type]?.some((m) => rootFiles.includes(m)) ?? false)

				if (hasMarker) {
					details.detectedProjectTypes?.push(type)
					if (rootFiles.includes(config.manifest)) details.manifests?.push(config.manifest)
					EnvironmentSovereignty.VERSION_MANIFESTS[type]?.forEach((m) => {
						if (rootFiles.includes(m)) details.manifests?.push(m)
					})
				}
			}

			// 2. Probe toolchains for DETECTED project types ONLY (plus mandatory git)
			const toolsToProbe = Array.from(new Set([...(details.detectedProjectTypes || []), "git"]))

			for (const type of toolsToProbe) {
				const config =
					EnvironmentSovereignty.PROJECT_MARKERS[type] || (type === "git" ? { probe: "git --version" } : null)
				if (!config) continue

				try {
					const { stdout } = await execAsync(config.probe)
					details.toolchain![type] = {
						status: "found",
						version: stdout.trim(),
					}

					const { stdout: binPath } = await execAsync(process.platform === "win32" ? `where ${type}` : `which ${type}`)
					details.toolchain![type].path = binPath.trim()

					const isStandardPath =
						binPath.includes("/usr/local/bin") ||
						binPath.includes("/usr/bin") ||
						binPath.includes(".nvm/versions") ||
						binPath.includes(".asdf/installs")

					if (!isStandardPath && details.toolchain![type].path?.startsWith(this.cwd)) {
						details.shadowingAlerts?.push(
							`⚠️ CAUTION: ${type} binary is located inside workspace: ${details.toolchain![type].path}`,
						)
					}
				} catch {
					// Fallback for Node via process.execPath
					if (type === "node" || type === "git" || details.detectedProjectTypes?.includes(type)) {
						if (type === "node") {
							const execPath = process.execPath
							try {
								const { stdout } = await execAsync(`"${execPath}" -v`)
								details.toolchain![type] = {
									status: "found",
									version: stdout.trim(),
									path: execPath,
								}
								Logger.info(`[EnvironmentSovereignty] Node found via process.execPath: ${execPath}`)
							} catch {
								details.toolchain![type] = { status: "missing" }
								details.shadowingAlerts?.push("⚠️ [ADVISORY] Node.js not found on PATH.")
							}
						} else {
							details.toolchain![type] = { status: "missing" }
						}
					}
				}
			}

			// 3. Management Tool Probes (Only if relevant)
			for (const [tool, cmd] of Object.entries(EnvironmentSovereignty.MGMT_TOOLS)) {
				try {
					const { stdout } = await execAsync(cmd)
					details.toolchain![tool] = { status: "found", version: stdout.trim() }
				} catch {
					// Silent skip
				}
			}

			if (details.toolchain?.node?.status === "found") {
				const execPath = process.execPath
				const nodeBinPath = details.toolchain.node.path
				if (nodeBinPath && !execPath.includes(path.basename(nodeBinPath))) {
					details.shadowingAlerts?.push(
						`⚠️ INTEGRITY: Active Node binary (${execPath}) differs from PATH Node (${nodeBinPath}).`,
					)
				}
				details.nodeVersion = details.toolchain.node.version
				details.nodePath = nodeBinPath
				details.hasNodeModules = rootFiles.includes("node_modules")
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
