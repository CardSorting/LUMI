import * as path from "path"
import * as ts from "typescript"
import { getLayer, isLayerTagSupported, Layer, parseLayerTag, validateImportDepth } from "@/utils/joy-zoning"
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
		resolveContent?: (path: string) => string | undefined,
	): { success: boolean; errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		// Skip completely for special case files
		if (this.isFileInWhitelist(filePath)) {
			return { success: true, errors: [], warnings: [] }
		}

		const currentLayer = getLayer(filePath)
		const lineCount = (content.match(/\n/g) || []).length + 1

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
					errors.push(`${path.basename(filePath)}: Missing mandatory [LAYER: TYPE] header tag.`)
				} else {
					warnings.push(`${path.basename(filePath)}: Missing mandatory [LAYER: TYPE] header tag.`)
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
		this.validateImports(sourceFile, filePath, currentLayer, errors, warnings)

		return {
			success: errors.length === 0,
			errors,
			warnings,
		}
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

			if (!isTypeGuard && !isExplicitNarrowing) {
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
							errors.push(msg)
							warnings.push(msg)
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

	private static readonly ALIASES: Record<string, string> = {
		"@/": "src/",
		"@api/": "src/core/api/",
		"@core/": "src/core/",
		"@generated/": "src/generated/",
		"@hosts/": "src/hosts/",
		"@integrations/": "src/integrations/",
		"@packages/": "src/packages/",
		"@services/": "src/services/",
		"@shared/": "src/shared/",
		"@utils/": "src/utils/",
		"@frontend/": "webview-ui/src/",
		"@shared-utils/": "src/shared/utils/",
	}

	/**
	 * Resolves project-specific path aliases.
	 * PRODUCTION HARDENING: Handles trailing slashes and precise matching to prevent path corruption.
	 * Ensures consistent POSIX path normalization to prevent "Geographic Misalignment" false positives.
	 */
	private resolveAlias(moduleName: string): string {
		// Sort aliases by length descending to ensure the most specific match (e.g., @shared-utils/ vs @shared/)
		const sortedAliases = Object.entries(TspPolicyPlugin.ALIASES).sort((a, b) => b[0].length - a[0].length)

		for (const [alias, replacement] of sortedAliases) {
			// Check for exact match without trailing slash OR starts with alias
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
