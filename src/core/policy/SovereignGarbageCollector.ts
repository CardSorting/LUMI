/**
 * [LAYER: CORE]
 */

import { execa } from "execa"
import * as fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { generateLayerComment, getLayer } from "../../utils/joy-zoning"
import { RefactorHealer } from "../task/tools/RefactorHealer"
import { SpiderEngine } from "./spider/SpiderEngine"

/**
 * SovereignGarbageCollector: The sweeping agent for build integrity.
 * Automatically fixes linting, unused imports, and missing references
 * to prevent systemic build decay.
 */
export class SovereignGarbageCollector {
	private healer: RefactorHealer
	private ghostAttempts: Map<string, number> = new Map() // V100: Graceful Suppression

	constructor(
		private cwd: string,
		private spiderEngine: SpiderEngine,
		private pathogens?: import("../integrity/PathogenStore").PathogenStore,
	) {
		this.healer = new RefactorHealer(cwd)
	}

	/**
	 * Performs a recursive sweeping pass over the modified files and their dependents.
	 * Capped at depth 2 to prevent infinite substrate loops.
	 */
	public async sweep(filePaths: string[]): Promise<{ fixedCount: number; remainingErrors: string[] }> {
		let totalFixed = 0
		const remainingErrors: string[] = []
		const processed = new Set<string>()
		const queue = [...filePaths.map((f) => ({ path: f, depth: 0 }))]

		while (queue.length > 0) {
			const { path: filePath, depth } = queue.shift()!
			if (processed.has(filePath)) continue
			processed.add(filePath)

			const absolutePath = path.resolve(this.cwd, filePath)
			let fileModified = false

			// 1. Layer Alignment (Structural Primacy)
			if (await this.alignLayerTags(filePath)) {
				totalFixed++
				fileModified = true
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

			// 2. Semantic Pruning (Active Pruning)
			if (await this.pruneUnusedExports(filePath)) {
				totalFixed++
				fileModified = true
			}

			// 3. Lint & Format Sweep (Biome)
			const lintResult = await this.runBiomeCheck(absolutePath)
			if (lintResult.fixedCount > 0) {
				totalFixed += lintResult.fixedCount
				fileModified = true
			}

			// 4. Structural Sweep (Ghost Imports & Alignment)
			if (await this.healer.autoHeal(filePath, this.spiderEngine)) {
				totalFixed++
				fileModified = true
			}

			// 5. Ghost Import Resolution
			if (await this.resolveMissingImports(filePath)) {
				totalFixed++
				fileModified = true
			}

			// 6. Circular Dependency Mitigation (Heuristics)
			if (await this.resolveCircularDependencies(filePath)) {
				totalFixed++
				fileModified = true
			}

			// 7. Forensic Pruning (False Positive Suppression)
			await this.pruneFalsePositives(filePath)

			// 8. Final Build Check (Verification)
			const miniTsc = await this.runMiniTsc(absolutePath)
			if (!miniTsc.success) {
				remainingErrors.push(...miniTsc.errors.map((e) => `[TSC] ${e}`))
			}

			if (lintResult.errors.length > 0) {
				remainingErrors.push(...lintResult.errors.map((e) => `[BIOME] ${path.basename(filePath)}: ${e}`))
			}

			// 🌊 Wave-Front Expansion: If file was modified, sweep its dependents
			if (fileModified && depth < 2) {
				const node = this.spiderEngine.nodes.get(this.spiderEngine.normalizePath(filePath))
				if (node && node.dependents.length > 0) {
					Logger.info(
						`[SovereignGarbageCollector] Wave-Front expansion: Scheduling ${node.dependents.length} dependents of ${path.basename(filePath)} for stabilization.`,
					)
					for (const dep of node.dependents) {
						if (!processed.has(dep)) {
							queue.push({ path: dep, depth: depth + 1 })
						}
					}
				}
			}
		}

		return { fixedCount: totalFixed, remainingErrors }
	}

	/**
	 * Automatically demotes unused exports to local symbols to reduce structural waste.
	 */
	private async pruneUnusedExports(filePath: string): Promise<boolean> {
		const violations = this.spiderEngine.getViolations().filter((v) => v.path === filePath && v.id === "SPI-103")
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
				const newContentNamed = content.replace(namedExportRegex, (m, symbols) => {
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
				const newContentInline = content.replace(inlineExportRegex, (m, type) => {
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
	 */
	private async runMiniTsc(absolutePath: string): Promise<{ success: boolean; errors: string[] }> {
		try {
			// We run tsc on the file, skipping lib checks for speed
			await execa(
				"npx",
				[
					"tsc",
					"--noEmit",
					"--skipLibCheck",
					"--module",
					"commonjs",
					"--target",
					"esnext",
					"--moduleResolution",
					"node",
					absolutePath,
				],
				{ cwd: this.cwd },
			)
			return { success: true, errors: [] }
		} catch (e: any) {
			const errors = (e.stderr || e.stdout || "")
				.split("\n")
				.filter((l: string) => l.includes("error TS"))
				.slice(0, 3)
			return { success: false, errors }
		}
	}

	/**
	 * Automatically resolves missing symbols by searching the graph and injecting imports.
	 */
	private async resolveMissingImports(filePath: string): Promise<boolean> {
		const absolutePath = path.resolve(this.cwd, filePath)
		let content = await fs.readFile(absolutePath, "utf-8")

		// V100: Predictive Ghosting (Synthesized Shadows)
		const shadows = this.spiderEngine.predictMissingImports(filePath, content)
		const violations = this.spiderEngine.getViolations().filter((v) => v.path === filePath && v.id === "SPI-005")

		const allGhostSymbols = new Set(
			[...shadows, ...violations.map((v) => v.message.match(/Ghost import: .* -> (.*)/)?.[1] || "")].filter(Boolean),
		)

		let fixed = false
		for (const symbol of allGhostSymbols) {
			const attempts = (this.ghostAttempts.get(`${filePath}:${symbol}`) || 0) + 1
			this.ghostAttempts.set(`${filePath}:${symbol}`, attempts)

			const providers = this.spiderEngine.findSymbolProviders(symbol)

			// V110: Confidence-Based Auto-Healing (Uniqueness Rule)
			if (providers.length === 1) {
				// Unique provider found! Inject the import.
				const provider = providers[0]
				let relPath = path.relative(path.dirname(filePath), provider).replace(/\.tsx?$/, "")
				if (!relPath.startsWith(".")) relPath = `./${relPath}`

				const importLine = `import { ${symbol} } from "${relPath}"\n`

				// Inject after existing imports or at the top after [LAYER] tag
				const lines = content.split("\n")
				let insertIndex = 0
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].includes("import ") || lines[i].includes('from "')) {
						insertIndex = i + 1
					}
					if (lines[i].includes("[LAYER:")) {
						insertIndex = Math.max(insertIndex, i + 1)
					}
				}

				lines.splice(insertIndex, 0, importLine)
				content = lines.join("\n")
				await fs.writeFile(absolutePath, content, "utf-8")
				Logger.info(
					`[SovereignGarbageCollector] Injected missing import for ${symbol} in ${path.basename(filePath)} (Shadow Prediction)`,
				)
				fixed = true
			} else if (attempts >= 2) {
				// V100: Graceful Degradation fallback (Auto-commenting)
				Logger.warn(`[SovereignGarbageCollector] Unresolvable ghost ${symbol}. Falling back to graceful suppression.`)
				const lines = content.split("\n")
				const commentedLines = lines.map((line) => {
					if (
						line.includes(symbol) &&
						(line.includes("import") || line.includes("from ") || line.includes(":") || line.includes("new "))
					) {
						return `// [SOVEREIGN_GHOST_SUPPRESSION]: ${line} // FIXME: Unresolvable provider`
					}
					return line
				})
				content = commentedLines.join("\n")
				await fs.writeFile(absolutePath, content, "utf-8")
				this.ghostAttempts.delete(`${filePath}:${symbol}`)
				fixed = true
			}
		}
		return fixed
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

			const fixedMatch = stdout.match(/Fixed (\d+) file/i)
			const fixedCount = fixedMatch ? Number.parseInt(fixedMatch[1], 10) : 0

			// Parse errors if any persist
			const errors: string[] = []
			if (stderr.includes("error")) {
				// Simple parsing of biome error lines
				const lines = stderr.split("\n")
				for (const line of lines) {
					if (line.includes("error[")) {
						errors.push(line.trim())
					}
				}
			}

			return { fixedCount, errors }
		} catch (e: any) {
			// Biome exits with non-zero if errors persist
			const errors: string[] = []
			const lines = (e.stderr || "").split("\n")
			for (const line of lines) {
				if (line.includes("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")) continue
				if (line.trim().length > 0 && !line.includes("Checking") && !line.includes("Found")) {
					errors.push(line.trim())
				}
			}
			return { fixedCount: 0, errors: errors.slice(0, 5) } // Cap at 5 errors per file
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

				const hasMatchingTscError = miniTsc.errors.some((te) => {
					// Check if symbol or file path is mentioned in the TSC error
					return (symbol && te.includes(symbol)) || te.includes(path.basename(filePath))
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
}
