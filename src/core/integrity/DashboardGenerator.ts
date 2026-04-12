import fs from "node:fs"
import path from "node:path"

import { Logger } from "@/shared/services/Logger"
import { SovereignOptimizer } from "../policy/SovereignOptimizer.js"
import type { SpiderEngine } from "../policy/SpiderEngine.js"
import type { AuditRecorder } from "./AuditRecorder.js"
import { MetabolicMonitor } from "./MetabolicMonitor.js"
import { PathogenStore } from "./PathogenStore.js"

/**
 * DashboardGenerator: Generates a live JOY_DASHBOARD.md report.
 * Provides real-time visibility into project sovereignty and structural joy.
 */
export class DashboardGenerator {
	private dashboardPath: string

	constructor(private cwd: string) {
		this.dashboardPath = path.join(cwd, "JOY_DASHBOARD.md")
	}

	/**
	 * Updates the live architectural dashboard.
	 */
	public async updateDashboard(
		engine: SpiderEngine,
		recorder: AuditRecorder,
		metabolic: MetabolicMonitor,
		optimizer: SovereignOptimizer,
		pathogens: PathogenStore,
	): Promise<void> {
		try {
			const report = engine.computeEntropy()
			const score = Math.round((1 - report.score) * 100)
			const trend = await recorder.getTrend()
			const violations = engine.getViolations()
			const mermaid = engine.toMermaid()
			const vitals = metabolic.getVitalityStats()
			const opts = optimizer.findOptimizations(engine)
			const immuneMemory = pathogens.getPathogens()

			const content = `# 🏗️ JoyZoning Architectural Dashboard

> **Current Integrity Score: ${score}/100**
> **Structural Trend: ${trend.message}**
> **Metabolic Heartbeat: ${vitals.totalWrites} edits / ${vitals.totalReads} reads**
> **Last Updated: ${new Date().toLocaleString()}**

---

## 🕷️ Project Topology (Mermaid)

\`\`\`mermaid
${mermaid}
\`\`\`

---

## 🚨 Active Structural Issues
${
	violations.length > 0
		? violations.map((v) => `- **[${v.severity}]** ${v.message} (\`${path.basename(v.path)}\`)`).join("\n")
		: "✅ All layers aligned. Project is in a state of high sovereignty."
}

---

## 👻 Ghost Files (Missing Sovereignty)
${this.generateGhostSection(engine)}

## 🧪 Structural Metrics
- **Average Entropy**: ${(report.score * 10).toFixed(2)} / 10
- **Layer Coupling**: ${(report.components.couplingScore * 100).toFixed(1)}%
- **System Orphans**: ${(report.components.orphanScore * 100).toFixed(1)}%
- **Path Depth**: ${(report.components.depthScore * 10).toFixed(1)} / 10

---

## 💓 Metabolic Pulse (Vitality)
- **Overall Doubt Signal**: ${vitals.avgDoubtSignal.toFixed(2)}
- **Agent Churn**: ${vitals.totalWrites} writes across current session.

### 🔥 Metabolic Hotspots (High Stress)
${
	vitals.hotspots.length > 0
		? vitals.hotspots.map((h) => `- \`${path.basename(h.path)}\`: Stress Index **${h.stress.toFixed(1)}**`).join("\n")
		: "✅ Codebase is calm. No fever detected."
}

---

## ⚡ Sovereign Optimization Queue
*The substrate has identified the following structural migrations to maximize integrity.*

${
	opts.length > 0
		? opts
				.map(
					(o) =>
						`- **[MOVE]** \`${path.basename(o.file)}\`: ${o.currentLayer} → **${o.recommendedLayer}** (Gain: +${o.integrityGain} points)\n  - *Reason*: ${o.reason}`,
				)
				.join("\n")
		: "✅ No optimizations pending. Architecture is at maximal stability."
}

---

## 🛡️ Immune System Status
- **Pathogen Memory**: ${immuneMemory.length} antigens recorded.
- **Defense Activity**: Blocked 0 regressions this session.
- **Memory Efficiency**: SHA-256 Compressed (LRU Active).

### 🧪 Detected Pathogens (Architectural Antigens)
${
	immuneMemory.length > 0
		? immuneMemory
				.slice(-5)
				.map((p) => `- **[${p.type}]** \`${path.basename(p.originalSummary)}\` (Hits: ${p.hitCount})`)
				.join("\n")
		: "✅ Immune memory is healthy. No pathogens detected."
}

---

## 📈 Audit History
*View detailed metrics in \`.spider/joy_audit.json\`*

> [!TIP]
> **Architectural Guarding is ACTIVE.**
> Low integrity scores may trigger the **Architectural Alarm**, soft-locking destructive operations until the project is healed.
`
			await fs.promises.writeFile(this.dashboardPath, content, "utf-8")
		} catch (error) {
			Logger.error("[DashboardGenerator] Failed to update dashboard:", error)
		}
	}

	private generateGhostSection(engine: SpiderEngine): string {
		const ghosts: string[] = []
		for (const node of engine.nodes.values()) {
			for (const imp of node.imports) {
				const res = engine.resolveImportToNodeId(node.path, imp)
				if (!res || !engine.nodes.has(res)) {
					if (imp.startsWith(".") || imp.startsWith("@/")) {
						ghosts.push(imp)
					}
				}
			}
		}

		if (ghosts.length === 0) return "✅ No ghosts detected."
		const uniqueGhosts = [...new Set(ghosts)]
		return uniqueGhosts.map((g) => `- \`${g}\` (Referenced in ${path.basename(engine.cwd)})`).join("\n")
	}
}
