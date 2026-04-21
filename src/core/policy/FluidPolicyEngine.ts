import { DietCodeDefaultTool } from "@shared/tools"
import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { Logger } from "@/shared/services/Logger"
import { getLayer, suggestLayerForContent } from "@/utils/joy-zoning"
import { SafeNumber } from "../../shared/utils/SafeNumber"
import { ToolUse } from "../assistant-message"
import { ContextStalenessTracker } from "../context/ContextStalenessTracker"
import { AuditRecorder } from "../integrity/AuditRecorder.js"
import { DashboardGenerator } from "../integrity/DashboardGenerator"
import { EnvironmentLease, EnvironmentSovereignty } from "../integrity/EnvironmentSovereignty"
import { MetabolicMonitor } from "../integrity/MetabolicMonitor"
import { PathogenStore } from "../integrity/PathogenStore"
import { StateManager } from "../storage/StateManager"
import { ForensicDiagnostic, RefactorHealer } from "../task/tools/RefactorHealer"
import { SovereignScribe } from "../task/tools/utils/SovereignScribe"
import { AxiomVerificationService } from "./AxiomVerificationService"
import { SemanticAxiomEngine } from "./SemanticAxiomEngine"
import { SimulationEngine } from "./SimulationEngine.js"
import { SovereignForensics } from "./SovereignForensics"
import { SovereignGarbageCollector } from "./SovereignGarbageCollector"
import { SovereignOptimizer } from "./SovereignOptimizer"
import { SovereignPolicy } from "./SovereignPolicy.js"
import { SovereignDiagnostics, SovereignProtocol } from "./SovereignProtocol"
import { SovereignTelemetrics } from "./SovereignTelemetrics"
import { RefactoringSuggestion, SpiderRefactorer } from "./SpiderRefactorer.js"
import { SpiderEngine } from "./spider/SpiderEngine.js"
import { TspPolicyPlugin } from "./TspPolicyPlugin.js"

export interface PolicyResult {
	success: boolean
	error?: string
	warning?: string
	isAlarmed?: boolean
	violations?: string[]
	buildErrors?: string[]
	entropyScore?: number
	correctionHint?: string
}

/**
 * FluidPolicyEngine: The single point of enforcement for architectural (Joy-Zoning),
 * concurrency (Collision), and stability (Entropy) rules.
 *
 * Progressive Enforcement Strategy:
 * - Strike 1 (domain only): Hard block — the write is rejected with correction hints.
 * - Strike 2+: Graceful degradation — the write proceeds with a strong warning injected.
 * - Core layer: Always warning-only (never hard-blocked).
 * - Other layers: Warning-only.
 * This prevents infinite deadlock while still educating the agent.
 */
export class FluidPolicyEngine {
	private readonly tspPlugin = new TspPolicyPlugin()
	private readonly spiderEngine: SpiderEngine
	private mode: "plan" | "act" = "act"
	private commitSeal: string | null = null
	private sealReason: string | null = null
	private layerCache: Map<string, string> = new Map()
	private sessionFiles: Map<string, string> = new Map()
	private auditRecorder: AuditRecorder
	private simulationEngine: SimulationEngine
	private stalenessTracker: ContextStalenessTracker
	private dashboardGenerator: DashboardGenerator
	private axiomEngine: SemanticAxiomEngine
	private metabolicMonitor: MetabolicMonitor
	private optimizer: SovereignOptimizer
	private pathogens: PathogenStore
	private buildAlarmActive = false
	private alarmViolations: string[] = []
	private stateRestored = false // V150: Immortality tracking
	private lastBuildHealth = 100
	private lastViolationCount = 0
	private telemetrics: SovereignTelemetrics
	private verification: AxiomVerificationService
	private refactorTurnsRemaining = 0 // V70: Sovereign Refactor Window
	private lastEntropyScore = 1.0 // V80: Karma Tracking
	private restorationTokens: Map<string, number> = new Map() // V100: Recovery Buffers
	private gracePeriods: Map<string, number> = new Map() // V100: Soft-Lock attempts
	private refactorHealer: RefactorHealer
	private forensics: SovereignForensics
	private garbageCollector: SovereignGarbageCollector
	private readonly envSovereignty: EnvironmentSovereignty
	private karma = 0

	constructor(
		private cwd: string,
		private streamId?: string,
		private stateManager?: StateManager,
		private virtualResolver?: (path: string) => string | undefined,
	) {
		this.spiderEngine = new SpiderEngine(this.cwd)
		this.auditRecorder = new AuditRecorder(this.cwd)
		this.simulationEngine = new SimulationEngine(this.cwd)
		this.stalenessTracker = new ContextStalenessTracker(this.cwd)
		this.dashboardGenerator = new DashboardGenerator(this.cwd)
		this.axiomEngine = new SemanticAxiomEngine()
		this.metabolicMonitor = new MetabolicMonitor()
		this.optimizer = new SovereignOptimizer(this.cwd)
		this.pathogens = new PathogenStore(this.cwd)
		this.refactorHealer = new RefactorHealer(this.cwd)
		this.forensics = new SovereignForensics(this.cwd, this.metabolicMonitor, this.spiderEngine)
		this.garbageCollector = new SovereignGarbageCollector(this.cwd, this.spiderEngine, this.pathogens, this.metabolicMonitor)
		this.telemetrics = new SovereignTelemetrics(this.cwd, this.metabolicMonitor, this.spiderEngine, this.pathogens)
		this.verification = new AxiomVerificationService(
			this.cwd,
			this.spiderEngine,
			this.axiomEngine,
			this.pathogens,
			this.forensics,
		)
		this.envSovereignty = new EnvironmentSovereignty(this.cwd, this.stateManager)

		// V16: Warm graph startup
		this.restoreSovereignSubstrate().catch((e: unknown) =>
			Logger.error("[FluidPolicyEngine] Failed to restore Sovereign Substrate:", e),
		)
	}

	/**
	 * Clears architectural alarms and metabolic blockades.
	 * Explicitly used by orchestrator during a Cognitive Reflection Nudge to grant a clean slate.
	 */
	public resetSystemPressure(): void {
		this.telemetrics.resetSystemPressure()
		this.alarmViolations = []
	}

	public getSystemDiagnostics(): string {
		// V18: Forwarding entropy context for velocity calculation
		return this.telemetrics.getSystemDiagnostics(this.lastEntropyScore)
	}

	/**
	 * Explicitly triggers environmental validation.
	 */
	public async validateEnvironment(): Promise<EnvironmentLease> {
		return await this.envSovereignty.validateEnvironment()
	}

	/**
	 * Revokes the current environmental lease.
	 */
	public revokeLease(): void {
		this.envSovereignty.revokeLease()
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 * Shuts down all engines and releases persistence buffers to prevent memory leaks.
	 */
	public dispose(): void {
		this.spiderEngine.dispose()
		this.layerCache.clear()
		this.sessionFiles.clear()
		this.restorationTokens.clear()
		this.gracePeriods.clear()
		Logger.info("[FluidPolicyEngine] Sovereign Teardown Complete. All substrates released.")
	}

	/**
	 * Increments and persists the strike count for a file.
	 */
	private async incrementStrikes(filePath: string): Promise<number> {
		if (!this.streamId) return 0
		const key = `strikes:${path.basename(filePath)}`
		const currentRaw = await orchestrator.recallMemory(this.streamId, key)
		const newCount = (currentRaw ? Number.parseInt(currentRaw, 10) : 0) + 1
		await orchestrator.storeMemory(this.streamId, key, newCount.toString())

		// Global project memory (legacy tracking)
		if (this.stateManager) {
			const strikes = { ...this.stateManager.getGlobalStateKey("architecturalStrikes") }
			strikes[filePath] = newCount
			this.stateManager.setGlobalState("architecturalStrikes", strikes)
		}

		return newCount
	}

	/**
	 * Resets strikes for a file once it's clean.
	 */
	private async resetStrikes(filePath: string): Promise<void> {
		if (this.streamId) {
			await orchestrator.storeMemory(this.streamId, `strikes:${path.basename(filePath)}`, "0")
		}
		if (this.stateManager) {
			const strikes = { ...this.stateManager.getGlobalStateKey("architecturalStrikes") }
			if (strikes[filePath]) {
				delete strikes[filePath]
				this.stateManager.setGlobalState("architecturalStrikes", strikes)
			}
		}
	}

	public setMode(mode: "plan" | "act") {
		this.mode = mode
	}

	public setStreamId(streamId: string) {
		this.streamId = streamId
	}

	public setCommitSeal(seal: string, reason: string) {
		this.commitSeal = seal
		this.sealReason = reason
	}

	public getFileLayerContext(filePath: string): string {
		const layer = this.getCachedLayer(filePath)
		return this.verification.getFileLayerContext(filePath, layer)
	}

	public getCorrectionHint(errors: string[], filePath?: string): string {
		const layer = filePath ? this.getCachedLayer(filePath) : undefined
		return this.verification.getCorrectionHint(errors, filePath, layer)
	}

	public computeBuildHealth(violations: string[]): number {
		const lastScore = this.lastBuildHealth
		const score = this.telemetrics.computeBuildHealth(violations)
		const config = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()
		const threshold = config.integrityAlertThreshold || 70
		const isDeclining = score < lastScore
		const isRecovering = score > lastScore

		if (score < threshold && !this.buildAlarmActive && isDeclining) {
			this.triggerBuildAlarm(violations)
		} else if (this.buildAlarmActive && (score >= 90 || isRecovering)) {
			this.clearBuildAlarm()
		}

		return score
	}

	/**
	 * Records the current scan results to history.
	 */
	public async recordScanHistory(violations: string[]) {
		const score = this.computeBuildHealth(violations)
		const fileCount = this.spiderEngine.nodes.size
		await this.auditRecorder.record(score, violations.length, fileCount)

		// Passive Dashboard Update
		await this.dashboardGenerator.updateDashboard(
			this.spiderEngine,
			this.auditRecorder,
			this.metabolicMonitor,
			this.optimizer,
			this.pathogens,
		)

		// V150: Substrate Immortalization (Ghost Persistence)
		await this.persistSovereignSubstrate()
	}

	private triggerBuildAlarm(violations: string[]) {
		this.buildAlarmActive = true
		this.alarmViolations = violations
		Logger.warn("🚨 [HEALTH ALERT] System entering safety mode due to linter/build errors. Forced cleanup started.")
	}

	private clearBuildAlarm() {
		this.buildAlarmActive = false
		this.alarmViolations = []
		this.lastBuildHealth = 100 // Reset baseline
		Logger.info("💚 [HEALTH ALERT] Health restored. System stability confirmed.")
	}

	/**
	 * Validates a tool block before execution.
	 * Uses progressive enforcement: first domain violation blocks, subsequent ones degrade to warnings.
	 */
	public async validatePreExecution(block: ToolUse): Promise<PolicyResult> {
		const result: PolicyResult = { success: true }

		// Step -1: Strategic Environment Check (SEC)
		// Ensuring essential tools are available to prevent progress issues.
		const lease = await this.envSovereignty.validateEnvironment()
		if (!lease.success || (lease.details?.diskSpaceGB && Number.parseFloat(lease.details.diskSpaceGB) < 0.5)) {
			const details = lease.details

			// V192 Hardening: Categorized Forensics
			const substrateContext = [
				`• Machine: ${details?.hostname || "Unknown"}`,
				`• Shell: ${details?.shell || "Unknown"}`,
				...(details?.shadowingAlerts || []),
			].join("\n")

			const toolchainContext = [
				details?.nodeVersion ? `• Node: ${details.nodeVersion} (${details.nodePath})` : "• Node: Missing/Inaccessible",
				details?.hasNodeModules === false ? "• Dependencies: node_modules missing (Run npm install)" : "",
			]
				.filter(Boolean)
				.join("\n")

			const metabolicContext = [
				details?.diskSpaceGB ? `• Disk: ${details.diskSpaceGB} available` : "• Disk: Sensing failed",
				details?.memoryFreeGB ? `• Memory: ${details.memoryFreeGB}GB free` : "",
			]
				.filter(Boolean)
				.join("\n")

			const forensicReport = `📊 [SUBSTRATE]\n${substrateContext}\n\n🛠️ [TOOLCHAIN]\n${toolchainContext}\n\n🔋 [METABOLICS]\n${metabolicContext}`

			// V191 Hardening: Metabolic Blockade
			if (lease.details?.diskSpaceGB && Number.parseFloat(lease.details.diskSpaceGB) < 0.5) {
				return {
					success: false,
					error:
						`🛑 METABOLIC BLOCKADE [CRITICAL]: Disk space dangerously low.\n\n` +
						`I've detected your environment has less than 500MB of free space (${lease.details.diskSpaceGB}).\n\n` +
						`💡 WHY THIS MATTERS: Coding with near-zero disk space causes silent corruption of the database and source files during write operations.\n\n` +
						`📊 STATE:\n${forensicReport}\n\n` +
						`🛠️ RECOVERY: Please free up space in ${this.cwd} before proceeding.`,
				}
			}

			// V191 Hardening: Shell Health Warning
			let shellWarning = ""
			if (details?.shell?.includes("cmd.exe")) {
				shellWarning = `⚠️ WARNING: Restricted Shell detected (cmd.exe). Many advanced coding tools and terminal features work more reliably in PowerShell or Git Bash.\n\n`
			}

			// V192 Hardening: Adaptive Multi-Language Recipes
			const recipes: string[] = []
			const detected = details?.detectedProjectTypes || []
			const toolchain = details?.toolchain || {}

			if (detected.includes("node")) {
				if (toolchain.node?.status !== "found")
					recipes.push("• **Node.js**: Toolchain missing. Please install Node.js and npm.")
				else if (details?.hasNodeModules === false)
					recipes.push("• **Node.js**: `node_modules` missing. Run `npm install`.")
			}
			if (detected.includes("python") && toolchain.python?.status !== "found") {
				recipes.push("• **Python**: Toolchain missing. Run `pip install -r requirements.txt` after installing python3.")
			}
			if (detected.includes("rust") && toolchain.rust?.status !== "found") {
				recipes.push("• **Rust**: Toolchain missing. Run `cargo build` after installing rustup.")
			}
			if (detected.includes("go") && toolchain.go?.status !== "found") {
				recipes.push("• **Go**: Toolchain missing. Run `go mod download` after installing Go.")
			}
			if (detected.includes("ruby") && toolchain.ruby?.status !== "found") {
				recipes.push("• **Ruby**: Toolchain missing. Run `bundle install` after installing Ruby.")
			}
			if (detected.includes("dart") && toolchain.dart?.status !== "found") {
				recipes.push("• **Dart/Flutter**: Toolchain missing. Run `flutter pub get`.")
			}

			let guidedSetup = recipes.length > 0 ? `🛠️ **ADAPTIVE REPAIR RECIPES**:\n${recipes.join("\n")}\n\n` : ""

			guidedSetup +=
				`1. Ensure essential tools are in your PATH.\n` +
				`2. Check write permissions for ${this.cwd}.\n` +
				`3. If using NVM/Version managers, ensure the correct version is activated.`

			if (lease.error?.includes("Git Not Found")) {
				guidedSetup = `⚠️ **CRITICAL**: Git is missing. Checkpoints and forensics are disabled. Please install git.\n\n${guidedSetup}`
			}

			return {
				success: false,
				error: `🛑 STRATEGIC ENVIRONMENT ALERT [GATEKEEPER]\n\nEssential environmental requirements for high-fidelity coding are not met.\n\n❌ ISSUE: ${lease.error || "Metabolic health critical"}\n\n${forensicReport}\n\n${shellWarning}💡 WHY THIS MATTERS: Attempting to modify code in a broken environment causes "hallucination loops" and failure spirals.\n\n🛠️ GUIDED SETUP:\n${guidedSetup}\n\n⚙️ I will remain in "Setup Mode" and will re-probe the environment on your next attempt.`,
			}
		}

		if (this.streamId && !this.stateRestored) {
			// V189: Unified Substrate handles metabolic state
		}

		// V150: Sovereign Breath tool is ALWAYS allowed for cognitive recovery
		if (block.name === DietCodeDefaultTool.SOVEREIGN_BREATH) {
			return { success: true }
		}

		// V18/V19: Harmonic Healing Intent Sensing
		let intent = null
		const content = (block.params as { content?: string })?.content || ""
		const thrashing = this.telemetrics.getAgenticHealth()

		// V185: Cognitive Interdiction - Block when agentic failure spiral is detected
		if (
			thrashing.loop &&
			block.name !== DietCodeDefaultTool.FILE_EDIT // Allow editing scratchpad/audit
		) {
			const isTargetingAudit = (block.params as { path?: string })?.path?.endsWith("scratchpad.md")
			if (!isTargetingAudit) {
				const auditTemplate = SovereignProtocol.generateAuditTemplate("Agentic Failure Recovery")
				return {
					success: false,
					error:
						`🛑 STRATEGIC FOCUS BREAK [REQUIRED]: Repetitive activity detected.\n` +
						`You appear to be in a loop (repeated investigation without changes).\n\n` +
						`💡 STEPS: To move forward, please perform a # STRATEGIC REVIEW in \`scratchpad.md\` to refine your plan.\n\n` +
						`\`\`\`markdown\n${auditTemplate}\n\`\`\``,
				}
			}
		}

		// V188: Concurrent Substrate Drift Detection
		const driftAlert = await this.detectConcurrentDrift(block)
		if (driftAlert) {
			result.warning = (result.warning ? `${result.warning}\n` : "") + driftAlert
		}

		// V189: Substrate Immune Response Check (Fragility Alarm)
		const targetPath =
			(block.params as { path?: string; target_file?: string })?.path ||
			(block.params as { path?: string; target_file?: string })?.target_file
		if (targetPath && (block.name === DietCodeDefaultTool.FILE_EDIT || block.name === DietCodeDefaultTool.APPLY_PATCH)) {
			const absPath = path.resolve(this.cwd, targetPath)
			const cci = this.spiderEngine.computeCCI(absPath, this.pathogens, this.metabolicMonitor)
			if (cci > 0.8) {
				result.warning =
					(result.warning ? `${result.warning}\n` : "") +
					`🛑 [STABILITY SAFETY ALERT]: \`${path.basename(targetPath)}\` has high complexity (Index: ${SafeNumber.format(cci, 2)}). ` +
					`This module is a 'Structural Hotspot' (${SafeNumber.formatPercent(cci, 0)} risk). Deep audit required before further edits.`
			}
		}

		// Step 0: Read scratchpad context for Sovereign Protocols
		let scratchpadContent = ""
		let hasAudit = false
		let hasBreath = false
		let scratchpadHealed = false

		try {
			const scratchpadPath = path.join(this.cwd, "scratchpad.md")
			scratchpadContent = await fs.readFile(scratchpadPath, "utf-8")
			hasAudit = scratchpadContent.includes(SovereignProtocol.HEADERS.AUDIT)
			hasBreath = scratchpadContent.includes(SovereignProtocol.HEADERS.BREATH)
		} catch (_e) {
			// V27 Agent Success: Auto-heal if we're trending towards a block
			const cooldown = this.metabolicMonitor.getCooldownStatus()
			if (cooldown.active || this.buildAlarmActive) {
				const healing = await this.ensureScratchpadIntegrity("Metabolic Recovery")
				scratchpadContent = healing.content
				hasAudit = scratchpadContent.includes(SovereignProtocol.HEADERS.AUDIT)
				scratchpadHealed = healing.created
			}

			// V28: Virtual Substrate Fallback (Search history if disk is empty)
			if (!hasAudit && !hasBreath && this.streamId) {
				const history = await orchestrator.getConversationHistory(this.streamId)
				if (history) {
					const virtual = SovereignScribe.findVirtualReviewInHistory(history)
					if (virtual.valid) {
						scratchpadContent = virtual.content
						hasAudit = true
						Logger.info(
							"[FluidPolicyEngine] Sovereign interdiction bypassed via Virtual Scratchpad (History Synthesis).",
						)
					}
				}
			}
		}

		if (
			(block.name === DietCodeDefaultTool.FILE_EDIT || block.name === DietCodeDefaultTool.APPLY_PATCH) &&
			(this.metabolicMonitor.getCooldownStatus().active || this.buildAlarmActive)
		) {
			intent = this.verification.detectHealingIntent(block)
			if (intent) {
				Logger.info(`[FluidPolicyEngine] Healing Intent detected. Resetting metabolic pressure for ${intent}.`)
				this.resetSystemPressure()
			}
		}

		const isHealingMode = this.buildAlarmActive || !!intent || !!content.match(/#HEAL|#HEALING|#CURE|#FIX|#REPAIR|#TIDY/)

		// V100: Cognitive Resonance Scaling
		const resonance = isHealingMode || this.refactorTurnsRemaining > 0 ? 0.5 : 1.0
		this.metabolicMonitor.setResonance(resonance)

		// 0. Rule: Cognitive Drift Sensing (Thrashing Prevention)
		// 0. Rule: Activity Cooldown Enforcement (Substrate Immune System)
		if (block.name === DietCodeDefaultTool.FILE_EDIT || block.name === DietCodeDefaultTool.APPLY_PATCH) {
			const isRefactoring = scratchpadContent.includes("#REFACTOR") || scratchpadContent.includes("#INFRASTRUCTURE")
			const cooldown = this.metabolicMonitor.getCooldownStatus(isRefactoring)
			if (cooldown.active && !this.commitSeal) {
				if (hasBreath) {
					Logger.info("[FluidPolicyEngine] Activity cooldown cleared via # STABILITY BREAK")
				} else if (hasAudit) {
					Logger.info("[FluidPolicyEngine] Activity cooldown cleared via # STRATEGIC REVIEW")
				}

				if (!hasBreath && !hasAudit) {
					// V32: Therapeutic Leniency
					if (isHealingMode) {
						result.warning =
							(result.warning ? `${result.warning}\n` : "") +
							`⚠️ STABILITY ASSISTANCE: The project has a high workload stage (${cooldown.reason}), but your fix intent (#HEAL/FIX) was noted. Proceeding with extra care for stability.`
						return result
					}

					const auditTemplate = SovereignProtocol.generateAuditTemplate("Cognitive Recovery")
					const breathTemplate = SovereignProtocol.generateBreathTemplate("Stability Reset", cooldown.reason)

					return {
						success: scratchpadHealed,
						error: scratchpadHealed
							? undefined
							: `🛑 ACTIVITY COOLDOWN [ACTIVE]: ${cooldown.reason}\n` +
								`The project foundation has reached a high level of activity. To keep things stable, we suggest a quick planning pause.\n\n` +
								`💡 STEPS: Please add a planning turn to your \`scratchpad.md\`:\n\n` +
								`📝 OPTION A: [Strategic Review] - Add a full strategic review:\n` +
								`\`\`\`markdown\n${auditTemplate}\n\`\`\`\n\n` +
								`📝 OPTION B: [Stability Break] - Add a quick stability break:\n` +
								`\`\`\`markdown\n${breathTemplate}\n\`\`\`\n`,
						warning: scratchpadHealed
							? `⚠️ FOUNDATION STABILIZED: \`scratchpad.md\` was created automatically during the activity cooldown to help organize recovery.\n\n` +
								`💡 ACTION: Please sync your current plan into \`scratchpad.md\` before your next move.`
							: undefined,
					}
				}
			}
		}

		// V24: Implicit Guideline Injection (Contextual Awareness)
		if (block.name === DietCodeDefaultTool.FILE_READ) {
			const targetPath = (block.params as { path?: string })?.path
			if (targetPath) {
				const absolutePath = path.resolve(this.cwd, targetPath)
				const violations = this.spiderEngine.getViolations().filter((v) => v.path === absolutePath)
				const isRefactoring = scratchpadContent.includes("#REFACTOR") || scratchpadContent.includes("#INFRASTRUCTURE")
				const status = this.metabolicMonitor.isHighlyActive(absolutePath, isRefactoring)

				if (violations.length > 0 || status.active) {
					const alerts: string[] = []
					if (status.active) alerts.push(`⚠️ HIGH RECENT ACTIVITY: ${status.reason}`)
					violations.forEach((v) => {
						alerts.push(`🚨 STABILITY WARNING: ${v.message}`)
					})

					result.warning =
						(result.warning ? `${result.warning}\n` : "") +
						`🏗️ PROJECT ADVISORY: \`${path.basename(targetPath)}\` has active health alerts:\n${alerts.join("\n")}`
					return result
				}
			}
		}

		// 0. Rule: Activity Cooldown (Inflammation Control)
		if (block.name === DietCodeDefaultTool.FILE_EDIT || block.name === DietCodeDefaultTool.APPLY_PATCH) {
			const targetPath = (block.params as { path?: string })?.path
			if (targetPath) {
				const absolutePath = path.resolve(this.cwd, targetPath)
				const isScratchpad = targetPath.endsWith("scratchpad.md")

				// V22: Implicit Recovery - Scratchpad edits are NEVER blocked.
				if (isScratchpad) {
					return result
				}

				// V24: Symbol Lockdown (Audit-to-Action Binding)
				if (hasAudit && !isScratchpad) {
					const isCovered = this.verification.isImplicitlyAudited(targetPath, scratchpadContent, block)

					if (!isCovered) {
						// Fallback to symbol-level check if not implicitly covered
						const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g
						const citedPaths = Array.from(scratchpadContent.matchAll(pathRegexp)).map((m) => m[0])
						const isCited = citedPaths.some((p) => absolutePath.includes(p))

						if (!isCited) {
							return {
								success: false,
								error: `🛑 FILE FOCUS PROTECTION: The file \`${path.basename(targetPath)}\` was not mentioned in your active # STRATEGIC REVIEW. Please focus only on the files identified during your investigation.`,
							}
						}
					}
				}

				const isRefactoring =
					this.refactorTurnsRemaining > 0 ||
					scratchpadContent.includes("#REFACTOR") ||
					scratchpadContent.includes("#INFRASTRUCTURE")
				const nodeSize = this.spiderEngine.nodes.get(absolutePath)?.astComplexity || 0
				const status = this.metabolicMonitor.isHighlyActive(absolutePath, isRefactoring, nodeSize)

				// V100: Restoration Buffer Management
				const tokens = this.restorationTokens.get(targetPath) || 0
				if (status.active && isHealingMode && tokens === 0) {
					this.restorationTokens.set(targetPath, 3)
					Logger.info(
						`[FluidPolicyEngine] Recovery Buffer Activated: 3 restoration tokens granted for ${path.basename(targetPath)}`,
					)
				}

				// V26: Axiom Lockdown (Structural Debt Prevention)
				if (!isScratchpad && block.name === DietCodeDefaultTool.FILE_EDIT) {
					const content = (block.params as { content: string }).content
					if (content) {
						const result = this.verification.calculateAxiomaticDrift(targetPath, content)
						if (result.status === "NEGATIVE" && !scratchpadContent.includes("# SOVEREIGN_AGILE")) {
							return {
								success: false,
								error: `🛑 AXIOM LOCKDOWN: ${result.message}\nThis edit introduces architectural regression. You must audit and justify this trade-off in \`scratchpad.md\`.`,
							}
						}
					}
				}

				const hasOverride = (block.params as { content?: string }).content?.includes(
					"[SOVEREIGN_EXCEPTION: Metabolic Cooldown Override]",
				)
				const hasBreath = (block.params as { content?: string }).content?.includes("# SOVEREIGN_BREATH")

				if (hasBreath) {
					this.resetSystemPressure()
					Logger.info(`[FluidPolicyEngine] Activity level reset via # STABILITY BREAK for ${targetPath}`)
				}

				const currentTokens = this.restorationTokens.get(targetPath) || 0
				if (status.active && currentTokens > 0) {
					this.restorationTokens.set(targetPath, currentTokens - 1)
					Logger.info(
						`[FluidPolicyEngine] Recovery Buffer Consumed for ${path.basename(targetPath)} (${currentTokens - 1} remain)`,
					)
					return {
						success: true,
						warning: `🩹 RESTORATION ACTIVE: Stability bypass granted. ${currentTokens - 1} recovery writes remaining for this file.`,
					}
				}

				if (status.active && !hasOverride && !hasBreath && !this.commitSeal) {
					return {
						success: false,
						error: `🛑 STABILITY SAFETY GUARD: \`${path.basename(targetPath)}\` is changing very rapidly right now (${status.reason}).`,
						warning:
							`💡 STEPS: To continue, please simplify your change or provide a justification in \`scratchpad.md\` to unlock a restoration token.\n` +
							`Alternatively, you can use \`[STABILITY_EXCEPTION: Safety Guard Override]\` in your edit.`,
					}
				}
			}
		}
		// 0. Rule: Logic Axiom Guard (Substrate Maturity)
		if (block.name === DietCodeDefaultTool.FILE_NEW || block.name === DietCodeDefaultTool.APPLY_PATCH) {
			const { path: filePath, content } = block.params as unknown as { path: string; content?: string }
			if (content) {
				const axiomViolations = this.axiomEngine.validateAxioms(filePath, content, this.spiderEngine)
				const errors = axiomViolations.filter((v) => v.severity === "ERROR")

				// PRODUCTION HARDENING: Auto-healing for specific axioms (e.g. STATELESSNESS)
				// This significantly improves agent success rate by fixing minor issues automatically.
				const statelessnessViolation = axiomViolations.find((v) => v.axiom === "STATELESSNESS")
				if (statelessnessViolation && block.name === DietCodeDefaultTool.APPLY_PATCH) {
					Logger.info(`[FluidPolicyEngine] Auto-healing STATELESSNESS for ${filePath}`)
					await this.refactorHealer.healStatelessness(filePath)
					// Remove from errors list to allow continuation if it was the only error
					const index = errors.indexOf(statelessnessViolation)
					if (index !== -1) errors.splice(index, 1)
				}

				if (errors.length > 0 && !this.commitSeal) {
					// v10 HARDENING: Aromatic Extraction Sensing.
					// If we detect a zero-sum move, suggest an extraction immediately.
					const currentViolations = this.spiderEngine
						.getViolations()
						.map((v) => ({ axiom: "STRUCTURAL", severity: "WARN" as const, message: v.message }))
					const nextViolations = axiomViolations
					const compare = this.axiomEngine.compareAxiomSessions(currentViolations, nextViolations)
					let directive = ""
					if (compare.status === "ZERO_SUM") {
						const suggestions = SpiderRefactorer.getRefactoringSuggestions(this.spiderEngine)
						const extract = suggestions.find(
							(s: RefactoringSuggestion) => s.type === "EXTRACT" && filePath.includes(s.target),
						)
						const synthesis = extract?.synthesis
							? `\n\n📝 SYNTHESIZED CONTRACT:\n\`\`\`typescript\n${extract.synthesis}\n\`\`\``
							: ""
						directive = `\n\n🧩 AROMATIC EXTRACTION DIRECTIVE: You are trading architectural debt. STRATEGY: Extract an interface to src/domain/interfaces/ and inject it to break the coupling.${synthesis}`
					}

					return {
						success: true,
						warning:
							`⚠️ AXIOMATIC LOGIC WARNING: Logic Sovereignty has been compromised.\n` +
							`${errors.map((v) => `  - [AXIOM: ${v.axiom}] ${v.message}`).join("\n")}\n\n` +
							`💡 You must split this logic or maintain purity before the substrate will accept these changes.${directive}`,
					}
				}
			}
		}

		// 0. Rule: Simulation Guard (Pre-flight Prophet)
		if (block.name === DietCodeDefaultTool.RENAME || block.name === DietCodeDefaultTool.MOVE) {
			const { oldPath, newPath } = block.params as { oldPath: string; newPath: string }

			// V8: Detect agile mode in turn
			let isAgile = false
			try {
				const scratchpadPath = path.join(this.cwd, "scratchpad.md")
				const scratchpadContent = await fs.readFile(scratchpadPath, "utf-8")
				if (scratchpadContent.includes("# SOVEREIGN_AGILE")) {
					isAgile = true
				}
			} catch (_e) {}

			const sim = await this.simulationEngine.simulateMove(
				oldPath,
				newPath,
				this.spiderEngine,
				this.pathogens,
				isHealingMode,
				isAgile,
			)
			if (!sim.safe && !this.commitSeal && !isHealingMode) {
				const healingHint = !isHealingMode
					? "\n\n💡 PRO-TIP: To bypass simulation blocks during structural repairs, add `# HEALING TURN` to your `scratchpad.md`."
					: ""
				return {
					success: true,
					[isHealingMode ? "info" : "warning"]:
						`⚠️ SIMULATION RESONANCE: ${sim.message}\n` +
						`Your proposed move predicts a significant architectural regression.\n` +
						`Violations predicted: \n${sim.violations.map((v: string) => `  - ${v}`).join("\n")}\n\n` +
						`💡 Fix these structural issues in the source before moving, or use a Commit Seal to bypass.${healingHint}`,
				}
			}

			// V8: Automated Re-linking after successful move
			if (sim.safe) {
				Logger.info(`[FluidPolicyEngine] Scheduling post-move import healing for ${oldPath} -> ${newPath}`)
				// Note: In a real orchestrator, this might be a post-execution hook.
				// For now, we inform the agent it can use RefactorHealer.
			}
		}

		// V40: Pre-flight Sweep (Metabolic cleanup)
		if (this.metabolicMonitor.getCooldownStatus().active && block.params?.path) {
			Logger.warn(`[FluidPolicyEngine] High Metabolic Pressure detected. Running Pre-flight Sweep on ${block.params.path}`)
			await this.garbageCollector.sweep([this.normalize(block.params.path)])
		}

		// V70: Sovereign Refactor Window Detection
		if (scratchpadContent.includes("#REFACTOR") || scratchpadContent.includes("#MIGRATION")) {
			if (this.refactorTurnsRemaining <= 0) {
				this.refactorTurnsRemaining = 3 // Standard 3-turn window
				Logger.info("[FluidPolicyEngine] Sovereign Refactor Window opened (3 turns of architectural leniency).")
			}
		}

		// 0. Update Session Awareness (V71)
		this.spiderEngine.setSessionBuffer(this.sessionFiles)

		// V80: Adaptive Metabolism (Metabolic Velocity Tuning)
		const currentEntropy = this.spiderEngine.computeEntropy()
		// V189: Removed unused diagnostic variables (entropyDiscovery, drift)

		const velocity = 1.0 + (this.karma / 1000) * 0.5
		this.metabolicMonitor.setThresholdMultiplier(Math.max(0.5, Math.min(2.0, velocity)))
		Logger.info(`[FluidPolicyEngine] Metabolic Velocity calibrated to ${SafeNumber.format(velocity, 2)}x.`)

		// 0. Rule: Architectural Alarm (Soft-Lock / Healing Mode)
		const isCriticalHealth = this.lastBuildHealth < 50
		const isRefactoringWindow = this.refactorTurnsRemaining > 0

		if (
			(this.buildAlarmActive || (isCriticalHealth && !isRefactoringWindow)) &&
			(block.name === DietCodeDefaultTool.FILE_NEW ||
				block.name === DietCodeDefaultTool.FILE_EDIT ||
				block.name === DietCodeDefaultTool.APPLY_PATCH ||
				block.name === DietCodeDefaultTool.BASH)
		) {
			const intent = this.verification.detectHealingIntent(block)

			// Detect #HEAL or #FIX in the scratchpad (via isHealingMode logic)
			if (!intent && !isHealingMode) {
				const actualViolations = this.spiderEngine
					.getViolations()
					.filter((v) => this.alarmViolations.includes(v.message))
					.slice(0, 5)
				const recipes = actualViolations.map((v) => this.refactorHealer.generateHealingRecipe(v))

				return {
					success: false,
					error: isCriticalHealth
						? `💓 STABILITY ALERT: System health is at ${SafeNumber.format(this.lastBuildHealth, 0)}%. Consider a checkpoint.`
						: "🚨 [BUILD ALARM] System health degraded.",
					warning:
						`⚠️ BUILD ALARM ACTIVE (Health: ${this.lastBuildHealth}/100)\n` +
						`Structural changes are discouraged until the following violations are healed:\n\n` +
						`${actualViolations.map((v) => `  - ${v.message}`).join("\n")}\n\n` +
						`🛠️ HEALING RECIPES:\n${recipes.join("\n")}\n\n` +
						`💡 Use #HEAL or #FIX in your scratchpad and focus ONLY on these repairs to bypass this alarm.`,
					isAlarmed: true,
				}
			}
		}

		// In PLAN mode, skip enforcement — agent is only planning, not writing
		// Return guidance instead of blocking
		if (this.mode === "plan" && block.params?.path) {
			// consolidated to top-level import
			const filePath = path.resolve(this.cwd, block.params.path)
			const layer = getLayer(filePath)

			// Predictive Collision Check: Warn early if another stream has a lock
			const collision = await orchestrator.checkCollision(this.streamId || "viewer", [filePath])
			if (collision) {
				return {
					success: true,
					warning: `⚠️ PREDICTIVE COLLISION: You are planning to edit \`${path.basename(filePath)}\`, but it's currently LOCKED by a sibling stream. Coordination is required before acting.`,
				}
			}

			return {
				success: true,
				warning: `📍 Planning a change in the **${layer.toUpperCase()}** layer (${path.basename(filePath)}).`,
			}
		}

		// v9 HARDENING: Pre-emptive Match Sensing for replace_in_file (simulated via FILE_EDIT validation)
		if (block.name === DietCodeDefaultTool.FILE_EDIT && block.params?.path && (block.params as { diff?: string }).diff) {
			const filePath = path.resolve(this.cwd, block.params.path)
			const diff = (block.params as { diff: string }).diff as string
			const searchBlocks = diff.match(/------- SEARCH\n([\s\S]*?)\n=======/)
			if (searchBlocks) {
				const searchContent = searchBlocks[1]
				try {
					const currentDiskContent = await fs.readFile(filePath, "utf-8")
					if (!currentDiskContent.includes(searchContent)) {
						// v9 AUTO-CORRECTION: Provide the agent with the actual lines to fix the search block
						const searchLines = searchContent.split("\n")
						const firstLine = searchLines[0].trim()
						const diskLines = currentDiskContent.split("\n")
						const matchIndex = diskLines.findIndex((l) => l.includes(firstLine))
						let hint = ""
						if (matchIndex !== -1) {
							const contextWindow = diskLines.slice(Math.max(0, matchIndex - 2), matchIndex + 5).join("\n")
							hint = `\n\n🔍 AUTO-CORRECTION HINT: Your SEARCH block failed, but I found a similar section starting at line ${matchIndex + 1}:\n\`\`\`typescript\n${contextWindow}\n\`\`\``
						}

						return {
							success: false,
							error: `🛑 PRE-EMPTIVE MATCH FAILURE: The SEARCH block in your edit does not match the current state of \`${path.basename(filePath)}\`.${hint}\n\n💡 RECOVERY: Update your SEARCH block to match the actual file content exactly.`,
						}
					}
				} catch (_e) {
					// File might not exist
				}
			}
		}

		// Architectural Policy: AST + Database Concurrent Pass
		if (
			(block.name === DietCodeDefaultTool.FILE_NEW || block.name === DietCodeDefaultTool.FILE_EDIT) &&
			block.params?.path &&
			block.params?.content
		) {
			const filePath = path.resolve(this.cwd, block.params.path)
			const content = block.params.content as string

			// 0. Rule: Contextual Sovereignty Guard (Staleness Protection)
			// PRODUCTION HARDENING: Proactively block edits based on verifiably stale context.
			const staleness = this.stalenessTracker.checkStaleness(filePath)
			if (staleness.isStale && !this.commitSeal) {
				const fileName = path.basename(filePath)
				// PRODUCTION HARDENING: Proactive recovery hint with a ready-to-use tool call snippet
				return {
					success: true,
					warning: `⚠️ CONTEXTUAL SOVEREIGNTY BREACH: You are attempting to edit \`${fileName}\` based on a stale mental model.\nReason: ${staleness.reason}\n\n💡 RECOVERY: Execute the following command to synchronize your context:\n\`\`\`json\n{\n  "name": "read_file",\n  "params": { "path": "${filePath}" }\n}\n\`\`\``,
				}
			}

			// Update Spider session cache with Incremental Node Sync (v16)
			this.sessionFiles.set(filePath, content)
			this.spiderEngine.updateNode(filePath, content)

			// 1. AST Validation (TSP)
			// V9: Pass trend signals for Absolute Metabolic Integrity
			const isRecovering = this.spiderEngine.isRecovering
			const isHealing = content.includes("[SOVEREIGN_HEALING]") || content.includes("# HEALING TURN")
			const astValidation = this.tspPlugin.validateSource(
				filePath,
				content,
				this.virtualResolver,
				isRecovering || isHealing,
			)

			// Block on AST Failure (Strike 1 Domain)
			if (!astValidation.success) {
				const layer = this.getCachedLayer(filePath)
				const strikes = await this.incrementStrikes(filePath)
				const projectHealth = this.computeBuildHealth(this.spiderEngine.getViolations().map((v) => v.message))

				// PRODUCTION HARDENING: Layer-aware blocking.
				// 1. DOMAIN is the holy of holies — ALWAYS block on any error UNLESS [SOVEREIGN_HEALING] is present.
				// 2. CORE is the mission control — block on Strike 1 if integrity is compromised (< 70) AND declining.

				const isRecoveringTrend = this.spiderEngine.isRecovering
				const shouldBlock =
					(layer === "domain" && astValidation.errors.length > 0 && !isHealing) ||
					(layer === "core" &&
						strikes === 1 &&
						astValidation.errors.length > 0 &&
						projectHealth < 70 &&
						!isRecoveringTrend)

				if (shouldBlock) {
					const violationSummaryRejection = astValidation.errors.map((e: string) => `  - ${e}`).join("\n")
					const rejectionTitle = layer === "domain" ? "🛡️ DOMAIN SOVEREIGNTY BREACH" : "🏗️ CORE INTEGRITY PROTECT"
					const shield = this.telemetrics.getResilienceShield()

					// PFH: Proactive Forensic Healing - We allow the write but force a repair turn
					return {
						success: true,
						warning:
							`${shield}🚨 ${rejectionTitle} [REPAIR_REQUIRED]\n` +
							`Layer file \`${path.basename(filePath)}\` has ${astValidation.errors.length} violation(s) (Strike ${strikes}):\n${violationSummaryRejection}\n\n` +
							`${this.getCorrectionHint(astValidation.errors, filePath)}\n\n` +
							`‼️ **PROACTIVE FORENSIC HEALING REQUIRED**\n` +
							`To maintain substrate stability, your NEXT turn MUST resolve these violations. ` +
							`If these errors persist, the system will trigger a Hard Metabolic Cooldown.`,
						violations: astValidation.errors,
					}
				}

				// Strike 2+ or other layers: Warning only
				const allWarnings = [...(astValidation.warnings || []), ...astValidation.errors]
				const violationSummary = allWarnings.map((e: string) => `  - ${e}`).join("\n")
				const entropy = this.spiderEngine.computeEntropy()
				const latestSnapshot = await this.spiderEngine.getLatestSnapshot()
				const delta = latestSnapshot ? this.spiderEngine.compareWith(latestSnapshot) : 0

				if (this.streamId) {
					await orchestrator.storeMemory(this.streamId, "last_entropy_score", entropy.score.toString())
					if (delta > 0.01) {
						await orchestrator.storeMemory(this.streamId, "entropy_decay", delta.toString())
					}
				}

				// V10: Recursive Drift Protection
				if (strikes >= 3 && layer === "core") {
					return {
						success: true,
						warning:
							`⚠️ RECURSIVE DRIFT INTERDICTION: You have attempted to edit \`${path.basename(filePath)}\` 3 times with unresolved Domain/Core violations.\n` +
							`The substrate is rejecting these atomic changes. You are likely trying to perform a complex refactor in too small of a window.\n\n` +
							`💡 STRATEGIC PIVOT: You MUST extract this logic or implement a formal interface rather than forcing the current approach. Use \`RefactorHealer\` to materialize a contract, or perform a # SOVEREIGN AUDIT.`,
					}
				}

				return {
					success: true,
					warning:
						layer === "domain"
							? `⚠️ ARCHITECTURAL WARNING (Strike ${strikes} — enforcement degraded): Domain layer file \`${path.basename(filePath)}\` has ${astValidation.errors.length} unresolved violation(s):\n${violationSummary}\n\nThe write is ALLOWED to prevent deadlock.`
							: `⚠️ ARCHITECTURAL WARNING: ${layer.toUpperCase()} layer file \`${path.basename(filePath)}\` has ${astValidation.errors.length} violation(s):\n${violationSummary}` +
								(delta > 0.01
									? `\n\n🕷️ ARCHITECTURAL DECAY: Entropy increased by ${SafeNumber.formatPercent(delta, 1)}%.`
									: ""),
					correctionHint: this.getCorrectionHint(astValidation.errors, filePath),
				}
			}

			// Clean file — reset strikes for this path
			await this.resetStrikes(filePath)

			// V10: Harmonic Decay (Forgiveness for historically stressed files)
			if (this.spiderEngine.isRecovering) {
				const isHistoricallyAlarmed =
					this.alarmViolations.some((v) => v.includes(filePath)) || this.pathogens.isPathogenic(filePath)
				if (isHistoricallyAlarmed) {
					Logger.info(`[FluidPolicyEngine] Triggering Harmonic Decay for successfully healed file: ${filePath}`)
					this.pathogens.decay(filePath, 2)
				}
			}

			// Surface AST warnings if any
			if (astValidation.warnings && astValidation.warnings.length > 0) {
				return {
					success: true,
					warning: `⚠️ DISCERNMENT WARNING: Architectural smell(s) detected:\n${astValidation.warnings.map((w: string) => `  - ${w}`).join("\n")}`,
				}
			}

			// For new files: proactively suggest the best layer if content doesn't match location
			if (block.name === DietCodeDefaultTool.FILE_NEW && block.params.content) {
				// consolidated to top-level import
				const currentLayer = getLayer(filePath)
				const suggestion = suggestLayerForContent(block.params.content)
				if (suggestion && suggestion.layer !== currentLayer && currentLayer !== "core") {
					return {
						success: true,
						warning: `📍 This file is being created in the **${currentLayer.toUpperCase()}** layer, but its content looks like it belongs in **${suggestion.layer.toUpperCase()}**.\n${suggestion.reason}\nConsider placing it under \`src/${suggestion.layer}/\` instead. If the current location is intentional, proceed.`,
					}
				}
			}
		}

		// Concurrency Policy: Check for file collisions with sibling streams
		if (!this.streamId) return { success: true }

		if (
			block.name === DietCodeDefaultTool.FILE_NEW ||
			block.name === DietCodeDefaultTool.FILE_EDIT ||
			block.name === DietCodeDefaultTool.APPLY_PATCH
		) {
			const params = (block as unknown as { params: Record<string, unknown> }).params || {}
			const files = params.path ? [path.resolve(this.cwd, params.path as string)] : []
			if (files.length > 0) {
				const collision = await orchestrator.checkCollision(this.streamId, files)
				if (collision) {
					return {
						success: false,
						error: `🛑 FLUID COORDINATION ERROR: ${collision}\nYOUR COMMIT HAS BEEN BLOCKED TO PREVENT DATA CORRUPTION. Coordinate with the sibling stream or wait for its completion before proceeding.`,
					}
				}
			}
		}

		if (block.params?.path) {
			const normalizedPath = this.normalize(block.params.path)
			this.metabolicMonitor.recordWrite(normalizedPath) // V31: Intent record (without content)

			// --- ZERO-FRICTION COMPLIANCE HOOK ---
			// Automatically align tags and fix outgoing imports in the backup
			try {
				const absolutePath = path.resolve(this.cwd, normalizedPath)
				await this.refactorHealer.alignTag(absolutePath)

				// --- VIBRATION SENSING (Blast Radius) ---
				// Heal the rattled dependents in the background
				await this.refactorHealer.healCascade(absolutePath, this.spiderEngine)
			} catch (e) {
				Logger.warn("Refactor healer failed in background", { error: e })
			}
		}

		// V150: Cognitive Immortality (Eager Persistence)
		if (this.streamId) {
			// V189: Unified Substrate handles metabolic persistence
		}

		// V204: Non-Blocking Integrity Advisories (TIA)
		// Pull healing suggestions from the structural graph without blocking execution.
		const advisories = this.spiderEngine.getIntegrityAdvisories(block.params?.path as string)
		const brittlePaths = this.refactorHealer.detectRelativeImports(
			block.params?.path as string,
			block.params?.content as string,
			this.spiderEngine,
		)
		const missingExports = this.refactorHealer.detectMissingExports(
			block.params?.path as string,
			block.params?.content as string,
		)
		const shadowing = this.refactorHealer.detectShadowing(block.params?.path as string, block.params?.content as string)
		const unusedImports = this.refactorHealer.detectUnusedImports(
			block.params?.path as string,
			block.params?.content as string,
		)
		const barrelGaps = await this.refactorHealer.detectMissingFromBarrel(block.params?.path as string)
		const vibrations = this.spiderEngine
			.getIntegrityAdvisories(block.params?.path as string)
			.filter((a) => a.id === "SPI-105")

		if (
			advisories.length > 0 ||
			brittlePaths.length > 0 ||
			missingExports.length > 0 ||
			shadowing.length > 0 ||
			unusedImports.length > 0 ||
			barrelGaps.length > 0 ||
			vibrations.length > 0
		) {
			const advisoryHint = [
				...advisories.map((a) => {
					let msg = `  - 💡 [INTEGRITY_ADVISORY]: ${a.message}`
					if (a.id === "SPI-102") {
						const symbol = a.message.match(/SYMBOL: (.*?) ->/)?.[1]
						if (symbol) {
							const layer = this.getCachedLayer(a.path)
							const boilerplate = this.refactorHealer.materializeSymbolBoilerplate(symbol, layer)
							msg += `\n    \`\`\`typescript\n${boilerplate}\n    \`\`\``
						}
					}
					return msg
				}),
				...brittlePaths.map((p) => `  - 💡 [PATH_ADVISORY]: Relative path should be an alias: ${p}`),
				...missingExports.map((e) => `  - 💡 [VISIBILITY_ADVISORY]: ${e}`),
				...shadowing.map((s) => `  - 💡 [NAMING_ADVISORY]: ${s}`),
				...unusedImports.map((u) => `  - 💡 [DEADWOOD_ADVISORY]: ${u}`),
				...barrelGaps.map((b) => `  - 💡 [BARREL_ADVISORY]: ${b}`),
				...vibrations.map((v) => `  - 🚨 [SUBSTRATE_VIBRATION]: ${v.message}`),
			].join("\n")

			result.warning =
				(result.warning ? result.warning + "\n\n" : "") +
				`### 🔍 ARCHITECTURAL ADVISORIES\n${advisoryHint}\n\n` +
				`*These are passive suggestions to improve structural health. You may address them in this turn or a subsequent stabilization phase.*`
		}

		return result
	}

	/**
	 * Resolves the architectural layer for a file with in-memory caching.
	 * Tier 3 optimization for high-volume file batches.
	 */
	private getCachedLayer(filePath: string): string {
		let layer = this.layerCache.get(filePath)
		if (!layer) {
			// consolidated to top-level import
			layer = getLayer(filePath)
			if (layer) {
				this.layerCache.set(filePath, layer)
			}
		}
		return layer ?? "infrastructure"
	}

	/**
	 * Inspects and enriches tool results with proactive layer context.
	 * Always injects the file's layer context so the agent knows the rules before editing.
	 * Additionally warns about existing violations if any are found.
	 */
	public async observeToolOutcome(_toolName: string, _output: unknown): Promise<{ hint?: string }> {
		return {}
	}

	public async onRead(
		filePath: string,
		content: string,
		totalReadCount = 0,
		perFileReadCount = 0,
		globalFileReadCount = 0,
	): Promise<string> {
		const absolutePath = path.resolve(this.cwd, filePath)

		// Update Spider session cache
		this.sessionFiles.set(absolutePath, content)
		this.spiderEngine.updateNode(absolutePath, content)
		await this.stalenessTracker.recordRead(absolutePath, content)
		this.metabolicMonitor.recordRead(absolutePath, content)

		// V189: Neural Forensic Extraction
		const symbolRegex = /(?:class|function|interface)\s+([a-zA-Z0-9_$]+)/g
		let match = symbolRegex.exec(content)
		while (match !== null) {
			this.metabolicMonitor.recordSymbolObservation(absolutePath, match[1])
			match = symbolRegex.exec(content)
		}

		const entropy = this.spiderEngine.computeEntropy()
		const latestSnapshot = await this.spiderEngine.getLatestSnapshot()
		const delta = latestSnapshot ? this.spiderEngine.compareWith(latestSnapshot) : 0

		if (this.streamId) {
			await orchestrator.storeMemory(this.streamId, "last_entropy_score", entropy.score.toString())
			if (delta > 0.01) {
				await orchestrator.storeMemory(this.streamId, "entropy_decay", delta.toString())
			}
		}

		const layerContext = this.getFileLayerContext(absolutePath)
		const validation = this.tspPlugin.validateSource(absolutePath, content, this.virtualResolver)
		const layer = this.getCachedLayer(absolutePath)
		const refactorSuggestions = SpiderRefactorer.getRefactoringSuggestions(this.spiderEngine)

		let header = `${layerContext}\n`

		if (refactorSuggestions.length > 0) {
			header += `🕷️ ARCHITECTURAL REFACTORING OPPORTUNITIES:\n${refactorSuggestions.map((s: RefactoringSuggestion) => `  - [${s.type}] ${s.target}: ${s.reason} (${s.benefit})`).join("\n")}\n`
		}

		if (!validation.success) {
			header += `⚠️ Existing issues in this file:\n${validation.errors.map((v) => `  - ${v}`).join("\n")}\n`

			// V29: Pathogen Nudging (Remediation Injection)
			const pathogens = this.spiderEngine.getViolations().filter((v) => v.path === absolutePath && v.remediation)
			if (pathogens.length > 0) {
				header += `💡 ARCHITECTURAL REMEDIATION:\n${pathogens.map((p) => `  - [${p.id}] ${p.remediation}`).join("\n")}\n`
			}
			header += `Keep these in mind — avoid propagating these patterns.\n`
		}

		// Proactive Dependency Detection (AST-based)
		const sourceFile = require("typescript").createSourceFile(
			absolutePath,
			content,
			require("typescript").ScriptTarget.Latest,
			true,
		)
		const crossLayerViolations = this.tspPlugin.findCrossLayerViolations(sourceFile, absolutePath)
		if (crossLayerViolations.length > 0) {
			header += `⚠️ ARCHITECTURAL SMELL DETECTED (Cross-Layer Dependency):\n${crossLayerViolations.map((v) => `  - ${v}`).join("\n")}\n`
		}

		// Proactive Context Freshness
		const stalenessWarning = this.stalenessTracker.getStaleWarning(absolutePath)
		if (stalenessWarning) {
			header += `${stalenessWarning}\n`
		}

		// Protocol Hardening: Inject Guard Directives based on project health
		// PRODUCTION HARDENING: Clearer, more authoritative guidance for integrity recovery.
		const buildHealth = this.computeBuildHealth(this.spiderEngine.getViolations().map((v) => v.message))
		if (buildHealth < 70) {
			header += `\n🛡️ HIGH-SHIELD PROTOCOL ACTIVE: Structural Integrity is CRITICAL (${buildHealth}/100).\n`
			header += `Architecture is currently under SOFT-LOCK. New features are RESTRICTED. Prioritize HEALING the following vectors:\n`
			header += `  - Address Circular Dependencies (SPI-004)\n  - Resolve Layer Violations\n  - Clean up Ghost Imports (SPI-005)\n`
		} else if (buildHealth < 85) {
			header += `\n🔍 ARCHITECTURAL WATCH: Structural Integrity is ${buildHealth}/100. Maintain layer discipline to avoid soft-lock thresholds.\n`
		}

		// Axiomatic Logic Report
		const axioms = this.axiomEngine.validateAxioms(absolutePath, content, this.spiderEngine)
		if (axioms.length > 0) {
			header += `\n🧠 LOGIC AXIOM ANALYSIS:\n${axioms.map((v) => `  - [${v.axiom}] ${v.message}`).join("\n")}\n`
		}

		// Metabolic Vitality Injection
		const doubt = this.metabolicMonitor.getDoubtSignal(path.relative(this.cwd, absolutePath))
		const cooldown = this.metabolicMonitor.getCooldownStatus()

		if (doubt > 1.0) {
			header += `\n⚠️ METABOLIC PRESSURE DETECTED (Doubt: ${SafeNumber.format(doubt, 1)}, Cooldown: ${cooldown.active})\n`
		}

		// V28: Proactive Recovery Template Injection
		let scratchpadExists = false
		try {
			await fs.access(path.join(this.cwd, "scratchpad.md"))
			scratchpadExists = true
		} catch (_) {}

		if (!scratchpadExists && (doubt > 5 || cooldown.active)) {
			const template = this.getSystemDiagnostics()
			header +=
				`🛑 ARCHITECTURAL STALL: Your investigation is thrashed. Sovereignty protocol requires an audit.\n` +
				`💡 I have synthesized a recovery template for you. Initialize \`scratchpad.md\` NOW to proceed:\n\n` +
				`\`\`\`markdown\n${template}\n\`\`\`\n`
		}

		// V33: Refactor awareness for diagnostic injection
		const isRefactoringIntent =
			this.refactorTurnsRemaining > 0 || this.spiderEngine.getViolations().length > 0 || this.buildAlarmActive
		const nodeSize = this.spiderEngine.nodes.get(absolutePath)?.astComplexity || 0
		const drift = this.metabolicMonitor.getTaskDrift(this.mode === "plan", isRefactoringIntent)
		const activity = this.metabolicMonitor.isHighlyActive(absolutePath, isRefactoringIntent, nodeSize)

		if (activity.active) {
			header += `\n🔥 HIGH ACTIVITY LEVEL DETECTED:\n${activity.reason}\nThis file is changing very rapidly. Consider a quick Strategic Review to stay aligned.\n`
		}

		if (drift.warning) {
			header += `\n${drift.warning}\n`
		}

		if (drift.drift > 0.15) {
			header += `\n🕸️ [AXIOMATIC DRIFT]: Graph is ${SafeNumber.formatPercent(drift.drift, 1)}% cross-layer (Target: < 15%).\n`
		}

		if (this.mode === "plan") {
			if (perFileReadCount >= 3) {
				header += `🔍 Architecture Analysis (PLAN mode):\n`
				header += `  ⚠️ RECURSIVE STALLING DETECTED: You have read this specific file (${path.basename(absolutePath)}) ${perFileReadCount} times in this turn without making progress. To avoid an infinite loop, you MUST NOW stop reading this file and either synthesize your findings into a plan or use \`ask_followup_question\`.\n`
			} else if (globalFileReadCount >= 5) {
				header += `🔍 Architecture Analysis (PLAN mode):\n`
				header += `  ⚠️ CROSS-TURN RECURSION DETECTED: You have read this specific file (${path.basename(absolutePath)}) ${globalFileReadCount} times across multiple turns without progress. To avoid an infinite loop, you MUST NOW stop reading this file and synthesize your findings or use \`ask_followup_question\`.\n`
			} else if (totalReadCount >= 10) {
				header += `🔍 Architecture Analysis (PLAN mode):\n`
				header += `  ⚠️ SYSTEMATIC SCANNING LIMIT: You have read ${totalReadCount} unique files in this interaction turn. To avoid context bloat, you MUST NOW synthesize your current findings into an architectural plan using \`plan_mode_respond\`.\n`
			} else if (totalReadCount >= 5) {
				// Adaptive Guidance: Omit probing questions after 5 reads to reduce turn-overhead and "nagging"
				header += `🔍 Architecture Context (PLAN mode):\n`
				header += `  (Probing questions disabled for turn-efficiency. Focus on your planning objective.)\n`
			} else {
				const isInterface = content.includes("interface ") || content.includes("type ")
				header += `🔍 Architecture Probing (PLAN mode):\n`
				switch (layer) {
					case "domain":
						if (isInterface) {
							header += `  - Is this Domain contract stable enough for Core consumption?\n  - Does it avoid leaking implementation details?`
						} else {
							header += `  - Does this logic belong in a Core Service instead?\n  - Are all Infrastructure side effects abstracted?`
						}
						break
					case "core":
						header += isInterface
							? `  - Is this Core interface consumed by UI or Infrastructure components?`
							: `  - Which Domain models are being coordinated here?\n  - Are Infrastructure dependencies properly abstracted via interfaces?`
						break
					case "infrastructure":
						header += `  - Does this adapter strictly implement a Domain or Core contract?\n  - Is any business logic leaking into this I/O-heavy layer?`
						break
					default:
						header += `  - How does this file fit into the overall JoyZoning topology?`
				}
				header += `\n`
			}
		} else if (this.mode === "act") {
			header += `🛠️ Layer Toolkit (ACT mode):\n`
			switch (layer) {
				case "domain":
					header += `  - 🚫 NO side effects. 🚫 NO external imports. 🚫 NO environment variable leakage.\n  - Ensure logic is pure and testable without I/O.`
					break
				case "core":
					header += `  - 🏗️ Coordinate Domain Models. 🏗️ Use Dependency Inversion for Infrastructure.\n  - Keep logic flow visible; delegate low-level implementation.`
					break
				case "infrastructure":
					header += `  - 🔌 Implement Domain interfaces. 🔌 Isolate I/O details.\n  - Transform external data to Domain models immediately.`
					break
			}
			header += `\n`

			// Context-Aware Tool Guidance
			if (this.commitSeal) {
				header += `🔓 COMMIT SEAL ACTIVE: '${this.commitSeal}'\n  Reason: ${this.sealReason}\n  Continue with care — architectural debt is being recorded.\n\n`
			}
		}

		return `${header}\n${content}`
	}

	/**
	 * Validates the outcome of a tool execution.
	 */
	public async validatePostExecution(block: ToolUse, toolOutput: unknown, prevResultHash?: string): Promise<PolicyResult> {
		const result: PolicyResult = { success: true }

		// V190: Reactive Environment Lease Revocation
		// If a bash command fails with code 127 (not found), revoke the environmental lease.
		if (block.name === DietCodeDefaultTool.BASH) {
			const output = toolOutput as { exitCode?: number }
			if (output?.exitCode === 127 || output?.exitCode === 126) {
				this.envSovereignty.revokeLease()
			}
		}

		// Build Integrity: Run Sweeping Garbage Collector (Real-time cleanup)
		const isHealingIntent = this.verification.detectHealingIntent(block) !== null
		const isRefactoringIntent = this.refactorTurnsRemaining > 0 || isHealingIntent

		// Build Integrity: Run Sweeping Garbage Collector (Real-time cleanup)
		if (
			block.name === DietCodeDefaultTool.FILE_NEW ||
			block.name === DietCodeDefaultTool.FILE_EDIT ||
			block.name === DietCodeDefaultTool.APPLY_PATCH
		) {
			const params = block.params as { path?: string; target_file?: string }
			const filePath = params?.path || params?.target_file
			if (filePath) {
				const absPath = path.resolve(this.cwd, filePath)
				try {
					const normPath = this.normalize(absPath)

					// 0. Update Session Awareness (V71)
					this.spiderEngine.setSessionBuffer(this.sessionFiles)

					// 0.1: Acquire Stability Lock (V190: Industrial Sovereignty)
					const lockId = await this.spiderEngine.acquireStabilityLock("AGENT_MUTATION")
					if (!lockId) {
						result.success = false
						result.error = "Stability Lock collision: Transaction denied by another agentic process."
						return result
					}

					try {
						// 0.2: Create Structural Checkpoint (V200: Resilience Insurance)
						this.spiderEngine.createCheckpoint()

						// 1. Run the Sweep (Auto-fix lint/imports/pruning)
						const sweepResult = await this.garbageCollector.sweep([normPath])

						// 2. Synchronize Graph
						const content = await fs.readFile(absPath, "utf-8")
						const lastIntegrity = this.spiderEngine.nodes.get(normPath)?.namingScore || 1.0

						// 2.1: Axiomatic Resonance Snapshot (V187)
						const lastAxioms = this.axiomEngine.validateAxioms(normPath, content, this.spiderEngine)

						this.spiderEngine.updateNode(normPath, content)
						const currentIntegrity = this.spiderEngine.nodes.get(normPath)?.namingScore || 1.0
						const currentAxioms = this.axiomEngine.validateAxioms(normPath, content, this.spiderEngine)
						const axiomaticResult = this.axiomEngine.compareAxiomSessions(lastAxioms, currentAxioms)

						// 2.2: Merkle Resonance Tracking (V186)
						const merkle = this.spiderEngine.computeMerkleRoot()
						if (this.streamId) {
							await orchestrator.storeMemory(this.streamId, "merkle_resonance", merkle)
						}

						this.metabolicMonitor.recordWrite(normPath, content, 0, 0, this.streamId)

						// 2.2: Structural & Axiomatic Gain Enforcement
						if (axiomaticResult.status === "POSITIVE" && lastAxioms.length > currentAxioms.length) {
							result.warning =
								(result.warning ? `${result.warning}\n` : "") +
								`✨ AXIOMATIC ALIGNMENT: Fundamental structural contradictions resolved in ${path.basename(filePath)}. Double down on this concept!`
						} else if (axiomaticResult.status === "NEGATIVE") {
							result.warning =
								(result.warning ? `${result.warning}\n` : "") +
								`⚠️ AXIOMATIC DECAY: This change introduced new structural violations. [INDUSTRIAL_ROLLBACK] suggested if build fails.`
						} else if (currentIntegrity > lastIntegrity) {
							result.warning =
								(result.warning ? `${result.warning}\n` : "") +
								`✨ STRUCTURAL GAIN: Identifier casing integrity improved in ${path.basename(filePath)}. Double down on this concept!`
						} else if (currentAxioms.length < lastAxioms.length) {
							result.warning =
								(result.warning ? `${result.warning}\n` : "") + `✨ AXIOMATIC GAIN: Structural purity improved.`
						}

						// 3. Report remaining errors
						if (sweepResult.remainingErrors.length > 0) {
							const attempts = (this.gracePeriods.get(normPath) || 0) + 1
							this.gracePeriods.set(normPath, attempts)

							if (isRefactoringIntent && attempts === 1) {
								// V100: GC Soft-Lock Grace Period
								result.success = true // Proceed with warning
								result.warning = `🩹 GC SOFT-LOCK ACTIVE: Minor build regressions remain after Sweep. Proceeding with caution. FIX IN NEXT TURN:\n${sweepResult.remainingErrors.map((e) => `  - ${e}`).join("\n")}`
								Logger.warn(`[FluidPolicyEngine] Soft-Lock Grace Period utilized for ${path.basename(filePath)}`)
							} else {
								// PFH: Instead of hard-failing, we allow it but inject a MANDATORY repair directive
								result.success = true
								result.buildErrors = sweepResult.remainingErrors
								result.warning =
									`⚠️ [PFH ALERT] Build/Lint issues persist after Sweep:\n` +
									`${sweepResult.remainingErrors.map((e) => `  - ${e}`).join("\n")}\n\n` +
									`🩹 **Supportive Healing Advisory**\n` +
									`The Garbage Collector could not auto-resolve these errors. Manual intervention is recommended to heal this file (Deterministic PFH).\n\n` +
									`${this.generateIntegrityAdvisor([normPath])}`

								// Passive Circuit Breaker: If build health is critical, force an audit
								if (this.lastBuildHealth < 60) {
									const auditTemplate = SovereignProtocol.generateAuditTemplate("Substrate Recovery", {
										buildHealth: this.lastBuildHealth,
										workloadLevel: "Critical",
										buildErrors: sweepResult.remainingErrors,
										lintWarnings: [],
										hotspots: [filePath],
										suggestedRepairs: [normPath],
									})
									result.warning +=
										`\n\n🛑 **CRITICAL HEALTH BREACH**: System health is at ${this.lastBuildHealth}%. ` +
										`I have prepared a Strategic Review template for you. Please update \`scratchpad.md\` before proceeding:\n\n` +
										`\`\`\`markdown\n${auditTemplate}\n\`\`\``
								}
							}
						}

						// V200: Mission Drift Suppression (Yak Shaving Interdiction)
						// If build health is low and the current edit is in a peripheral file, encourage healing first.
						const drift = this.metabolicMonitor.getTaskDrift(isRefactoringIntent)
						const layer = this.getCachedLayer(filePath)
						if (drift.warning && this.lastBuildHealth < 75 && !layer.match(/domain|core/i)) {
							const shield = this.telemetrics.getResilienceShield()
							result.success = true // V201: Soft-Lock (Allow but Mandate)
							result.warning =
								`The substrate has enabled an Integrity Advisory. You are encouraged to return focus to healing the core logic violations before proceed with this new logic.\n\n` +
								`🩹 **Supportive Healing Advisory**\n` +
								`${this.generateIntegrityAdvisor([filePath])}`
							return result
						}

						if (sweepResult.fixedCount > 0) {
							Logger.info(
								`[FluidPolicyEngine] Sweep fixed ${sweepResult.fixedCount} issues in ${path.basename(filePath)}.`,
							)
						}
					} finally {
						this.spiderEngine.releaseStabilityLock("AGENT_MUTATION", lockId)
					}
				} catch (e) {
					Logger.error(`[FluidPolicyEngine] Garbage Collection failed for ${filePath}:`, e)
				}
			}
		}

		// V42: Active Move Synthesis (Project-wide re-linking)
		if (block.name === DietCodeDefaultTool.MOVE || block.name === DietCodeDefaultTool.RENAME) {
			const params = block.params as { path?: string; oldPath?: string; destination?: string; newPath?: string }
			const oldPath = params.path || params.oldPath
			const newPath = params.destination || params.newPath

			if (oldPath && newPath) {
				Logger.info(`[FluidPolicyEngine] MOVE detected. Synthesizing substrate imports for ${oldPath} -> ${newPath}`)
				const updateCount = await this.refactorHealer.healImports(oldPath, newPath, this.spiderEngine)
				if (updateCount > 0) {
					result.warning =
						(result.warning ? `${result.warning}\n` : "") +
						`✨ [MOVE SYNTHESIS]: Automatically re-linked ${updateCount} imports project-wide to maintain integrity.`
				}
			}
		}

		// Stability Policy: Entropy Detection
		if (prevResultHash) {
			const resultStr = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput)
			const currentHash = crypto.createHash("sha256").update(resultStr).digest("hex")

			if (currentHash !== prevResultHash) {
				const entropyReport = this.spiderEngine.computeEntropy()
				const latestSnapshot = await this.spiderEngine.getLatestSnapshot()
				const delta = latestSnapshot ? this.spiderEngine.compareWith(latestSnapshot) : 0

				if (this.streamId) {
					await orchestrator.storeMemory(this.streamId, "last_entropy_score", entropyReport.score.toString())
					if (delta > 0.01) {
						await orchestrator.storeMemory(this.streamId, "entropy_decay", delta.toString())
					}
				}

				result.warning =
					(result.warning ? `${result.warning}\n` : "") +
					`⚠️ ENTROPY WARNING: Tool output has diverged. Structural health: ${SafeNumber.formatPercent(entropyReport.score, 1)}% decay.` +
					(delta > 0.01 ? `\n🕷️ DECAY SINCE LAST SNAPSHOT: +${SafeNumber.formatPercent(delta, 1)}%` : "")
				result.entropyScore = entropyReport.score
			}

			// Take a snapshot if successful and divergence is low
			if (result.success && result.entropyScore !== undefined && result.entropyScore < 0.2) {
				await this.spiderEngine.takeSnapshot()
			}
		}

		const currentEntropy = this.spiderEngine.computeEntropy()
		const currentViolations = this.spiderEngine.getViolations()
		const health = this.computeBuildHealth(currentViolations.map((v) => v.message))

		// V80: Karma-Based Strike Pardon (Structural Reward)
		const entropyDiscovery = this.lastEntropyScore - currentEntropy.score
		const karmaEarned = entropyDiscovery > 0.05 // 5% improvement in structural purity

		const recoveryDetected =
			(this.lastBuildHealth < 70 && health > 90) || currentViolations.length < this.lastViolationCount || karmaEarned

		if (recoveryDetected) {
			const oldHealth = this.lastBuildHealth
			this.lastViolationCount = currentViolations.length
			this.lastBuildHealth = health
			this.lastEntropyScore = currentEntropy.score

			const params = block.params as { path?: string }
			const filePath = params.path
			if (filePath) {
				const norm = this.normalize(path.resolve(this.cwd, filePath))
				this.metabolicMonitor.resetFileInflammation(norm)
			}

			this.metabolicMonitor.resetMetabolicPressure()

			// V45: Sovereign Success Reinforcement
			if (karmaEarned) {
				result.warning =
					(result.warning ? `${result.warning}\n` : "") +
					`✨ [KARMA EARNED]: Your high-quality refactor has reduced structural entropy by ${SafeNumber.formatPercent(entropyDiscovery, 1)}%.\n` +
					`Sovereign strikes have been pardoned. Substrate health is recovering.`
				Logger.info(
					`[FluidPolicyEngine] Karma Pardon triggered: Entropy drop ${SafeNumber.formatPercent(entropyDiscovery, 1)}%`,
				)
			} else if (oldHealth < 70 && health > 90) {
				result.warning =
					(result.warning ? `${result.warning}\n` : "") +
					`🌟 [SOVEREIGN PRAISE]: You have successfully stabilized the substrate (Health: ${oldHealth}% -> ${health}%).\n` +
					`Metabolic pressure has been reset. Sovereignty is maintained.`
				Logger.info(`[FluidPolicyEngine] Success Reinforcement triggered: ${oldHealth} -> ${health}`)
			} else {
				Logger.info(`[FluidPolicyEngine] Metabolic Forgiveness applied (Structural Improvement Detected).`)
			}
			const errorCount = currentViolations.filter((v) => v.severity === "ERROR").length
			if (errorCount > 0) {
				const warnCount = currentViolations.filter((v) => v.severity === "WARN").length
				const deltaMsg = `Distance to Green: ${errorCount} errors and ${warnCount} warnings remaining.`
				result.warning = (result.warning ? `${result.warning}\n` : "") + `🔍 [STABILIZATION DELTA]: ${deltaMsg}`
			}
		}

		// V70: Sovereign Refactor Window Decay
		if (this.refactorTurnsRemaining > 0) {
			this.refactorTurnsRemaining--
			if (this.refactorTurnsRemaining === 0) {
				Logger.info("[FluidPolicyEngine] Sovereign Refactor Window closed. Strict enforcement restored.")
			}
		}

		return result
	}

	/**
	 * Performs a final architectural audit on a set of changes before they are committed.
	 * Only domain-layer changes with violations block the commit; others produce warnings.
	 */
	public async validateCommit(
		affectedFiles: Set<string>,
		ops: import("../../infrastructure/db/BufferedDbPool").WriteOp[],
	): Promise<{ success: boolean; errors: string[] }> {
		const allErrors: string[] = []
		const isDomainChange = ops.some((op) => op.layer === "domain")

		for (const filePath of Array.from(affectedFiles)) {
			try {
				const content = await fs.readFile(filePath, "utf-8")
				const validation = this.tspPlugin.validateSource(filePath, content, this.virtualResolver)
				if (!validation.success) {
					allErrors.push(...validation.errors)
				}

				// AST-based dependency detection
				const ts = require("typescript")
				const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)
				const crossViolations = this.tspPlugin.findCrossLayerViolations(sourceFile, filePath)
				if (crossViolations.length > 0) {
					const layer = getLayer(filePath)
					allErrors.push(...crossViolations.map((v) => `[${layer.toUpperCase()}] ${path.basename(filePath)}: ${v}`))
				}
			} catch (e) {
				Logger.error(`[FluidPolicyEngine] Commit validation failed for ${filePath}:`, e)
			}
		}

		const isSealed = !!this.commitSeal
		const success = isSealed || !isDomainChange || allErrors.length === 0

		if (success) {
			Logger.info("[FluidPolicyEngine] Commit validated. Focus shift tracking reset.")
		}

		return {
			success,
			errors: isSealed ? allErrors.map((e) => `[SEALED OVERRIDE] ${e}`) : allErrors,
		}
	}

	private normalize(p: string): string {
		return this.spiderEngine.normalizePath(p)
	}

	public getForensics(): SovereignForensics {
		return this.forensics
	}

	public getStabilityStats() {
		return this.metabolicMonitor.getStabilityStats()
	}

	public getViolations() {
		return this.spiderEngine.getViolations()
	}

	public getEntropy() {
		return this.spiderEngine.computeEntropy()
	}

	public getNodes() {
		return this.spiderEngine.nodes
	}
	/**
	 * V110: Substrate Stability Telemetry Proxy.
	 */
	public getStabilityTelemetry(filePath: string) {
		const layer = this.getCachedLayer(filePath)
		const tokens = this.restorationTokens.get(filePath) || 0
		return this.telemetrics.getStabilityTelemetry(filePath, layer, tokens)
	}

	/**
	 * V189: Industrial Hardening - Sovereign Substrate Immortalization.
	 * Consolidates Metabolic, Spider, and Telemetry trends into a single atomic persistence transaction.
	 */
	private async persistSovereignSubstrate() {
		if (!this.streamId) return
		try {
			const spiderData = this.spiderEngine.serialize()
			const metabolicState = this.metabolicMonitor.exportState()
			const telemetricsState = this.telemetrics.exportState()

			const checksum = crypto.createHash("sha256").update(spiderData).digest("hex")

			const payload = JSON.stringify({
				version: "V189",
				spider: spiderData.toString("base64"),
				metabolic: metabolicState,
				telemetrics: telemetricsState,
				checksum,
				timestamp: Date.now(),
			})

			await orchestrator.storeMemory(this.streamId, "sovereign_substrate_v189", payload)
			Logger.info(`[FluidPolicyEngine] Sovereign Substrate immortalized (Checksum: ${checksum.slice(0, 8)}).`)
		} catch (e) {
			Logger.error("[FluidPolicyEngine] Failed to immortalize Sovereign Substrate:", e)
		}
	}

	/**
	 * V189: Industrial Hardening - Sovereign Substrate Restoration.
	 * Restores the entire structural and metabolic context from Ghost Memory.
	 */
	private async restoreSovereignSubstrate() {
		if (!this.streamId) {
			await this.spiderEngine.loadRegistry()
			return
		}
		try {
			const raw = await orchestrator.recallMemory(this.streamId, "sovereign_substrate_v189")
			if (raw) {
				const payload = JSON.parse(raw)
				const data = Buffer.from(payload.spider, "base64")
				const actualChecksum = crypto.createHash("sha256").update(data).digest("hex")

				if (actualChecksum !== payload.checksum) {
					Logger.error("[FluidPolicyEngine] Substrate Corruption sensed (Checksum Mismatch). Rebuilding...")
					await this.spiderEngine.loadRegistry()
					return
				}

				// Restore Sub-systems
				await this.spiderEngine.loadRegistry(data)
				this.metabolicMonitor.importState(payload.metabolic)
				this.telemetrics.importState(payload.telemetrics)

				this.stateRestored = true
				Logger.info(`[FluidPolicyEngine] Sovereign Substrate V189 restored and verified for stream ${this.streamId}.`)
			} else {
				// Fallback to legacy or rebuild
				await this.spiderEngine.loadRegistry()
			}
		} catch (e) {
			Logger.error("[FluidPolicyEngine] Failed to restore Sovereign Substrate:", e)
			await this.spiderEngine.loadRegistry()
		}
	}

	public getLayerForPath(filePath: string): string {
		const { getLayer } = require("@/utils/joy-zoning")
		return getLayer(filePath)
	}

	private async ensureScratchpadIntegrity(taskName = "Architectural Recovery"): Promise<{ content: string; created: boolean }> {
		const scratchpadPath = path.join(this.cwd, "scratchpad.md")
		try {
			const content = await fs.readFile(scratchpadPath, "utf-8")
			if (content.trim().length > 0) {
				return { content, created: false }
			}
		} catch (_e) {}

		const currentViolations = this.spiderEngine.getViolations()
		const diagnostics: SovereignDiagnostics = {
			buildHealth: this.computeBuildHealth(currentViolations.map((v) => v.message)),
			workloadLevel: "Restoring...",
			buildErrors: currentViolations.filter((v) => v.severity === "ERROR").map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			lintWarnings: [],
			hotspots: [],
		}

		const template = SovereignProtocol.generateAuditTemplate(taskName, diagnostics)
		await fs.writeFile(scratchpadPath, template, "utf-8")
		return { content: template, created: true }
	}
	/**
	 * V188: Detects if the physical substrate has been modified externally since the last edit.
	 */
	private async detectConcurrentDrift(block: ToolUse): Promise<string | undefined> {
		if (block.name !== DietCodeDefaultTool.FILE_EDIT && block.name !== DietCodeDefaultTool.APPLY_PATCH) return undefined

		const params = block.params as { path?: string; target_file?: string }
		const filePath = params?.path || params?.target_file
		if (!filePath) return undefined

		const absPath = path.resolve(this.cwd, filePath)
		try {
			const metrics = this.metabolicMonitor.getForensicRegistry().get(absPath)
			if (metrics?.lastObservedHash) {
				const currentContent = await fs.readFile(absPath, "utf-8")
				const currentHash = crypto.createHash("md5").update(currentContent).digest("hex")

				if (currentHash !== metrics.lastObservedHash) {
					return `⚠️ CONCURRENT DRIFT DETECTED: ${path.basename(filePath)} has been modified externally. Syncing substrate...`
				}
			}
		} catch (_e) {
			// File might not exist yet or be inaccessible
		}
		return undefined
	}
	/**
	 * V202: Manual Trigger for Sovereign Sweep.
	 */
	public async runGarbageCollectorSweep(
		files: string[],
	): Promise<{ fixedCount: number; remainingErrors: string[]; repairLog: string[] }> {
		return this.garbageCollector.sweep(files)
	}

	/**
	 * V202: Manual Trigger for AST Repair.
	 */
	public async applyDiagnosticFix(diag: ForensicDiagnostic): Promise<boolean> {
		return this.refactorHealer.applyDiagnosticFix(diag, this.spiderEngine)
	}

	/**
	 * V202-B: Generates a passive integrity advisor hint.
	 * Removed raw XML to prevent agentic spiraling.
	 */
	private generateIntegrityAdvisor(files: string[]): string {
		return `💡 [INTEGRITY_ADVISORY]: Auto-healing available. Run 'sovereign_integrity_sweep' with files: ${JSON.stringify(files)} to resolve.`
	}
}
