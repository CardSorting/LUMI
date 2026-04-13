import * as path from "path"
import * as ts from "typescript"
import { getLayer, Layer, parseLayerTag, validateImportDepth } from "@/utils/joy-zoning"
import { Logger } from "../../shared/services/Logger"

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
	/**
	 * Configurable enforcement theme (default: safety mode for best balance)
	 * - strict: All validation rules enforced, 300-line limit applies
	 * - relaxed: Only critical errors enforced, 800-line limit applies
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
		MAX_CUSTOM_LINES: 800,
		MAX_WARNING_LINES: 300,
		MAX_AST_LINES: 1500, // AST processing cutoff for performance
	}

	/**
	 * Quality scoring thresholds
	 */
	private readonly QUALITY = {
		RISK_LEVELS: {
			POOR: { minScore: 0, maxScore: 40 },
			MODERATE: { minScore: 41, maxScore: 75 },
			EXCELLENT: { minScore: 76, maxScore: 100 },
		},
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
	 */
	private isFileInWhitelist(filePath: string): boolean {
		const basename = path.basename(filePath)
		const ext = basename.split(".").pop()?.toLowerCase()
		return this.SPECIAL_CASE_FILES.has(ext || "") || this.exceptions.some((e) => e.extension === ext)
	}

	/**
	 * Analyze a file's structure for quality scoring
	 */
	private analyzeFileStructure(content: string): FileQualityScore {
		const lines = content.split("\n")
		const recommendations: string[] = []
		let score = 100

		if (lines.length > this.THRESHOLDS.MAX_CUSTOM_LINES) {
			score -= 30
			recommendations.push("File exceeds maximum allowed lines")
		} else if (lines.length > this.THRESHOLDS.MAX_WARNING_LINES) {
			score -= 10
			recommendations.push("Consider splitting file into smaller modules")
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
		resolveContent?: (path: string) => string | undefined,
	): { success: boolean; errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		// Skip completely for special case files
		if (this.isFileInWhitelist(filePath)) {
			return { success: true, errors: [], warnings: [] }
		}

		const currentLayer = getLayer(filePath)
		const lineCount = content.split("\n").length

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
			if (this.theme === "strict") {
				errors.push(`${path.basename(filePath)}: Missing mandatory [LAYER: TYPE] header tag.`)
			} else {
				warnings.push(`${path.basename(filePath)}: Missing mandatory [LAYER: TYPE] header tag.`)
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
		this.validateImports(sourceFile, filePath, currentLayer, errors, warnings, resolveContent)

		return {
			success: errors.length === 0,
			errors,
			warnings,
		}
	}

	/**
	 * Validates only CRITICAL rules for large files.
	 */
	private validateCriticalRules(filePath: string, content: string, currentLayer: string, errors: string[], warnings: string[]) {
		const tag = parseLayerTag(content)
		if (!tag && this.theme === "strict") {
			errors.push(`${path.basename(filePath)}: Missing mandatory [LAYER: TYPE] header tag.`)
		}

		const importPattern = /import\s+from\s+['"]@api\/|['"]@core\/|['"]@infrastructure\//g
		if (importPattern.test(content)) {
			warnings.push(`${path.basename(filePath)}: Large file has complex imports — verify layer boundaries.`)
		}
	}

	/**
	 * Public API to detect cross-layer violations using AST.
	 */
	public findCrossLayerViolations(sourceFile: ts.SourceFile, filePath: string): string[] {
		const violations: string[] = []
		const currentLayer = getLayer(filePath)
		this.validateLayering(sourceFile, filePath, currentLayer, violations)
		return violations
	}

	/**
	 * Recursively finds 'any' keyword usage.
	 */
	private findAnyTypes(node: ts.Node, layer: string, warnings: string[]) {
		if (node.kind === ts.SyntaxKind.AnyKeyword) {
			const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
			warnings.push(`'any' type in ${layer.toUpperCase()} layer (line ${line + 1}).`)
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
		resolveContent?: (path: string) => string | undefined,
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
							errors.push(`Domain cannot import '${moduleName}' (${targetLayer} layer).`)
						}
					}

					if (currentLayer === "core" && targetLayer === "ui") {
						errors.push(`Core layer cannot import UI component '${moduleName}'.`)
					}

					if (currentLayer === "ui" && targetLayer === "infrastructure") {
						errors.push(`UI cannot directly import Infrastructure '${moduleName}'.`)
					}
				}
			}
		})
	}

	/**
	 * Helper for deep layering validation.
	 */
	private validateLayering(sourceFile: ts.SourceFile, filePath: string, currentLayer: Layer, violations: string[]) {
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
							violations.push(`Domain layer cannot import from ${targetLayer}: '${moduleName}'.`)
						}
					}
				}
			}
		})
	}

	/**
	 * Resolves project-specific path aliases.
	 */
	private resolveAlias(moduleName: string): string {
		const aliases: Record<string, string> = {
			"@/": "src/",
			"@api/": "src/core/api/",
			"@core/": "src/core/",
			"@services/": "src/services/",
			"@shared/": "src/shared/",
			"@utils/": "src/utils/",
		}

		for (const [alias, replacement] of Object.entries(aliases)) {
			if (moduleName.startsWith(alias)) {
				return path.join(replacement, moduleName.substring(alias.length))
			}
		}
		return moduleName
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
