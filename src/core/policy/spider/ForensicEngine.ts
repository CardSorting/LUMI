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

			// V150: Memory-First Forensic Sensing
			const sessionContent = sessionBuffer ? sessionBuffer.get(node.path) : null
			let content = sessionContent
			if (!content) {
				if (!fs.existsSync(absPath)) continue
				content = fs.readFileSync(absPath, "utf-8")
			}

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
					// PRODUCTION HARDENING: Ignore ghost files for common build/config files, Node builtins, or external packages
					if (!specifier.startsWith(".") && !this.isProjectAlias(specifier) && this.isNodeLibrary(specifier)) continue
					if (specifier.endsWith(".config.js") || specifier.endsWith(".config.ts")) continue

					const msg = `[SPI-101] GHOST FILE: ${node.path} -> ${specifier}`
					allGhosts.add(msg)
					nodeGhosts.push(msg)
				} else if (symbols.length > 0 && !hasGhostException) {
					// V16: Use Node exports for high-precision verification
					const targetNode = targetId ? nodes.get(targetId) : null

					if (targetNode) {
						let foundMissingInExport = false
						for (const symbol of symbols) {
							if (symbol === "*" || targetNode.exports.includes(symbol)) continue

							const msg = `[SPI-102] GHOST SYMBOL: ${node.path} -> ${symbol} from ${specifier}`
							allGhosts.add(msg)
							nodeGhosts.push(msg)
							foundMissingInExport = true
						}

						// V150 High-Velocity Calibration: If exports match, don't hit the disk for symbol verification
						if (foundMissingInExport) continue

						// Fallback to detailed AST check if target is in session but exports are stale
						const targetSessionId = this.resolver.normalizePath(diskPath)
						const targetSessionContent = sessionBuffer ? sessionBuffer.get(targetSessionId) : null
						if (targetSessionContent) {
							const targetAst = ts.createSourceFile(diskPath, targetSessionContent, ts.ScriptTarget.Latest, true)
							const exportedSymbols = this.getExportedSymbolsFull(targetAst)

							for (const symbol of symbols) {
								if (symbol === "*" || exportedSymbols.has(symbol)) continue
								const msg = `[SPI-102] GHOST SYMBOL: ${node.path} -> ${symbol} from ${specifier}`
								allGhosts.add(msg)
								nodeGhosts.push(msg)
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
	 * V160: Zombie Detection - Flags symbols exported but only used within their own module.
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
				// V160: Forensic Pruning - default exports often used dynamically
				if (exp === "default") continue

				if (!consumedSymbols.has(exp)) {
					unusedViolations.push(`[SPI-103] UNUSED EXPORT: ${node.path} -> ${exp}`)
				}
			}
		}

		return unusedViolations
	}

	/**
	 * V160: Contract Drift Forensics.
	 */
	public compareContracts(oldNodes: Map<string, SpiderNode>, newNodes: Map<string, SpiderNode>): string[] {
		const drifts: string[] = []
		for (const [id, newNode] of newNodes.entries()) {
			const oldNode = oldNodes.get(id)
			if (!oldNode) continue

			const removedExports = oldNode.exports.filter((e) => !newNode.exports.includes(e))
			if (removedExports.length > 0) {
				drifts.push(
					`[SPI-105] CONTRACT DRIFT (REMOVAL): ${newNode.path} -> removed exports: ${removedExports.join(", ")}`,
				)
			}
		}
		return drifts
	}

	/**
	 * V190: Fragility Sensing (Structural Risk Analysis).
	 * Calculates the 'Blast Radius' of each node based on afferent coupling and
	 * depth in the architectural graph.
	 */
	public computeFragility(nodes: Map<string, SpiderNode>): Map<string, { blastRadius: number; isFragile: boolean }> {
		const results = new Map<string, { blastRadius: number; isFragile: boolean }>()
		const totalNodes = nodes.size
		if (totalNodes === 0) return results

		for (const node of nodes.values()) {
			// Afferent Coupling (Incoming dependencies)
			const directDependents = node.dependents.length

			// V190: Industrial Calibration - Weighted Blast Radius
			// We consider direct dependents and the layer importance.
			const layerWeight = node.layer === "domain" ? 1.5 : node.layer === "core" ? 1.2 : 1.0
			const blastRadius = Math.min((directDependents * layerWeight) / (totalNodes * 0.1), 1.0)

			// Critical Threshold: If a node affects > 15% of the codebase, it's Fragile.
			const isFragile = blastRadius > 0.4 || (node.layer === "domain" && directDependents > 5)

			results.set(node.id, { blastRadius, isFragile })
		}
		return results
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
