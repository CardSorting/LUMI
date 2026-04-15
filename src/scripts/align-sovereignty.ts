import * as fs from "fs/promises"
import * as path from "path"
import { SemanticAxiomEngine } from "../core/policy/SemanticAxiomEngine"
import { SovereignOptimizer } from "../core/policy/SovereignOptimizer"
import { SpiderEngine } from "../core/policy/spider/SpiderEngine"
import { RefactorHealer } from "../core/task/tools/RefactorHealer"

/**
 * Sovereign Alignment Script: Global Codebase Restoration.
 * Performs a deep audit and aligns the entire project to JoyZoning 3.0 standards.
 */
async function main() {
	const cwd = process.cwd()
	const engine = new SpiderEngine(cwd)
	const healer = new RefactorHealer(cwd)
	const optimizer = new SovereignOptimizer(cwd)
	const axiomEngine = new SemanticAxiomEngine(cwd)

	console.log("🛸 Starting Sovereign Alignment audit...")

	// 1. Discover and build graph
	const srcDir = path.join(cwd, "src")
	const files = await globFiles(srcDir, [".ts", ".tsx"])

	const fileData = await Promise.all(
		files.map(async (f) => ({
			filePath: path.relative(cwd, f),
			content: await fs.readFile(f, "utf-8"),
		})),
	)

	engine.buildGraph(fileData)
	console.log(`📊 Indexed ${fileData.length} files.`)

	let healCount = 0

	// 2. Align Tags by Fingerprint
	for (const node of engine.nodes.values()) {
		await healer.alignTagByFingerprint(node, optimizer)
	}

	// 3. Fix Statelessness in Plumbing
	for (const node of engine.nodes.values()) {
		if (node.layer === "plumbing") {
			const axioms = axiomEngine.validateAxioms(node.path, await fs.readFile(path.resolve(cwd, node.path), "utf-8"), engine)
			if (axioms.some((a) => a.axiom === "STATELESSNESS")) {
				console.log(`✨ Healing statelessness in ${node.path}`)
				const fixed = await healer.healStatelessness(node.path)
				if (fixed) healCount++
			}
		}
	}

	console.log(`✅ Alignment complete. Healed ${healCount} violations. Codebase is Sovereign.`)
}

async function globFiles(dir: string, exts: string[]): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	const files = await Promise.all(
		entries.map((entry) => {
			const res = path.resolve(dir, entry.name)
			return entry.isDirectory() ? globFiles(res, exts) : res
		}),
	)
	return Array.prototype.concat(...files).filter((f) => exts.some((e) => f.endsWith(e)))
}

main().catch((err) => {
	console.error("❌ Alignment failed:", err)
	process.exit(1)
})
