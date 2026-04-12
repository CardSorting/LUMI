import { ToolUse } from "@core/assistant-message"
import { CodemarieDefaultTool } from "@shared/tools"
import { createHash } from "crypto"
import fs from "fs/promises"
import * as path from "path"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { StateManager } from "../storage/StateManager"
import { ContextStalenessTracker } from "../context/ContextStalenessTracker"
import { AuditRecorder } from "./AuditRecorder.js"
import { DashboardGenerator } from "../integrity/DashboardGenerator"
import { MetabolicMonitor } from "../integrity/MetabolicMonitor"
import { SemanticAxiomEngine } from "./SemanticAxiomEngine"
import { SimulationEngine } from "./SimulationEngine.js"
import { SpiderEngine } from "./SpiderEngine.js"
import { SpiderRefactorer } from "./SpiderRefactorer.js"
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
	private architecturalAlarmActive = false
	private alarmViolations: string[] = []

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
		this.metabolicMonitor = new MetabolicMonitor(this.cwd)
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
		const { getLayer } = require("@/utils/joy-zoning")
		const layer = getLayer(filePath)
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
	 */
	public getCorrectionHint(errors: string[]): string {
		const fixes: string[] = []
		for (const err of errors) {
			if (err.includes("tag") || err.includes("Missing mandatory"))
				fixes.push("Add a mandatory [LAYER: TYPE] tag to the file header (one of DOMAIN, CORE, INFRASTRUCTURE, PLUMBING, UI).")
			else if (err.includes("Geographic Misalignment"))
				fixes.push("Move the file to the physical directory that matches its declared [LAYER] tag.")
			else if (err.includes("relative navigation"))
				fixes.push("Flatten the project structure or use '@/' aliases to avoid deep relative imports (max 3 levels).")
			else if (err.includes("import"))
				fixes.push("Move the import to the appropriate layer, or extract an interface in Domain.")
			else if (err.includes("class")) fixes.push("Split into separate files — one class per file in Domain.")
			else if (err.includes("circular")) fixes.push("Extract shared logic into a Plumbing utility.")
			else fixes.push("Review the violation and restructure accordingly.")
		}
		const uniqueFixes = [...new Set(fixes)]
		return `💡 How to fix:\n${uniqueFixes.map((f) => `  → ${f}`).join("\n")}`
	}

	/**
	 * Computes the architectural integrity score (0-100).
	 * Every violation reduces the score exponentially.
	 */
	public computeIntegrityScore(violations: string[]): number {
		if (violations.length === 0) return 100
		const base = 100
		const penalty = Math.min(95, violations.length * 5)
		const score = Math.max(5, base - penalty)

		// Trigger Architectural Alarm if score drops below 70 due to hard errors
		if (score < 70 && !this.architecturalAlarmActive) {
			this.triggerAlarm(violations)
		} else if (score >= 90 && this.architecturalAlarmActive) {
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
		await this.dashboardGenerator.updateDashboard(this.spiderEngine, this.auditRecorder, this.metabolicMonitor)
	}

	private triggerAlarm(violations: string[]) {
		this.architecturalAlarmActive = true
		this.alarmViolations = violations
		Logger.warn("🚨 [ARCHITECTURAL ALARM] System entering soft-lock due to integrity violations.")
	}

	private clearAlarm() {
		this.architecturalAlarmActive = false
		this.alarmViolations = []
		Logger.info("💚 [ARCHITECTURAL ALARM] Alarm cleared. System integrity restored.")
	}

	/**
	 * Validates a tool block before execution.
	 * Uses progressive enforcement: first domain violation blocks, subsequent ones degrade to warnings.
	 */
	public async validatePreExecution(block: ToolUse): Promise<PolicyResult> {
		// 0. Rule: Logic Axiom Guard (Substrate Maturity)
		if (block.name === "write_files" || block.name === "patch_files") {
			const { path: filePath, content } = block.params as any
			if (content) {
				const axiomViolations = this.axiomEngine.validateAxioms(filePath, content, this.spiderEngine)
				const errors = axiomViolations.filter(v => v.severity === "ERROR")
				if (errors.length > 0 && !this.commitSeal) {
					return {
						success: false,
						error: `🚨 AXIOMATIC LOGIC BLOCK: Logic Sovereignty has been compromised.\n` +
							   `${errors.map(v => `  - [AXIOM: ${v.axiom}] ${v.message}`).join("\n")}\n\n` +
							   `💡 You must split this logic or maintain purity before the substrate will accept these changes.`,
					}
				}
			}
		}

		// 0. Rule: Simulation Guard (Pre-flight Prophet)
		if (block.name === "rename_files" || block.name === "move_files") {
			const { oldPath, newPath } = block.params as any
			const sim = await this.simulationEngine.simulateMove(oldPath, newPath, this.spiderEngine)
			if (!sim.safe && !this.commitSeal) {
				return {
					success: false,
					error: `🚨 SIMULATION BLOCK: ${sim.message}\n` +
						   `Your proposed move predicts a significant architectural regression.\n` +
						   `Violations predicted: \n${sim.violations.map(v => `  - ${v}`).join("\n")}\n\n` +
						   `💡 Fix these structural issues in the source before moving, or use a Commit Seal to bypass.`,
				}
			}
		}

		// 0. Rule: Architectural Alarm (Soft-Lock)
		if (this.architecturalAlarmActive && 
			(block.name === CodemarieDefaultTool.FILE_NEW || 
			 block.name === CodemarieDefaultTool.FILE_EDIT || 
			 block.name === CodemarieDefaultTool.APPLY_PATCH ||
			 block.name === "delete_file")) {
			return {
				success: false,
				error: `🚨 ARCHITECTURAL ALARM ACTIVE (Score: ${this.computeIntegrityScore(this.alarmViolations)}/100)\n` +
					   `Your previous actions have degraded the system integrity beyond the safety threshold. ` +
					   `All destructive or structural tool calls are LOCKED until the following violations are healed:\n` +
					   `${this.alarmViolations.map(v => `  - ${v}`).join("\n")}\n\n` +
					   `💡 You MUST fix these issues using simple writes or refactor tools before continuing with new features.`,
			}
		}

		// In PLAN mode, skip enforcement — agent is only planning, not writing
		// Return guidance instead of blocking
		if (this.mode === "plan" && block.params?.path) {
			const { getLayer } = require("@/utils/joy-zoning")
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

		// Architectural Policy: AST + Database Concurrent Pass
		if (
			(block.name === CodemarieDefaultTool.FILE_NEW || block.name === CodemarieDefaultTool.FILE_EDIT) &&
			block.params?.path &&
			block.params?.content
		) {
			const filePath = path.resolve(this.cwd, block.params.path)
			const content = block.params.content as string

			// Update Spider session cache
			this.sessionFiles.set(filePath, content)
			this.spiderEngine.buildGraph(Array.from(this.sessionFiles.entries()).map(([p, c]) => ({ filePath: p, content: c })))

			// 1. AST Validation (TSP)
			const astValidation = this.tspPlugin.validateSource(filePath, content, this.virtualResolver)

			// Block on AST Failure (Strike 1 Domain)
			if (!astValidation.success) {
				const layer = this.getCachedLayer(filePath)
				const strikes = await this.incrementStrikes(filePath)
				const allWarnings = [...(astValidation.warnings || []), ...astValidation.errors]
				const violationSummary = allWarnings.map((e: string) => `  - ${e}`).join("\n")

				if (layer === "domain" && strikes === 1 && astValidation.errors.length > 0) {
					const violationSummaryRejection = astValidation.errors.map((e: string) => `  - ${e}`).join("\n")
					return {
						success: false,
						error: `🏗️ ARCHITECTURAL CORRECTION REQUIRED (Strike ${strikes})\nDomain layer file \`${path.basename(filePath)}\` has ${astValidation.errors.length} violation(s):\n${violationSummaryRejection}\n\n${this.getCorrectionHint(astValidation.errors)}\n\n💡 Your write was NOT executed. Please address these violations and try again.`,
						violations: astValidation.errors,
					}
				}

				// Strike 2+ or other layers: Warning only
				const entropy = this.spiderEngine.computeEntropy()
				const latestSnapshot = await this.spiderEngine.getLatestSnapshot()
				const delta = latestSnapshot ? this.spiderEngine.compareWith(latestSnapshot) : 0

				if (this.streamId) {
					await orchestrator.storeMemory(this.streamId, "last_entropy_score", entropy.score.toString())
					if (delta > 0.01) {
						await orchestrator.storeMemory(this.streamId, "entropy_decay", delta.toString())
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
					correctionHint: this.getCorrectionHint(astValidation.errors),
				}
			}

			// Clean file — reset strikes for this path
			await this.resetStrikes(filePath)

			// Surface AST warnings if any
			if (astValidation.warnings && astValidation.warnings.length > 0) {
				return {
					success: true,
					warning: `⚠️ DISCERNMENT WARNING: Architectural smell(s) detected:\n${astValidation.warnings.map((w: string) => `  - ${w}`).join("\n")}`,
				}
			}

			// For new files: proactively suggest the best layer if content doesn't match location
			if (block.name === CodemarieDefaultTool.FILE_NEW && block.params.content) {
				const { getLayer, suggestLayerForContent } = require("@/utils/joy-zoning")
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
			block.name === CodemarieDefaultTool.FILE_NEW ||
			block.name === CodemarieDefaultTool.FILE_EDIT ||
			block.name === CodemarieDefaultTool.APPLY_PATCH
		) {
			const files = block.params?.path ? [path.resolve(this.cwd, block.params.path)] : []
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

		const normalizedPath = this.normalize(block.params.path)
		this.metabolicMonitor.recordWrite(normalizedPath, 0, 0) // Basic write record

		return { success: true }
	}

	/**
	 * Resolves the architectural layer for a file with in-memory caching.
	 * Tier 3 optimization for high-volume file batches.
	 */
	private getCachedLayer(filePath: string): string {
		let layer = this.layerCache.get(filePath)
		if (!layer) {
			const { getLayer } = require("@/utils/joy-zoning")
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
		const { getLayer } = require("@/utils/joy-zoning")
		const layer = getLayer(absolutePath)
		const refactorSuggestions = SpiderRefactorer.getRefactoringSuggestions(this.spiderEngine)

		let header = `${layerContext}\n`

		if (refactorSuggestions.length > 0) {
			header += `🕷️ ARCHITECTURAL REFACTORING OPPORTUNITIES:\n${refactorSuggestions.map((s) => `  - [${s.type}] ${s.target}: ${s.reason} (${s.benefit})`).join("\n")}\n`
		}

		if (!validation.success) {
			header += `⚠️ Existing issues in this file:\n${validation.errors.map((v) => `  - ${v}`).join("\n")}\nKeep these in mind — avoid propagating these patterns.\n`
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
		const integrityScore = this.computeIntegrityScore(this.spiderEngine.getViolations().map(v => v.message))
		if (integrityScore < 70) {
			header += `\n🛡️ HIGH-SHIELD PROTOCOL ACTIVE: The project's Structural Integrity is CRITICAL (${integrityScore}/100).\n`
			header += `You are instructed by the Substrate Sovereignty directives to PRIORITIZE HEALING the architecture over new feature development. Fix existing violations before proceeding.\n`
		} else if (integrityScore < 85) {
			header += `\n🔍 ARCHITECTURAL WATCH: Structural Integrity has slightly decayed (${integrityScore}/100). Maintain discipline to prevent soft-locks.\n`
		}

		// Axiomatic Logic Report
		const axioms = this.axiomEngine.validateAxioms(absolutePath, content, this.spiderEngine)
		if (axioms.length > 0) {
			header += `\n🧠 LOGIC AXIOM ANALYSIS:\n${axioms.map(v => `  - [${v.axiom}] ${v.message}`).join("\n")}\n`
		}

		// Metabolic Vitality Injection
		const doubt = this.metabolicMonitor.getDoubtSignal(absolutePath)
		if (doubt > 5 && !this.commitSeal) {
			header += `\n⚠️ METABOLIC DOUBT DETECTED (Signal: ${doubt.toFixed(1)}):\n`
			header += `You have read this file ${doubt.toFixed(0)} times without making a move. You are drifting into a RECURSIVE LOOP. Stop reading and formulate a clear execution plan NOW.\n`
		}

		const infection = this.metabolicMonitor.isInflamed(absolutePath)
		if (infection.inflamed) {
			header += `\n🔥 METABOLIC FEVER DETECTED:\n${infection.reason}\nThis file is reaching a state of architectural exhaustion. Consider an atomic split.\n`
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
				header += `👻 GHOST IMPORTS DETECTED (Missing Files):\n${ghosts.map(g => `  - ${g}`).join("\n")}\n`
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
		if (block.name === CodemarieDefaultTool.FILE_NEW || block.name === CodemarieDefaultTool.FILE_EDIT) {
			const filePath = block.params?.path ? path.resolve(this.cwd, block.params.path) : null
			if (filePath) {
				try {
					const content = await fs.readFile(filePath, "utf-8")
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
						result.correctionHint = this.getCorrectionHint(validation.errors)
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
		const { getLayer } = require("@/utils/joy-zoning")

		for (const filePath of affectedFiles) {
			try {
				const content = await fs.readFile(filePath, "utf-8")
				const validation = this.tspPlugin.validateSource(filePath, content, this.virtualResolver)
				if (!validation.success || (validation.warnings && validation.warnings.length > 0)) {
					const allIssues = [...(validation.warnings || []), ...validation.errors]
					const layer = getLayer(filePath)
					const layerPrefix = `[${layer.toUpperCase()}] ${path.basename(filePath)}`
					allErrors.push(...allIssues.map((e) => `${layerPrefix}: ${e}`))
				}

				// Dependency Detection for commit validation (AST-based)
				const sourceFile = require("typescript").createSourceFile(
					filePath,
					content,
					require("typescript").ScriptTarget.Latest,
					true,
				)
				const crossLayerViolations = this.tspPlugin.findCrossLayerViolations(sourceFile, filePath)
				if (crossLayerViolations.length > 0) {
					const layer = getLayer(filePath)
					const layerPrefix = `[${layer.toUpperCase()}] ${path.basename(filePath)}`
					allErrors.push(
						...crossLayerViolations.map((e) => `${layerPrefix}: ARCHITECTURAL SMELL (Cross-Layer Dependency): ${e}`),
					)
				}
			} catch {
				// File might have been deleted or moved
			}
		}

		if (isDomainChange && allErrors.length > 0) {
			// Restore blocking for domain violations on commit, unless it's just warnings
			let hasHardErrors = false
			for (const filePath of affectedFiles) {
				try {
					const content = require("fs").readFileSync(filePath, "utf-8")
					const validation = this.tspPlugin.validateSource(filePath, content)
					if (validation.errors.length > 0) {
						hasHardErrors = true
						break
					}
				} catch {
					// File might not exist
				}
			}

			if (hasHardErrors && !this.commitSeal) {
				return { success: false, errors: allErrors }
			}

			return { success: true, errors: allErrors.map((e) => `[DOMAIN WARNING] ${e}`) }
		}

		return { success: true, errors: allErrors }
	}
}
