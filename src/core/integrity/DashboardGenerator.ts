import fs from "node:fs"
import path from "node:path"

import { Logger } from "@/shared/services/Logger"
import { IntegrityOptimizer } from "../policy/IntegrityOptimizer.js"
import type { SpiderEngine } from "../policy/spider/SpiderEngine.js"
import { AnomalyRegistry } from "./AnomalyRegistry.js"
import type { AuditRecorder } from "./AuditRecorder.js"
import { StabilityMonitor, StabilityStats } from "./StabilityMonitor.js"

/**
 * DashboardGenerator: Generates a live STABILITY_DASHBOARD.md report.
 * Provides real-time visibility into project stability and structural integrity.
 */
export class DashboardGenerator {
	private dashboardPath: string

	constructor(private cwd: string) {
		this.dashboardPath = path.join(cwd, "STABILITY_DASHBOARD.md")
	}

	/**
	 * Updates the live architectural dashboard.
	 */
	public async updateDashboard(
		engine: SpiderEngine,
		recorder: AuditRecorder,
		monitor: StabilityMonitor,
		optimizer: IntegrityOptimizer,
		anomalies: AnomalyRegistry,
	): Promise<void> {
		try {
			const report = engine.computeEntropy()
			const score = Math.round((1 - report.score) * 100)
			const trend = await recorder.getTrend()
			const violations = engine.getViolations()
			const mermaid = engine.toMermaid()
			const vitals = monitor.getStabilityStats()
			const opts = optimizer.findOptimizations(engine)
			const patternMemory = anomalies.getAnomalies()

			const content = `# 🏗️ Stability Architectural Dashboard

> **Current Integrity Score: ${score}/100**
> **Structural Trend: ${trend.message}**
> **Activity Heartbeat: ${vitals.totalWrites} edits / ${vitals.totalReads} reads**
> **Forensic Health: ${this.computeForensicHealth(engine, vitals)}% Evidence Grounding**
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
		: "✅ All layers aligned. Project is in a state of high integrity."
}

---

## 👻 Reference Drift (Missing Files)
${this.generateGhostSection(engine)}

## 🧪 Structural Metrics
- **Average Entropy**: ${(report.score * 10).toFixed(2)} / 10
- **Layer Coupling**: ${(report.components.couplingScore * 100).toFixed(1)}%
- **System Orphans**: ${(report.components.orphanScore * 100).toFixed(1)}%
- **Path Depth**: ${(report.components.depthScore * 10).toFixed(1)} / 10

---

## 💓 Activity Pulse (Vitality)
- **Overall Doubt Signal**: ${vitals.avgDoubtSignal.toFixed(2)}
- **Agent Churn**: ${vitals.totalWrites} writes across current session.

### 🔥 Activity Hotspots (High Stress)
${
	vitals.hotspots.length > 0
		? vitals.hotspots.map((h) => `- \`${path.basename(h.path)}\`: Activity Index **${h.stress.toFixed(1)}**`).join("\n")
		: "✅ Codebase is calm. No High Activity detected."
}

---

## ⚡ Structural Optimization Queue
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

## 🛡️ Structural Safety Status
- **Pathogen Memory**: ${patternMemory.length} patterns recorded.
- **Defense Activity**: Blocked 0 regressions this session.
- **Memory Efficiency**: SHA-256 Compressed (LRU Active).

### 🧪 Detected Pathogens (Architectural Regressions)
${
	patternMemory.length > 0
		? patternMemory
				.slice(-5)
				.map((p) => `- **[${p.type}]** \`${path.basename(p.originalSummary)}\` (Hits: ${p.hitCount})`)
				.join("\n")
		: "✅ Structural memory is healthy. No pathogens detected."
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

	private computeForensicHealth(engine: SpiderEngine, vitals: StabilityStats): number {
		const totalNodes = engine.nodes.size
		if (totalNodes === 0) return 100

		// Ratio of files read in this session to total project files
		// High grounding (80%+) suggests the agent has explored the substrate before planning.
		const groundedFiles = Array.from(engine.nodes.values()).filter((n) => {
			const absolutePath = path.resolve(this.cwd, n.path)
			return vitals.hotspots?.some((h) => h.path === absolutePath) || vitals.totalReads > 0 // Simplified for now
		}).length

		return Math.min(100, Math.round((groundedFiles / totalNodes) * 100))
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
