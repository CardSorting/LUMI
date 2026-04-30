import * as fs from "fs"
import * as path from "path"
import { Logger } from "../../../shared/services/Logger.js"
import { getLayer, Layer } from "../../../utils/joy-zoning.js"

const asNonEmptyString = (value: unknown): string | null => {
	if (typeof value !== "string") return null
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : null
}

export class PathResolver {
	private dynamicAliases: Map<string, string> = new Map()
	private resolutionCache: Map<string, Map<string, string | null>> = new Map()
	private negativeCache: Map<string, Map<string, boolean>> = new Map()
	private canonicalCache: Map<string, string> = new Map()
	private stringInterner: Map<string, string> = new Map() // V200: Memory deduplication core

	constructor(
		private cwd: string,
		defaultAliases?: Record<string, string>,
	) {
		if (defaultAliases) {
			for (const [alias, target] of Object.entries(defaultAliases)) {
				this.dynamicAliases.set(alias, target)
			}
		}
		this.loadProjectAliases()
	}

	public loadProjectAliases() {
		const tsconfigPath = path.join(this.cwd, "tsconfig.json")
		if (fs.existsSync(tsconfigPath)) {
			try {
				const raw = fs.readFileSync(tsconfigPath, "utf-8")
				// V160: Industrial JSON sanitization (String-aware)
				// Strips comments while respecting quoted strings
				const cleanJson = raw.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g1) => g1 ? "" : m)
					.replace(/,(\s*[}\]])/g, "$1")
				const config = JSON.parse(cleanJson)
				const paths = config.compilerOptions?.paths
				if (paths) {
					for (const [alias, targets] of Object.entries(paths)) {
						if (!Array.isArray(targets) || targets.length === 0) continue
						const cleanAlias = alias.replace("/*", "")
						const target = targets[0].replace("/*", "")
						this.dynamicAliases.set(cleanAlias, target)
					}
					Logger.info(`[PathResolver] Dynamically loaded ${this.dynamicAliases.size} aliases from tsconfig.json.`)
				}
			} catch (e) {
				Logger.warn("[PathResolver] Failed to parse tsconfig.json for dynamic aliases:", e)
			}
		}
		if (!this.dynamicAliases.has("@/")) {
			this.dynamicAliases.set("@/", "src/")
		}
	}

	/**
	 * V340: Recursive Transitive Resolution.
	 * Resolves an import specifier to its final physical Node ID.
	 * Now follows 'export *' re-exports to ensure that transitive consumers are
	 * correctly mapped to their ultimate producers.
	 */
	public resolveImportToNodeId(
		sourcePath: string,
		specifier: string,
		nodeIds: Map<string, any> | Set<string>,
		visited: Set<string> = new Set(),
	): string | null {
		const safeSourcePath = asNonEmptyString(sourcePath)
		const safeSpecifier = asNonEmptyString(specifier)
		if (!safeSourcePath || !safeSpecifier) return null

		this.checkCacheSaturation()

		let sourceMap = this.resolutionCache.get(safeSourcePath)
		if (sourceMap?.has(safeSpecifier)) return sourceMap.get(safeSpecifier) ?? null

		let result: string | null = null
		if (safeSpecifier.startsWith(".")) {
			const abs = path.resolve(this.cwd, path.dirname(safeSourcePath), safeSpecifier)
			const rel = this.canonicalize(abs)
			if (nodeIds instanceof Set ? nodeIds.has(rel) : nodeIds.has(rel)) result = rel
			else if (nodeIds.has(`${rel}.ts`)) result = `${rel}.ts`
			else if (nodeIds.has(`${rel}.tsx`)) result = `${rel}.tsx`
			else {
				const indexTs = path.join(rel, "index.ts").replace(/\\/g, "/")
				if (nodeIds.has(indexTs)) result = indexTs
				else {
					const indexTsx = path.join(rel, "index.tsx").replace(/\\/g, "/")
					if (nodeIds.has(indexTsx)) result = indexTsx
				}
			}
		} else {
			for (const [alias, target] of this.dynamicAliases) {
				if (safeSpecifier.startsWith(alias)) {
					const rel = safeSpecifier.replace(alias, target).replace(/\\/g, "/")
					if (nodeIds instanceof Set ? nodeIds.has(rel) : nodeIds.has(rel)) result = rel
					else if (nodeIds.has(`${rel}.ts`)) result = `${rel}.ts`
					else if (nodeIds.has(`${rel}.tsx`)) result = `${rel}.tsx`
					else {
						const indexTs = path.join(rel, "index.ts").replace(/\\/g, "/")
						if (nodeIds.has(indexTs)) result = indexTs
						else {
							const indexTsx = path.join(rel, "index.tsx").replace(/\\/g, "/")
							if (nodeIds.has(indexTsx)) result = indexTsx
						}
					}
					break
				}
			}
		}

		if (!sourceMap) {
			sourceMap = new Map()
			this.resolutionCache.set(safeSourcePath, sourceMap)
		}
		sourceMap.set(safeSpecifier, result)
		return result ? this.intern(result) : null
	}

	public getDiskPath(sourcePath: string, specifier: string): string | null {
		const safeSourcePath = asNonEmptyString(sourcePath)
		const safeSpecifier = asNonEmptyString(specifier)
		if (!safeSourcePath || !safeSpecifier) return null

		let absPath = ""
		if (safeSpecifier.startsWith(".")) {
			absPath = path.resolve(this.cwd, path.dirname(safeSourcePath), safeSpecifier)
		} else {
			let resolved = false
			for (const [alias, target] of this.dynamicAliases) {
				if (safeSpecifier.startsWith(alias)) {
					absPath = path.resolve(this.cwd, safeSpecifier.replace(alias, target))
					resolved = true
					break
				}
			}
			if (!resolved) return null
		}

		// V18: Standardized extension retry logic across all engines
		const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]
		for (const ext of extensions) {
			const full = (absPath.endsWith("/") && ext.startsWith("/") ? absPath.slice(0, -1) : absPath) + ext
			if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
		}
		return null
	}

	public verifyOnDisk(sourcePath: string, specifier: string): boolean {
		const safeSourcePath = asNonEmptyString(sourcePath)
		const safeSpecifier = asNonEmptyString(specifier)
		if (!safeSourcePath || !safeSpecifier) return false

		let sourceMap = this.negativeCache.get(safeSourcePath)
		if (sourceMap?.has(safeSpecifier)) return false

		const diskPath = this.getDiskPath(safeSourcePath, safeSpecifier)
		if (diskPath) return true

		// External check fallback
		if (!safeSpecifier.startsWith(".") && !this.isProjectAlias(safeSpecifier)) return true

		if (!sourceMap) {
			sourceMap = new Map()
			this.negativeCache.set(safeSourcePath, sourceMap)
		}
		sourceMap.set(safeSpecifier, true)
		return false
	}

	public isProjectAlias(specifier: string): boolean {
		const safeSpecifier = asNonEmptyString(specifier)
		if (!safeSpecifier) return false
		for (const alias of this.dynamicAliases.keys()) {
			if (safeSpecifier.startsWith(alias)) return true
		}
		return false
	}

	public resolveLayer(filePath: string): Layer {
		return getLayer(path.resolve(this.cwd, asNonEmptyString(filePath) ?? ""))
	}

	public normalizePath(filePath: string): string {
		return this.canonicalize(filePath)
	}

	/**
	 * V160: High-Velocity Canonicalization.
	 * Memoized fingerprinting for extreme performance on massive structural graphs.
	 */
	public canonicalize(p: string): string {
		const safePath = asNonEmptyString(p)
		if (!safePath) return ""
		this.checkCacheSaturation()
		const cached = this.canonicalCache.get(safePath)
		if (cached) return cached

		let result: string
		try {
			const absolutePath = path.resolve(this.cwd, safePath)
			const relativePath = path.relative(this.cwd, absolutePath)
			result = relativePath.replace(/\\/g, "/").toLowerCase()
		} catch {
			result = safePath.replace(/\\/g, "/").toLowerCase()
		}

		this.canonicalCache.set(safePath, result)
		return this.intern(result)
	}

	/**
	 * V200: String Interning (Atomic Identity).
	 * Ensures that every unique path string exists exactly once in memory.
	 */
	public intern(s: string): string {
		const safeString = asNonEmptyString(s)
		if (!safeString) return ""
		const existing = this.stringInterner.get(safeString)
		if (existing) return existing
		this.stringInterner.set(safeString, safeString)
		return safeString
	}

	/**
	 * V215: Incremental Cache Purge.
	 * Removes all cached resolutions originating from a specific file.
	 */
	public clearFileFromCache(filePath: string) {
		this.resolutionCache.delete(filePath)
		this.negativeCache.delete(filePath)
	}

	public clearCaches() {
		this.resolutionCache.clear()
		this.negativeCache.clear()
		this.canonicalCache.clear()
		this.stringInterner.clear()
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 * Forcefully clears all map references to assist V8 in resource reclamation.
	 */
	public dispose() {
		this.resolutionCache.clear()
		this.negativeCache.clear()
		this.canonicalCache.clear()
		this.stringInterner.clear()
		this.dynamicAliases.clear()
	}

	/**
	 * V200: Cache Saturation Floor.
	 * Prevents indefinite memory growth in massive projects.
	 */
	private checkCacheSaturation() {
		const MAX_ENTRIES = 5000
		if (this.resolutionCache.size > MAX_ENTRIES) {
			this.resolutionCache.clear()
			Logger.info("[PathResolver] Resolution cache saturated. Metaphorical sweep performed.")
		}
		if (this.canonicalCache.size > MAX_ENTRIES) {
			this.canonicalCache.clear()
			Logger.info("[PathResolver] Canonical cache saturated. Metaphorical sweep performed.")
		}
		if (this.stringInterner.size > MAX_ENTRIES) {
			this.stringInterner.clear()
			Logger.info("[PathResolver] String interner saturated. Metaphorical sweep performed.")
		}
	}

	/**
	 * V200: Substrate Boundary Enforcement.
	 * Identifies if a path is part of the internal agentic/system logic
	 * that should be excluded from the structural graph.
	 */
	public isInternalPath(p: string): boolean {
		const norm = this.canonicalize(p)
		const segments = norm.split("/")

		// Exclude known system/agentic directories at any level
		const excludedFolders = [".gemini", ".spider", "node_modules", ".git", "dist", "build", "out", "target"]
		if (segments.some((s) => excludedFolders.includes(s))) return true

		// Exclude non-code assets
		const excludedExts = [
			".png",
			".jpg",
			".jpeg",
			".gif",
			".svg",
			".ico",
			".woff",
			".woff2",
			".ttf",
			".eot",
			".mp4",
			".wav",
			".mp3",
		]
		if (excludedExts.some((ext) => norm.endsWith(ext))) return true

		return false
	}

	/**
	 * V93: Recursive project scanning for substrate re-indexing.
	 */
	public scanProject(): string[] {
		const results: string[] = []
		// V205: Adaptive Root Discovery. Scan 'src' if it exists, otherwise scan the root.
		const startDir = fs.existsSync(path.join(this.cwd, "src")) ? path.join(this.cwd, "src") : this.cwd

		const stack = [startDir]
		while (stack.length > 0) {
			const dir = stack.pop()
			if (!dir) continue
			try {
				const items = fs.readdirSync(dir, { withFileTypes: true })
				for (const item of items) {
					const full = path.join(dir, item.name)
					const itemRel = path.relative(this.cwd, full).replace(/\\/g, "/")

					if (this.isInternalPath(itemRel)) continue

					if (item.isDirectory()) {
						stack.push(full)
					} else if (
						item.name.endsWith(".ts") ||
						item.name.endsWith(".tsx") ||
						item.name.endsWith(".js") ||
						item.name.endsWith(".jsx")
					) {
						results.push(itemRel)
					}
				}
			} catch (e) {
				Logger.warn(`[PathResolver] Failed to scan directory ${dir}:`, e)
			}
		}
		return results
	}

	/**
	 * V204: Deterministic Alias Resolution.
	 * Calculates the most concise alias-based import string for any file in the project.
	 * Prefers deep aliases (@api/, @shared-utils/) over root aliases (@/).
	 */
	public getBestAlias(targetPath: string): string {
		const normTarget = this.canonicalize(targetPath)
		const sortedAliases = Array.from(this.dynamicAliases.entries()).sort((a, b) => b[1].length - a[1].length)

		for (const [alias, replacement] of sortedAliases) {
			const normReplacement = this.canonicalize(replacement)
			if (normTarget === normReplacement || normTarget.startsWith(`${normReplacement}/`)) {
				const result = normTarget.replace(normReplacement, alias).replace(/\\/g, "/")
				// V215: Prevent double-slashes (e.g. @//core -> @/core)
				return result.replace(/\/+/g, "/")
			}
		}

		return normTarget // Fallback to normalized relative path if no alias matches
	}
}
