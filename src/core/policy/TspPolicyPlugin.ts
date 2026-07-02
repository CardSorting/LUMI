import * as path from "path"
import * as ts from "typescript"
import { getLayer, isLayerTagSupported, Layer, parseLayerTag, validateImportDepth } from "@/utils/joy-zoning"
import { Logger } from "../../shared/services/Logger"
import { SpiderEngine } from "./spider/SpiderEngine"
import { detectWorkspaceArchitectureProfile, type WorkspaceArchitectureProfile } from "./WorkspaceArchitectureProfile"

/**
 * Policy Enforcement Theme: Defines the strictness level of architectural validation
 */
export type EnforcementTheme = "strict" | "relaxed" | "safety"

/**
 * Exception Rule: A pattern or filename extension that bypasses specific validation rules
 */
export interface ExceptionRule {
	type: "whitelist" | "exclusion"
	extension: string
	notes?: string
}

/**
 * Quality Score: AI-assessed quality of a large file (0-100)
 */
export interface FileQualityScore {
	score: number
	reviewed: boolean
	recommendations: string[]
}

/**
 * TspPolicyPlugin: A production-grade, configurable TypeScript Transformer that enforces
 * Joy-Zoning architectural policies at the AST level with intelligent flexibility.
 */
export class TspPolicyPlugin {
	private readonly architectureProfile: WorkspaceArchitectureProfile

	public constructor(cwd = process.cwd()) {
		this.architectureProfile = detectWorkspaceArchitectureProfile(cwd)
	}

	public getArchitectureProfile(): WorkspaceArchitectureProfile {
		return this.architectureProfile
	}

	/**
	 * Configurable enforcement theme (default: safety mode for best balance)
	 * - strict: All validation rules enforced, strict layer boundaries apply
	 * - relaxed: Only critical errors enforced, 1500-line limit applies
	 * - safety: Performance-first, only essential checks on large files
	 */
	private theme: EnforcementTheme = "safety"

	/**
	 * Exception management registry - allows dynamic addition/removal of bypass rules
	 */
	private exceptions: ExceptionRule[] = []

	/**
	 * Performance thresholds - configurable based on project testing needs
	 */
	private readonly THRESHOLDS = {
		MAX_CUSTOM_LINES: 1500,
		MAX_WARNING_LINES: 1000,
		MAX_AST_LINES: 3000, // AST processing cutoff for performance
	}

	/**
	 * Extended exception whitelist with dynamic exception management
	 * Includes platform-generated files, lockfiles, and legitimate large metadata files.
	 */
	private readonly SPECIAL_CASE_FILES: Set<string> = new Set([
		// Platform-generated project files
		"pbxproj",
		"pbxproj.parts",
		"solution",
		"vcproj",
		"vcxproj",
		"project.lock.json",

		// Build artifacts
		".turbo",
		"dist",
		"out",
		".next",
		"coverage",

		// Configuration and lockfiles
		"workspace.json",
		"tsconfig.json",
		"tsconfig.base.json",
		"tsconfig.node.json",
		"package-lock.json",
		"yarn.lock",
		"pnpm-lock.yaml",
		"bun.lockb",
		"Cargo.lock",
		"Cargo.toml",
		"go.sum",
		"go.mod",
		"gemfile.lock",
		"pipfile.lock",
		"composer.lock",
		"mix.lock",
		"poetry.lock",
		"pnpm-workspace.yaml",

		// OS and editor metadata
		".swp",
		".swo",
		".swn",
		".DS_Store",
		".gitattributes",
		".gitignore",
		".gitmodules",
		".editorconfig",
		".babelrc",
		".prettierrc",
		".eslintrc",
		".eslintignore",
		".stylelintrc",
		".postcssrc",
		"nginx.conf",
		"httpd.conf",
		"php.ini",
		".drone.yml",
		".biome",
		".editorconfig",
		".vscode",
		".vscode-test.mjs",
		"biome.json",
		"biome.jsonc",
		"knip.json",
		"vitest.config.ts",
		"playwright.config.ts",

		// Documentation and asset files
		"package.json",
		"README.md",
		"README.txt",
		"CHANGELOG.md",
		"LICENSE",
		"COPYING",
		"NOTICE",
		"MANIFEST.in",
		"VERSION",
		"BUILD",
		"Makefile",
		"docker-compose.yml",
		"docker-compose.yaml",
		"CNAME",
		"vercel.json",
		"netlify.toml",
		".env.example",

		// Generated code and wireframes
		"build.gradle",
		"build.gradle.kts",
		"settings.gradle",
		"CMakeLists.txt",
		"webpack.config.js",
		"rollup.config.js",
		"vite.config.ts",
		"next.config.js",
		"nuxt.config.ts",
		"wrangler.toml",
		"projenrc.js",
		"projenrc.ts",
		"casl.config.js",
		".umirc.ts",
	])

	/**
	 * Reset plugin to initial safe state
	 */
	public reset(): void {
		this.theme = "safety"
		this.exceptions = []
	}

	/**
	 * Set enforcement theme (strict, relaxed, safety)
	 */
	public setTheme(theme: EnforcementTheme): void {
		this.theme = theme
		Logger.info(`[JOY-ZONING] Enforcement theme set to: ${theme}`)
	}

	/**
	 * Add a file that should be completely bypassed
	 */
	public addException(extension: string, notes?: string): void {
		const rule: ExceptionRule = { type: "whitelist", extension, notes }
		this.exceptions.push(rule)
	}

	/**
	 * Checks if a file path matches any entry in the special cases whitelist (including dynamic exceptions)
	 * PRODUCTION HARDENING: Deep path inspection for third-party and generated directories.
	 */
	private isFileInWhitelist(filePath: string): boolean {
		const basename = path.basename(filePath)
		const ext = basename.split(".").pop()?.toLowerCase() || ""

		// Check extensions
		if (this.SPECIAL_CASE_FILES.has(ext)) return true

		// Check directory fragments (e.g., /node_modules/)
		const normalizedPath = filePath.replace(/\\/g, "/")
		for (const special of this.SPECIAL_CASE_FILES) {
			if (normalizedPath.includes(`/${special}/`)) return true
		}

		for (const e of this.exceptions) {
			if (e.extension === ext) return true
		}
		return false
	}

	/**
	 * Analyze a file's structure for quality scoring
	 */
	private analyzeFileStructure(content: string): FileQualityScore {
		const lineCount = (content.match(/\n/g) || []).length + 1
		const recommendations: string[] = []
		let score = 100

		if (lineCount > this.THRESHOLDS.MAX_CUSTOM_LINES) {
			score -= 20
			recommendations.push(`Large file (${lineCount} lines) detected. Maintainability may decrease.`)
		} else if (lineCount > this.THRESHOLDS.MAX_WARNING_LINES) {
			score -= 10
			recommendations.push("Consider splitting file into smaller modules if it becomes complex.")
		}

		return {
			score: Math.max(0, score),
			reviewed: true,
			recommendations,
		}
	}

	/**
	 * Analyzes a source file for architectural violations at the AST level.
	 * Returns a list of violations if any are found.
	 */
	public validateSource(
		filePath: string,
		content: string,
		_resolveContent?: (path: string) => string | undefined,
		isRecovering = false, // V9: Downgrade errors to warnings if project integrity is recovering
	): { success: boolean; errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		// V19: Fat Module Sensing (Architectural Proactivity)
		const lines = content.split("\n").length
		if (lines > 800) {
			warnings.push(
				`🐋 FAT MODULE DETECTED: ${path.basename(filePath)} has ${lines} lines. Logic density exceeds structural safety limits. ` +
					"STRATEGY: Consider splitting cohesive responsibilities through the workspace's established module pattern.",
			)
		}

		// Skip completely for special case files
		if (this.isFileInWhitelist(filePath)) {
			return { success: true, errors: [], warnings: [] }
		}

		const currentLayer = getLayer(filePath)
		const lineCount = (content.match(/\n/g) || []).length + 1

		// Blended mode keeps JoyZoning active as non-blocking design steering while
		// leaving directory taxonomy, naming, and dependency topology to the
		// established workspace.
		if (!this.architectureProfile.enforceCanonicalLayers) {
			warnings.push(...this.validateBlendedSteering(filePath, content))
			if (lineCount > this.THRESHOLDS.MAX_WARNING_LINES) {
				const quality = this.analyzeFileStructure(content)
				warnings.push(`${path.basename(filePath)}: Large file (${lineCount} lines). Quality Score: ${quality.score}/100.`)
				warnings.push(...quality.recommendations.map((recommendation) => `  - ${recommendation}`))
			}
			return { success: true, errors: [], warnings }
		}

		// Safety/Relaxed Theme logic
		if (this.theme !== "strict") {
			if (lineCount > this.THRESHOLDS.MAX_CUSTOM_LINES) {
				const quality = this.analyzeFileStructure(content)
				warnings.push(`${path.basename(filePath)}: Large file (${lineCount} lines). Quality Score: ${quality.score}/100.`)
				if (quality.recommendations.length > 0) {
					warnings.push(...quality.recommendations.map((r) => `  - ${r}`))
				}

				this.validateCriticalRules(filePath, content, currentLayer, errors, warnings)
				return { success: errors.length === 0, errors, warnings }
			}
		}

		// Standard validation path
		const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)

		// 1. Rule: Mandatory [LAYER: TYPE] Tag
		const tag = parseLayerTag(content)
		if (!tag) {
			if (isLayerTagSupported(filePath, content)) {
				if (this.theme === "strict") {
					errors.push(
						`${path.basename(filePath)}: Missing mandatory [LAYER: TYPE] header tag. REMEDIATION: Add '/** [LAYER: ${currentLayer.toUpperCase()}] */' at the top of the file.`,
					)
				} else {
					warnings.push(
						`${path.basename(filePath)}: Missing mandatory [LAYER: TYPE] header tag. REMEDIATION: Add '/** [LAYER: ${currentLayer.toUpperCase()}] */' at the top of the file.`,
					)
				}
			}
		} else if (tag !== currentLayer) {
			errors.push(
				`${path.basename(filePath)}: Geographic Misalignment — Tag [LAYER: ${tag.toUpperCase()}] does not match path layer '${currentLayer}'.`,
			)
		}

		// 2. Rule: Import Depth Validation
		const depthErrors = validateImportDepth(filePath, content)
		errors.push(...depthErrors)

		// 3. Rule: 'any' types (warning only)
		if (currentLayer === "domain" || currentLayer === "infrastructure") {
			this.findAnyTypes(sourceFile, currentLayer, warnings)
		}

		// 4. Rule: Single Class per file in Domain
		if (currentLayer === "domain") {
			const classCount = this.countClasses(sourceFile)
			if (classCount > 1) {
				warnings.push(`Domain layer should ideally have one class per file — found ${classCount}.`)
			}
		}

		// 5. Rule: Layered Import Constraints
		this.validateImports(sourceFile, filePath, currentLayer, errors, warnings, isRecovering)

		// 6. Rule: Contractual Sovereignty (v12)
		if (currentLayer === "domain" || currentLayer === "core") {
			this.validateContractualIntegrity(filePath, content, errors, warnings)
		}

		return {
			success: errors.length === 0,
			errors,
			warnings,
		}
	}

	/**
	 * Applies topology-neutral JoyZoning guidance to established workspaces.
	 * These checks never reject a write or prescribe canonical directories.
	 */
	private validateBlendedSteering(filePath: string, content: string): string[] {
		if (this.isTestFile(filePath) || this.isGeneratedContent(content)) return []

		const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)
		const warnings: string[] = []
		const units: Array<{ name: string; body: ts.Block }> = []

		const collectUnits = (node: ts.Node) => {
			if (ts.isFunctionDeclaration(node) && node.body) {
				units.push({ name: node.name?.text || "anonymous function", body: node.body })
			} else if (ts.isMethodDeclaration(node) && node.body) {
				units.push({ name: node.name.getText(sourceFile), body: node.body })
			} else if (ts.isConstructorDeclaration(node) && node.body) {
				units.push({ name: "constructor", body: node.body })
			} else if (
				ts.isVariableDeclaration(node) &&
				node.initializer &&
				(ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
				ts.isBlock(node.initializer.body)
			) {
				units.push({ name: node.name.getText(sourceFile), body: node.initializer.body })
			}
			ts.forEachChild(node, collectUnits)
		}
		collectUnits(sourceFile)

		for (const unit of units) {
			const startLine = sourceFile.getLineAndCharacterOfPosition(unit.body.getStart(sourceFile)).line
			const endLine = sourceFile.getLineAndCharacterOfPosition(unit.body.getEnd()).line
			const lineCount = endLine - startLine + 1
			const metrics = this.measureDecisionAndEffects(unit.body, sourceFile)

			if (lineCount > this.architectureProfile.steeringThresholds.maxFunctionLines) {
				warnings.push(
					`[JOY STEERING JZ-C01: COHESION] ${unit.name} spans ${lineCount} lines. Keep its workspace-native placement, but consider extracting one coherent responsibility using nearby project patterns.`,
				)
			}

			if (
				lineCount >= this.architectureProfile.steeringThresholds.minBoundaryLines &&
				metrics.decisions >= this.architectureProfile.steeringThresholds.minBoundaryDecisions &&
				metrics.externalEffects > 0
			) {
				warnings.push(
					`[JOY STEERING JZ-B01: BOUNDARY] ${unit.name} combines ${metrics.decisions} decision points with ${metrics.externalEffects} external-effect call(s). Mirror the workspace's existing boundary seam, then keep the decision portion independently testable where practical.`,
				)
			}
		}

		const inspectClass = (node: ts.Node) => {
			if (ts.isClassDeclaration(node) && node.name) {
				const methodCount = node.members.filter((member) => ts.isMethodDeclaration(member)).length
				if (methodCount > this.architectureProfile.steeringThresholds.maxClassMethods) {
					warnings.push(
						`[JOY STEERING JZ-O01: OWNERSHIP] ${node.name.text} exposes ${methodCount} methods. Preserve local class conventions, but verify that it still represents one cohesive capability.`,
					)
				}
			}
			ts.forEachChild(node, inspectClass)
		}
		inspectClass(sourceFile)

		return warnings
	}

	private measureDecisionAndEffects(body: ts.Block, sourceFile: ts.SourceFile) {
		let decisions = 0
		let externalEffects = 0
		const effectPattern =
			/(?:^|\.)(?:fetch|request|query|execute|save|send|publish|emit|readFile|writeFile|appendFile|now|random)\b|\b(?:axios|fs|database|repository|process)\./i

		const visit = (node: ts.Node) => {
			if (node !== body && this.isNestedFunction(node)) return
			if (
				ts.isIfStatement(node) ||
				ts.isSwitchStatement(node) ||
				ts.isConditionalExpression(node) ||
				ts.isForStatement(node) ||
				ts.isForInStatement(node) ||
				ts.isForOfStatement(node) ||
				ts.isWhileStatement(node) ||
				ts.isDoStatement(node) ||
				ts.isCatchClause(node)
			)
				decisions++
			if (ts.isCallExpression(node) && effectPattern.test(node.expression.getText(sourceFile))) {
				externalEffects++
			}
			ts.forEachChild(node, visit)
		}
		visit(body)
		return { decisions, externalEffects }
	}

	private isNestedFunction(node: ts.Node): boolean {
		return (
			ts.isFunctionDeclaration(node) ||
			ts.isFunctionExpression(node) ||
			ts.isArrowFunction(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isConstructorDeclaration(node)
		)
	}

	private isTestFile(filePath: string): boolean {
		const normalized = filePath.replace(/\\/g, "/").toLowerCase()
		return /(?:^|\/)(?:__tests__|test|tests)\//.test(normalized) || /\.(?:test|spec)\.[^.]+$/.test(normalized)
	}

	private isGeneratedContent(content: string): boolean {
		const header = content.slice(0, 5000)
		return ["@generated", "Code generated by", "DO NOT EDIT", "Automatically generated"].some((marker) =>
			header.includes(marker),
		)
	}

	/**
	 * Validates only CRITICAL rules for large files.
	 */
	private validateCriticalRules(
		filePath: string,
		content: string,
		_currentLayer: string,
		errors: string[],
		warnings: string[],
	) {
		const tag = parseLayerTag(content)
		if (!tag && isLayerTagSupported(filePath, content) && this.theme === "strict") {
			errors.push(`${path.basename(filePath)}: Missing mandatory [LAYER: TYPE] header tag.`)
		}

		const importPattern = /import\s+from\s+['"]@api\/|['"]@core\/|['"]@infrastructure\//g
		if (importPattern.test(content)) {
			warnings.push(`${path.basename(filePath)}: Large file has complex imports — verify layer boundaries.`)
		}
	}

	public findCrossLayerViolations(sourceFile: ts.SourceFile, filePath: string): string[] {
		if (!this.architectureProfile.enforceCanonicalLayers) return []

		const violations: string[] = []
		const currentLayer = getLayer(filePath)
		this.validateImports(sourceFile, filePath, currentLayer, [], violations)
		return violations
	}

	/**
	 * Recursively finds 'any' keyword usage.
	 * PRODUCTION HARDENING: Ignores 'any' in type guards, unknown-casts, and unit test files to prevent false positives.
	 */
	private findAnyTypes(node: ts.Node, layer: string, warnings: string[]) {
		const sourceFile = node.getSourceFile()
		const fileName = sourceFile.fileName.toLowerCase()

		// PRODUCTION HARDENING: Ignore 'any' types in unit tests as they are often required for mocking/probing.
		if (
			fileName.endsWith(".test.ts") ||
			fileName.endsWith(".spec.ts") ||
			fileName.endsWith(".test.tsx") ||
			fileName.endsWith(".spec.tsx") ||
			fileName.includes("/__tests__/") ||
			fileName.includes("/tests/")
		) {
			return
		}

		if (node.kind === ts.SyntaxKind.AnyKeyword) {
			// Check if parent is a type guard or cast to unknown
			const parent = node.parent
			const isTypeGuard = parent && ts.isTypePredicateNode(parent)

			// PRODUCTION HARDENING: Contextual leniency for explicit type-narrowing blocks.
			// Skip if it's 'as unknown as any' or similar common narrowing patterns.
			// This allows expert developers to perform necessary type casting without noise.
			const isExplicitNarrowing =
				parent &&
				(ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) &&
				(parent.getText().includes("unknown") ||
					parent.getText().includes("any as") ||
					parent.getText().includes("as any"))

			const isIgnored = sourceFile.text.includes("@sovereign-ignore any-type")

			if (!isTypeGuard && !isExplicitNarrowing && !isIgnored) {
				const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
				warnings.push(`'any' type in ${layer.toUpperCase()} layer (line ${line + 1}).`)
			}
		}
		ts.forEachChild(node, (child) => this.findAnyTypes(child, layer, warnings))
	}

	/**
	 * Counts top-level classes in a source file.
	 */
	private countClasses(sourceFile: ts.SourceFile): number {
		let count = 0
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isClassDeclaration(node)) {
				count++
			}
		})
		return count
	}

	/**
	 * Validates imports against Joy-Zoning rules.
	 */
	private validateImports(
		sourceFile: ts.SourceFile,
		filePath: string,
		currentLayer: Layer,
		errors: string[],
		warnings: string[],
		isRecovering = false,
	) {
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isImportDeclaration(node)) {
				const moduleSpecifier = node.moduleSpecifier
				if (ts.isStringLiteral(moduleSpecifier)) {
					const moduleName = moduleSpecifier.text

					let targetPath = moduleName
					if (moduleName.startsWith(".")) {
						targetPath = path.resolve(path.dirname(filePath), moduleName)
					} else {
						targetPath = this.resolveAlias(moduleName)
					}

					const targetLayer = getLayer(targetPath)

					if (currentLayer === "domain") {
						if (targetLayer === "infrastructure" || targetLayer === "ui") {
							const msg = `Domain layer cannot import '${moduleName}' (${targetLayer} layer).`
							if (isRecovering) {
								warnings.push(`${msg} (Leniency applied during recovery)`)
							} else {
								errors.push(msg)
								warnings.push(msg)
							}
						}
					}

					if (currentLayer === "core" && targetLayer === "ui") {
						const msg = `Core layer cannot import UI component '${moduleName}'.`
						if (isRecovering) {
							warnings.push(`${msg} (Leniency applied during recovery)`)
						} else {
							errors.push(msg)
						}
					}

					if (currentLayer === "ui" && targetLayer === "infrastructure") {
						const msg = `UI cannot directly import Infrastructure '${moduleName}'.`
						if (isRecovering) {
							warnings.push(`${msg} (Leniency applied during recovery)`)
						} else {
							errors.push(msg)
						}
					}
				}
			}
		})
	}

	/**
	 * PRODUCTION HARDENING: Validates that critical modules have corresponding interfaces.
	 * Enforces Dependency Inversion at the architectural boundary.
	 */
	private validateContractualIntegrity(filePath: string, content: string, _errors: string[], warnings: string[]) {
		const baseName = path.basename(filePath).split(".")[0]
		// Skip index files and types
		if (baseName === "index" || filePath.includes("/interfaces/") || filePath.includes("/types/")) return

		const interfaceName = `I${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}`
		const expectedInterfacePath = `src/domain/interfaces/${interfaceName}.ts`

		// Heuristic: If it exports a class, it MUST have a contract
		const isIgnored = content.includes("@sovereign-ignore contractual-integrity")
		if (content.includes("export class ") && !content.includes(`implements ${interfaceName}`) && !isIgnored) {
			const remediation = `export class ${baseName} implements ${interfaceName} { ... }`
			warnings.push(
				`📜 CONTRACTLESS BREACH: Module ${baseName} exports concrete logic without a formal contract in ${expectedInterfacePath}.\n` +
					`REMEDIATION: Extract interface '${interfaceName}' and use 'implements'. Snippet: ${remediation}`,
			)
		}
	}

	/**
	 * Resolves project-specific path aliases.
	 * PRODUCTION HARDENING: Handles trailing slashes and precise matching to prevent path corruption.
	 * Ensures consistent POSIX path normalization to prevent "Geographic Misalignment" false positives.
	 */
	private resolveAlias(moduleName: string): string {
		// V9: Use centralized aliases from SpiderEngine
		const globalAliases = SpiderEngine.getGlobalAliases()
		const sortedAliases = Object.entries(globalAliases).sort((a, b) => b[0].length - a[0].length)

		for (const [alias, replacement] of sortedAliases) {
			if (moduleName === alias.slice(0, -1) || moduleName.startsWith(alias)) {
				const suffix = moduleName.startsWith(alias) ? moduleName.substring(alias.length) : ""
				return path.join(replacement, suffix).replace(/\\/g, "/")
			}
		}

		// Fallback: ensure POSIX consistency even if no alias matches
		return moduleName.replace(/\\/g, "/")
	}

	/**
	 * Creates a TypeScript Transformer factory for Joy-Zoning.
	 */
	public createTransformer(): ts.TransformerFactory<ts.SourceFile> {
		return (_context: ts.TransformationContext) => {
			return (sourceFile: ts.SourceFile) => {
				const filePath = sourceFile.fileName
				const validation = this.validateSource(filePath, sourceFile.getText())

				if (!validation.success || validation.warnings.length > 0) {
					Logger.warn(
						`[JOY-ZONING] Issues in ${filePath}:\n${[...validation.errors, ...validation.warnings].join("\n")}`,
					)
				}

				return sourceFile
			}
		}
	}
}
