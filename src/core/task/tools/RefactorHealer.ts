import { ImportFixer } from "@/utils/import-fixer"
import { getLayer, parseLayerTag } from "@/utils/joy-zoning"
import { SpiderEngine } from "../../policy/SpiderEngine"
import { SovereignTransaction } from "../../integrity/SovereignTransaction"
import { SemanticAxiomEngine } from "../../policy/SemanticAxiomEngine"
import { Logger } from "@/shared/services/Logger"
import * as fs from "fs/promises"
import * as path from "path"
import { crypto } from "crypto"

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
	private importFixer: ImportFixer

	constructor(private projectRoot: string) {
		this.importFixer = new ImportFixer(this.projectRoot)
	}

	/**
	 * Strategic Pivoting: Heals a move violation, but pivots to extraction if move is impossible.
	 */
	public async healMove(filePath: string, targetPath: string): Promise<{ success: boolean; pivot?: string }> {
		const tx = new SovereignTransaction(`heal_move_${path.basename(filePath)}`)
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
		} catch (error) {
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
			} catch (e) {
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
					// @ts-ignore
					id: (globalThis.crypto || require("crypto")).randomUUID(),
					type: "BOTTLENECK",
					file: filePath,
					confidence: 0.3, // Low confidence: requires human extraction of interface
					message: `Structural Bottleneck detected: ${afferentCoupling} incoming links. Consider extracting a Domain interface.`,
					action: async () => { /* No-op: Requires human refactor */ }
				}
			}
		}
		return null
	}

	/**
	 * Ensures the file's [LAYER] tag matches its directory.
	 */
	public async alignTag(filePath: string): Promise<void> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			const currentTag = parseLayerTag(content)
			const expectedLayer = getLayer(filePath)

			if (currentTag !== expectedLayer) {
				const tagLabel = expectedLayer.toUpperCase() === "PLUMBING" ? "UTILS" : expectedLayer.toUpperCase()
				const newTag = `[LAYER: ${tagLabel}]`
				
				let newContent: string
				if (currentTag) {
					// Replace existing tag
					newContent = content.replace(/\[LAYER:\s*(DOMAIN|CORE|INFRASTRUCTURE|PLUMBING|UI|UTILS)\]/i, newTag)
				} else {
					// Add new tag at the top
					newContent = `/**\n * ${newTag}\n */\n\n${content}`
				}
				
				await fs.writeFile(filePath, newContent, "utf-8")
			}
		} catch (err) {
			console.error(`[RefactorHealer] Failed to align tag for ${filePath}:`, err)
		}
	}

	/**
	 * Materializes a "Ghost" file (Missing import) into a physical Domain interface.
	 */
	public async materializeGhost(filePath: string): Promise<void> {
		const absolutePath = path.resolve(this.projectRoot, filePath)
		const fileName = path.basename(filePath, path.extname(filePath))
		const interfaceName = this.toPascalCase(fileName)
		const layer = getLayer(filePath)

		const template = `/**\n * [LAYER: ${layer.toUpperCase()}]\n * Auto-materialized by JoyZoning Healer\n */\n\nexport interface ${interfaceName} {\n\t// TODO: Define members for ${interfaceName}\n}\n`

		try {
			const dir = path.dirname(absolutePath)
			if (!(await this.dirExists(dir))) {
				await fs.mkdir(dir, { recursive: true })
			}
			await fs.writeFile(absolutePath, template, "utf-8")
		} catch (err) {
			console.error(`[RefactorHealer] Failed to materialize ghost ${filePath}:`, err)
		}
	}

	private toPascalCase(str: string): string {
		return str.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("")
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
