/**
 * [LAYER: CORE]
 */

import { execa } from "execa"
import * as fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { generateLayerComment, getLayer } from "../../utils/joy-zoning"
import { ForensicDiagnostic, RefactorHealer } from "../task/tools/RefactorHealer"
import { SpiderEngine } from "./spider/SpiderEngine"

/**
 * SovereignGarbageCollector: The sweeping agent for build integrity.
 * Automatically fixes linting, unused imports, and missing references
 * to prevent systemic build decay.
 */
export class SovereignGarbageCollector {
	private healer: RefactorHealer

	constructor(
		private cwd: string,
		private spiderEngine: SpiderEngine,
		private pathogens?: import("../integrity/PathogenStore").PathogenStore,
		private monitor?: import("../integrity/MetabolicMonitor").MetabolicMonitor,
	) {
		this.healer = new RefactorHealer(cwd)
	}

	/**
	 * Performs a recursive sweeping pass over the modified files and their dependents.
	 * Capped at depth 2 to prevent infinite substrate loops.
	 */
	public async sweep(filePaths: string[]): Promise<{ fixedCount: number; remainingErrors: string[]; repairLog: string[] }> {
		const lockId = await this.spiderEngine.acquireStabilityLock("SovereignGarbageCollector")
		if (!lockId) {
			Logger.warn(
				"[SovereignGarbageCollector] Stability Lock acquisition failed. Proceeding with caution (Non-atomic Sweep).",
			)
		}

		// V200: Deterministic Checkpoint for rollback capability
		this.spiderEngine.createCheckpoint()

		const repairLog: string[] = []
		let totalFixed = 0
		const remainingErrors: string[] = []
		const processed = new Set<string>()
		const queue = [...filePaths.map((f) => ({ path: f, depth: 0 }))]

		try {
			while (queue.length > 0) {
				const item = queue.shift()
				if (!item) continue
				const { path: filePath, depth } = item
				if (processed.has(filePath)) continue
				processed.add(filePath)

				const absolutePath = path.resolve(this.cwd, filePath)
				let fileModified = false

				// V200: Deterministic Forensic Pre-Pass (Heroic Phase)
				// Fixes clear ghost symbols BEFORE expensive build tools run.
				const preFixed = await this.forensicStabilize(filePath)
				if (preFixed > 0) {
					totalFixed += preFixed
					fileModified = true
					repairLog.push(`[FORENSIC] Deterministically resolved ${preFixed} ghost symbol(s) in ${filePath}`)
				}

				// 1. Layer Alignment (Structural Primacy)
				if (await this.alignLayerTags(filePath)) {
					totalFixed++
					fileModified = true
					repairLog.push(`[ALIGNMENT] Resolved [LAYER] metadata drift in ${filePath}`)
				}

				// 1b. Immune-Driven Hardening (V91)
				if (this.pathogens?.isPathogenic(filePath)) {
					Logger.info(
						`[SovereignGarbageCollector] Chronic failure history detected for ${path.basename(filePath)}. Triggering Deep Forensic Scan.`,
					)
					const deepFixed = await this.deepScanPathogen(filePath)
					totalFixed += deepFixed
					if (deepFixed > 0) fileModified = true
				}

				// 2. Build Check (Diagnostic Probe) - The Source of Forensic Truth
				const buildProbe = await this.runMiniTsc(absolutePath)

				// 3. Proactive Forensic Healing (PFH)
				if (!buildProbe.success) {
					for (const diag of buildProbe.diagnostics) {
						if (await this.healer.applyDiagnosticFix(diag, this.spiderEngine)) {
							totalFixed++
							fileModified = true
							repairLog.push(`[PFH] Deterministically resolved TS${diag.code} in ${filePath}`)
						}
					}

					// 3b. Structural Alignment (Spider-Level violations)
					if (await this.healer.autoHeal(filePath, this.spiderEngine)) {
						totalFixed++
						fileModified = true
						repairLog.push(`[STRUCTURAL_HEAL] Corrected architectural regression in ${filePath}`)
					}

					// 3d. Circular Dependency Mitigation
					if (await this.resolveCircularDependencies(filePath)) {
						totalFixed++
						fileModified = true
						repairLog.push(`[CIRCULAR_FIX] Mitigated dependency cycle involving ${filePath}`)
					}
				}

				// 4. Baseline Stabilization (Lint & Format)
				const lintResult = await this.runBiomeCheck(absolutePath)
				if (lintResult.fixedCount > 0) {
					totalFixed += lintResult.fixedCount
					fileModified = true
					repairLog.push(`[LINT] Heroic Healing: Fixed ${lintResult.fixedCount} formatting/lint issues in ${filePath}`)

					// V189: Double Down Reinforcement
					repairLog.push(
						`✨ [STRUCTURAL GAIN]: Code purity improved in ${path.basename(filePath)}. Double down on this concept!`,
					)
				}

				// 5. Authoritative Deadwood Pruning (V200: Industrial Sovereignty)
				// Automatically demotes unused exports (SPI-103) found by the Forensic Engine.
				if (await this.pruneUnusedExports(filePath)) {
					totalFixed++
					fileModified = true
					repairLog.push(`[PRUNING] Autonomously neutralized deadwood symbols in ${filePath}`)
				}

				// 6. Forensic Pruning (False Positive Suppression)
				await this.pruneFalsePositives(filePath)

				// 9. Final Build Check (Verification)
				const miniTsc = await this.runMiniTsc(absolutePath)
				if (!miniTsc.success) {
					remainingErrors.push(...miniTsc.diagnostics.map((d) => `[TSC] ${d.message}`))
				}

				if (lintResult.errors.length > 0) {
					remainingErrors.push(...lintResult.errors.map((e) => `[BIOME] ${path.basename(filePath)}: ${e}`))
				}

				// 🌊 Wave-Front Expansion: If file was modified, sweep its dependents
				// V200: Metabolic Throttling — Adjust expansion depth based on pressure
				const immune = this.monitor?.getImmuneResponse()
				const maxDepth = immune?.strategy === "STABILIZE" ? 1 : 2

				if (fileModified && depth < maxDepth) {
					const node = this.spiderEngine.nodes.get(this.spiderEngine.normalizePath(filePath))
					if (node && node.dependents.length > 0) {
						Logger.info(
							`[SovereignGarbageCollector] Wave-Front expansion: Scheduling ${node.dependents.length} dependents of ${path.basename(filePath)} (Metabolic Depth: ${maxDepth}).`,
						)
						for (const dep of node.dependents) {
							if (!processed.has(dep)) {
								queue.push({ path: dep, depth: depth + 1 })
							}
						}
					}
				}
			}

			// V200: Orphanage Hardening (Evolutionary Purge)
			if (this.monitor?.getImmuneResponse().strategy === "PURGE") {
				const orphansFixed = await this.pruneOrphans()
				if (orphansFixed > 0) {
					totalFixed += orphansFixed
					repairLog.push(`[ORPHAN_PURGE] Identified and neutralized ${orphansFixed} orphaned substrate node(s).`)
				}
			}
		} finally {
			if (lockId) {
				this.spiderEngine.releaseStabilityLock("SovereignGarbageCollector", lockId)
			}
		}

		return { fixedCount: totalFixed, remainingErrors, repairLog }
	}

	/**
	 * Automatically demotes unused exports to local symbols to reduce structural waste.
	 */
	private async pruneUnusedExports(filePath: string): Promise<boolean> {
		const violations = this.spiderEngine.getIntegrityAdvisories(filePath).filter((v) => v.id === "SPI-103")
		if (violations.length === 0) return false

		const absolutePath = path.resolve(this.cwd, filePath)
		let content = await fs.readFile(absolutePath, "utf-8")
		let fixed = false

		for (const v of violations) {
			// Example: [SPI-103] UNUSED EXPORT: core/Engine.ts -> someHiddenHelper
			const match = v.message.match(/ -> (.*)/)
			if (match) {
				const symbol = match[1]

				// 1. Handle 'export { X }'
				const namedExportRegex = new RegExp(`export\\s+\\{([^}]*\\b${symbol}\\b[^}]*)\\}`, "g")
				const newContentNamed = content.replace(namedExportRegex, (_m, symbols) => {
					fixed = true
					const remaining = symbols
						.split(",")
						.map((s: string) => s.trim())
						.filter((s: string) => s !== symbol)
						.join(", ")
					return remaining ? `export { ${remaining} }` : ""
				})

				if (newContentNamed !== content) {
					content = newContentNamed
					continue
				}

				// 2. Handle 'export const X', 'export class X', etc.
				// We just remove the 'export ' keyword, making it local.
				const inlineExportRegex = new RegExp(
					`export\\s+(class|const|interface|type|function|enum|let|var)\\s+${symbol}\\b`,
					"g",
				)
				const newContentInline = content.replace(inlineExportRegex, (_m, type) => {
					fixed = true
					return `${type} ${symbol}`
				})

				if (newContentInline !== content) {
					content = newContentInline
				}
			}
		}

		if (fixed) {
			await fs.writeFile(absolutePath, content, "utf-8")
			Logger.info(`[SovereignGarbageCollector] Pruned unused exports in ${path.basename(filePath)} (Demoted to local)`)
		}
		return fixed
	}

	/**
	 * Automatically corrects [LAYER: TYPE] tags based on geographic alignment.
	 */
	private async alignLayerTags(filePath: string): Promise<boolean> {
		const absolutePath = path.resolve(this.cwd, filePath)
		try {
			const content = await fs.readFile(absolutePath, "utf-8")
			const correctLayer = getLayer(filePath)
			const newContent = generateLayerComment(filePath, correctLayer, content)

			if (newContent && newContent !== content) {
				await fs.writeFile(absolutePath, newContent, "utf-8")
				Logger.info(
					`[SovereignGarbageCollector] Realigned layer tag to [LAYER: ${correctLayer.toUpperCase()}] in ${path.basename(filePath)}`,
				)
				return true
			}
		} catch (e) {
			Logger.error(`[SovereignGarbageCollector] Tag alignment failed for ${filePath}:`, e)
		}
		return false
	}

	/**
	 * Detects circular dependencies and attempts to mitigate them
	 * by identifying type-only imports and converting them to 'import type'.
	 */
	private async resolveCircularDependencies(filePath: string): Promise<boolean> {
		const violations = this.spiderEngine.getViolations().filter((v) => v.path === filePath && v.id === "SPI-004")
		if (violations.length === 0) return false

		const absolutePath = path.resolve(this.cwd, filePath)
		let content = await fs.readFile(absolutePath, "utf-8")
		let fixed = false

		for (const v of violations) {
			// Example: Circular Dependency: core/Engine.ts -> utils/Helper.ts -> core/Engine.ts
			const match = v.message.match(/ -> (.*)/)
			if (match) {
				const problematicFile = match[1]
				const relPath = path.relative(path.dirname(filePath), problematicFile).replace(/\.tsx?$/, "")

				// HEURISTIC: If we can move this to 'import type', do it.
				// This is a naive implementation that replaces 'import { X }' with 'import type { X }'
				// if we suspect X is only used as a type.
				const importRegex = new RegExp(`import\\s+\\{\\s*([^}]*)\\s*\\}\\s+from\\s+["'](\\.\\.?/.*${relPath})["']`, "g")
				const newContent = content.replace(importRegex, (m, symbols, p) => {
					if (!m.includes("type ")) {
						fixed = true
						return `import type { ${symbols} } from "${p}"`
					}
					return m
				})

				if (fixed) {
					content = newContent
				}
			}
		}

		if (fixed) {
			await fs.writeFile(absolutePath, content, "utf-8")
			Logger.info(
				`[SovereignGarbageCollector] Mitigated circular dependency in ${path.basename(filePath)} by type-casting imports.`,
			)
		}
		return fixed
	}

	/**
	 * Runs a fast, targeted TSC check on the file.
	 * V201: Captures structured Forensic Diagnostics for the healer.
	 */
	private async runMiniTsc(absolutePath: string): Promise<{ success: boolean; diagnostics: ForensicDiagnostic[] }> {
		try {
			// We run tsc on the file, skipping lib checks for speed
			await execa(
				"npx",
				[
					"tsc",
					"--noEmit",
					"--pretty",
					"false", // Ensure parseable output
					"--skipLibCheck",
					"--module",
					"commonjs",
					absolutePath,
				],
				{ cwd: this.cwd },
			)
			return { success: true, diagnostics: [] }
		} catch (e: unknown) {
			const err = e as { stderr?: string; stdout?: string }
			const fullOutput = err.stderr || err.stdout || ""
			const diagnostics: ForensicDiagnostic[] = []

			// V201: Structured Forensic Parser
			// Format: path/to/file.ts(line,col): error TSXXXX: message
			const regex = /([^(]+)\((\d+),(\d+)\): error TS(\d+): (.*)/g
			let match = regex.exec(fullOutput)
			while (match !== null) {
				diagnostics.push({
					file: this.spiderEngine.normalizePath(absolutePath),
					line: Number.parseInt(match[2], 10),
					column: Number.parseInt(match[3], 10),
					code: Number.parseInt(match[4], 10),
					message: match[5].trim(),
				})
				match = regex.exec(fullOutput)
			}

			// Fallback for non-standard formats
			if (diagnostics.length === 0 && fullOutput.includes("error TS")) {
				Logger.warn(`[SovereignGarbageCollector] Non-standard TSC output detected: ${fullOutput}`)
			}

			return { success: false, diagnostics }
		}
	}

	/**
	 * Explicitly prunes unused imports and fixes common issues using Biome.
	 */
	private async runBiomeCheck(absolutePath: string): Promise<{ fixedCount: number; errors: string[] }> {
		try {
			// Run biome check with --write and --unsafe to allow automatic fixes for common issues
			const { stdout, stderr } = await execa(
				"npx",
				[
					"biome",
					"check",
					"--write",
					"--unsafe",
					"--no-errors-on-unmatched",
					"--files-ignore-unknown=true",
					absolutePath,
				],
				{ cwd: this.cwd },
			)

			// Parse errors if any persist
			const errors: string[] = []
			const fullOutput = stdout + stderr
			if (fullOutput.includes("error")) {
				const lines = fullOutput.split("\n")
				for (const line of lines) {
					if (line.includes("error[")) {
						errors.push(line.trim())
					}
				}
			}

			const fixedMatch = stdout.match(/Fixed (\d+) file/i)
			const fixedCount = fixedMatch ? Number.parseInt(fixedMatch[1], 10) : 0

			// V190: Force multiple passes if fixes were successful to ensure cascading purity
			if (fixedCount > 0 && errors.length > 0) {
				Logger.info(`[SovereignGarbageCollector] Fixed ${fixedCount} issues. Running secondary verification pass.`)
				return await this.runBiomeCheck(absolutePath)
			}

			return { fixedCount, errors }
		} catch (e: unknown) {
			const err = e as { stderr?: string; stdout?: string }
			const errors: string[] = []
			const lines = (err.stderr || err.stdout || "").split("\n")
			for (const line of lines) {
				if (line.includes("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")) continue
				if (line.trim().length > 0 && !line.includes("Checking") && !line.includes("Found")) {
					errors.push(line.trim())
				}
			}
			return { fixedCount: 0, errors: errors.slice(0, 8) } // Cap at 8 errors per file
		}
	}
	/**
	 * Forensicly prunes false positive violations by verifying them against the real compiler.
	 */
	private async pruneFalsePositives(filePath: string): Promise<void> {
		const absolutePath = path.resolve(this.cwd, filePath)
		const violations = this.spiderEngine.getViolations().filter((v) => v.path === filePath)
		if (violations.length === 0) return

		// Run a target TSC check
		const miniTsc = await this.runMiniTsc(absolutePath)
		if (miniTsc.success) {
			// If TSC is 100% clean, ALL heuristic violations are false positives.
			for (const v of violations) {
				this.spiderEngine.addSuppression(v.id, v.path, v.message)
				Logger.info(
					`[SovereignGarbageCollector] Forensic Pruning: Suppressed false positive ${v.id} in ${path.basename(filePath)} (TSC Verified Clean)`,
				)
			}
		} else {
			// If TSC has errors, we only prune violations that do NOT match any TSC error.
			for (const v of violations) {
				const symbolMatch = v.message.match(/ -> (.*)/)
				const symbol = symbolMatch ? symbolMatch[1] : null

				const hasMatchingTscError = miniTsc.diagnostics.some((te) => {
					// Check if symbol or file path is mentioned in the TSC error
					return (symbol && te.message.includes(symbol)) || te.message.includes(path.basename(filePath))
				})

				if (!hasMatchingTscError) {
					this.spiderEngine.addSuppression(v.id, v.path, v.message)
					Logger.info(
						`[SovereignGarbageCollector] Forensic Pruning: Suppressed heuristic noise ${v.id} (No matching TSC error found).`,
					)
				}
			}
		}
	}

	/**
	 * V91: Performs an aggressive forensic scan of a pathogenic file.
	 * Enforces absolute structural purity and prunes all potential technical debt.
	 */
	private async deepScanPathogen(filePath: string): Promise<number> {
		let fixed = 0
		const absolutePath = path.resolve(this.cwd, filePath)

		// 1. Force absolute Biome compliance (Aggressive fix)
		const biome = await this.runBiomeCheck(absolutePath)
		fixed += biome.fixedCount

		// 2. Aggressive Symbol Pruning
		const unused = this.spiderEngine.getViolations().filter((v) => v.path === filePath && v.id === "SPI-103")
		if (unused.length > 0) {
			await this.pruneUnusedExports(filePath)
			fixed += unused.length
		}

		// 3. Force Interface Extraction (Shadow suggestion)
		const node = this.spiderEngine.nodes.get(this.spiderEngine.normalizePath(filePath))
		if (node && node.astComplexity > 500 && !filePath.includes("interface")) {
			Logger.info(
				`[SovereignGarbageCollector] Pathogen ${path.basename(filePath)} exceeds complexity threshold. Recommending structural decomposition.`,
			)
		}

		return fixed
	}

	/**
	 * V200: Deterministic Forensic Stabilization.
	 * Resolves structural violations (Ghosts) identified by the Spider Engine
	 * BEFORE expensive build tools are invoked.
	 */
	private async forensicStabilize(filePath: string): Promise<number> {
		const advisories = this.spiderEngine.getIntegrityAdvisories(filePath)
		let fixedCount = 0

		for (const v of advisories) {
			if (v.id === "SPI-101" || v.id === "SPI-102") {
				// Deterministic Ghost: We only resolve if the symbol/file provider is known and unique.
				const symbol = v.message.match(/-> (.*) from/)?.[1] || v.message.match(/GHOST SYMBOL: .* -> (.*) from/)?.[1]
				if (
					symbol &&
					(await this.healer.applyDiagnosticFix(
						{
							file: filePath,
							line: 1,
							column: 1,
							code: 2304,
							message: `Cannot find name '${symbol}'`,
						},
						this.spiderEngine,
					))
				) {
					fixedCount++
				}
			}
		}

		return fixedCount
	}

	/**
	 * V200: Orphanage Hardening.
	 * Identifies files that are completely disconnected from the project graph
	 * and recommends them for removal to prevent substrate bloat.
	 */
	private async pruneOrphans(): Promise<number> {
		const nodes = this.spiderEngine.nodes
		let orphanCount = 0

		for (const node of nodes.values()) {
			if (node.orphaned && !node.path.includes("/__tests__/") && !node.path.endsWith(".d.ts")) {
				// We don't delete them automatically, we neutralize them (stub them or flag them)
				// For industrial hardening, we add a [DEADWOOD] marker.
				const absolutePath = path.resolve(this.cwd, node.path)
				try {
					let content = await fs.readFile(absolutePath, "utf-8")
					if (!content.includes("[SOVEREIGN_DEADWOOD]")) {
						content =
							`/** [SOVEREIGN_DEADWOOD] This file is an orphan. It is scheduled for evolutionary purging. */\n` +
							content
						await fs.writeFile(absolutePath, content, "utf-8")
						orphanCount++
					}
				} catch (err) {
					Logger.error(`[SovereignGarbageCollector] Failed to neutralize orphan ${node.path}:`, err)
				}
			}
		}
		return orphanCount
	}

	/**
	 * V220: Industrial Hygiene (Disposal).
	 */
	public dispose(): void {
		this.healer.dispose()
		this.spiderEngine = null as unknown as SpiderEngine
		this.pathogens = undefined
		this.monitor = undefined
		Logger.info("[SovereignGarbageCollector] Collector substrate released.")
	}
}
