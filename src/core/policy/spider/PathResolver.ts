import * as fs from "fs"
import * as path from "path"
import { Logger } from "../../../shared/services/Logger.js"
import { getLayer, Layer } from "../../../utils/joy-zoning.js"

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
				// V160: Use surgical regex for JSON comments if strip-json-comments is missing or to avoid CJS require issues in ESM
				const cleanJson = raw.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")
				const config = JSON.parse(cleanJson)
				const paths = config.compilerOptions?.paths
				if (paths) {
					for (const [alias, targets] of Object.entries(paths)) {
						const cleanAlias = alias.replace("/*", "")
						const target = (targets as string[])[0].replace("/*", "")
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

	public resolveImportToNodeId(sourcePath: string, specifier: string, nodeIds: Map<string, any> | Set<string>): string | null {
		this.checkCacheSaturation()

		let sourceMap = this.resolutionCache.get(sourcePath)
		if (sourceMap?.has(specifier)) return sourceMap.get(specifier) ?? null

		let result: string | null = null
		if (specifier.startsWith(".")) {
			const abs = path.resolve(this.cwd, path.dirname(sourcePath), specifier)
			const rel = this.canonicalize(abs)
			if (nodeIds.has(rel)) result = rel
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
				if (specifier.startsWith(alias)) {
					const rel = specifier.replace(alias, target).replace(/\\/g, "/")
					if (nodeIds.has(rel)) result = rel
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
			this.resolutionCache.set(sourcePath, sourceMap)
		}
		sourceMap.set(specifier, result)
		return result ? this.intern(result) : null
	}

	public getDiskPath(sourcePath: string, specifier: string): string | null {
		let absPath = ""
		if (specifier.startsWith(".")) {
			absPath = path.resolve(this.cwd, path.dirname(sourcePath), specifier)
		} else {
			let resolved = false
			for (const [alias, target] of this.dynamicAliases) {
				if (specifier.startsWith(alias)) {
					absPath = path.resolve(this.cwd, specifier.replace(alias, target))
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
		let sourceMap = this.negativeCache.get(sourcePath)
		if (sourceMap?.has(specifier)) return false

		const diskPath = this.getDiskPath(sourcePath, specifier)
		if (diskPath) return true

		// External check fallback
		if (!specifier.startsWith(".") && !this.isProjectAlias(specifier)) return true

		if (!sourceMap) {
			sourceMap = new Map()
			this.negativeCache.set(sourcePath, sourceMap)
		}
		sourceMap.set(specifier, true)
		return false
	}

	private isProjectAlias(specifier: string): boolean {
		for (const alias of this.dynamicAliases.keys()) {
			if (specifier.startsWith(alias)) return true
		}
		return false
	}

	public resolveLayer(filePath: string): Layer {
		return getLayer(path.resolve(this.cwd, filePath))
	}

	public normalizePath(filePath: string): string {
		return this.canonicalize(filePath)
	}

	/**
	 * V160: High-Velocity Canonicalization.
	 * Memoized fingerprinting for extreme performance on massive structural graphs.
	 */
	public canonicalize(p: string): string {
		if (!p) return ""
		this.checkCacheSaturation()
		const cached = this.canonicalCache.get(p)
		if (cached) return cached

		let result: string
		try {
			const absolutePath = path.resolve(this.cwd, p)
			const relativePath = path.relative(this.cwd, absolutePath)
			result = relativePath.replace(/\\/g, "/").toLowerCase()
		} catch {
			result = p.replace(/\\/g, "/").toLowerCase()
		}

		this.canonicalCache.set(p, result)
		return this.intern(result)
	}

	/**
	 * V200: String Interning (Atomic Identity).
	 * Ensures that every unique path string exists exactly once in memory.
	 */
	public intern(s: string): string {
		const existing = this.stringInterner.get(s)
		if (existing) return existing
		this.stringInterner.set(s, s)
		return s
	}

	public clearCaches() {
		this.resolutionCache.clear()
		this.negativeCache.clear()
		this.canonicalCache.clear()
		this.stringInterner.clear()
	}

	public clearFileFromCache(filePath: string) {
		this.resolutionCache.delete(filePath)
		this.negativeCache.delete(filePath)
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 * Forcefully nullifies all map references to assist V8 in aggressive
	 * resource reclamation of the structural substrate.
	 */
	public dispose() {
		this.resolutionCache.clear()
		;(this.resolutionCache as any) = null

		this.negativeCache.clear()
		;(this.negativeCache as any) = null

		this.canonicalCache.clear()
		;(this.canonicalCache as any) = null

		this.stringInterner.clear()
		;(this.stringInterner as any) = null

		this.dynamicAliases.clear()
		;(this.dynamicAliases as any) = null
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
			if (normTarget === normReplacement || normTarget.startsWith(normReplacement + "/")) {
				return normTarget.replace(normReplacement, alias).replace(/\\/g, "/")
			}
		}

		return normTarget // Fallback to normalized relative path if no alias matches
	}
}
