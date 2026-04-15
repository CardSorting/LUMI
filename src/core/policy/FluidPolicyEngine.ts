/**
 * [LAYER: CORE]
 */

import { DietCodeDefaultTool } from "@shared/tools"
import { createHash } from "crypto"
import fs from "fs/promises"
import * as path from "path"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { Logger } from "@/shared/services/Logger"
import { getLayer, isLayerTagSupported, suggestLayerForContent } from "@/utils/joy-zoning"
import { ToolUse } from "../assistant-message"
import { ContextStalenessTracker } from "../context/ContextStalenessTracker"
import { AuditRecorder } from "../integrity/AuditRecorder.js"
import { DashboardGenerator } from "../integrity/DashboardGenerator"
import { MetabolicMonitor } from "../integrity/MetabolicMonitor"
import { PathogenStore } from "../integrity/PathogenStore"
import { StateManager } from "../storage/StateManager"
import { RefactorHealer } from "../task/tools/RefactorHealer"
import { SovereignScribe } from "../task/tools/utils/SovereignScribe"
import { AxiomViolation, SemanticAxiomEngine } from "./SemanticAxiomEngine"
import { SimulationEngine } from "./SimulationEngine.js"
import { SovereignOptimizer } from "./SovereignOptimizer"
import { SovereignPolicy } from "./SovereignPolicy.js"
import { SovereignProtocol } from "./SovereignProtocol"
import { RefactoringSuggestion, SpiderRefactorer } from "./SpiderRefactorer.js"
import { SpiderEngine } from "./spider/SpiderEngine.js"
import { TspPolicyPlugin } from "./TspPolicyPlugin.js"

export interface PolicyResult {
	success: boolean
	error?: string
	warning?: string
	isAlarmed?: boolean
	violations?: string[]
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
	private architecturalAlarmActive = false
	private alarmViolations: string[] = []
	private lastIntegrityScore = 100
	private lastViolationCount = 0
	private modifiedLayers: Set<string> = new Set()
	private refactorHealer: RefactorHealer

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
		this.axiomEngine = new SemanticAxiomEngine(this.cwd)
		this.metabolicMonitor = new MetabolicMonitor()
		this.optimizer = new SovereignOptimizer(this.cwd)
		this.pathogens = new PathogenStore(this.cwd)
		this.refactorHealer = new RefactorHealer(this.cwd)

		// V16: Warm graph startup
		this.spiderEngine.loadRegistry().catch((e: unknown) => Logger.error("[FluidPolicyEngine] Failed to load registry:", e))
	}

	/**
	 * Clears architectural alarms and metabolic blockades.
	 * Explicitly used by orchestrator during a Cognitive Reflection Nudge to grant a clean slate.
	 */
	public resetSystemPressure(): void {
		this.metabolicMonitor.resetMetabolicPressure()
		this.alarmViolations = []
		this.modifiedLayers.clear()
		this.lastIntegrityScore = 100
		Logger.info("[FluidPolicyEngine] Unified System Pressure Reset (Metabolic & Structural).")
	}

	/**
	 * Returns a compiled diagnostic report of current architectural blockades and metabolic hotspots.
	 * Injected into the Breather Nudge BEFORE pressure is reset, so the agent learns *why* it was failing.
	 */
	public getSystemDiagnostics(): string {
		const violations = this.spiderEngine.getViolations()
		const stats = this.metabolicMonitor.getVitalityStats()
		const integrityScore = this.computeIntegrityScore(violations.map((v) => v.message))

		return SovereignProtocol.generateAuditTemplate("System Recovery", {
			integrityScore,
			metabolicPressure: `${stats.totalWrites} writes across ${this.spiderEngine.nodes.size} nodes`,
			violations: violations.slice(0, 10).map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			hotspots: stats.hotspots.map((h) => `${path.basename(h.path)} (${h.stress.toFixed(2)})`),
		})
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

	/**
	 * Returns proactive architectural guidance for a given file's layer.
	 */
	public getFileLayerContext(filePath: string): string {
		const layer = this.getCachedLayer(filePath)
		const fileName = path.basename(filePath)

		switch (layer) {
			case "domain":
				return `📍 ${fileName} → DOMAIN layer\n  ✅ Pure business logic, models, rules, value objects\n  🚫 No I/O, no external imports, no side effects`
			case "core":
				return `📍 ${fileName} → CORE layer\n  ✅ Orchestration, task coordination, prompt assembly\n  🚫 Avoid raw I/O — delegate to Infrastructure adapters`
			case "infrastructure":
				return `📍 ${fileName} → INFRASTRUCTURE layer\n  ✅ Adapters, API clients, persistence, external services\n  🚫 No business rules (keep those in Domain)`
			case "ui":
				return `📍 ${fileName} → UI layer\n  ✅ Components, views, event handlers, visual state\n  🚫 No business logic, no direct I/O`
			case "plumbing":
				return `📍 ${fileName} → PLUMBING layer\n  ✅ Stateless utilities, formatters, pure helpers\n  🚫 No dependencies on Domain, Infrastructure, or UI`
			default:
				return `📍 ${fileName} → INFRASTRUCTURE layer (default)\n  ✅ Adapters and integrations\n  🚫 No business rules`
		}
	}

	/**
	 * Generates a concise, actionable correction hint for architectural violations.
	 * Includes code snippets for immediate resolution.
	 */
	public getCorrectionHint(errors: string[], filePath?: string): string {
		const fixes: string[] = []
		const snippets: string[] = []
		const supportsTags = filePath ? isLayerTagSupported(filePath) : true

		for (const err of errors) {
			if ((err.includes("tag") || err.includes("Missing mandatory")) && supportsTags) {
				const layer = filePath ? this.getCachedLayer(filePath).toUpperCase() : "DOMAIN"
				fixes.push(`Add a mandatory [LAYER: ${layer}] tag to the file header.`)
				snippets.push(`/**\n * [LAYER: ${layer}]\n */`)
			} else if (err.includes("Geographic Misalignment")) {
				fixes.push("Move the file to the physical directory that matches its declared [LAYER] tag.")
			} else if (err.includes("relative navigation")) {
				fixes.push("Flatten the project structure or use '@/' aliases to avoid deep relative imports (max 3 levels).")
				snippets.push("import { ... } from '@/core/logic'")
			} else if (err.includes("import")) {
				fixes.push("Move the import to the appropriate layer, or extract an interface in Domain.")
				if (err.includes("Domain layer")) {
					snippets.push("// Domain Leak: Move this to src/domain/interfaces/ and depend on the interface instead")
					snippets.push("export interface IMyContract { ... }")
				}
			} else if (err.includes("class")) {
				fixes.push("Split into separate files — one class per file in Domain.")
			} else if (err.includes("circular") || err.includes("Circular Dependency")) {
				fixes.push(
					"Break the circular dependency by extracting shared logic to a lower layer (Plumbing) or using Dependency Inversion via interfaces (Domain).",
				)
				// PRODUCTION HARDENING: Provide high-fidelity extraction targets based on common patterns
				snippets.push(
					"// Pattern A: Extract shared state/logic to src/plumbing/shared-utils.ts\n// Pattern B: Define a listener interface in src/domain/interfaces/ and use events/callbacks.\nexport interface IEventListener { onAction(): void; }",
				)
				snippets.push(
					"// Pattern C: Use an EventEmitter for cross-module signaling without direct coupling\nimport { EventEmitter } from 'events';\nexport const bridge = new EventEmitter();",
				)
			} else if (err.includes("Sovereign Leak") || err.includes("DEPENDENCY_INVERSION")) {
				fixes.push("Domain/Core logic cannot depend on concrete Infrastructure. Extract an interface.")
				// PRODUCTION HARDENING: Explicitly suggest the standard extraction pattern with dynamic names
				const interfaceMatch = err.match(/concrete implementation: ([^,]+)/)
				const baseName = interfaceMatch ? interfaceMatch[1].split("/").pop()?.split(".")[0] : "Service"
				const interfaceName = `I${baseName?.charAt(0).toUpperCase()}${baseName?.slice(1)}`

				snippets.push(`/**\n * [LAYER: DOMAIN]\n */\nexport interface ${interfaceName} {\n\t// TODO: Define members\n}`)
				snippets.push(
					`// 1. Move implementation to src/infrastructure/adapters/\n// 2. Define contract in src/domain/interfaces/${interfaceName}.ts\n// 3. Inject implementation into Core at runtime\nexport interface ${interfaceName} { ... }`,
				)
			} else {
				fixes.push("Review the violation and restructure accordingly.")
			}
		}

		const uniqueFixes = [...new Set(fixes)]
		let response = `💡 How to fix:\n${uniqueFixes.map((f) => `  → ${f}`).join("\n")}`
		if (snippets.length > 0) {
			response += `\n\n📝 Suggested Code:\n${snippets.map((s) => `\`\`\`typescript\n${s}\n\`\`\``).join("\n")}`
		}
		return response
	}

	/**
	 * Computes the architectural integrity score (0-100).
	 * Every violation reduces the score based on its weighted severity.
	 *
	 * Weights:
	 * - Ghost imports: 1 point
	 * - Layer violations: 10 points
	 * - Circular dependencies: 15 points
	 */
	public computeIntegrityScore(violations: string[]): number {
		if (violations.length === 0) return 100

		let totalPenalty = 0
		for (const violation of violations) {
			// PERFECTION WEIGHTED INTEGRAL (v14)
			if (violation.includes("[GHOST SYMBOL]")) {
				totalPenalty += 1
			} else if (violation.includes("[GHOST FILE]")) {
				totalPenalty += 3
			} else if (violation.includes("Circular Dependency")) {
				totalPenalty += 15
			} else if (violation.includes("Sovereign Leak") || violation.includes("Geographic Misalignment")) {
				totalPenalty += 10
			} else if (violation.includes("Node is orphaned")) {
				totalPenalty += 2 // Orchestrated healing handles these specifically
			} else if (
				violation.includes("PURITY") ||
				violation.includes("COHESION") ||
				violation.includes("Fragmented Domain Model")
			) {
				totalPenalty += 0 // Info-only warnings for Pass 2
			} else {
				totalPenalty += 5 // Default structural penalty
			}
		}

		const base = 100
		const penalty = Math.min(95, totalPenalty)
		const score = Math.max(5, base - penalty)

		// PRODUCTION HARDENING: Alarm is trend-aware. Only trigger if score is actively declining.
		const isDeclining = score < this.lastIntegrityScore
		const isRecovering = score > this.lastIntegrityScore
		this.lastIntegrityScore = score
		this.spiderEngine.isRecovering = isRecovering // Synchronize trend with substrate engine

		const config = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()
		const threshold = config.integrityAlertThreshold || 70

		if (score < threshold && !this.architecturalAlarmActive && isDeclining) {
			this.triggerAlarm(violations)
		} else if (this.architecturalAlarmActive && (score >= 90 || isRecovering)) {
			// Clear alarm if score is high enough OR if we are making active progress (recovering)
			this.clearAlarm()
		}

		return score
	}

	/**
	 * Records the current scan results to history.
	 */
	public async recordScanHistory(violations: string[]) {
		const score = this.computeIntegrityScore(violations)
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
	}

	private triggerAlarm(violations: string[]) {
		this.architecturalAlarmActive = true
		this.alarmViolations = violations
		Logger.warn("🚨 [ARCHITECTURAL ALARM] System entering soft-lock due to integrity violations.")
	}

	private clearAlarm() {
		this.architecturalAlarmActive = false
		this.alarmViolations = []
		this.lastIntegrityScore = 100 // Reset baseline
		Logger.info("💚 [ARCHITECTURAL ALARM] Alarm cleared. System integrity restored.")
	}

	/**
	 * Validates a tool block before execution.
	 * Uses progressive enforcement: first domain violation blocks, subsequent ones degrade to warnings.
	 */
	public async validatePreExecution(block: ToolUse): Promise<PolicyResult> {
		// V18/V19: Harmonic Healing Intent Sensing
		let intent = null
		const content = (block.params as { content?: string })?.content || ""

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
			if (cooldown.active || this.architecturalAlarmActive) {
				const healing = await this.ensureScratchpadIntegrity("Metabolic Recovery")
				scratchpadContent = healing.content
				hasAudit = scratchpadContent.includes(SovereignProtocol.HEADERS.AUDIT)
				scratchpadHealed = healing.created
			}

			// V28: Virtual Substrate Fallback (Search history if disk is empty)
			if (!hasAudit && !hasBreath && this.streamId) {
				const history = await (orchestrator as any).getConversationHistory(this.streamId)
				if (history) {
					const virtual = SovereignScribe.findVirtualAuditInHistory(history)
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
			(this.metabolicMonitor.getCooldownStatus().active || this.architecturalAlarmActive)
		) {
			intent = this.detectHealingIntent(block)
			if (intent) {
				Logger.info(`[FluidPolicyEngine] Healing Intent detected. Resetting metabolic pressure for ${intent}.`)
				this.resetSystemPressure()
			}
		}

		// Centralized Healing Mode Detection
		const isHealingMode = this.architecturalAlarmActive || !!intent || !!content.match(/#HEAL|#HEALING|#CURE/)

		// 0. Rule: Cognitive Drift Sensing (Thrashing Prevention)
		if (
			block.name === DietCodeDefaultTool.FILE_EDIT ||
			block.name === DietCodeDefaultTool.APPLY_PATCH ||
			block.name === DietCodeDefaultTool.FILE_NEW
		) {
			const targetPath = (block.params as { path?: string })?.path
			if (targetPath) {
				const layer = getLayer(targetPath)
				this.modifiedLayers.add(layer)

				if (this.modifiedLayers.size > 3 && !this.commitSeal) {
					return {
						success: true,
						warning:
							`⚠️ [SPI-201] COGNITIVE DRIFT DETECTED: You have modified ${this.modifiedLayers.size} distinct architectural layers in this task (${Array.from(this.modifiedLayers).join(", ")}).\n` +
							`High layer entropy often leads to structural regressions. Consider completing one layer or performing a # SOVEREIGN_BREATH to reset cognitive focus.`,
					}
				}
			}
		}

		// 0. Rule: Cognitive Cooldown Enforcement (Substrate Immune System)
		if (block.name === DietCodeDefaultTool.FILE_EDIT || block.name === DietCodeDefaultTool.APPLY_PATCH) {
			const cooldown = this.metabolicMonitor.getCooldownStatus()
			if (cooldown.active && !this.commitSeal) {
				if (hasBreath) {
					Logger.info("[FluidPolicyEngine] Metabolic Cooldown bypassed via # SOVEREIGN BREATH")
				} else if (hasAudit) {
					Logger.info("[FluidPolicyEngine] Metabolic Cooldown bypassed via # SOVEREIGN AUDIT")
				}

				if (!hasBreath && !hasAudit) {
					const auditTemplate = SovereignProtocol.generateAuditTemplate("Cognitive Recovery")
					const breathTemplate = SovereignProtocol.generateBreathTemplate("Metabolic Reset", cooldown.reason)

					return {
						success: scratchpadHealed, // V27: Allow success if we just healed the substrate
						error: scratchpadHealed
							? undefined
							: `🛑 COGNITIVE COOLDOWN [ACTIVE]: ${cooldown.reason}\n` +
								`The substrate has reached structural saturation. High-velocity logic churn is discouraged to prevent architectural regression.\n\n` +
								`💡 GUIDANCE: You are currently BLOCKED from performing further edits. You MUST perform an audit turn to justify further churn.\n\n` +
								`📝 OPTION A: [Audit Turn] - Add this to your \`scratchpad.md\` for a full state synthesis:\n` +
								`\`\`\`markdown\n${auditTemplate}\`\`\`\n\n` +
								`📝 OPTION B: [Breath Turn] - Add this to your \`scratchpad.md\` for a quick targeted fix:\n` +
								`\`\`\`markdown\n${breathTemplate}\`\`\`\n`,
						warning: scratchpadHealed
							? `⚠️ SUBSTRATE RECOVERED: \`scratchpad.md\` was missing during Cognitive Cooldown. I have automatically generated it with the required recovery templates.\n\n` +
								`💡 ACTION REQUIRED: You MUST now sync your plan into the newly created \`scratchpad.md\` before your next move.`
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
				const status = this.metabolicMonitor.isInflamed(absolutePath)

				if (violations.length > 0 || status.inflamed) {
					const alerts: string[] = []
					if (status.inflamed) alerts.push(`⚠️ METABOLIC INFLAMMATION: ${status.reason}`)
					violations.forEach((v) => {
						alerts.push(`🚨 STRUCTURAL ANTIGEN: ${v.message}`)
					})

					return {
						success: true,
						warning: `🏗️ ARCHITECTURAL ADVISORY: \`${path.basename(targetPath)}\` has active structural alerts:\n${alerts.join("\n")}`,
					}
				}
			}
		}

		// 0. Rule: Metabolic Cooldown (Inflammation Control)
		if (block.name === DietCodeDefaultTool.FILE_EDIT || block.name === DietCodeDefaultTool.APPLY_PATCH) {
			const targetPath = (block.params as { path?: string })?.path
			if (targetPath) {
				const absolutePath = path.resolve(this.cwd, targetPath)
				const isScratchpad = targetPath.endsWith("scratchpad.md")

				// V22: Implicit Recovery - Scratchpad edits are NEVER blocked.
				if (isScratchpad) {
					return { success: true }
				}

				// V24: Symbol Lockdown (Audit-to-Action Binding)
				if (hasAudit && !isScratchpad) {
					const isCovered = this.isImplicitlyAudited(targetPath, scratchpadContent)

					if (!isCovered) {
						// Fallback to symbol-level check if not implicitly covered
						const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g
						const citedPaths = Array.from(scratchpadContent.matchAll(pathRegexp)).map((m) => m[0])
						const isCited = citedPaths.some((p) => absolutePath.includes(p))

						if (!isCited) {
							return {
								success: false,
								error: `🛑 SYMBOL LOCKDOWN: The file \`${path.basename(targetPath)}\` is not cited in your active # SOVEREIGN AUDIT. You are restricted to editing only files identified during your forensic investigation.`,
							}
						}
					}
				}

				const status = this.metabolicMonitor.isInflamed(absolutePath)

				// V26: Axiom Lockdown (Structural Debt Prevention)
				if (!isScratchpad && block.name === DietCodeDefaultTool.FILE_EDIT) {
					const content = (block.params as { content: string }).content
					if (content) {
						const newViolations = this.axiomEngine.validateAxioms(targetPath, content, this.spiderEngine)
						const oldViolations = this.spiderEngine.getViolations().filter((v) => v.path === absolutePath)
						const oldAxiomMapped: AxiomViolation[] = oldViolations.map((v) => ({
							axiom: v.id,
							severity: v.severity === "INFO" ? "WARN" : v.severity,
							message: v.message,
							remediation: v.remediation,
						}))
						const result = this.axiomEngine.compareAxiomSessions(oldAxiomMapped, newViolations)

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
					Logger.info(`[FluidPolicyEngine] Metabolic Auto-Reset triggered via # SOVEREIGN_BREATH for ${targetPath}`)
				}

				if (status.inflamed && !hasOverride && !hasBreath && !this.commitSeal) {
					return {
						success: true,
						warning:
							`⚠️ METABOLIC COOLDOWN INTERDICTION: \`${path.basename(targetPath)}\` is currently INFLAMED.\n` +
							`${status.reason}\n\n` +
							`💡 RECOVERY: Architectural exhaustion detected. You MUST stop editing this file and performing a # SOVEREIGN AUDIT in \`scratchpad.md\` to justify further churn.\n\n` +
							`To override, add \`[SOVEREIGN_EXCEPTION: Metabolic Cooldown Override]\` with a substantive reason to your edit.`,
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
						const extract = suggestions.find((s) => s.type === "EXTRACT" && filePath.includes(s.target))
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

		// 0. Rule: Architectural Alarm (Soft-Lock / Healing Mode)
		if (
			this.architecturalAlarmActive &&
			(block.name === DietCodeDefaultTool.FILE_NEW ||
				block.name === DietCodeDefaultTool.FILE_EDIT ||
				block.name === DietCodeDefaultTool.APPLY_PATCH ||
				block.name === DietCodeDefaultTool.MOVE ||
				block.name === DietCodeDefaultTool.RENAME ||
				block.name === DietCodeDefaultTool.DELETE)
		) {
			const _targetPath = (block.params as { path?: string })?.path

			let isExplicitlyIgnored = false
			try {
				const scratchpadPath = path.join(this.cwd, "scratchpad.md")
				const scratchpadContent = await fs.readFile(scratchpadPath, "utf-8")
				if (scratchpadContent.includes("# SOVEREIGN_IGNORE_ALARM")) {
					isExplicitlyIgnored = true
				}
			} catch (_e) {}

			const isSealed = !!this.commitSeal
			if (!isHealingMode && !isExplicitlyIgnored && !isSealed) {
				const recipes = this.spiderEngine
					.getViolations()
					.slice(0, 3)
					.map((v) => `  - ${this.refactorHealer.generateHealingRecipe(v)}`)

				// V21: Diagnostic Synthesis (Cognitive Load Reduction)
				const displayedViolations =
					this.alarmViolations.length > 5
						? [
								...this.alarmViolations.slice(0, 3),
								`... and ${this.alarmViolations.length - 3} more structural antigens.`,
							]
						: this.alarmViolations

				const auditTemplate = SovereignProtocol.generateAuditTemplate("Alarm Healing")

				return {
					success: true,
					warning:
						`⚠️ ARCHITECTURAL ALARM ACTIVE (Score: ${this.computeIntegrityScore(this.alarmViolations)}/100)\n` +
						`Structural changes are discouraged until the following violations are healed:\n\n` +
						`${displayedViolations.map((v) => `  - ${v}`).join("\n")}\n\n` +
						`🛠️ HEALING RECIPES:\n${recipes.join("\n")}\n\n` +
						`💡 To bypass this block during structural repairs, add \`# HEALING TURN\` to your \`scratchpad.md\`, or perform a full audit turn:\n\n` +
						`\`\`\`markdown\n${auditTemplate}\`\`\`\n`,
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
				const projectIntegrity = this.computeIntegrityScore(this.spiderEngine.getViolations().map((v) => v.message))

				// PRODUCTION HARDENING: Layer-aware blocking.
				// 1. DOMAIN is the holy of holies — ALWAYS block on any error UNLESS [SOVEREIGN_HEALING] is present.
				// 2. CORE is the mission control — block on Strike 1 if integrity is compromised (< 70) AND declining.

				const isRecoveringTrend = this.spiderEngine.isRecovering
				const shouldBlock =
					(layer === "domain" && astValidation.errors.length > 0 && !isHealing) ||
					(layer === "core" &&
						strikes === 1 &&
						astValidation.errors.length > 0 &&
						projectIntegrity < 70 &&
						!isRecoveringTrend)

				if (shouldBlock) {
					const violationSummaryRejection = astValidation.errors.map((e: string) => `  - ${e}`).join("\n")
					const rejectionTitle = layer === "domain" ? "🛡️ DOMAIN SOVEREIGNTY BREACH" : "🏗️ CORE INTEGRITY PROTECT"
					const shield = this.getResilienceShield()
					const healingHint =
						layer === "domain"
							? "\n\n🩹 SOVEREIGN HEALING: To bypass this block during complex refactoring, add `[SOVEREIGN_HEALING]` to your file content.\n" +
								"💡 Alternatively, use `materializeGhost` or `healImports` tools if applicable."
							: ""
					return {
						success: true,
						warning: `${shield}${rejectionTitle} (Strike ${strikes})\nLayer file \`${path.basename(filePath)}\` has ${astValidation.errors.length} violation(s):\n${violationSummaryRejection}\n\n${this.getCorrectionHint(astValidation.errors, filePath)}${healingHint}\n\n💡 This file block was automatically bypassed and you may proceed.`,
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
									? `\n\n🕷️ ARCHITECTURAL DECAY: Entropy increased by ${(delta * 100).toFixed(1)}%.`
									: ""),
					violations: astValidation.errors,
					entropyScore: entropy.score,
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

		return { success: true }
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
		this.metabolicMonitor.recordRead(absolutePath)

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
		const integrityScore = this.computeIntegrityScore(this.spiderEngine.getViolations().map((v) => v.message))
		if (integrityScore < 70) {
			header += `\n🛡️ HIGH-SHIELD PROTOCOL ACTIVE: Structural Integrity is CRITICAL (${integrityScore}/100).\n`
			header += `Architecture is currently under SOFT-LOCK. New features are RESTRICTED. Prioritize HEALING the following vectors:\n`
			header += `  - Address Circular Dependencies (SPI-004)\n  - Resolve Layer Violations\n  - Clean up Ghost Imports (SPI-005)\n`
		} else if (integrityScore < 85) {
			header += `\n🔍 ARCHITECTURAL WATCH: Structural Integrity is ${integrityScore}/100. Maintain layer discipline to avoid soft-lock thresholds.\n`
		}

		// Axiomatic Logic Report
		const axioms = this.axiomEngine.validateAxioms(absolutePath, content, this.spiderEngine)
		if (axioms.length > 0) {
			header += `\n🧠 LOGIC AXIOM ANALYSIS:\n${axioms.map((v) => `  - [${v.axiom}] ${v.message}`).join("\n")}\n`
		}

		// Metabolic Vitality Injection
		const lineCount = content.split("\n").length
		const doubt = this.metabolicMonitor.getDoubtSignal(absolutePath, layer, lineCount)
		const cooldown = this.metabolicMonitor.getCooldownStatus()

		if ((doubt > 5 || cooldown.active) && !this.commitSeal) {
			const isHardStall = doubt >= 999.0
			header += `\n⚠️ METABOLIC PRESSURE DETECTED (Doubt: ${doubt.toFixed(1)}, Cooldown: ${cooldown.active})\n`

			// V28: Proactive Recovery Template Injection
			let scratchpadExists = false
			try {
				await fs.access(path.join(this.cwd, "scratchpad.md"))
				scratchpadExists = true
			} catch (_) {}

			if (!scratchpadExists) {
				const template = this.getSystemDiagnostics()
				header +=
					`🛑 ARCHITECTURAL STALL: Your investigation is thrashed. Sovereignty protocol requires an audit.\n` +
					`💡 I have synthesized a recovery template for you. Initialize \`scratchpad.md\` NOW to proceed:\n\n` +
					`\`\`\`markdown\n${template}\n\`\`\`\n`
			} else if (isHardStall) {
				header +=
					`🛑 ARCHITECTURAL STALL: Your investigation has reached a cognitive dead-end. Automated recovery suggested:\n` +
					`  STEP 1: Re-read core domain contracts in \`src/domain/interfaces/\`.\n` +
					`  STEP 2: Trigger a # SOVEREIGN AUDIT in \`scratchpad.md\` to re-ground your mental model.\n`
			} else {
				header += `You have read this file ${doubt.toFixed(0)} times without making a move. You are drifting into a RECURSIVE LOOP. Stop reading and formulate a clear execution plan NOW.\n`
			}
		}

		const infection = this.metabolicMonitor.isInflamed(absolutePath)
		if (infection.inflamed) {
			header += `\n🔥 METABOLIC FEVER DETECTED:\n${infection.reason}\nThis file is reaching a state of architectural exhaustion. Consider an atomic split.\n`
		}

		const isRefactoring = this.spiderEngine.getViolations().length > 0 || this.architecturalAlarmActive
		const drift = this.metabolicMonitor.getTaskDrift(this.mode === "plan", isRefactoring)
		if (drift.warning) {
			header += `\n${drift.warning}\n`
		}

		// Proactive Ghost Intelligence
		const node = this.spiderEngine.nodes.get(absolutePath)
		if (node) {
			const ghosts: string[] = []
			for (const imp of node.imports) {
				const res = this.spiderEngine.resolveImportToNodeId(node.path, imp)
				if (!res || !this.spiderEngine.nodes.has(res)) {
					if (!imp.startsWith(".") && !imp.startsWith("@/")) continue
					ghosts.push(imp)
				}
			}
			if (ghosts.length > 0) {
				header += `👻 GHOST IMPORTS DETECTED (Missing Files):\n${ghosts.map((g) => `  - ${g}`).join("\n")}\n`
			}
		}

		if (this.mode === "plan") {
			if (perFileReadCount >= 3) {
				header += `🔍 Architecture Analysis (PLAN mode):\n`
				header += `  ⚠️ RECURSIVE STALLING DETECTED: You have read this specific file (${path.basename(filePath)}) ${perFileReadCount} times in this turn without making progress. To avoid an infinite loop, you MUST NOW stop reading this file and either synthesize your findings into a plan or use \`ask_followup_question\`.\n`
			} else if (globalFileReadCount >= 5) {
				header += `🔍 Architecture Analysis (PLAN mode):\n`
				header += `  ⚠️ CROSS-TURN RECURSION DETECTED: You have read this specific file (${path.basename(filePath)}) ${globalFileReadCount} times across multiple turns without progress. To avoid an infinite loop, you MUST NOW stop reading this file and synthesize your findings or use \`ask_followup_question\`.\n`
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

		// Architectural Policy: Audit file changes via AST (warning-only, never blocks post-execution)
		if (block.name === DietCodeDefaultTool.FILE_NEW || block.name === DietCodeDefaultTool.FILE_EDIT) {
			const filePath = block.params?.path ? path.resolve(this.cwd, block.params.path) : null
			if (filePath) {
				try {
					const content = await fs.readFile(filePath, "utf-8")
					// V31: Structural Sync Awareness
					this.metabolicMonitor.recordWrite(this.normalize(filePath), content)

					const validation = this.tspPlugin.validateSource(filePath, content, this.virtualResolver)
					if (!validation.success || (validation.warnings && validation.warnings.length > 0)) {
						const allIssues = [...(validation.warnings || []), ...validation.errors]
						const entropy = this.spiderEngine.computeEntropy()
						if (this.streamId) {
							await orchestrator.storeMemory(this.streamId, "last_entropy_score", entropy.score.toString())
						}
						result.violations = validation.errors
						result.warning = `⚠️ ${path.basename(filePath)}:\n${allIssues.map((v) => `  - ${v}`).join("\n")}`
						result.entropyScore = entropy.score
						result.correctionHint = this.getCorrectionHint(validation.errors, filePath)
					}
				} catch {
					// File might not exist yet
				}
			}
		}

		// Stability Policy: Entropy Detection
		if (prevResultHash) {
			const resultStr = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput)
			const currentHash = createHash("sha256").update(resultStr).digest("hex")

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
					`⚠️ ENTROPY WARNING: Tool output has diverged. Structural health: ${(entropyReport.score * 100).toFixed(1)}% decay.` +
					(delta > 0.01 ? `\n🕷️ DECAY SINCE LAST SNAPSHOT: +${(delta * 100).toFixed(1)}%` : "")
				result.entropyScore = entropyReport.score
			}

			// Take a snapshot if successful and divergence is low
			if (result.success && result.entropyScore !== undefined && result.entropyScore < 0.2) {
				await this.spiderEngine.takeSnapshot()
			}
		}

		// V16/V17: Metabolic Forgiveness 2.0
		// If health improved (recovery detected) or violation count decreased, clear inflammation
		const latestSnapshot = await this.spiderEngine.getLatestSnapshot()
		const currentEntropy = this.spiderEngine.computeEntropy().score
		const currentViolations = this.spiderEngine.getViolations()

		const recoveryDetected =
			(latestSnapshot && currentEntropy < latestSnapshot.entropyScore) || currentViolations.length < this.lastViolationCount

		if (recoveryDetected) {
			this.lastViolationCount = currentViolations.length
			this.modifiedLayers.clear() // Reset drift on recovery

			const filePath = block.params?.path
			if (filePath) {
				const norm = this.normalize(filePath)
				this.metabolicMonitor.resetFileInflammation(norm)
				Logger.info(
					`[FluidPolicyEngine] Metabolic Forgiveness applied to ${path.basename(norm)} (Architectural Recovery Detected).`,
				)
			} else {
				this.metabolicMonitor.resetMetabolicPressure()
				Logger.info("[FluidPolicyEngine] Global Metabolic Forgiveness applied (Structural Improvement Detected).")
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

		for (const filePath of affectedFiles) {
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

		return {
			success,
			errors: isSealed ? allErrors.map((e) => `[SEALED OVERRIDE] ${e}`) : allErrors,
		}
	}

	private normalize(p: string): string {
		return this.spiderEngine.normalizePath(p)
	}

	/**
	 * PRODUCTION HARDENING: Consolidates all substrate metrics into a high-fidelity Resilience Shield.
	 */
	public getResilienceShield(): string {
		const metabolic = this.metabolicMonitor.getVitalityStats()
		const stagnant = this.metabolicMonitor.getStagnantSubstrate()
		const hotspots = this.spiderEngine.getViolationHotspots()

		const shield = [
			"\n🛡️ UNIFIED RESILIENCE SHIELD [V12]",
			"====================================",
			`METABOLIC: ${metabolic.totalWrites} edits, ${metabolic.totalReads} reads (Doubt: ${metabolic.avgDoubtSignal.toFixed(1)})`,
			`STRUCTURAL: ${this.spiderEngine.nodes.size} nodes, ${hotspots.length} hotspots detected`,
			stagnant.length > 0 ? `DECAY: ${stagnant.length} stagnant files detected (Action: Prune)` : "DECAY: 0 stagnant files",
			"====================================\n",
		]

		return shield.join("\n")
	}

	/**
	 * V18: Detects if the proposed tool execution is an attempt to heal known architectural violations.
	 */
	private detectHealingIntent(block: ToolUse): string | null {
		const content = (block.params as { content?: string })?.content || ""
		if (!content) return null

		const violations = this.spiderEngine.getViolations()
		for (const v of violations) {
			if (!v.remediation) continue

			// Match suggested import lines
			const importMatch = v.remediation.match(/Suggested Import: (.*)/)
			if (importMatch && content.includes(importMatch[1])) {
				return `Resolved Ghost: ${v.message}`
			}

			// Match explicit intention markers or remediation keywords
			if (content.includes("#HEAL") || content.includes("[HEALING]")) {
				return "Explicit Healing Intention"
			}

			// Match interface extraction markers
			if (v.id === "SPI-004" && content.includes("interface I") && content.includes("implements I")) {
				return `Breaking Cycle: ${v.message}`
			}
		}

		return null
	}

	/**
	 * V27: Ensures that the scratchpad.md exists and is meaningful.
	 * If missing or uninitialized, it automatically generates a recovery template.
	 */
	private async ensureScratchpadIntegrity(taskName = "Architectural Recovery"): Promise<{ content: string; created: boolean }> {
		const scratchpadPath = path.join(this.cwd, "scratchpad.md")
		try {
			const content = await fs.readFile(scratchpadPath, "utf-8")
			if (content.trim().length > 0) {
				return { content, created: false }
			}
		} catch (_e) {
			// File doesn't exist or is unreadable
		}

		// Auto-creation logic
		const violations = this.spiderEngine.getViolations()
		const stats = this.metabolicMonitor.getVitalityStats()
		const diagnostics: import("./SovereignProtocol").SovereignDiagnostics = {
			integrityScore: this.computeIntegrityScore(violations.map((v) => v.message)),
			metabolicPressure: `${stats.totalWrites} writes, ${stats.totalReads} reads`,
			violations: violations.slice(0, 5).map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			hotspots: stats.hotspots.map((h) => `${path.basename(h.path)} (${h.stress.toFixed(2)})`),
		}

		const template = SovereignProtocol.generateAuditTemplate(taskName, diagnostics)
		await fs.writeFile(scratchpadPath, template, "utf-8")
		Logger.info(`[FluidPolicyEngine] Auto-initialized missing scratchpad.md for '${taskName}'`)
		return { content: template, created: true }
	}

	/**
	 * V30: Harmonic Audit Inheritance.
	 * Checks if a file is implicitly covered by a parent directory citation or if it's an Agile Domain.
	 */
	private isImplicitlyAudited(filePath: string, scratchpadContent: string): boolean {
		const absolutePath = path.resolve(this.cwd, filePath)

		if (scratchpadContent.includes("# SOVEREIGN_AGILE")) return true

		// 1. Directory-level coverage
		const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+(?:\/|$)/g
		const citedPaths = Array.from(scratchpadContent.matchAll(pathRegexp)).map((m) => m[0])
		const isCoveredByDir = citedPaths.some((p) => absolutePath.includes(p))
		if (isCoveredByDir) return true

		// 2. Terminal Node Agility (Leaf nodes)
		const node = this.spiderEngine.nodes.get(this.spiderEngine.normalizePath(filePath))
		if (node && node.dependents.length === 0) {
			Logger.info(`[FluidPolicyEngine] Terminal Node Agility triggered for ${path.basename(filePath)}`)
			return true
		}

		// 3. Global Agile Domain detection
		return SovereignProtocol.isImplicitAgileSafe(absolutePath)
	}
}
