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
				cached.ghosts.forEach((g) => allGhosts.add(g))
				continue
			}

			const nodeGhosts: string[] = []
			const sourceFile = ts.createSourceFile(node.path, content, ts.ScriptTarget.Latest, true)
			const imports = this.getImportedSymbols(sourceFile)

			for (const { specifier, symbols } of imports) {
				const diskPath = this.resolver.getDiskPath(node.path, specifier)

				if (!diskPath || !fs.existsSync(diskPath)) {
					if (this.isNodeLibrary(specifier)) continue
					const msg = `[SPI-101] GHOST FILE: ${node.path} -> ${specifier}`
					allGhosts.add(msg)
					nodeGhosts.push(msg)
				} else if (symbols.length > 0) {
					try {
						const targetContent = fs.readFileSync(diskPath, "utf-8")
						for (const symbol of symbols) {
							if (symbol === "*") continue
							const exportPattern = new RegExp(
								`export\\s+(const|class|interface|type|function|enum|let|var)\\s+${symbol}\\b`,
							)
							if (!exportPattern.test(targetContent) && !targetContent.includes(`export { ${symbol}`)) {
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
			this.ghostVerificationCache.set(node.path, { hash: currentHash, ghosts: nodeGhosts })
		}
		return allGhosts
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

		if (!specifier.startsWith(".") && !this.isProjectAlias(specifier)) return true
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
		]
		for (const alias of aliases) {
			if (specifier.startsWith(alias)) return true
		}
		return false
	}
}
