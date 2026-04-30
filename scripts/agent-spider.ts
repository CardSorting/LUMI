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
	let shutdownInProgress = false
	const cleanup = async () => {
		if (shutdownInProgress) return
		shutdownInProgress = true
		console.log("\n🛑 Graceful shutdown initiated...")
		try {
			const dbPath = path.resolve(process.cwd(), "broccolidb.db")
			const conn = new Connection({ dbPath })
			const pool = conn.getPool()
			await pool.stop()
			console.log("✅ BroccoliDB safely persisted. Goodbye.")
		} catch (e) {
			console.error("❌ Shutdown failed:", e)
		} finally {
			process.exit(0)
		}
	}

	process.on("SIGINT", cleanup)
	process.on("SIGTERM", cleanup)

	const args = process.argv.slice(2)
	const command = args[0] || "status"

	const dbPath = path.resolve(process.cwd(), "broccolidb.db")
	const conn = new Connection({ dbPath })
	const pool = conn.getPool()
	const ws = new Workspace(pool, "local-user", "local-workspace")
	ws.setPhysicalPath(process.cwd())

	// Pass 6: Idempotent Substrate Initialization
	await ws.init()
	await pool.flush() // Ensure users/workspaces are on disk before repo FK checks

	const repoId = ws.workspaceId
	let repo: Repository
	try {
		repo = await ws.getRepo(repoId)
	} catch {
		console.log(`[Spider] Initializing repository '${repoId}' in BroccoliDB...`)
		repo = await ws.createRepo(repoId, "main")
		await pool.flush()
	}

	const ctx = new AgentContext(ws, pool)

	if (command === "seed" || command === "re-seed") {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim()
		console.log(`📡 Seeding BroccoliDB on branch '${branch}'...`)

		try {
			// Idempotent branch resolution
			await repo.resolveRef(branch)
		} catch {
			console.log(`🌱 Creating branch '${branch}'...`)
			await repo.createBranch(branch)
			await pool.flush()
		}

		const filesStr = execSync("git ls-files", { encoding: "utf8" })
		const files = filesStr
			.split("\n")
			.filter(
				(f) =>
					f.trim().length > 0 && (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".mjs")),
			)

		const forceFull = args.includes("--force-full") || command === "re-seed"
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
		for (const imp of node.imports) {
			const resolved = node.resolvedImports.get(imp)
			console.log(`  -> ${imp} ${resolved ? `(${resolved})` : "[UNRESOLVED]"}`)
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
			for (const imp of node.imports) {
				const resolvedId = node.resolvedImports.get(imp)
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

	if (command === "pre-heat") {
		const filePath = args[1]
		if (!filePath) {
			console.error("Usage: pre-heat <file>")
			process.exit(1)
		}
		const pack = ctx.spider.getStudyPack(filePath)
		console.log(`📖  Sovereign Study Pack for ${filePath}:`)
		console.log(`   (Read these files to master the structural context)`)
		for (const item of pack.studyItems) {
			console.log(`   - ${item.path} [${item.reason}]`)
		}
		process.exit(0)
	}

	if (command === "conflicts") {
		const conflicts = engine.getRegistry().getConflicts()
		console.log(`⚔️  Structural Conflicts: ${conflicts.size}`)
		for (const [symbol, providers] of conflicts.entries()) {
			console.log(`   - '${symbol}' is provided by:`)
			for (const p of providers) console.log(`     -> ${p}`)
		}
		process.exit(0)
	}

	if (command === "bridges") {
		console.log("🌉 Detecting Structural Bridges (Articulated Points)...")
		const bridges = engine.forensic.detectStructuralBridges(engine.nodes)
		if (bridges.length === 0) {
			console.log("  ✅ No single points of failure detected.")
		} else {
			console.log(`  Found ${bridges.length} architectural bridges:`)
			for (const b of bridges) console.log(`    - ${b}`)
		}
		process.exit(0)
	}

	if (command === "hotspots") {
		console.log("🔥 Detecting High-Hazard Hotspots...")
		const results: { path: string; score: number }[] = []
		for (const node of engine.nodes.values()) {
			const score = engine.forensic.calculateHazardScore(node, engine.nodes)
			if (score > 0.4) results.push({ path: node.path, score })
		}
		results.sort((a, b) => b.score - a.score)
		if (results.length === 0) {
			console.log("  ✅ No critical hotspots detected.")
		} else {
			for (const r of results) {
				console.log(`    - [${(r.score * 100).toFixed(0)}%] ${r.path}`)
			}
		}
		process.exit(0)
	}

	if (command === "debt") {
		console.log("📉 Analyzing Structural Debt (Clones & Implicit Interfaces)...")
		const clones = engine.forensic.findLogicClones(engine.nodes)
		const interfaces = engine.forensic.findImplicitInterfaces(engine.nodes)
		const resonance = engine.forensic.detectSymbolResonance(engine.nodes)

		console.log(`  - Logic Clones: ${clones.length}`)
		for (const c of clones) console.log(`    ${c}`)
		console.log(`  - Implicit Interfaces: ${interfaces.length}`)
		for (const i of interfaces) console.log(`    ${i}`)
		console.log(`  - Symbol Resonance: ${resonance.length}`)
		for (const r of resonance) console.log(`    ${r}`)
		process.exit(0)
	}

	if (command === "audit") {
		console.log("🕵️  Performing Global Architectural Audit...")
		const violations = engine.getViolations()
		const unused = engine.forensic.findUnusedExports(engine.nodes)
		const contracts = engine.forensic.auditImplicitContracts(engine.nodes)
		const snapshots = await engine.getSnapshotHistory(5)

		const decay: string[] = []
		const fatigue: string[] = []
		for (const node of engine.nodes.values()) {
			const halfLife = engine.metrics.trackStructuralHalfLife(node, snapshots)
			if (halfLife > 1.2) {
				decay.push(
					`[SPI-112] STRUCTURAL DECAY: ${node.path} (Entropy increased ${(halfLife * 100 - 100).toFixed(0)}% over 5 sessions)`,
				)
			}
			const pressure = engine.forensic.calculateHazardScore(node, engine.nodes)
			if (engine.metrics.detectRefactoringFatigue(node, pressure, snapshots)) {
				fatigue.push(`[SPI-113] REFACTORING FATIGUE: ${node.path} (High churn, zero improvement)`)
			}
		}

		if (
			violations.length === 0 &&
			unused.length === 0 &&
			contracts.length === 0 &&
			decay.length === 0 &&
			fatigue.length === 0
		) {
			console.log("  ✅ Substrate is clean. Zero violations.")
		} else {
			if (violations.length > 0) {
				console.log(`  ⚠️  Architectural Violations (${violations.length}):`)
				for (const v of violations) console.log(`    - [${v.id}] ${v.path}: ${v.message}`)
			}
			if (decay.length > 0) {
				console.log(`  📉 Structural Decay (${decay.length}):`)
				for (const d of decay) console.log(`    - ${d}`)
			}
			if (fatigue.length > 0) {
				console.log(`  😫 Refactoring Fatigue (${fatigue.length}):`)
				for (const f of fatigue) console.log(`    - ${f}`)
			}
			if (unused.length > 0) {
				console.log(`  💀 Deadwood (${unused.length}):`)
				for (const u of unused) console.log(`    - ${u}`)
			}
			if (contracts.length > 0) {
				console.log(`  📝 Contract Asymmetry (${contracts.length}):`)
				for (const c of contracts) console.log(`    - ${c}`)
			}
		}
		process.exit(0)
	}

	if (command === "blast-radius") {
		const filePath = args[1]
		if (!filePath) {
			console.error("Usage: blast-radius <file>")
			process.exit(1)
		}
		const node = engine.nodes.get(engine.normalizePath(filePath))
		if (!node) {
			console.error(`File not found in graph: ${filePath}`)
			process.exit(1)
		}
		const ripple = engine.forensic.calculateRippleProbability(engine.nodes)
		const prob = ripple.get(node.id) || 0
		console.log(`☢️  Blast Radius for ${node.path}:`)
		console.log(`   - Systemic Impact: ${(prob * 100).toFixed(1)}%`)
		console.log(`   - Direct Dependents: ${node.dependents.length}`)
		console.log(`   - Afferent Coupling: ${node.afferentCoupling}`)

		if (prob > 0.6) console.log("   🚨 CRITICAL COMPONENT: High ripple probability detected.")
		process.exit(0)
	}

	if (command === "mermaid") {
		const filePath = args[1]
		const depth = Number.parseInt(args[2] || "1", 10)
		if (!filePath) {
			console.log(engine.toMermaid())
		} else {
			const scope = engine.getNeighborhood(filePath, depth)
			console.log(engine.toMermaid(scope))
		}
		process.exit(0)
	}

	if (command === "pre-heat") {
		const filePath = args[1]
		const depth = Number.parseInt(args[2] || "1")
		if (!filePath) {
			console.error("Usage: pre-heat <file> [depth]")
			process.exit(1)
		}
		const scope = engine.getNeighborhood(filePath, depth)
		console.log(`🌡️  Pre-heating neighborhood for ${filePath} (depth: ${depth})...`)
		console.log(`   Added ${scope.size} files to study scope.`)
		for (const id of scope) {
			console.log(`    - ${id}`)
		}
		process.exit(0)
	}

	if (command === "tutor") {
		const entropy = engine.computeEntropy().score
		console.log("🎓  Sovereign Navigation Tutor")
		console.log("--------------------------------")
		console.log("Interaction Pattern: The Hybrid Anchor")
		console.log("1. SCOPE    (Spider)  : Use 'find-symbol' or 'find-usage' to narrow the area.")
		console.log("2. AUDIT    (Forensic): Use 'audit', 'bridges', or 'hotspots' to find hazards.")
		console.log("3. VERIFY   (Grep)    : Use 'grep_search' to confirm code reality on disk.")
		console.log("4. FORECAST (Ghost)   : Use 'blast-radius' to quantify the ripple effect.")
		console.log("5. ALIGN    (Seed)    : If things diverge, run 're-seed' to update the substrate.")
		console.log("")
		console.log(
			`Current Entropy: ${entropy.toFixed(2)}% ${entropy > 20 ? "🚨 (High - Re-seed recommended)" : "✅ (Healthy)"}`,
		)
		console.log("")
		console.log("Checklist for Agentic Success:")
		console.log("[ ] Did I run 're-seed' at the start of the session?")
		console.log("[ ] Did I run 'audit' to check for layer violations or deadwood?")
		console.log("[ ] Did I check 'hotspots' for toxic churn before editing?")
		console.log("[ ] Did I use 'pre-heat' to study the module architecture?")
		console.log("[ ] Did I verify the graph's scope with a physical Grep?")
		process.exit(0)
	}
}

main().catch((err) => {
	console.error("❌ Agent Spider failed:", err)
	process.exit(1)
})
