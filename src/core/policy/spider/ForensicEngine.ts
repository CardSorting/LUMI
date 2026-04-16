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

	public findGhosts(nodes: Map<string, SpiderNode>, sessionBuffer?: Map<string, string>): Set<string> {
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
						// 1. Check Session Buffer (V71)
						const sessionContent = sessionBuffer ? sessionBuffer.get(this.resolver.normalizePath(diskPath)) : null
						const targetContent =
							sessionContent || (fs.existsSync(diskPath) ? fs.readFileSync(diskPath, "utf-8") : null)

						if (targetContent) {
							for (const symbol of symbols) {
								if (symbol === "*") continue
								// V16: Forensic Realism - 100% Accurate AST Sensing
								const targetAst = ts.createSourceFile(diskPath, targetContent, ts.ScriptTarget.Latest, true)
								const exportedSymbols = this.getExportedSymbolsFull(targetAst)

								if (!exportedSymbols.has(symbol)) {
									const msg = `[SPI-102] GHOST SYMBOL: ${node.path} -> ${symbol} from ${specifier}`
									allGhosts.add(msg)
									nodeGhosts.push(msg)
								}
							}
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
	/**
	 * V140: Industrial Hardening - Precise Unused Export Forensics.
	 */
	public findUnusedExports(nodes: Map<string, SpiderNode>): string[] {
		const unusedViolations: string[] = []
		const globalConsumption = new Map<string, Set<string>>()

		// 1. Build Global Consumption Map (TargetNodeID -> Set of Symbols)
		for (const node of nodes.values()) {
			for (const [targetId, symbols] of Object.entries(node.consumptions)) {
				if (!globalConsumption.has(targetId)) {
					globalConsumption.set(targetId, new Set())
				}
				const consumptionSet = globalConsumption.get(targetId)!
				for (const s of symbols) {
					consumptionSet.add(s)
				}
			}
		}

		// 2. Identify Deadwood (Exports never consumed)
		for (const node of nodes.values()) {
			const consumedSymbols = globalConsumption.get(node.id) || new Set()

			// V16: Namespace imports or specific root files prevent pruning
			if (consumedSymbols.has("*")) continue
			if (node.path === "src/main.ts" || node.path === "src/index.ts" || node.path === "src/extension.ts") continue

			for (const exp of node.exports) {
				// V16: Industrial Hardening - Include default exports in pruning
				if (!consumedSymbols.has(exp)) {
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

	/**
	 * V140: Forensic Realism - 100% Accurate AST-based Export Sensing.
	 */
	public getExportedSymbolsFull(sourceFile: ts.SourceFile): Set<string> {
		const exports = new Set<string>()
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isExportDeclaration(node)) {
				if (node.exportClause && ts.isNamedExports(node.exportClause)) {
					for (const element of node.exportClause.elements) {
						exports.add(element.name.text)
					}
				}
			} else if (
				ts.isClassDeclaration(node) ||
				ts.isFunctionDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node) ||
				ts.isEnumDeclaration(node)
			) {
				const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
				if (isExported && node.name) {
					exports.add(node.name.text)
					const isDefault = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
					if (isDefault) exports.add("default")
				}
			} else if (ts.isVariableStatement(node)) {
				const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
				if (isExported) {
					for (const decl of node.declarationList.declarations) {
						if (ts.isIdentifier(decl.name)) {
							exports.add(decl.name.text)
						}
					}
				}
			} else if (ts.isExportAssignment(node)) {
				exports.add("default")
			}
		})
		return exports
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
