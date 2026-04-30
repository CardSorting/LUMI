import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as fs from "fs"
import * as nodePath from "path"
import { DietCodeDefaultTool } from "@/shared/tools"
import { SpiderEngine } from "../../../policy/spider/SpiderEngine"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

type ProjectMapItem = {
	path: string
	reason: string
	weight: number
}

type ProjectMapRisk = {
	path?: string
	level: "info" | "warning" | "high"
	reason: string
}

type ProjectMapEvidence = {
	type: "spider" | "broccolidb" | "disk"
	description: string
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

const uniqueRisks = (items: ProjectMapRisk[]): ProjectMapRisk[] => {
	const seen = new Set<string>()
	return items.filter((item) => {
		const key = `${item.path ?? "workspace"}:${item.level}:${item.reason}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
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
			const engine = new SpiderEngine(config.cwd)
			await engine.loadRegistry()
			await engine.synchronizeRegistry().catch(() => undefined)

			const startingPoint: ProjectMapItem[] = []
			const connections: ProjectMapItem[] = []
			const risks: ProjectMapRisk[] = []
			const suggestedReads = new Set<string>()
			const suggestedSearches = new Set<string>()
			const factChecks: string[] = []
			const evidence: ProjectMapEvidence[] = []
			let staleGraph = false

			const addItem = (collection: ProjectMapItem[], path: string, reason: string, weight: number) => {
				if (!path) return
				collection.push({ path, reason, weight })
				if (suggestedReads.size < maxFiles) suggestedReads.add(path)
				if (!fileExists(config.cwd, path)) {
					staleGraph = true
					risks.push({
						path,
						level: "warning",
						reason: "The map references this file, but it was not found on disk. Verify the graph is fresh before relying on it.",
					})
				}
			}

			const normalizedPath = pathParam ? engine.normalizePath(pathParam) : undefined
			const targetNode = normalizedPath ? engine.nodes.get(normalizedPath) : undefined

			if (targetNode) {
				evidence.push({ type: "spider", description: `Resolved requested path to ${targetNode.path}.` })
				addItem(startingPoint, targetNode.path, "Starting file from the request", 1)
				const neighborhood = new Set<string>([...targetNode.imports, ...targetNode.dependents])
				for (const neighbor of neighborhood) {
					if (neighbor !== targetNode.path && engine.nodes.has(neighbor)) {
						addItem(connections, neighbor, "Nearby file in the project map", 0.82)
					}
				}
				for (const resolved of targetNode.imports) {
					addItem(connections, resolved, "File this starting point depends on", 0.9)
				}
				const dependents = targetNode.dependents
					.map((dependentId) => engine.nodes.get(dependentId))
					.filter((node): node is NonNullable<typeof node> => Boolean(node))
				for (const dependent of dependents.slice(0, maxFiles)) {
					addItem(connections, dependent.path, "File that uses the starting point", 0.85)
				}
				if ((targetNode.blastRadius || 0) > 0.5 || targetNode.afferentCoupling > 5) {
					risks.push({
						path: targetNode.path,
						level: targetNode.afferentCoupling > 10 ? "high" : "warning",
						reason: `Many files may rely on this area (${targetNode.afferentCoupling} incoming links, blast radius ${Math.round((targetNode.blastRadius || 0) * 100)}%).`,
					})
				}
				suggestedSearches.add(`import.*${escapeRegex(nodePath.basename(targetNode.path))}`)
				for (const exp of targetNode.exports.slice(0, 5)) suggestedSearches.add(`\\b${exp}\\b`)
				factChecks.push(`Read ${targetNode.path} and verify its imports/exports before editing.`)
				evidence.push({ type: "disk", description: `Suggested reading ${targetNode.path} as the primary fact check.` })
			} else if (pathParam) {
				staleGraph = true
				risks.push({
					path: pathParam,
					level: "warning",
					reason: "Requested path was not present in the project map. Use disk reads/searches to confirm whether it exists or the map is stale.",
				})
				if (fileExists(config.cwd, pathParam)) suggestedReads.add(pathParam)
				factChecks.push(`Check whether ${pathParam} exists and whether the project map needs refreshing.`)
			}

			if (symbolParam) {
				const providers = engine.findSymbolProviders(symbolParam)
				evidence.push({ type: "spider", description: `Found ${providers.length} provider(s) for '${symbolParam}'.` })
				for (const provider of providers.slice(0, maxFiles)) {
					addItem(startingPoint, provider, `Provides symbol '${symbolParam}'`, 0.95)
				}
				suggestedSearches.add(`\\b${symbolParam}\\b`)
				factChecks.push(`Search for '${symbolParam}' to confirm definitions and usages on disk.`)
				if (providers.length > 1) {
					for (const provider of providers) {
						risks.push({
							path: provider,
							level: "warning",
							reason: `Multiple files provide '${symbolParam}', so confirm the intended one.`,
						})
					}
				}
				if (providers.length === 0) {
					risks.push({
						level: "warning",
						reason: `No project-map provider was found for '${symbolParam}'. Verify with an exact symbol search.`,
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
				risks.push({
					path: node.path,
					level: (node.hazardScore || 0) > 0.8 ? "high" : "warning",
					reason: "Project risk area detected by structural analysis.",
				})
			}

			if (staleGraph) {
				factChecks.push(
					"Some mapped paths did not match the current workspace. Treat the map as needing review and verify with exact searches/reads.",
				)
			}

			const reads = Array.from(suggestedReads).slice(0, maxFiles)
			const searches = Array.from(suggestedSearches).slice(0, 8)
			const confidence = Math.min(
				0.95,
				0.35 +
					(startingPoint.length > 0 ? 0.25 : 0) +
					(connections.length > 0 ? 0.2 : 0) +
					(factChecks.length > 0 ? 0.15 : 0),
			)

			return formatResponse.toolResult(
				JSON.stringify(
					{
						title: "Project Map",
						summary: "Use this map first, then verify with the suggested searches/reads before presenting a plan.",
						startingPoint: uniqueByPathAndReason(startingPoint).slice(0, maxFiles),
						connections: uniqueByPathAndReason(connections)
							.sort((a, b) => b.weight - a.weight)
							.slice(0, maxFiles),
						risks: uniqueRisks(risks).slice(0, maxFiles),
						factChecks:
							factChecks.length > 0
								? factChecks
								: ["Use the suggested searches and reads to confirm this map against workspace files."],
						suggestedReads: reads,
						suggestedSearches: searches,
						...(includeEvidence ? { evidence: evidence.slice(0, 12) } : {}),
						confidence: staleGraph ? Math.min(confidence, 0.55) : confidence,
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
