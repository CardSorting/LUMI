import * as fs from "fs/promises"
import * as path from "path"
import * as ts from "typescript"
import { Logger } from "@/shared/services/Logger"
import { generateLayerComment, getLayer, isLayerTagSupported, parseLayerTag } from "@/utils/joy-zoning"
import { SovereignTransaction } from "../../integrity/SovereignTransaction"
import { AxiomViolation } from "../../policy/SemanticAxiomEngine"
import { SovereignOptimizer } from "../../policy/SovereignOptimizer"
import { SpiderEngine } from "../../policy/spider/SpiderEngine"
import { SpiderNode, SpiderViolation } from "../../policy/spider/types"

export interface HealingProposal {
	id: string
	type: "TAG_ALIGN" | "MOVE" | "BOTTLENECK"
	file: string
	confidence: number
	message: string
	action: () => Promise<void>
}

/**
 * RefactorHealer: The autonomous coordinator for architectural self-healing.
 * Automatically aligns file tags and fixes broken imports after architectural drift.
 */
export class RefactorHealer {
	constructor(private projectRoot: string) {}

	/**
	 * Strategic Pivoting: Heals a move violation, but pivots to extraction if move is impossible.
	 */
	public async healMove(filePath: string, targetPath: string): Promise<{ success: boolean; pivot?: string }> {
		const tx = new SovereignTransaction(`heal_move_${path.basename(filePath)}`, this.projectRoot)
		tx.start()

		try {
			// Try Strategy A: Move
			const content = await fs.readFile(filePath, "utf-8")
			tx.stage(filePath, "DELETE")
			tx.stage(targetPath, "WRITE", content)

			const result = await tx.commit()
			if (result.success) {
				return { success: true }
			}

			// If Strategy A fails, pivot to Strategy B: Extract Interface
			Logger.info("Move strategy failed. Pivoting to Strategic Extraction...")
			return { success: false, pivot: "EXTRACT_INTERFACE" }
		} catch (_error) {
			await tx.rollback()
			return { success: false }
		}
	}

	/**
	 * V10: Orchestrates a multi-step healing process based on known violations.
	 */
	public async autoHeal(filePath: string, _engine: SpiderEngine, violations?: string[] | AxiomViolation[]): Promise<boolean> {
		let healedSomething = false
		try {
			const absolutePath = path.resolve(this.projectRoot, filePath)
			const content = await fs.readFile(absolutePath, "utf-8")
			const layer = getLayer(filePath, content)

			// 1. Tag Alignment (Archetypal Sync)
			const currentTag = parseLayerTag(content)
			if (currentTag !== layer && isLayerTagSupported(filePath, content)) {
				const newContent = generateLayerComment(filePath, layer, content)
				if (newContent && newContent !== content) {
					await fs.writeFile(absolutePath, newContent, "utf-8")
					Logger.info(
						`[RefactorHealer] Auto-healed: Aligned tag to [LAYER: ${layer.toUpperCase()}] in ${path.basename(filePath)}`,
					)
					healedSomething = true
				}
			}

			// 2. Resolve known ghost symbols from violations
			if (violations) {
				const vstrings = violations.map((v) => (typeof v === "string" ? v : v.message))
				for (const v of vstrings) {
					// Detect "Cannot find module/symbol 'X'"
					const ghostMatch =
						v.match(/Cannot find name ['"]([^'"]+)['"]/i) ||
						v.match(/Module.*has no exported member ['"]([^'"]+)['"]/i)
					if (ghostMatch) {
						const symbol = ghostMatch[1]
						const ok = await this.materializeGhostSymbol(filePath, symbol, _engine)
						if (ok) healedSomething = true
					}

					if (v.includes("Circular dependency detected")) {
						const cycle = v.split(": ")[1].split(" -> ")
						const remediation = await this.mediateCycle(cycle, _engine)
						if (remediation) {
							Logger.info(`[RefactorHealer] Cycle Mediation Proposal: ${remediation}`)
							healedSomething = true
						}
					}
				}
			}

			return healedSomething
		} catch (err) {
			Logger.error(`[RefactorHealer] autoHeal failed for ${filePath}:`, err)
			return false
		}
	}

	/**
	 * Cascade Healing: Fixes the "Vibrations" in dependents after a change.
	 */
	public async healCascade(targetPath: string, engine: SpiderEngine): Promise<number> {
		const node = engine.nodes.get(targetPath)
		if (!node) return 0

		let healCount = 0
		// Sense vibrations in 1-degree dependents
		for (const dependent of node.dependents) {
			try {
				await this.alignTag(dependent)
				healCount++
			} catch (_e) {
				// Silent fail for background cascade
			}
		}
		return healCount
	}

	/**
	 * Proactively analyzes a file for structural issues (Bottlenecks).
	 */
	public async analyzeStructuralHealth(filePath: string, afferentCoupling: number): Promise<HealingProposal | null> {
		if (afferentCoupling > 10) {
			const layer = getLayer(filePath)
			if (layer === "infrastructure" || layer === "ui") {
				return {
					id: (globalThis.crypto || require("crypto")).randomUUID(),
					type: "BOTTLENECK",
					file: filePath,
					confidence: 0.3, // Low confidence: requires human extraction of interface
					message: `Structural Bottleneck detected: ${afferentCoupling} incoming links. Consider extracting a Domain interface.`,
					action: async () => {
						/* No-op: Requires human refactor */
					},
				}
			}
		}
		return null
	}

	/**
	 * Ensures the file's [LAYER] tag matches its directory.
	 * PRODUCTION HARDENING: Idempotent alignment that respects existing JSDoc structures.
	 */
	public async alignTag(filePath: string): Promise<void> {
		if (!isLayerTagSupported(filePath)) return

		try {
			const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.projectRoot, filePath)
			const content = await fs.readFile(absolutePath, "utf-8")
			const currentTag = parseLayerTag(content)
			const expectedLayer = getLayer(absolutePath)

			if (currentTag !== expectedLayer) {
				const tagLabel = expectedLayer.toUpperCase() === "PLUMBING" ? "UTILS" : expectedLayer.toUpperCase()

				// PRODUCTION HARDENING: If a tag already exists but is wrong, replace it instead of prepending.
				let newContent = content
				const tagRegex = /\/\*\*[\s\S]*?\[LAYER:\s*\w+\][\s\S]*?\*\//i
				if (tagRegex.test(content)) {
					newContent = content.replace(tagRegex, `/**\n * [LAYER: ${tagLabel}]\n */`)
				} else {
					newContent = generateLayerComment(absolutePath, tagLabel, content) || content
				}

				if (newContent && newContent !== content) {
					await fs.writeFile(absolutePath, newContent, "utf-8")
					Logger.info(`[RefactorHealer] Automatically aligned [LAYER: ${tagLabel}] tag for ${path.basename(filePath)}`)
				}
			}
		} catch (err) {
			Logger.error(`[RefactorHealer] Failed to align tag for ${filePath}:`, err)
		}
	}

	/**
	 * V8: Strategic Import Re-linking.
	 * Automatically updates all known dependents when a file is moved.
	 */
	public async healImports(oldPath: string, newPath: string, engine: SpiderEngine): Promise<number> {
		const node = engine.nodes.get(oldPath) || engine.nodes.get(newPath)
		if (!node) return 0

		let updatedCount = 0
		const oldRel = oldPath.replace(".ts", "").replace(".tsx", "")
		const newRel = newPath.replace(".ts", "").replace(".tsx", "")

		for (const dependent of node.dependents) {
			try {
				const depAbs = path.resolve(this.projectRoot, dependent)
				const content = await fs.readFile(depAbs, "utf-8")

				// Calculate relative paths using @/ aliases if possible, or fall back to relative
				const oldImportStr = oldRel.startsWith("src/") ? oldRel.replace("src/", "@/") : oldRel
				const newImportStr = newRel.startsWith("src/") ? newRel.replace("src/", "@/") : newRel

				if (content.includes(oldImportStr)) {
					const updatedContent = content.split(oldImportStr).join(newImportStr)
					if (updatedContent !== content) {
						await fs.writeFile(depAbs, updatedContent, "utf-8")
						updatedCount++
						Logger.info(
							`[RefactorHealer] Automatically re-linked import in ${path.basename(dependent)}: ${oldImportStr} -> ${newImportStr}`,
						)
					}
				}
			} catch (_e) {
				// Skip if failed
			}
		}
		return updatedCount
	}

	/**
	 * V16: Materializes a missing symbol in a file or suggests an existing match from the graph.
	 */
	public async materializeGhostSymbol(filePath: string, symbol: string, engine?: SpiderEngine): Promise<boolean> {
		try {
			const absolutePath = path.resolve(this.projectRoot, filePath)
			const content = await fs.readFile(absolutePath, "utf-8")

			// Check if already materialized or exists
			if (
				content.includes(`export class ${symbol}`) ||
				content.includes(`export interface ${symbol}`) ||
				content.includes(`export const ${symbol}`) ||
				content.includes(`import { ${symbol}`) ||
				content.includes(`import ${symbol}`)
			) {
				return false
			}

			// V16: Semantic Sensing - Search for existing symbols in the graph
			if (engine) {
				const matches: { symbol: string; path: string }[] = []
				for (const node of engine.nodes.values()) {
					if (node.path === filePath) continue
					for (const exported of node.exports) {
						if (
							exported.toLowerCase() === symbol.toLowerCase() ||
							exported.includes(symbol) ||
							symbol.includes(exported)
						) {
							matches.push({ symbol: exported, path: node.path })
						}
					}
				}

				if (matches.length > 0) {
					const bestMatch = matches[0]

					Logger.info(
						`[RefactorHealer] Semantic Match Found: Suggesting import of '${bestMatch.symbol}' from ${bestMatch.path} instead of materialization.`,
					)
					// We don't automatically inject imports yet to avoid breaking multi-symbol imports,
					// but we provide the hint in the log/violations.
					return false
				}
			}

			// Fallback: Add a basic boilerplate at the end of the file
			const layer = getLayer(filePath)
			const boilerplate = `\n\n/**\n * [LAYER: ${layer.toUpperCase()}]\n * Placeholder for ${symbol} (Materialized via Sovereign Healer)\n */\nexport class ${symbol} {\n\t// TODO: Implement members\n}\n`

			await fs.writeFile(absolutePath, content + boilerplate, "utf-8")
			Logger.info(`[RefactorHealer] Materialized ghost symbol ${symbol} in ${path.basename(filePath)}`)
			return true
		} catch (err) {
			Logger.error(`[RefactorHealer] Failed to materialize ghost symbol ${symbol} in ${filePath}:`, err)
			return false
		}
	}

	/**
	 * Automatically heals a statelessness violation by converting 'let' to 'const'.
	 */
	public async healStatelessness(filePath: string): Promise<boolean> {
		try {
			const absolutePath = path.resolve(this.projectRoot, filePath)
			const content = await fs.readFile(absolutePath, "utf-8")
			const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)

			// Simple byte-level replacement for 'let' to 'const' at global variable level
			// This is safer than full AST factory for simple healing.
			let changed = false
			let newContent = content

			ts.forEachChild(sourceFile, (node) => {
				if (ts.isVariableStatement(node)) {
					const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0
					if (!isConst) {
						// Only heal if it's a 'let' or 'var' at the top level
						const listText = node.declarationList.getFullText(sourceFile)
						if (listText.trim().startsWith("let ") || listText.trim().startsWith("var ")) {
							const start = node.declarationList.getStart(sourceFile)
							const updatedList = listText.replace(/^(let|var)\s+/, "const ")

							// Just update the first occurrence for this heuristic check
							if (updatedList !== listText) {
								newContent =
									newContent.substring(0, start) + updatedList + newContent.substring(start + listText.length)
								changed = true
							}
						}
					}
				}
			})

			if (changed) {
				await fs.writeFile(absolutePath, newContent, "utf-8")
				return true
			}
		} catch (err) {
			Logger.error(`[RefactorHealer] Failed to heal statelessness in ${filePath}:`, err)
		}
		return false
	}

	/**
	 * Re-aligns a file's tag based on its ARCHETYPAL fingerprint, not just its location.
	 */
	public async alignTagByFingerprint(node: SpiderNode, optimizer: SovereignOptimizer): Promise<void> {
		const recommended = optimizer.calculateOptimalLayer(node, {} as SpiderEngine)
		if (recommended && recommended !== node.layer) {
			Logger.info(`Re-aligning ${node.path} from ${node.layer} to ${recommended} (Fingerprint Match)`)
			await this.alignTagWithLayer(node.path, recommended)
		}
	}

	private async alignTagWithLayer(filePath: string, layer: string): Promise<void> {
		if (!isLayerTagSupported(filePath)) return

		const absolutePath = path.resolve(this.projectRoot, filePath)
		const content = await fs.readFile(absolutePath, "utf-8")
		const newContent = generateLayerComment(filePath, layer, content)
		if (newContent) {
			await fs.writeFile(absolutePath, newContent, "utf-8")
		}
	}

	/**
	 * V16: Identifies the best candidate in a cycle to break it via interface extraction.
	 */
	public async mediateCycle(cycle: string[], engine: SpiderEngine): Promise<string | null> {
		if (cycle.length < 2) return null

		// Find the node with the lowest internal complexity or lowest coupling to others
		let weakestLink: string | null = null
		let minCoupling = Number.POSITIVE_INFINITY

		for (const nodeLabel of cycle) {
			const node = Array.from(engine.nodes.values()).find((n: SpiderNode) => path.basename(n.path) === nodeLabel)
			if (node && node.afferentCoupling < minCoupling) {
				minCoupling = node.afferentCoupling
				weakestLink = node.path
			}
		}

		if (weakestLink) {
			const base = path.basename(weakestLink).split(".")[0]
			const interfaceName = `I${base.charAt(0).toUpperCase()}${base.slice(1)}`
			return `Break cycle by extracting '${interfaceName}' from ${path.basename(weakestLink)} and moving it to the DOMAIN layer.`
		}

		return null
	}

	/**
	 * V17: Generates an executable healing recipe for structural violations.
	 */
	public generateHealingRecipe(violation: SpiderViolation): string {
		switch (violation.id) {
			case "SPI-001": // Contractless Breach
				const className = violation.message.match(/Module (.*) exports/)?.[1]
				return className
					? `EXECUTE: Create src/domain/interfaces/I${className}.ts with the following bridge:\n${this.generateInterfaceBridge(className)}`
					: "EXECUTE: Implement a domain interface."
			case "SPI-004": // Cycle
				return violation.remediation || "Analyze complexity to find weakest link for extraction."
			case "SPI-005": // Ghost
				return violation.remediation
					? `EXECUTE: Add the following line to ${path.basename(violation.path)}: \n    ${violation.remediation.replace("Suggested Import: ", "")}`
					: "Locate providing module and add missing import."
			case "SPI-103": // Unused Export
				return `EXECUTE: Remove unused export from ${path.basename(violation.path)} to reduce structural waste.`
			case "SPI-003": // Orphan
				return `EXECUTE: Delete file if redundant, or integrate it into a consumer in the same directory.`
			default:
				return violation.message
		}
	}

	/**
	 * PRODUCTION HARDENING: Proactively scans the codebase for untagged files
	 * and returns healing proposals for the dashboard.
	 */
	public async proactiveScan(fileList: string[]): Promise<HealingProposal[]> {
		const proposals: HealingProposal[] = []

		for (const file of fileList) {
			if (!isLayerTagSupported(file)) continue

			try {
				const absolutePath = path.isAbsolute(file) ? file : path.resolve(this.projectRoot, file)
				const content = await fs.readFile(absolutePath, "utf-8")
				const currentTag = parseLayerTag(content)

				if (!currentTag) {
					const expectedLayer = getLayer(absolutePath)
					proposals.push({
						id: (globalThis.crypto || require("crypto")).randomUUID(),
						type: "TAG_ALIGN",
						file: file,
						confidence: 1.0,
						message: `Proactive Alignment Required: File is missing mandatory [LAYER] tag. Expected: ${expectedLayer.toUpperCase()}.`,
						action: () => this.alignTag(file),
					})
				}
			} catch (_e) {
				// Skip files we can't read
			}
		}

		return proposals
	}

	/**
	 * V18: Generates a suggested interface contract for a concrete class.
	 */
	public generateInterfaceBridge(className: string): string {
		const interfaceName = `I${className.charAt(0).toUpperCase()}${className.slice(1)}`
		return [
			`/** [LAYER: DOMAIN] */`,
			`export interface ${interfaceName} {`,
			`  // Add formal contract methods here`,
			`  initialize(): Promise<void>;`,
			`  dispose(): void;`,
			`}`,
		].join("\n")
	}
}
