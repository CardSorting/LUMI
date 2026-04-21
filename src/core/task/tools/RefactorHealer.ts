import * as fsSync from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { Project, SourceFile, VariableDeclarationKind } from "ts-morph"
import * as ts from "typescript"
import { Logger } from "@/shared/services/Logger"
import { generateLayerComment, getLayer, isLayerTagSupported, parseLayerTag } from "@/utils/joy-zoning"
import { SovereignTransaction } from "../../integrity/SovereignTransaction"
import { AxiomViolation } from "../../policy/SemanticAxiomEngine"
import { SovereignOptimizer } from "../../policy/SovereignOptimizer"
import { SpiderEngine } from "../../policy/spider/SpiderEngine"
import { SpiderNode, SpiderViolation } from "../../policy/spider/types"

export interface ForensicDiagnostic {
	file: string
	line: number
	column: number
	code: number
	message: string
}

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
	private morphProject: Project | null = null

	constructor(private projectRoot: string) {}

	private getProject(): Project {
		if (!this.morphProject) {
			this.morphProject = new Project({
				useInMemoryFileSystem: false,
				skipAddingFilesFromTsConfig: true,
			})
		}
		return this.morphProject
	}

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
						const ok = await this.proposeSymbolAction(filePath, symbol, _engine)
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
	 * V204: Brittle Path Detection.
	 * Scans content for relative imports that should be project aliases.
	 */
	public detectRelativeImports(filePath: string, content: string, engine: SpiderEngine): string[] {
		const relativeImportRegex = /import\s+.*from\s+["'](\.\.?\/[^"']+)["']/g
		const suggestions: string[] = []
		let match: RegExpExecArray | null

		while ((match = relativeImportRegex.exec(content)) !== null) {
			const specifier = match[1]
			const absPath = path.resolve(path.dirname(path.resolve(this.projectRoot, filePath)), specifier)
			const alias = engine.getBestAlias(absPath)

			if (alias.startsWith("@")) {
				suggestions.push(`\`${specifier}\` -> \`${alias}\``)
			}
		}

		return suggestions
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
	 * V204: Shadowing Detection.
	 * Detects if an imported symbol is redefined in the local scope.
	 */
	public detectShadowing(filePath: string, content: string): string[] {
		const suggestions: string[] = []
		const importedSymbols = new Set<string>()

		// Extract imports
		const importRegex = /import\s+\{([^}]*)\}\s+from/g
		let match: RegExpExecArray | null
		while ((match = importRegex.exec(content)) !== null) {
			match[1].split(",").forEach((s) => importedSymbols.add(s.trim()))
		}

		// Detect redefinitions (class, const, let, function)
		const redefRegex = /^(?:class|const|let|function)\s+([a-zA-Z0-9_]+)/gm
		while ((match = redefRegex.exec(content)) !== null) {
			const symbol = match[1]
			if (importedSymbols.has(symbol)) {
				suggestions.push(
					`\`${symbol}\` is imported but also redefined locally. This shadowing will cause a naming collision or 'Already defined' error.`,
				)
			}
		}

		return suggestions
	}

	/**
	 * V204: Deadwood Detection (Local).
	 * Detects imports that are never used in the file body.
	 */
	public detectUnusedImports(filePath: string, content: string): string[] {
		const suggestions: string[] = []
		const importRegex = /import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
		let match: RegExpExecArray | null

		while ((match = importRegex.exec(content)) !== null) {
			const symbols = match[1].split(",").map((s) => s.trim())
			const specifier = match[2]

			for (const symbol of symbols) {
				// Simple check: is the symbol used anywhere else in the file?
				const usageRegex = new RegExp(`\\b${symbol}\\b`, "g")
				const usageCount = (content.match(usageRegex) || []).length
				if (usageCount === 1) {
					// Only found in the import declaration
					suggestions.push(
						`Imported symbol \`${symbol}\` from \`${specifier}\` is unused. Redundant imports increase cognitive load and substrate bloat.`,
					)
				}
			}
		}

		return suggestions
	}

	/**
	 * V204: Zero-Friction Path Normalization.
	 * Automatically converts relative imports to project aliases in the provided content.
	 */
	public normalizeBrittlePaths(filePath: string, content: string, engine: SpiderEngine): string {
		const relativeImportRegex = /import\s+(.*)\s+from\s+["'](\.\.?\/[^"']+)["']/g
		return content.replace(relativeImportRegex, (match, symbols, specifier) => {
			const absPath = path.resolve(path.dirname(path.resolve(this.projectRoot, filePath)), specifier)
			const alias = engine.getBestAlias(absPath)
			if (alias.startsWith("@")) {
				return `import ${symbols} from "${alias}"`
			}
			return match
		})
	}

	/**
	 * V204: Barrel Sync Detection.
	 * Detects if a file in a directory with an index.ts is missing from its exports.
	 */
	public async detectMissingFromBarrel(filePath: string): Promise<string[]> {
		const dir = path.dirname(filePath)
		const indexPath = path.join(dir, "index.ts")
		const absoluteIndexPath = path.isAbsolute(indexPath) ? indexPath : path.resolve(this.projectRoot, indexPath)

		try {
			const indexContent = await fs.readFile(absoluteIndexPath, "utf-8")
			const fileName = path.basename(filePath, path.extname(filePath))

			// Simple check: is there an export for this file?
			// handles: export * from "./file", export { x } from "./file", import x from "./file"
			const exportRegex = new RegExp(`from\\s+["']\\.\\/${fileName}["']`, "i")
			if (!exportRegex.test(indexContent)) {
				return [
					`File \`${path.basename(filePath)}\` is not exported in \`${path.basename(indexPath)}\`. Symbols in this file may be inaccessible via the directory barrel.`,
				]
			}
		} catch (_e) {
			// No index.ts, skip
		}
		return []
	}

	/**
	 * V204: Proactive Materialization.
	 * Generates a high-fidelity boilerplate for a missing symbol.
	 */
	public materializeSymbolBoilerplate(symbol: string, layer: string): string {
		const isCap = /^[A-Z]/.test(symbol)
		const isInterface = symbol.startsWith("I") && symbol.length > 2 && /^[A-Z]/.test(symbol.charAt(1))

		if (isInterface) {
			return `export interface ${symbol} {\n\t// TODO: Define the contract for ${symbol}\n}`
		}

		if (isCap) {
			return `/**\n * [LAYER: ${layer.toUpperCase()}]\n */\nexport class ${symbol} {\n\tconstructor() {}\n}`
		}

		return `export const ${symbol} = () => {\n\t// TODO: Implement ${symbol}\n}`
	}

	/**
	 * V204: Visibility Hardening.
	 * Detects top-level declarations in major layers that are missing 'export'.
	 */
	public detectMissingExports(filePath: string, content: string): string[] {
		const layer = getLayer(filePath)
		if (layer === "plumbing" || layer === "ui") return [] // Skip utilities and UI (might have locals)

		const suggestions: string[] = []
		const lines = content.split("\n")

		for (const line of lines) {
			const match = line.match(/^(class|interface|type|enum|const|function)\s+([a-zA-Z0-9_]+)/)
			if (match) {
				const symbol = match[2]
				suggestions.push(
					`\`${symbol}\` is defined but not exported. In the **${layer.toUpperCase()}** layer, internal symbols should typically be exported for visibility.`,
				)
			}
		}

		return suggestions
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

		// V190 Hardening: Forensic recursion (healing deep dependents)
		const visited = new Set<string>()
		const queue = [...node.dependents]

		while (queue.length > 0) {
			const dependent = queue.shift()
			if (!dependent || visited.has(dependent)) continue
			visited.add(dependent)

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

						// Add dependents of this healed file to the queue for secondary stability
						const depNode = engine.nodes.get(dependent)
						if (depNode) queue.push(...depNode.dependents)
					}
				}
			} catch (_e) {
				// Skip if failed
			}
		}
		return updatedCount
	}

	/**
	 * V201: Proposes a structured symbol action (Import or Proactive Creation)
	 * instead of blindly appending boilerplates.
	 */
	public async proposeSymbolAction(filePath: string, symbol: string, engine?: SpiderEngine): Promise<boolean> {
		try {
			const absolutePath = path.resolve(this.projectRoot, filePath)
			const content = await fs.readFile(absolutePath, "utf-8")

			// Check if already exist
			if (
				content.includes(`export class ${symbol}`) ||
				content.includes(`export interface ${symbol}`) ||
				content.includes(`export const ${symbol}`) ||
				content.includes(`import { ${symbol}`) ||
				content.includes(`import ${symbol}`)
			) {
				return false
			}

			if (engine) {
				const providers = engine.findSymbolProviders(symbol)
				if (providers.length > 0) {
					const bestProvider = providers[0]
					Logger.info(`[RefactorHealer] Forensic Match: Found ${symbol} in ${bestProvider}. Proposing import.`)

					// Use AST to inject import safely
					return await this.applyDiagnosticFix({
						file: filePath,
						line: 1,
						column: 1,
						code: 2304, // Cannot find name
						message: `Cannot find name '${symbol}'`,
					})
				}
			}

			// If no provider found, we no longer blindly materialize.
			// Instead, we propose a high-fidelity definition in a valid architectural layer.
			const layer = getLayer(filePath)
			const isCap = /^[A-Z]/.test(symbol)
			const targetDir = isCap ? "src/domain/services" : "src/plumbing"
			const targetFile = path.join(targetDir, `${symbol}.ts`)

			Logger.warn(
				`[RefactorHealer] UNRESOLVED SYMBOL: ${symbol}. ` +
					`ACTION REQUIRED: Please define ${symbol} in ${targetFile} or provide a provider path.`,
			)

			// We return false because automatic materialization is deprecated for safety.
			return false
		} catch (err) {
			Logger.error(`[RefactorHealer] proposeSymbolAction failed for ${symbol}:`, err)
			return false
		}
	}

	/**
	 * V201: Deterministic AST-based Diagnostic Repair.
	 * Handlers specific TypeScript error codes with high-fidelity repairs.
	 */
	public async applyDiagnosticFix(diag: ForensicDiagnostic, engine?: SpiderEngine): Promise<boolean> {
		const project = this.getProject()
		const absPath = path.resolve(this.projectRoot, diag.file)

		try {
			// Ensure file is in project
			const sourceFile = project.addSourceFileAtPathIfExists(absPath) || project.addSourceFileAtPath(absPath)
			if (!sourceFile) return false

			let fixed = false

			// TS2304: Cannot find name 'X'
			if (diag.code === 2304 || diag.message.includes("Cannot find name")) {
				const symbolMatch = diag.message.match(/Cannot find name '([^']+)'/)
				const symbol = symbolMatch ? symbolMatch[1] : null

				if (symbol && engine) {
					fixed = await this.fixMissingImport(sourceFile, symbol, engine)
				}
			}

			// TS1361: 'let' should be 'const'
			if (diag.code === 1361 || diag.message.includes("should be a 'const'")) {
				fixed = await this.fixStatelessnessAST(sourceFile, diag.line)
			}

			if (fixed) {
				await sourceFile.save()
				Logger.info(
					`[RefactorHealer] PFH: Successfully applied AST repair for TS${diag.code} in ${path.basename(diag.file)}`,
				)
			}

			return fixed
		} catch (err) {
			Logger.error(`[RefactorHealer] PFH: Failed to apply AST repair in ${diag.file}:`, err)
			return false
		}
	}

	private async fixMissingImport(sourceFile: SourceFile, symbol: string, engine: SpiderEngine): Promise<boolean> {
		const providers = engine.findSymbolProviders(symbol)
		if (providers.length === 0) return false

		// V204: Ambiguity Resolution.
		// If multiple providers exist, pick the one that is architecturally closest.
		let provider = providers[0]
		if (providers.length > 1) {
			const sourceLayer = getLayer(sourceFile.getFilePath())
			const sameLayer = providers.find((p) => getLayer(p) === sourceLayer)
			if (sameLayer) provider = sameLayer
		}

		// V204: Deterministic Aliasing.
		// Always prefer project aliases (@/) over brittle relative paths.
		const bestPath = engine.getBestAlias(provider).replace(/\.tsx?$/, "")
		const sourceFilePath = sourceFile.getFilePath()

		// Verify existing imports to avoid duplicates
		const existing = sourceFile.getImportDeclaration(
			(d) => d.getModuleSpecifierValue() === bestPath || d.getModuleSpecifierValue().includes(path.basename(bestPath)),
		)

		if (existing) {
			if (!existing.getNamedImports().some((n) => n.getName() === symbol)) {
				existing.addNamedImport(symbol)
				return true
			}
			return false
		}

		sourceFile.addImportDeclaration({
			namedImports: [symbol],
			moduleSpecifier: bestPath,
		})
		return true
	}

	private async fixStatelessnessAST(sourceFile: SourceFile, line: number): Promise<boolean> {
		const variable = sourceFile.getVariableDeclaration((d) => d.getStartLineNumber() === line)
		if (variable) {
			const statement = variable.getVariableStatement()
			if (statement && statement.getDeclarationKind() !== VariableDeclarationKind.Const) {
				statement.setDeclarationKind(VariableDeclarationKind.Const)
				return true
			}
		}
		return false
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
	 * V200: Strategic Healing Recipe.
	 * Generates hyper-deterministic directives based on structural risk metrics.
	 */
	public generateHealingRecipe(violation: SpiderViolation, engine?: SpiderEngine): string {
		const node = engine?.nodes.get(violation.path)
		const riskPrefix = node?.isHotspot ? "🔥 [HOTSPOT_REPAIR]: " : node?.isFragile ? "🛡️ [FRAGILE_SHIELD]: " : ""

		switch (violation.id) {
			case "SPI-001": // Contractless Breach
				const className = violation.message.match(/Module (.*) exports/)?.[1]
				return `${riskPrefix}Extract I${className || "Component"} to domain/interfaces and run SWEEP.`
			case "SPI-004": // Cycle
				return `${riskPrefix}Break Cycle via Dependency Inversion or move shared logic to src/plumbing/.`
			case "SPI-005": // Ghost
				return `${riskPrefix}Materialize missing symbols via Sovereign Garbage Collector Sweep.`
			case "SPI-103": // Unused Export
				return `🧹 [METABOLIC_PRUNE]: Autonomously demote unused export in ${path.basename(violation.path)}.`
			case "SPI-003": // Orphan
				return `🗑️ [METABOLIC_TRASH]: Delete this file if redundant (Disconnected from Root).`
			default:
				if (violation.message.includes("Geographic Misalignment")) {
					return `${riskPrefix}Align [LAYER] tag to match physical path and synchronize registry.`
				}
				return `🛠️ [FIX]: ${violation.message}`
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
	public generateInterfaceBridge(className: string, absolutePath: string): string {
		const interfaceName = `I${className.charAt(0).toUpperCase()}${className.slice(1)}`
		const signatures: string[] = []

		try {
			if (fsSync.existsSync(absolutePath)) {
				const content = fsSync.readFileSync(absolutePath, "utf-8")
				const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)

				ts.forEachChild(sourceFile, (node) => {
					if (ts.isClassDeclaration(node) && node.name?.getText(sourceFile) === className) {
						for (const member of node.members) {
							// PRODUCTION HARDENING: Safe modifier check for ClassElement
							const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined
							const isPublic = !modifiers?.some(
								(m: ts.Modifier) =>
									m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
							)

							if (isPublic && (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member))) {
								const name = member.name.getText(sourceFile)
								const params = ts.isMethodDeclaration(member)
									? `(${member.parameters.map((p) => p.getText(sourceFile)).join(", ")})`
									: ""
								const type = member.type ? `: ${member.type.getText(sourceFile)}` : ""
								const isAsync = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
									? "Promise<"
									: ""
								const isAsyncEnd = isAsync ? ">" : ""

								// Convert to interface signature
								if (ts.isMethodDeclaration(member)) {
									signatures.push(
										`  ${name}${params}: ${isAsync}${member.type?.getText(sourceFile) || "void"}${isAsyncEnd};`,
									)
								} else {
									signatures.push(`  ${name}${type};`)
								}
							}
						}
					}
				})
			}
		} catch (err) {
			Logger.error(`[RefactorHealer] Failed to generate interface bridge for ${className}:`, err)
		}

		if (signatures.length === 0) {
			signatures.push("  // TODO: Add formal contract methods")
			signatures.push("  initialize(): Promise<void>;")
			signatures.push("  dispose(): void;")
		}

		return [`/** [LAYER: DOMAIN] */`, `export interface ${interfaceName} {`, ...signatures, `}`].join("\n")
	}

	/**
	 * V140: Forensic Member Extraction.
	 * Attempts to find the symbol in other modules to extract its physical signature.
	 */
	private extractMemberSignatures(symbol: string, engine: SpiderEngine): string[] {
		const signatures: string[] = []
		for (const node of Array.from(engine.nodes.values())) {
			if (node.exports.includes(symbol)) {
				const absolutePath = path.resolve(this.projectRoot, node.path)
				try {
					if (!fsSync.existsSync(absolutePath)) continue
					const content = fsSync.readFileSync(absolutePath, "utf-8")
					const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true)

					// Helper to extract signatures from a declaration
					const processDeclaration = (decl: ts.Node) => {
						if (ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl)) {
							for (const member of (decl as ts.ClassDeclaration | ts.InterfaceDeclaration).members) {
								if (
									ts.isMethodDeclaration(member) ||
									ts.isPropertyDeclaration(member) ||
									ts.isMethodSignature(member) ||
									ts.isPropertySignature(member)
								) {
									const isAsync = member.modifiers?.some(
										(m: ts.ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword,
									)
										? "async "
										: ""
									const name = member.name?.getText(sourceFile) || "unknown"
									const params =
										ts.isMethodDeclaration(member) || ts.isMethodSignature(member)
											? `(${member.parameters.map((p) => p.getText(sourceFile)).join(", ")})`
											: ""
									const typeNode = (
										member as
											| ts.PropertyDeclaration
											| ts.PropertySignature
											| ts.MethodDeclaration
											| ts.MethodSignature
									).type
									const type = typeNode ? `: ${typeNode.getText(sourceFile)}` : ""
									signatures.push(`public ${isAsync}${name}${params}${type};`)
								}
							}
						} else if (ts.isFunctionDeclaration(decl)) {
							const isAsync = decl.modifiers?.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword)
								? "async "
								: ""
							const name = decl.name?.getText(sourceFile) || "unknown"
							const params = `(${decl.parameters.map((p) => p.getText(sourceFile)).join(", ")})`
							const type = decl.type ? `: ${decl.type.getText(sourceFile)}` : ""
							signatures.push(`export ${isAsync}function ${name}${params}${type} { /* Forensic Stub */ }`)
						}
					}

					// Find the symbol declaration
					ts.forEachChild(sourceFile, (child) => {
						if (
							ts.isClassDeclaration(child) ||
							ts.isInterfaceDeclaration(child) ||
							ts.isFunctionDeclaration(child) ||
							ts.isTypeAliasDeclaration(child)
						) {
							const namedNode = child as
								| ts.ClassDeclaration
								| ts.InterfaceDeclaration
								| ts.FunctionDeclaration
								| ts.TypeAliasDeclaration
							if (namedNode.name?.getText(sourceFile) === symbol) {
								processDeclaration(child)
							}
						}
						// Also check for 'export const X = ...'
						if (ts.isVariableStatement(child)) {
							for (const desc of child.declarationList.declarations) {
								if (desc.name.getText(sourceFile) === symbol) {
									if (
										desc.initializer &&
										(ts.isArrowFunction(desc.initializer) || ts.isFunctionExpression(desc.initializer))
									) {
										const func = desc.initializer as ts.ArrowFunction | ts.FunctionExpression
										const isAsync = func.modifiers?.some(
											(m: ts.ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword,
										)
											? "async "
											: ""
										const params = `(${func.parameters.map((p) => p.getText(sourceFile)).join(", ")})`
										const type = func.type ? `: ${func.type.getText(sourceFile)}` : ""
										signatures.push(
											`export const ${symbol} = ${isAsync}${params}${type} => { /* Forensic Stub */ };`,
										)
									}
								}
							}
						}
					})
				} catch (err) {
					Logger.error(`[RefactorHealer] Failed to extract signatures for ${symbol} from ${node.path}:`, err)
				}
			}
		}
		// Dedup signatures
		return Array.from(new Set(signatures))
	}

	/**
	 * V190: Industrial Contract Enforcement.
	 * Automatically materializes an interface file and updates the concrete class to 'implements' it.
	 */
	public async enforceContract(filePath: string, className: string): Promise<boolean> {
		const interfaceName = `I${className.charAt(0).toUpperCase()}${className.slice(1)}`
		const interfacePath = path.join("src/domain/interfaces", `${interfaceName}.ts`)
		const absoluteInterfacePath = path.resolve(this.projectRoot, interfacePath)

		try {
			// 1. Generate Interface Content
			const absolutePath = path.resolve(this.projectRoot, filePath)
			const interfaceContent = this.generateInterfaceBridge(className, absolutePath)
			await fs.mkdir(path.dirname(absoluteInterfacePath), { recursive: true })
			await fs.writeFile(absoluteInterfacePath, interfaceContent, "utf-8")

			// 2. Update Concrete Class
			let content = await fs.readFile(absolutePath, "utf-8")

			// Inject 'implements'
			content = content.replace(
				new RegExp(`export class ${className}\\b`),
				`export class ${className} implements ${interfaceName}`,
			)

			// Inject Import
			let relPath = path.relative(path.dirname(filePath), interfacePath).replace(/\.tsx?$/, "")
			if (!relPath.startsWith(".")) relPath = `./${relPath}`
			const importLine = `import { ${interfaceName} } from "${relPath}"\n`

			const lines = content.split("\n")
			// Inject after [LAYER] tag
			let insertIndex = 0
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes("[LAYER:")) {
					insertIndex = i + 1
					break
				}
			}
			lines.splice(insertIndex, 0, importLine)

			await fs.writeFile(absolutePath, lines.join("\n"), "utf-8")

			Logger.info(`[RefactorHealer] Industrial Contract Enforced: ${className} -> ${interfaceName}`)
			return true
		} catch (err) {
			Logger.error(`[RefactorHealer] Contract Enforcement failed for ${className}:`, err)
			return false
		}
	}
}
