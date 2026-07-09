import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Logger } from "@/shared/services/Logger"
import { type SubsystemStabilityFact, type WorkspaceCognitiveModel, type WorkspaceIntelligenceArtifactRecord } from "./types"

export class WorkspaceIntelligenceStore {
	private readonly intelligenceDir: string

	constructor(cwd: string) {
		this.intelligenceDir = path.join(cwd, ".wiki/intelligence")
	}

	async readModel(): Promise<WorkspaceCognitiveModel | undefined> {
		const jsonPath = path.join(this.intelligenceDir, "workspace-intelligence.json")
		try {
			const { readFile } = await import("node:fs/promises")
			const raw = await readFile(jsonPath, "utf-8")
			const parsed = JSON.parse(raw)
			if (parsed && typeof parsed === "object" && (parsed.schemaVersion === 1 || parsed.schemaVersion === 2)) {
				// Migrate schemaVersion 1 to schemaVersion 2 facts collection on read!
				if (parsed.schemaVersion === 1) {
					parsed.schemaVersion = 2
					parsed.facts = []
					if (Array.isArray(parsed.stableSubsystems)) {
						for (const s of parsed.stableSubsystems) {
							parsed.facts.push({
								id: `fact-subsystem-${s.replace(/[^a-z0-9]+/g, "-")}-stability`,
								type: "subsystem_stability",
								value: { path: s, status: "stable" },
								confidence: "confirmed",
								provenance: [],
								lifecycle: "active",
								lastUpdated: parsed.generatedAt,
							})
						}
					}
					if (Array.isArray(parsed.volatileSubsystems)) {
						for (const s of parsed.volatileSubsystems) {
							parsed.facts.push({
								id: `fact-subsystem-${s.replace(/[^a-z0-9]+/g, "-")}-stability`,
								type: "subsystem_stability",
								value: { path: s, status: "volatile" },
								confidence: "confirmed",
								provenance: [],
								lifecycle: "active",
								lastUpdated: parsed.generatedAt,
							})
						}
					}
					if (Array.isArray(parsed.recentArchitectureDecisions)) {
						for (const d of parsed.recentArchitectureDecisions) {
							parsed.facts.push({
								id: `fact-adr-${d.id.toLowerCase()}`,
								type: "architecture_decision",
								value: d,
								confidence: "confirmed",
								provenance: [],
								lifecycle: "active",
								lastUpdated: parsed.generatedAt,
							})
						}
					}
					// clean up deprecated schemaVersion 1 properties
					delete parsed.stableSubsystems
					delete parsed.volatileSubsystems
					delete parsed.recentArchitectureDecisions
					delete parsed.staleDocumentationSurfaces
					delete parsed.recurringRiskAreas
					delete parsed.handoffRelevantFacts
				}
				return parsed as WorkspaceCognitiveModel
			}
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error)
			if (!errMsg.includes("ENOENT")) {
				Logger.warn(`[Workspace Knowledge System] Failed to parse existing model: ${errMsg}. Recovering best-effort.`)
				try {
					const { appendFile, mkdir } = await import("node:fs/promises")
					await mkdir(this.intelligenceDir, { recursive: true })
					await appendFile(
						path.join(this.intelligenceDir, "diagnostics.log"),
						`[${new Date().toISOString()}] Warning: failed to parse workspace-intelligence.json: ${errMsg}\n`,
						"utf-8",
					)
				} catch {
					// Stay advisory-only
				}
			}
			return undefined
		}
		return undefined
	}

	async writeModel(model: WorkspaceCognitiveModel): Promise<WorkspaceIntelligenceArtifactRecord[]> {
		await mkdir(this.intelligenceDir, { recursive: true })

		const jsonPath = path.join(this.intelligenceDir, "workspace-intelligence.json")
		const mdPath = path.join(this.intelligenceDir, "workspace-intelligence.md")

		await writeFile(jsonPath, JSON.stringify(model, null, 2), "utf-8")
		await writeFile(mdPath, renderMarkdownModel(model), "utf-8")

		return [
			{
				relPath: ".wiki/intelligence/workspace-intelligence.json",
				absPath: jsonPath,
			},
			{
				relPath: ".wiki/intelligence/workspace-intelligence.md",
				absPath: mdPath,
			},
		]
	}
}

export function renderMarkdownModel(model: WorkspaceCognitiveModel): string {
	const lines: string[] = []

	lines.push(`# Workspace Intelligence: ${model.workspaceName}`)
	lines.push("")
	lines.push(`- Generated At: \`${model.generatedAt}\``)
	lines.push(`- Task ID: \`${model.taskId}\``)
	lines.push(`- Finalization Run ID: \`${model.finalizationRunId}\``)
	lines.push("")

	lines.push("## Source Snapshot Summary", "")
	lines.push(`- Package name: ${model.sourceSnapshot.packageName ? `\`${model.sourceSnapshot.packageName}\`` : "_none_"}`)
	lines.push(
		`- Package version: ${model.sourceSnapshot.packageVersion ? `\`${model.sourceSnapshot.packageVersion}\`` : "_none_"}`,
	)
	lines.push(`- Detected manifests: ${model.sourceSnapshot.manifests.map((m) => `\`${m}\``).join(", ") || "_none_"}`)
	lines.push(
		`- Preferred validation scripts: ${model.sourceSnapshot.preferredCommands.map((c) => `\`${c}\``).join(", ") || "_none_"}`,
	)

	lines.push("", "## Drift Findings", "")
	if (!model.driftFindings.length) {
		lines.push("_No drift findings detected in this pass._")
	} else {
		lines.push("| Severity | Kind | Finding |")
		lines.push("|---|---|---|")
		for (const finding of model.driftFindings) {
			lines.push(`| ${finding.severity} | ${finding.kind} | ${escapeTableCell(finding.summary)} |`)
		}
	}

	lines.push("", "## Workspace State Projections", "")
	lines.push("### Stable Subsystems")
	lines.push(
		renderProvenanceFactsMarkdown(
			model.facts.filter(
				(f) => f.type === "subsystem_stability" && (f.value as SubsystemStabilityFact)?.status === "stable",
			),
		),
	)
	lines.push("", "### Volatile Subsystems")
	lines.push(
		renderProvenanceFactsMarkdown(
			model.facts.filter(
				(f) => f.type === "subsystem_stability" && (f.value as SubsystemStabilityFact)?.status === "volatile",
			),
		),
	)
	lines.push("", "### Recent Architecture Decisions")
	lines.push(
		renderProvenanceFactsMarkdown(
			model.facts.filter((f) => f.type === "architecture_decision"),
			(d: { id: string; title: string; status: string }) => `${d.id}: ${d.title} (${d.status})`,
		),
	)
	lines.push("", "### Stale Documentation Surfaces")
	lines.push(
		renderProvenanceFactsMarkdown(
			model.facts.filter((f) => f.type === "documentation_surface"),
			(v: { summary: string }) => v.summary,
		),
	)
	lines.push("", "### Recurring Risk Areas")
	lines.push(
		renderProvenanceFactsMarkdown(
			model.facts.filter((f) => f.type === "risk_area"),
			(v: { risk: string }) => v.risk,
		),
	)
	lines.push("", "### Handoff-Relevant Facts")
	lines.push(
		renderProvenanceFactsMarkdown(
			model.facts.filter((f) => f.type === "handoff_fact"),
			(v: { fact: string }) => v.fact,
		),
	)

	lines.push("", "## Meta Reflection", "")
	lines.push("### Repeated Friction")
	lines.push(markdownList(model.metaReflection.repeatedFriction))
	lines.push("", "### Rediscovery Costs")
	lines.push(markdownList(model.metaReflection.rediscoveryCosts))
	lines.push("", "### Self Improvements")
	lines.push(markdownList(model.metaReflection.selfImprovements))
	lines.push("")

	return `${lines.join("\n")}\n`
}

function renderProvenanceFactsMarkdown<T>(
	facts: Array<import("./types").WorkspaceFact> | undefined,
	renderer: (value: T) => string = (v) => String(v),
): string {
	if (!facts || !facts.length) return "_None recorded._"
	const lines: string[] = []
	for (const fact of facts) {
		lines.push(
			`- **${renderer(fact.value as T)}** (confidence: \`${fact.confidence}\`, lifecycle: \`${fact.lifecycle}\`, updated: \`${fact.lastUpdated}\`)`,
		)
		for (const prov of fact.provenance) {
			const typeIcon =
				prov.type === "finalization_evidence" ? "📜" : prov.type === "manifest" ? "📦" : prov.type === "adr" ? "🏛️" : "📁"
			const runInfo = prov.runId ? ` [run: \`${prov.runId.slice(0, 8)}\`]` : ""
			const pathInfo = prov.path ? ` in \`${prov.path}\`` : ""
			lines.push(`  - ${typeIcon} *${prov.description}*${pathInfo}${runInfo} (at \`${prov.timestamp}\`)`)
		}
	}
	return lines.join("\n")
}

function markdownList(items: string[]): string {
	if (!items.length) return "_None recorded._"
	return items.map((item) => `- ${item}`).join("\n")
}

function escapeTableCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>")
}
