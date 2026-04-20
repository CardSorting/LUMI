import { execSync } from "node:child_process"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { AgentContext } from "../broccolidb/core/agent-context.js"
import { Connection } from "../broccolidb/core/connection.js"
import { Repository } from "../broccolidb/core/repository.js"
import { Workspace } from "../broccolidb/core/workspace.js"

async function main() {
	process.setMaxListeners(100)

	// Graceful Shutdown: Sovereign Cleanup
	const cleanup = async () => {
		console.log("\n🛑 Graceful shutdown initiated...")
		const dbPath = path.resolve(process.cwd(), "broccolidb.db")
		const conn = new Connection({ dbPath })
		const pool = conn.getPool()
		await pool.stop()
		console.log("✅ BroccoliDB safely persisted. Goodbye.")
		process.exit(0)
	}

	process.on("SIGINT", cleanup)
	process.on("SIGTERM", cleanup)

	const args = process.argv.slice(2)
	const command = args[0] || "status"

	const dbPath = path.resolve(process.cwd(), "broccolidb.db")
	const conn = new Connection({ dbPath })
	const pool = conn.getPool()
	const ws = new Workspace(pool, "local-user", "local-workspace")
	await ws.init()

	const repoId = path.basename(process.cwd())
	let repo: Repository
	try {
		repo = await ws.getRepo(repoId)
	} catch {
		console.log(`[Spider] Initializing repository '${repoId}' in BroccoliDB...`)
		repo = await ws.createRepo(repoId, "main")
	}

	const ctx = new AgentContext(ws, pool)

	if (command === "seed") {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim()
		console.log(`📡 Seeding BroccoliDB on branch '${branch}'...`)

		try {
			await repo.resolveRef(branch)
		} catch {
			console.log(`🌱 Creating branch '${branch}'...`)
			await repo.createBranch(branch)
		}

		const filesStr = execSync("git ls-files", { encoding: "utf8" })
		const files = filesStr
			.split("\n")
			.filter(
				(f) =>
					f.trim().length > 0 && (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".mjs")),
			)

		const forceFull = args.includes("--force-full")
		if (forceFull) {
			console.log("🔥 Force-full re-index requested. Clearing persistent cache...")
			await pool.push({
				type: "delete",
				table: "knowledge",
				where: [{ column: "type", value: "structural_snapshot" }],
				layer: "infrastructure",
			})
			await pool.flush()
		}

		console.log(`🔍 Found ${files.length} files to index.`)

		const tree: Record<string, string> = {}
		const author = "Agent-Sovereign-Seed"

		await pool.beginWork(author)
		try {
			for (const file of files) {
				if (!fs.existsSync(file)) continue
				const content = fs.readFileSync(file, "utf8")
				const docId = crypto.createHash("sha256").update(content).update("utf-8").digest("hex")

				await pool.push(
					{
						type: "upsert",
						table: "files",
						where: [{ column: "id", value: docId }],
						values: {
							id: docId,
							path: file,
							content,
							encoding: "utf-8",
							size: Buffer.byteLength(content, "utf-8"),
							updatedAt: Date.now(),
							author,
						},
						layer: "domain",
					},
					author,
				)

				tree[file] = docId
			}

			const headId = repo.generateNodeId()
			await repo.commitInTransaction(
				null,
				branch,
				headId,
				{ tree },
				author,
				"Initial Sovereign Seed",
				{
					type: "snapshot",
				},
				author,
			)

			await pool.commitWork(author)
			console.log(`✅ Indexed ${files.length} files in-memory. Flushing to disk...`)
			await pool.flush()
			console.log(`✅ Seeded ${files.length} files into BroccoliDB.`)
		} catch (e) {
			await pool.rollbackWork(author)
			throw e
		}

		console.log("🕸️  Bootstrapping Spider graph...")
		await ctx.spider.bootstrapGraph()

		const engine = ctx.spider.getEngine()
		console.log(`✅ Graph Bootstrapped: ${engine.nodes.size} nodes.`)

		await pool.flush()
		process.exit(0)
	}

	const branchesInDb = await pool.selectWhere("branches", [])
	if (branchesInDb.length === 0) {
		console.log("⚠️  BroccoliDB is empty. Run 'npx tsx scripts/agent-spider.ts seed' first.")
		process.exit(1)
	}

	await ctx.spider.bootstrapGraph()
	const engine = ctx.spider.getEngine()

	if (command === "status") {
		const entropy = engine.computeEntropy()
		console.log(`📊 Nodes: ${engine.nodes.size}`)
		console.log(`🧠 Entropy: ${entropy.score.toFixed(2)}%`)
		process.exit(0)
	}

	if (command === "find-symbol") {
		const symbol = args[1]
		if (!symbol) {
			console.error("Usage: find-symbol <name>")
			process.exit(1)
		}
		const registry = engine.getRegistry()
		const providers = registry.findProviders(symbol)
		console.log(`🔍 Providers for '${symbol}':`)
		for (const p of providers) {
			console.log(`  - ${p}`)
		}
		process.exit(0)
	}

	if (command === "deps") {
		const filePath = args[1]
		if (!filePath) {
			console.error("Usage: deps <file>")
			process.exit(1)
		}
		const node = engine.nodes.get(engine.normalizePath(filePath))
		if (!node) {
			console.error(`File not found in graph: ${filePath}`)
			process.exit(1)
		}
		console.log(`📦 Dependencies for ${node.path}:`)
		for (const imp of Array.from(node.imports)) {
			const resolved = node.resolvedImports.get(imp.specifier)
			console.log(`  -> ${imp.specifier} ${resolved ? `(${resolved})` : "[UNRESOLVED]"}`)
		}
		console.log(`🔗 Dependents:`)
		const dependents = Array.from(engine.nodes.values()).filter((n) =>
			Array.from(n.resolvedImports.values()).includes(node.id),
		)
		for (const d of dependents) {
			console.log(`  <- ${d.path}`)
		}
		process.exit(0)
	}

	if (command === "find-usage") {
		const symbol = args[1]
		if (!symbol) {
			console.error("Usage: find-usage <symbol>")
			process.exit(1)
		}

		const providers = engine.getRegistry().findProviders(symbol)
		if (providers.length === 0) {
			console.error(`Symbol '${symbol}' not found in registry.`)
			process.exit(1)
		}

		console.log(`🔎 Usages of '${symbol}':`)
		const providerFileIds = providers.map((p) => engine.normalizePath(p))

		const usages: string[] = []
		for (const node of Array.from(engine.nodes.values())) {
			for (const imp of Array.from(node.imports)) {
				const resolvedId = node.resolvedImports.get(imp.specifier)
				if (resolvedId && providerFileIds.includes(resolvedId)) {
					usages.push(node.path)
					break
				}
			}
		}

		if (usages.length === 0) {
			console.log("  No usages found.")
		} else {
			for (const u of usages) console.log(`  <- ${u}`)
		}
		process.exit(0)
	}

	if (command === "verify-graph") {
		console.log("🧐 Verifying graph integrity (Ghost Node Guard)...")
		const report = await ctx.spider.verifyGraphIntegrity(false)
		if (report.pruned > 0) {
			console.log(`✅ Pruned ${report.pruned} ghost nodes.`)
		} else {
			console.log("✅ Graph is healthy. Zero ghost nodes detected.")
		}
		process.exit(0)
	}

	if (command === "blast-radius") {
		const filePath = args[1]
		if (!filePath) {
			console.error("Usage: blast-radius <file>")
			process.exit(1)
		}
		const discovery = ctx.spider.getDiscovery()
		const report = discovery.getBlastRadius(filePath)
		console.log(`🔥 Blast Radius for ${filePath}:`)
		console.log(`  Centrality Score: ${(report.centralityScore * 100).toFixed(2)}%`)
		console.log(`  Total Impacted Nodes: ${report.affectedNodes.length}`)
		console.log(`  Critical Dependents: ${report.criticalDependents.length}`)

		if (report.criticalDependents.length > 0) {
			console.log("  Critical Layers Impacted:")
			for (const f of report.criticalDependents) console.log(`    - ${f}`)
		}
		process.exit(0)
	}
}

main().catch((err) => {
	console.error("❌ Agent Spider failed:", err)
	process.exit(1)
})
