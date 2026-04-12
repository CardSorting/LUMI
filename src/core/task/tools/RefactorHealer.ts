import { ImportFixer } from "@/utils/import-fixer"
import { getLayer, parseLayerTag } from "@/utils/joy-zoning"
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
	 * Synchronously heals a file move.
	 * 1. Updates tags within the moved file.
	 * 2. Fixes incoming imports from other files.
	 * 3. Fixes outgoing imports within the moved file.
	 */
	public async healMove(oldPath: string, newPath: string): Promise<void> {
		const absoluteNewPath = path.resolve(this.projectRoot, newPath)
		
		// 1. Tag Alignment (Confidence 1.0)
		await this.alignTag(absoluteNewPath)

		// 2. Outgoing Imports (Fix links inside the moved file)
		await this.importFixer.fixOutgoingImports(newPath, oldPath)

		// 3. Incoming Imports (Fix references from the rest of the project)
		await this.importFixer.fixImports(oldPath, newPath)
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
