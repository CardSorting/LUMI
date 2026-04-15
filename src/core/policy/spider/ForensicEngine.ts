import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import { PathResolver } from "./PathResolver.js"
import { SpiderNode } from "./types.js"

export class ForensicEngine {
	private ghostVerificationCache: Map<string, { hash: string; ghosts: string[] }> = new Map()

	constructor(
		private cwd: string,
		private resolver: PathResolver,
	) {}

	public findGhosts(nodes: Map<string, SpiderNode>): Set<string> {
		const allGhosts = new Set<string>()
		for (const node of nodes.values()) {
			const absPath = path.resolve(this.cwd, node.path)
			if (!fs.existsSync(absPath)) continue

			const content = fs.readFileSync(absPath, "utf-8")
			const currentHash = crypto.createHash("md5").update(content).digest("hex")

			const cached = this.ghostVerificationCache.get(node.path)
			if (cached && cached.hash === currentHash) {
				cached.ghosts.forEach((g) => {
					allGhosts.add(g)
				})
				continue
			}

			const nodeGhosts: string[] = []
			const sourceFile = ts.createSourceFile(node.path, content, ts.ScriptTarget.Latest, true)
			const imports = this.getImportedSymbols(sourceFile)
			const hasGhostException = content.includes("[SOVEREIGN_EXCEPTION: Ghost Symbols]")

			for (const { specifier, symbols } of imports) {
				const diskPath = this.resolver.getDiskPath(node.path, specifier)
				const targetId = this.resolver.resolveImportToNodeId(node.path, specifier, new Set(nodes.keys()))

				if (!diskPath) {
					// PRODUCTION HARDENING: Ignore ghost files for common build/config files in root
					if (!specifier.startsWith(".") && !this.isProjectAlias(specifier)) continue
					if (specifier.endsWith(".config.js") || specifier.endsWith(".config.ts")) continue
					if (specifier.endsWith(".config.js") || specifier.endsWith(".config.ts")) continue

					const msg = `[SPI-101] GHOST FILE: ${node.path} -> ${specifier}`
					allGhosts.add(msg)
					nodeGhosts.push(msg)
				} else if (symbols.length > 0 && !hasGhostException) {
					// V16: Use Node exports for high-precision verification
					const targetNode = targetId ? nodes.get(targetId) : null

					if (targetNode) {
						for (const symbol of symbols) {
							if (symbol === "*" || targetNode.exports.includes(symbol)) continue

							const msg = `[SPI-102] GHOST SYMBOL: ${node.path} -> ${symbol} from ${specifier}`
							allGhosts.add(msg)
							nodeGhosts.push(msg)
						}
					} else {
						// Fallback to disk-based verification (legacy with hardened regex)
						try {
							const targetContent = fs.readFileSync(diskPath, "utf-8")
							for (const symbol of symbols) {
								if (symbol === "*") continue
								// V16: Hardened regex to avoid false positives for complex export patterns
								const exportPattern = new RegExp(
									`export\\s+(?:const|class|interface|type|function|enum|let|var)\\s+${symbol}\\b|export\\s+\\{\\s*(?:[^}]*,\\s*)?${symbol}(?:\\s*,[^}]*)?\\s*\\}`,
								)
								if (!exportPattern.test(targetContent)) {
									const msg = `[SPI-102] GHOST SYMBOL: ${node.path} -> ${symbol} from ${specifier}`
									allGhosts.add(msg)
									nodeGhosts.push(msg)
								}
							}
						} catch (_e) {
							// Skip if file unreadable
						}
					}
				}
			}
			this.ghostVerificationCache.set(node.path, { hash: currentHash, ghosts: nodeGhosts })
		}
		return allGhosts
	}

	/**
	 * V16: Identifies exported symbols that are never consumed project-wide.
	 */
	public findUnusedExports(nodes: Map<string, SpiderNode>): string[] {
		const unusedViolations: string[] = []

		const allConsumptions = new Set<string>()
		for (const node of nodes.values()) {
			for (const symbols of Object.values(node.consumptions)) {
				for (const s of symbols) {
					allConsumptions.add(`${node.id}::${s}`) // This is not quite right, symbols are relative to target
				}
			}
		}

		// Correct logic: Track global symbol consumption (symbolName -> Set of target Node IDs)
		const globalConsumption = new Map<string, Set<string>>()
		for (const node of nodes.values()) {
			for (const [targetId, symbols] of Object.entries(node.consumptions)) {
				if (!globalConsumption.has(targetId)) globalConsumption.set(targetId, new Set())
				for (const s of symbols) globalConsumption.get(targetId)?.add(s)
			}
		}

		for (const node of nodes.values()) {
			const consumed = globalConsumption.get(node.id) || new Set()
			if (consumed.has("*")) continue // Namespace import consumes everything

			for (const exp of node.exports) {
				if (exp === "default") continue // Skip default exports for now to avoid noise
				if (!consumed.has(exp)) {
					unusedViolations.push(`[SPI-103] UNUSED EXPORT: ${node.path} -> ${exp}`)
				}
			}
		}

		return unusedViolations
	}

	public getImportedSymbols(sourceFile: ts.SourceFile): { specifier: string; symbols: string[] }[] {
		const imports: { specifier: string; symbols: string[] }[] = []
		ts.forEachChild(sourceFile, (n) => {
			if (ts.isImportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
				const specifier = n.moduleSpecifier.text
				const symbols: string[] = []
				if (n.importClause) {
					if (n.importClause.name) symbols.push(n.importClause.name.text)
					if (n.importClause.namedBindings) {
						if (ts.isNamedImports(n.importClause.namedBindings)) {
							for (const e of n.importClause.namedBindings.elements) {
								symbols.push(e.name.text)
							}
						} else if (ts.isNamespaceImport(n.importClause.namedBindings)) {
							symbols.push("*")
						}
					}
				}
				imports.push({ specifier, symbols })
			}
		})
		return imports
	}

	private isNodeLibrary(specifier: string): boolean {
		const builtins = [
			"assert",
			"async_hooks",
			"buffer",
			"child_process",
			"cluster",
			"console",
			"constants",
			"crypto",
			"dgram",
			"dns",
			"domain",
			"events",
			"fs",
			"fs/promises",
			"http",
			"http2",
			"https",
			"inspector",
			"module",
			"net",
			"os",
			"path",
			"perf_hooks",
			"process",
			"punycode",
			"querystring",
			"readline",
			"repl",
			"stream",
			"string_decoder",
			"timers",
			"tls",
			"trace_events",
			"tty",
			"url",
			"util",
			"v8",
			"vm",
			"worker_threads",
			"zlib",
			"typescript",
			"diagnostics_channel",
			"wasi",
			"test",
		]
		const normalizedSpecifier = specifier.startsWith("node:") ? specifier.slice(5) : specifier
		if (builtins.includes(normalizedSpecifier)) return true

		// Dynamic package.json Verification (V7)
		if (!specifier.startsWith(".") && !this.isProjectAlias(specifier)) {
			// Check if it's a scoped package or a top-level package that exists in node_modules or package.json
			try {
				const pkgPath = path.join(this.cwd, "package.json")
				if (fs.existsSync(pkgPath)) {
					const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
					const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
					const rootSpecifier = specifier.startsWith("@")
						? specifier.split("/").slice(0, 2).join("/")
						: specifier.split("/")[0]

					if (deps[rootSpecifier]) return true
				}
			} catch (_e) {
				// Fallback to basic detection if package.json read fails
			}

			// Final fallback: if it doesn't look like a project path, assume it's an external library
			// to avoid false positive "Ghost File" errors that block agents.
			return true
		}
		return false
	}

	private isProjectAlias(specifier: string): boolean {
		const aliases = [
			"@/",
			"@api/",
			"@core/",
			"@infrastructure/",
			"@shared/",
			"@utils/",
			"@frontend/",
			"@shared-utils/",
			"@generated/",
			"@hosts/",
			"@integrations/",
			"@packages/",
			"@services/",
			"@shared-components/",
			"@ui/",
			"@domain/",
			"@plumbing/",
		]
		for (const alias of aliases) {
			if (specifier.startsWith(alias)) return true
		}
		return false
	}
}
