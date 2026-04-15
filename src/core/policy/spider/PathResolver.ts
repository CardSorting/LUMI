import * as fs from "fs"
import * as path from "path"
import { Logger } from "../../../shared/services/Logger.js"
import { getLayer, Layer } from "../../../utils/joy-zoning.js"

export class PathResolver {
	private dynamicAliases: Map<string, string> = new Map()
	private resolutionCache: Map<string, string | null> = new Map()
	private negativeCache: Map<string, boolean> = new Map()

	constructor(private cwd: string) {
		this.loadProjectAliases()
	}

	public loadProjectAliases() {
		const tsconfigPath = path.join(this.cwd, "tsconfig.json")
		if (fs.existsSync(tsconfigPath)) {
			try {
				const raw = fs.readFileSync(tsconfigPath, "utf-8")
				const config = JSON.parse(require("strip-json-comments")(raw))
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
			const rel = path.relative(this.cwd, abs).replace(/\\/g, "/")
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
			for (const [alias, target] of this.dynamicAliases.entries()) {
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
			for (const [alias, target] of this.dynamicAliases.entries()) {
				if (specifier.startsWith(alias)) {
					absPath = path.resolve(this.cwd, specifier.replace(alias, target))
					resolved = true
					break
				}
			}
			if (!resolved) return null
		}

		const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]
		for (const ext of extensions) {
			const full = absPath + ext
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
		try {
			const absolutePath = path.resolve(this.cwd, filePath)
			const relativePath = path.relative(this.cwd, absolutePath)
			return relativePath.replace(/\\/g, "/")
		} catch {
			return filePath.replace(/\\/g, "/")
		}
	}

	public clearCaches() {
		this.resolutionCache.clear()
		this.negativeCache.clear()
	}

	public clearFileFromCache(filePath: string) {
		for (const key of this.resolutionCache.keys()) {
			if (key.startsWith(`${filePath}:`)) {
				this.resolutionCache.delete(key)
			}
		}
	}
}
