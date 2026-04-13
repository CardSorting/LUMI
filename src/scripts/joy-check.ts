import * as path from "path"
import { SpiderEngine } from "../core/policy/SpiderEngine"

/**
 * JoyCheck: The Sovereign Radar CLI.
 * Performs a global architectural health audit and generates a high-fidelity report.
 */
async function audit() {
	const cwd = process.cwd()
	const engine = new SpiderEngine(cwd)
	const loaded = await engine.loadRegistry()

	if (!loaded) {
		console.log("❌ Sovereign Registry not found. Run 'npm run scan' first.")
		process.exit(1)
	}

	const nodes = Array.from(engine.nodes.values())
	const layers = ["domain", "core", "infrastructure", "plumbing", "ui"]

	console.log("\n🛰️  JOY-ZONING SOVEREIGN RADAR")
	console.log("===============================")

	let totalViolations = 0

	for (const layer of layers) {
		const layerNodes = nodes.filter((n) => n.layer === layer)
		if (layerNodes.length === 0) continue

		const avgDensity = layerNodes.reduce((acc, n) => acc + n.logicDensity, 0) / layerNodes.length
		const avgEntropy = layerNodes.reduce((acc, n) => acc + n.ioEntropy, 0) / layerNodes.length
		const orphans = layerNodes.filter((n) => n.orphaned).length

		let status = "✅ STABLE"
		if (avgEntropy > 0.1 && (layer === "domain" || layer === "core")) {
			status = "⚠️  DEGRADED"
			totalViolations++
		}
		if (orphans > layerNodes.length * 0.2) {
			status = "🚨 FEVER"
			totalViolations++
		}

		console.log(`\n[${layer.toUpperCase()}] status: ${status}`)
		console.log(`- Files: ${layerNodes.length}`)
		console.log(`- Avg Density: ${(avgDensity * 100).toFixed(1)}%`)
		console.log(`- Avg Entropy: ${(avgEntropy * 100).toFixed(1)}%`)
		console.log(`- Orphans: ${orphans}`)
	}

	const violations = engine.getViolations()
	if (violations.length > 0) {
		console.log("\n❌ CRITICAL VIOLATIONS DETECTED:")
		violations.forEach((v) => {
			console.log(`  - [${v.severity}] ${v.path}: ${v.message}`)
		})
	}

	console.log("\n📡 GENERATING SOVEREIGN MAP (Mermaid)...")
	let mermaid = "graph TD\n"
	nodes.forEach((node) => {
		const label = path.basename(node.id).replace(/\./g, "_")
		const status =
			node.ioEntropy > 0.1 && (node.layer === "domain" || node.layer === "core")
				? "fill:#f96,stroke:#333"
				: "fill:#9f6,stroke:#333"
		mermaid += `  ${label}[${node.path}]\n`
		mermaid += `  style ${label} ${status}\n`
	})
	console.log(mermaid)

	console.log("\n===============================")
	if (totalViolations > 0 || violations.length > 0) {
		console.log("🚫 Structural integrity compromised. Healing required.")
		process.exit(1)
	} else {
		console.log("💎 System core is Sovereign.")
		process.exit(0)
	}
}

audit().catch(console.error)
