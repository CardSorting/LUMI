import * as fs from "fs/promises"
import * as path from "path"
import { Project, VariableDeclarationKind } from "ts-morph"
import { Logger } from "@/shared/services/Logger"
import { generateLayerComment, getLayer, isLayerTagSupported, parseLayerTag } from "@/utils/joy-zoning"
import { SovereignTransaction } from "../../integrity/SovereignTransaction"
import { SovereignOptimizer } from "../../policy/SovereignOptimizer"
import { SpiderEngine, SpiderNode } from "../../policy/SpiderEngine"

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
	 */
	public async alignTag(filePath: string): Promise<void> {
		if (!isLayerTagSupported(filePath)) return

		try {
			const content = await fs.readFile(filePath, "utf-8")
			const currentTag = parseLayerTag(content)
			const expectedLayer = getLayer(filePath)

			if (currentTag !== expectedLayer) {
				const tagLabel = expectedLayer.toUpperCase() === "PLUMBING" ? "UTILS" : expectedLayer.toUpperCase()
				const newContent = generateLayerComment(filePath, tagLabel, content) || content

				await fs.writeFile(filePath, newContent, "utf-8")
			}
		} catch (err) {
			Logger.error(`[RefactorHealer] Failed to align tag for ${filePath}:`, err)
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
		const tagHeader = generateLayerComment(filePath, layer) || ""
		const template = `${tagHeader}export interface ${interfaceName} {\n\t// TODO: Define members for ${interfaceName}\n}\n`

		try {
			const dir = path.dirname(absolutePath)
			if (!(await this.dirExists(dir))) {
				await fs.mkdir(dir, { recursive: true })
			}
			await fs.writeFile(absolutePath, template, "utf-8")
		} catch (err) {
			Logger.error(`[RefactorHealer] Failed to materialize ghost ${filePath}:`, err)
		}
	}

	/**
	 * Automatically heals a statelessness violation by converting 'let' to 'const'.
	 */
	public async healStatelessness(filePath: string): Promise<boolean> {
		try {
			const project = new Project()
			const absolutePath = path.resolve(this.projectRoot, filePath)
			const sourceFile = project.addSourceFileAtPath(absolutePath)

			let changed = false
			sourceFile.getVariableStatements().forEach((vs) => {
				if (vs.getDeclarationKind() !== VariableDeclarationKind.Const) {
					vs.setDeclarationKind(VariableDeclarationKind.Const)
					changed = true
				}
			})

			if (changed) {
				await sourceFile.save()
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
