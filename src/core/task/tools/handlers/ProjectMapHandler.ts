import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as fs from "fs"
import * as nodePath from "path"
import { DietCodeDefaultTool } from "@/shared/tools"
import { SpiderEngine } from "../../../policy/spider/SpiderEngine"
import { resolveSessionSpiderEngine } from "../executionAuthority"
import type { TaskConfig } from "../types/TaskConfig"
import type { IToolHandler, ToolResponse } from "../types/ToolContracts"

type ProjectMapItem = {
	path: string
	reason: string
	weight: number
	category?: "main" | "depends_on" | "used_by" | "often_changes_with" | "candidate" | "risk"
}

type ProjectMapRisk = {
	path?: string
	level: "info" | "warning" | "high"
	reason: string
	mitigation?: string
}

type ProjectMapEvidence = {
	type: "spider" | "broccolidb" | "disk"
	description: string
}

type ProjectMapChoice = {
	label: string
	description: string
	whenToUse: string
}

const clampLimit = (value: unknown, fallback = 12): number => {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
	if (!Number.isFinite(parsed)) return fallback
	return Math.max(3, Math.min(30, parsed))
}

const uniqueByPathAndReason = <T extends { path: string; reason?: string }>(items: T[]): T[] => {
	const seen = new Set<string>()
	return items.filter((item) => {
		const key = `${item.path}:${item.reason ?? ""}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const asBoolean = (value: unknown, fallback = true): boolean => {
	if (typeof value === "boolean") return value
	if (typeof value === "string") return value.toLowerCase() !== "false"
	return fallback
}

const tokenizeQuery = (query: string): string[] =>
	query
		.toLowerCase()
		.split(/[^a-z0-9_/-]+/i)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3)

const fileExists = (cwd: string, relPath: string): boolean => fs.existsSync(nodePath.resolve(cwd, relPath))

const toDiskPath = (cwd: string, relPath: string): string | undefined => {
	if (!relPath) return undefined
	if (fileExists(cwd, relPath)) return relPath
	const withoutQuery = relPath.split(/[?#]/)[0]
	if (withoutQuery && fileExists(cwd, withoutQuery)) return withoutQuery
	return undefined
}

const uniqueRisks = (items: ProjectMapRisk[]): ProjectMapRisk[] => {
	const seen = new Set<string>()
	return items.filter((item) => {
		const key = `${item.path ?? "workspace"}:${item.level}:${item.reason}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

const levelRank: Record<ProjectMapRisk["level"], number> = { info: 1, warning: 2, high: 3 }

const summarizeConfidence = (confidence: number, staleGraph: boolean, riskCount: number): string => {
	if (staleGraph) return "Needs review: the map may be stale, so verify paths before planning."
	if (confidence >= 0.8 && riskCount === 0) return "High: map and verification suggestions are well aligned."
	if (confidence >= 0.65) return "Medium-high: enough context to plan after targeted fact checks."
	if (confidence >= 0.5) return "Medium: use suggested searches/reads before committing to scope."
	return "Low: ask a clarifying question or run a narrow search before planning."
}

const buildChoices = (risks: ProjectMapRisk[], staleGraph: boolean): ProjectMapChoice[] => {
	const hasHighRisk = risks.some((risk) => risk.level === "high") || staleGraph
	return [
		{
			label: "Safe/minimal fix",
			description: "Change the smallest verified file set and avoid refactors.",
			whenToUse: hasHighRisk
				? "Best when stale map warnings or high-impact files are present."
				: "Best when the user wants the lowest-risk path.",
		},
		{
			label: "Recommended balanced approach",
			description: "Edit the main files plus directly connected files that verification confirms.",
			whenToUse: "Best default for most implementation plans.",
		},
		{
			label: "Larger cleanup/refactor",
			description: "Address adjacent risk areas or cleanup opportunities while implementing the change.",
			whenToUse: hasHighRisk
				? "Use only with explicit approval because the map shows elevated risk."
				: "Use when the user values long-term maintainability over minimal scope.",
		},
	]
}

/**
 * ProjectMapHandler: A user-friendly planning context pack.
 *
 * It uses Spider first to map structural reality, enriches with BroccoliDB's
 * knowledge graph when available, then returns targeted fact-check probes so
 * agents verify with grep/read instead of blindly exploring the workspace.
 */
export class ProjectMapHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.PROJECT_MAP

	getDescription(block: ToolUse): string {
		const target = block.params.path || block.params.symbol || block.params.query || "workspace"
		return `[project map for '${target}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const pathParam = block.params.path?.trim()
		const symbolParam = block.params.symbol?.trim()
		const queryParam = block.params.query?.trim()
		const maxFiles = clampLimit(block.params.maxFiles)
		const includeEvidence = asBoolean(block.params.includeEvidence)

		try {
			let engine = resolveSessionSpiderEngine(config)
			if (!engine || engine.nodes.size === 0) {
				engine = new SpiderEngine(config.cwd)
				await engine.loadRegistry()
			} else {
				void engine.synchronizeRegistry().catch(() => undefined)
			}

			const startingPoint: ProjectMapItem[] = []
			const connections: ProjectMapItem[] = []
			const risks: ProjectMapRisk[] = []
			const suggestedReads = new Set<string>()
			const suggestedSearches = new Set<string>()
			const factChecks: string[] = []
			const evidence: ProjectMapEvidence[] = []
			let staleGraph = false

			const addItem = (
				collection: ProjectMapItem[],
				path: string,
				reason: string,
				weight: number,
				category?: ProjectMapItem["category"],
			) => {
				if (!path) return
				const diskPath = toDiskPath(config.cwd, path)
				collection.push({ path, reason, weight, category })
				if (diskPath && suggestedReads.size < maxFiles) suggestedReads.add(diskPath)
				if (!diskPath) {
					staleGraph = true
					risks.push({
						path,
						level: "warning",
						reason: "The map references this file, but it was not found on disk. Verify the graph is fresh before relying on it.",
						mitigation: "Run an exact file search/read check before including this path in the implementation plan.",
					})
				}
			}

			const addRisk = (risk: ProjectMapRisk) => risks.push(risk)

			const normalizedPath = pathParam ? engine.normalizePath(pathParam) : undefined
			const targetNode = normalizedPath ? engine.nodes.get(normalizedPath) : undefined

			if (targetNode) {
				evidence.push({ type: "spider", description: `Resolved requested path to ${targetNode.path}.` })
				addItem(startingPoint, targetNode.path, "Starting file from the request", 1, "main")
				const resolvedImports = targetNode.imports
					.map((specifier) => engine.resolveImportToNodeId(targetNode.path, specifier) || specifier)
					.filter(Boolean)
				const neighborhood = new Set<string>([...resolvedImports, ...targetNode.dependents])
				for (const neighbor of neighborhood) {
					if (neighbor !== targetNode.path && engine.nodes.has(neighbor)) {
						addItem(connections, neighbor, "Nearby file in the project map", 0.82, "candidate")
					}
				}
				for (const resolved of resolvedImports) {
					addItem(connections, resolved, "File this starting point depends on", 0.9, "depends_on")
				}
				const dependents = targetNode.dependents
					.map((dependentId) => engine.nodes.get(dependentId))
					.filter((node): node is NonNullable<typeof node> => Boolean(node))
				for (const dependent of dependents.slice(0, maxFiles)) {
					addItem(connections, dependent.path, "File that uses the starting point", 0.85, "used_by")
				}
				if ((targetNode.blastRadius || 0) > 0.5 || targetNode.afferentCoupling > 5) {
					addRisk({
						path: targetNode.path,
						level: targetNode.afferentCoupling > 10 ? "high" : "warning",
						reason: `Many files may rely on this area (${targetNode.afferentCoupling} incoming links, blast radius ${Math.round((targetNode.blastRadius || 0) * 100)}%).`,
						mitigation: "Prefer a minimal change and verify direct dependents before implementation.",
					})
				}
				if ((targetNode.anyDensity || 0) > 0.2 || (targetNode.cognitiveComplexity || 0) > 0.6) {
					addRisk({
						path: targetNode.path,
						level: "warning",
						reason: "This file appears complex or weakly typed, so changes may be harder to review safely.",
						mitigation:
							"Keep edits small, preserve existing interfaces, and add focused validation around changed behavior.",
					})
				}
				suggestedSearches.add(`import.*${escapeRegex(nodePath.basename(targetNode.path))}`)
				for (const exp of targetNode.exports.slice(0, 5)) suggestedSearches.add(`\\b${exp}\\b`)
				factChecks.push(`Read ${targetNode.path} and verify its imports/exports before editing.`)
				evidence.push({ type: "disk", description: `Suggested reading ${targetNode.path} as the primary fact check.` })
			} else if (pathParam) {
				staleGraph = true
				addRisk({
					path: pathParam,
					level: "warning",
					reason: "Requested path was not present in the project map. Use disk reads/searches to confirm whether it exists or the map is stale.",
					mitigation: "Verify the path on disk and avoid relying on graph-only context for this request.",
				})
				if (fileExists(config.cwd, pathParam)) suggestedReads.add(pathParam)
				factChecks.push(`Check whether ${pathParam} exists and whether the project map needs refreshing.`)
			}

			if (symbolParam) {
				const providers = engine.findSymbolProviders(symbolParam)
				evidence.push({ type: "spider", description: `Found ${providers.length} provider(s) for '${symbolParam}'.` })
				for (const provider of providers.slice(0, maxFiles)) {
					addItem(startingPoint, provider, `Provides symbol '${symbolParam}'`, 0.95, "main")
				}
				suggestedSearches.add(`\\b${symbolParam}\\b`)
				factChecks.push(`Search for '${symbolParam}' to confirm definitions and usages on disk.`)
				if (providers.length > 1) {
					for (const provider of providers) {
						addRisk({
							path: provider,
							level: "warning",
							reason: `Multiple files provide '${symbolParam}', so confirm the intended one.`,
							mitigation: "Use exact definition and usage searches before selecting the implementation target.",
						})
					}
				}
				if (providers.length === 0) {
					addRisk({
						level: "warning",
						reason: `No project-map provider was found for '${symbolParam}'. Verify with an exact symbol search.`,
						mitigation: "Search the workspace for the symbol before presenting implementation options.",
					})
				}
			}

			if (!targetNode && !symbolParam && queryParam) {
				const tokens = tokenizeQuery(queryParam)
				const candidates = Array.from(engine.nodes.values())
					.map((node) => {
						const haystack = `${node.path} ${node.exports.join(" ")}`.toLowerCase()
						const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0)
						return { node, score }
					})
					.filter(({ score }) => score > 0)
					.sort((a, b) => b.score - a.score)
					.map(({ node, score }) => ({ node, score }))
					.slice(0, maxFiles)
				for (const candidate of candidates)
					addItem(
						startingPoint,
						candidate.node.path,
						"Matched the request wording",
						Math.min(0.9, 0.55 + candidate.score * 0.1),
						"candidate",
					)
				for (const token of tokens.slice(0, 4)) suggestedSearches.add(escapeRegex(token))
				evidence.push({ type: "spider", description: `Matched query tokens against file paths and exported symbols.` })
			}

			const semanticPath = targetNode?.path || normalizedPath || pathParam
			if (semanticPath && config.services.knowledgeGraphService) {
				try {
					const semantic = await config.services.knowledgeGraphService.getContextGraph(
						config.taskId,
						semanticPath,
						maxFiles,
					)
					for (const item of semantic) {
						addItem(
							connections,
							item.path,
							`Often changes with the starting point (weight ${item.weight})`,
							Number(item.weight) || 0.5,
							"often_changes_with",
						)
					}
					evidence.push({
						type: "broccolidb",
						description: `Added ${semantic.length} semantic/co-change connection(s).`,
					})
				} catch {
					// Knowledge graph may be unavailable in some hosts; Spider still provides the map.
				}
			}

			const hotspotNodes = Array.from(engine.nodes.values())
				.filter((node) => node.isHotspot || (node.hazardScore || 0) > 0.6)
				.sort((a, b) => (b.hazardScore || 0) - (a.hazardScore || 0))
				.slice(0, 5)
			for (const node of hotspotNodes) {
				addRisk({
					path: node.path,
					level: (node.hazardScore || 0) > 0.8 ? "high" : "warning",
					reason: "Project risk area detected by structural analysis.",
					mitigation: "Treat as a review hotspot; avoid broad edits unless this file is directly in scope.",
				})
			}

			if (config.services.knowledgeGraphService) {
				try {
					const chokepoints = await config.services.knowledgeGraphService.detectChokepoints(config.taskId, 5)
					for (const choke of chokepoints) {
						if (toDiskPath(config.cwd, choke.path)) {
							addRisk({
								path: choke.path,
								level: choke.score > 10 ? "high" : "warning",
								reason: `Often changes across recent snapshots (churn ${choke.churn}).`,
								mitigation: "Verify whether this churny area is in scope before expanding the plan.",
							})
						}
					}
					evidence.push({
						type: "broccolidb",
						description: `Checked ${chokepoints.length} recent change chokepoint(s).`,
					})
				} catch {
					// Chokepoints are optional enrichment.
				}
			}

			if (staleGraph) {
				factChecks.push(
					"Some mapped paths did not match the current workspace. Treat the map as needing review and verify with exact searches/reads.",
				)
			}

			const reads = Array.from(suggestedReads).slice(0, maxFiles)
			const searches = Array.from(suggestedSearches).slice(0, 8)
			const sortedRisks = uniqueRisks(risks)
				.sort((a, b) => levelRank[b.level] - levelRank[a.level])
				.slice(0, maxFiles)
			const confidence = Math.min(
				0.95,
				Math.max(
					0.1,
					0.35 +
						(startingPoint.length > 0 ? 0.25 : 0) +
						(connections.length > 0 ? 0.2 : 0) +
						(factChecks.length > 0 ? 0.15 : 0) -
						(staleGraph ? 0.25 : 0) -
						(sortedRisks.some((risk) => risk.level === "high") ? 0.1 : 0),
				),
			)
			const finalConfidence = staleGraph ? Math.min(confidence, 0.55) : confidence

			return formatResponse.toolResult(
				JSON.stringify(
					{
						title: "Project Map",
						summary: "Use this map first, then verify with the suggested searches/reads before presenting a plan.",
						startingPoint: uniqueByPathAndReason(startingPoint).slice(0, maxFiles),
						connections: uniqueByPathAndReason(connections)
							.sort((a, b) => b.weight - a.weight)
							.slice(0, maxFiles),
						risks: sortedRisks,
						factChecks:
							factChecks.length > 0
								? factChecks
								: ["Use the suggested searches and reads to confirm this map against workspace files."],
						suggestedReads: reads,
						suggestedSearches: searches,
						confidenceSummary: summarizeConfidence(finalConfidence, staleGraph, sortedRisks.length),
						choices: buildChoices(sortedRisks, staleGraph),
						...(includeEvidence ? { evidence: evidence.slice(0, 12) } : {}),
						confidence: finalConfidence,
						staleGraph,
					},
					null,
					2,
				),
			)
		} catch (error) {
			return formatResponse.toolError(`Failed to build project map: ${(error as Error)?.message}`)
		}
	}
}
