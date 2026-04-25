import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as fs from "fs/promises"
import * as path from "path"
import { DietCodeDefaultTool } from "@/shared/tools"
import { SpiderEngine } from "../../../policy/spider/SpiderEngine"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * SovereignMapHandler: Visualizes Codebase Sovereignty.
 * Generates a rich HTML report with layer health and coupling maps.
 */
export class SovereignMapHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.SOVEREIGN_MAP

	getDescription(_block: ToolUse): string {
		return "[generate sovereign health map]"
	}

	async execute(config: TaskConfig, _block: ToolUse): Promise<ToolResponse> {
		if (!config.isSubagentExecution) {
			return formatResponse.toolError(
				"🛑 **ACCESS DENIED**: Architectural mapping tools are reserved for Forensic Sub-Agents. Please use 'attempt_completion' to trigger an autonomous documentation phase.",
			)
		}
		const engine = new SpiderEngine(config.cwd)
		await engine.loadRegistry()

		const nodes = Array.from(engine.nodes.values())

		// 1. Generate Mermaid Graph
		let mermaidGraph = "graph TD\n"

		// Style definitions
		mermaidGraph += "  classDef domain fill:#f96,stroke:#333,stroke-width:4px;\n"
		mermaidGraph += "  classDef core fill:#69c,stroke:#333,stroke-width:2px;\n"
		mermaidGraph += "  classDef infra fill:#6c6,stroke:#333,stroke-width:2px;\n"
		mermaidGraph += "  classDef ui fill:#c6c,stroke:#333,stroke-width:2px;\n"
		mermaidGraph += "  classDef orphan stroke:#f00,stroke-width:4px,stroke-dasharray: 5 5;\n"

		// Nodes and Edges
		for (const node of nodes) {
			const sanitizedPath = node.path.replace(/\//g, "_").replace(/\./g, "_")
			const label = path.basename(node.path)
			mermaidGraph += `  ${sanitizedPath}["${label}<br/><small>Score: ${node.logicDensity.toFixed(2)}</small>"]\n`

			// Class assignment
			mermaidGraph += `  class ${sanitizedPath} ${node.layer || "plumbing"};\n`
			if (node.orphaned) mermaidGraph += `  class ${sanitizedPath} orphan;\n`

			// Edges (Dependencies)
			for (const depId of node.imports || []) {
				const depNode = engine.nodes.get(depId)
				if (depNode) {
					const sanitizedDep = depNode.path.replace(/\//g, "_").replace(/\./g, "_")
					mermaidGraph += `  ${sanitizedPath} --> ${sanitizedDep}\n`
				}
			}
		}

		// 2. Wrap in HTML Template
		const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
    <title>Sovereign Health Map</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; background: #1a1a1a; padding: 40px; border-radius: 12px; border: 1px solid #333; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
        h1 { color: #f96; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .stats { display: flex; gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #252525; padding: 15px; border-radius: 8px; flex: 1; text-align: center; border: 1px solid #444; }
        .stat-value { font-size: 24px; font-weight: bold; color: #fff; }
        .stat-label { font-size: 12px; color: #888; text-transform: uppercase; }
        #mermaid-container { background: #fff; padding: 20px; border-radius: 8px; margin-top: 20px; min-height: 500px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Sovereign Health Map</h1>
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value">${nodes.length}</div>
                <div class="stat-label">Modules</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${nodes.filter((n) => n.orphaned).length}</div>
                <div class="stat-label">Orphans</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${engine.computeEntropy().score.toFixed(1)}%</div>
                <div class="stat-label">Integrity</div>
            </div>
        </div>
        <div id="mermaid-container" class="mermaid">
            ${mermaidGraph}
        </div>
    </div>
    <script>
        mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
    </script>
</body>
</html>
		`

		const reportPath = path.join(config.cwd, ".spider", "sovereign_map.html")
		await fs.mkdir(path.dirname(reportPath), { recursive: true })
		await fs.writeFile(reportPath, htmlTemplate)

		return formatResponse.toolResult(
			`Sovereign Health Map generated successfully at: ${reportPath}\nYou can open this file in your browser to visualize the codebase health.`,
		)
	}
}
