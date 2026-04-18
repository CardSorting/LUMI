import * as fs from "fs"
import * as path from "path"
import { Logger } from "../../../shared/services/Logger.js"
import { getLayer, Layer } from "../../../utils/joy-zoning.js"

export class PathResolver {
	private dynamicAliases: Map<string, string> = new Map()
	private resolutionCache: Map<string, string | null> = new Map()
	private negativeCache: Map<string, boolean> = new Map()
	private canonicalCache: Map<string, string> = new Map()

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

	public resolveImportToNodeId(sourcePath: string, specifier: string, nodes: Set<string>): string | null {
		const cacheKey = `${sourcePath}:${specifier}`
		if (this.resolutionCache.has(cacheKey)) return this.resolutionCache.get(cacheKey) ?? null

		let result: string | null = null
		if (specifier.startsWith(".")) {
			const abs = path.resolve(this.cwd, path.dirname(sourcePath), specifier)
			const rel = this.canonicalize(abs)
			if (nodes.has(rel)) result = rel
			else if (nodes.has(`${rel}.ts`)) result = `${rel}.ts`
			else if (nodes.has(`${rel}.tsx`)) result = `${rel}.tsx`
			else {
				const indexTs = path.join(rel, "index.ts").replace(/\\/g, "/")
				if (nodes.has(indexTs)) result = indexTs
				else {
					const indexTsx = path.join(rel, "index.tsx").replace(/\\/g, "/")
					if (nodes.has(indexTsx)) result = indexTsx
				}
			}
		} else {
			for (const [alias, target] of this.dynamicAliases) {
				if (specifier.startsWith(alias)) {
					const rel = specifier.replace(alias, target).replace(/\\/g, "/")
					if (nodes.has(rel)) result = rel
					else if (nodes.has(`${rel}.ts`)) result = `${rel}.ts`
					else if (nodes.has(`${rel}.tsx`)) result = `${rel}.tsx`
					else {
						const indexTs = path.join(rel, "index.ts").replace(/\\/g, "/")
						if (nodes.has(indexTs)) result = indexTs
						else {
							const indexTsx = path.join(rel, "index.tsx").replace(/\\/g, "/")
							if (nodes.has(indexTsx)) result = indexTsx
						}
					}
					break
				}
			}
		}
		this.resolutionCache.set(cacheKey, result)
		return result
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
		const cacheKey = `${sourcePath}:${specifier}`
		if (this.negativeCache.has(cacheKey)) return false

		const diskPath = this.getDiskPath(sourcePath, specifier)
		if (diskPath) return true

		// External check fallback
		if (!specifier.startsWith(".") && !this.isProjectAlias(specifier)) return true

		this.negativeCache.set(cacheKey, true)
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
		return result
	}

	public clearCaches() {
		this.resolutionCache.clear()
		this.negativeCache.clear()
		this.canonicalCache.clear()
	}

	public clearFileFromCache(filePath: string) {
		for (const key of this.resolutionCache.keys()) {
			if (key.startsWith(`${filePath}:`)) {
				this.resolutionCache.delete(key)
			}
		}
	}

	/**
	 * V200: Substrate Boundary Enforcement.
	 * Identifies if a path is part of the internal agentic/system logic
	 * that should be excluded from the structural graph.
	 */
	public isInternalPath(p: string): boolean {
		const norm = this.canonicalize(p)
		return (
			norm.includes(".gemini") ||
			norm.includes(".spider") ||
			norm.includes("node_modules") ||
			norm.includes(".git") ||
			norm.includes("dist") ||
			norm.includes("build")
		)
	}

	/**
	 * V93: Recursive project scanning for substrate re-indexing.
	 */
	public scanProject(): string[] {
		const results: string[] = []
		const srcDir = path.join(this.cwd, "src")
		if (!fs.existsSync(srcDir)) return []

		const stack = [srcDir]
		while (stack.length > 0) {
			const dir = stack.pop()
			if (!dir) continue
			const items = fs.readdirSync(dir, { withFileTypes: true })
			for (const item of items) {
				const full = path.join(dir, item.name)
				const itemRel = path.relative(this.cwd, full).replace(/\\/g, "/")

				if (this.isInternalPath(itemRel)) continue

				if (item.isDirectory()) {
					stack.push(full)
				} else if (item.name.endsWith(".ts") || item.name.endsWith(".tsx")) {
					results.push(itemRel)
				}
			}
		}
		return results
	}
}
