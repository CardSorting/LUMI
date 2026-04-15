import * as fs from "fs/promises"
import * as path from "path"
import * as ts from "typescript"
import { Logger } from "@/shared/services/Logger"
import { generateLayerComment, getLayer, isLayerTagSupported, parseLayerTag } from "@/utils/joy-zoning"
import { SovereignTransaction } from "../../integrity/SovereignTransaction"
import { SovereignOptimizer } from "../../policy/SovereignOptimizer"
import { SpiderEngine } from "../../policy/spider/SpiderEngine"
import { SpiderNode } from "../../policy/spider/types"

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
	 * Materializes a "Ghost" file (Missing import) into a physical Domain interface.
	 */
	public async materializeGhost(filePath: string, importingSource?: string): Promise<void> {
		const absolutePath = path.resolve(this.projectRoot, filePath)
		const fileName = path.basename(filePath, path.extname(filePath))
		const interfaceName = this.toPascalCase(fileName)
		const layer = getLayer(filePath)
		const tagHeader = generateLayerComment(filePath, layer) || ""

		// PRODUCTION HARDENING: If importing source is provided, try to infer methods
		let members = "// TODO: Define members"
		if (importingSource?.includes(interfaceName)) {
			const usageMatch = importingSource.match(new RegExp(`${interfaceName}\\s*{([\\s\\S]+?)}`, "g"))
			if (usageMatch) {
				members = `// Inferred from usage:\n\t${usageMatch.map((m) => m.trim()).join("\n\t")}`
			}
		}

		const template = `${tagHeader}export interface ${interfaceName} {\n\t${members}\n}\n`

		try {
			const dir = path.dirname(absolutePath)
			if (!(await this.dirExists(dir))) {
				await fs.mkdir(dir, { recursive: true })
			}
			await fs.writeFile(absolutePath, template, "utf-8")
			Logger.info(`[RefactorHealer] Materialized ghost interface ${interfaceName} at ${filePath}`)
		} catch (err) {
			Logger.error(`[RefactorHealer] Failed to materialize ghost ${filePath}:`, err)
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

	private toPascalCase(str: string): string {
		return str
			.split("-")
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join("")
	}

	private async dirExists(dir: string): Promise<boolean> {
		try {
			await fs.access(dir)
			return true
		} catch {
			return false
		}
	}
}
