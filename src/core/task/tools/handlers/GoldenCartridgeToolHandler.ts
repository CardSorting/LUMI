import type { ToolUse } from "@core/assistant-message"
import {
	type CommandExecutionEvidence,
	commandOutputSummary,
	readCommandExecutionEvidence,
} from "@shared/command-execution-evidence"
import type { ApprovalRequirement } from "@shared/execution/executionFunnelEvent"
import type {
	GoldenCartridgeEvidence,
	GoldenCartridgeResult,
	GoldenCartridgeSideEffects,
	GoldenCartridgeValidationObservation,
	GoldenCartridgeVerb,
	SolutionCandidate,
} from "@shared/golden-cartridge"
import { DietCodeDefaultTool } from "@shared/tools"
import { NativeMutationManager } from "@/services/mutation/NativeMutationManager"
import { executionFunnel } from "../execution/ExecutionFunnel"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import { declareApprovalIntent, type IToolHandler, type ToolResponse } from "../types/ToolContracts"
import { ApplyPatchHandler } from "./ApplyPatchHandler"
import { CognitiveMemorySnapshotHandler } from "./CognitiveMemorySnapshotHandler"
import { CondenseHandler } from "./CondenseHandler"
import { ExecuteCommandToolHandler } from "./ExecuteCommandToolHandler"
import { ListCodeDefinitionNamesToolHandler } from "./ListCodeDefinitionNamesToolHandler"
import { ProjectMapHandler } from "./ProjectMapHandler"
import { SearchFilesToolHandler } from "./SearchFilesToolHandler"

type Payload = Record<string, unknown>

export interface GoldenCartridgeAdapters {
	projectMap: IToolHandler
	search: IToolHandler
	definitions: IToolHandler
	snapshot: IToolHandler
	condense: IToolHandler
	patch: IToolHandler
	command: IToolHandler
}

const PROJECTION_ONLY: GoldenCartridgeSideEffects = {
	readsRepository: false,
	releasesActiveContext: false,
	executesCommands: false,
	mayMutateViaDelegatedPrimitive: false,
	projectionOnly: true,
}

const SIDE_EFFECTS: Record<GoldenCartridgeVerb, GoldenCartridgeSideEffects> = {
	trace: { ...PROJECTION_ONLY, readsRepository: true, projectionOnly: false },
	slice: { ...PROJECTION_ONLY, readsRepository: true, projectionOnly: false },
	resolve_authority: { ...PROJECTION_ONLY, readsRepository: true, projectionOnly: false },
	find_reuse: { ...PROJECTION_ONLY, readsRepository: true, projectionOnly: false },
	compress: { ...PROJECTION_ONLY, releasesActiveContext: true, projectionOnly: false },
	compare_mass: PROJECTION_ONLY,
	design_compact: PROJECTION_ONLY,
	patch_smallest: { ...PROJECTION_ONLY, mayMutateViaDelegatedPrimitive: true, projectionOnly: false },
	disprove: { ...PROJECTION_ONLY, executesCommands: true, projectionOnly: false },
	measure: PROJECTION_ONLY,
	reclaim: PROJECTION_ONLY,
	seal: PROJECTION_ONLY,
}

const VERBS = new Set<GoldenCartridgeVerb>(Object.keys(SIDE_EFFECTS) as GoldenCartridgeVerb[])
const asString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined)
const asStrings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
const asEvidence = (value: unknown): GoldenCartridgeEvidence[] =>
	Array.isArray(value)
		? value.flatMap((item) => {
				if (!item || typeof item !== "object") return []
				const record = item as Record<string, unknown>
				const statement = asString(record.statement)
				if (!statement) return []
				const provenance = ["repository", "runtime", "telemetry", "caller", "inference", "unavailable"].includes(
					String(record.provenance),
				)
					? (record.provenance as GoldenCartridgeEvidence["provenance"])
					: "caller"
				return [{ source: asString(record.source) ?? "payload", provenance, statement }]
			})
		: []

function delegatedBlock(name: DietCodeDefaultTool, params: Record<string, string>): ToolUse {
	return { type: "tool_use", name, params, partial: false, isNativeToolCall: true }
}

function responseText(value: ToolResponse): string {
	return typeof value === "string" ? value : JSON.stringify(value)
}

function compactText(value: ToolResponse, limit = 1_200): string {
	const normalized = responseText(value).replace(/\s+/g, " ").trim()
	return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

function parseObject(value: ToolResponse): Record<string, unknown> | undefined {
	const text = responseText(value)
	for (const candidate of [text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
		try {
			const parsed = JSON.parse(candidate)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
		} catch {}
	}
	return undefined
}

const stableUnique = <T>(items: T[], key: (item: T) => string): T[] =>
	[...new Map(items.map((item) => [key(item), item])).values()].sort((a, b) => key(a).localeCompare(key(b)))

function pathsFromText(value: ToolResponse): string[] {
	return stableUnique(
		(responseText(value).match(/[\w@.-]+(?:\/[\w@.\-[\]]+)+\.[a-z0-9]+/gi) ?? []).map((path) => path.replace(/^\.\//, "")),
		(path) => path,
	).slice(0, 12)
}

function stableIdentity(verb: GoldenCartridgeVerb, payload: Payload): string {
	const normalized = Object.fromEntries(
		Object.entries(payload)
			.filter(([key]) => !["refresh", "bypassCache", "execute"].includes(key))
			.sort(([left], [right]) => left.localeCompare(right)),
	)
	return `${verb}:${JSON.stringify(normalized)}`
}

function repositoryIdentity(config: TaskConfig): string {
	return `${config.taskState.goldenCartridgeCanonicalWorkspaceRevision ?? "unknown"}:${config.taskState.goldenCartridgeEvidenceGeneration}`
}

function patchFiles(patch: string): string[] {
	return stableUnique(
		patch.split("\n").flatMap((line) => {
			const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/)
			return match ? [match[1].trim()] : []
		}),
		(path) => path,
	)
}

function commandFailed(output: ToolResponse): boolean {
	const text = responseText(output)
	return /(?:exit code|exited with)\s*[:=]?\s*[1-9]\d*/i.test(text) || /\b(?:command failed|error:)\b/i.test(text)
}

function delegatedFailure(authority: string, output: ToolResponse): GoldenCartridgeEvidence | undefined {
	const text = compactText(output, 400)
	return /(?:^|\b)(?:error|failed|denied|unavailable)(?:\b|:)/i.test(text)
		? { source: authority, provenance: "unavailable", statement: text }
		: undefined
}

function configuredCommands(value: ToolResponse): Array<{ command: string; source: string }> {
	const text = responseText(value)
	const commands: Array<{ command: string; source: string }> = []
	for (const match of text.matchAll(/["'](test(?::[^"']+)?|check|typecheck|lint)["']\s*:\s*["']/gi)) {
		commands.push({ command: `npm run ${match[1]}`, source: "package_script" })
	}
	for (const match of text.matchAll(/(?:^|\n)(test|check|typecheck|lint)\s*:/gi)) {
		commands.push({ command: `make ${match[1]}`, source: "make_target" })
	}
	return [...new Map(commands.map((item) => [item.command, item])).values()]
}

function validationStatus(evidence: CommandExecutionEvidence | undefined): GoldenCartridgeValidationObservation["outcome"] {
	const base = {
		exitCode: evidence?.exitCode,
		signal: evidence?.signal,
		durationMs: evidence?.durationMs,
		approvalStatus: evidence?.approvalStatus ?? ("unknown" as const),
	}
	if (!evidence) return { ...base, status: "inconclusive" }
	if (evidence.approvalStatus === "denied") return { ...base, status: "denied" }
	if (evidence.timedOut) return { ...base, status: "timed_out" }
	if (evidence.executionError || evidence.signal) return { ...base, status: "execution_error" }
	if (!evidence.started || !evidence.completed || evidence.exitCode === undefined) {
		return { ...base, status: "inconclusive" }
	}
	return { ...base, status: evidence.exitCode === 0 ? "passed" : "failed" }
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function candidates(value: unknown): SolutionCandidate[] {
	if (!Array.isArray(value)) return []
	return value.flatMap((item, index) => {
		if (!item || typeof item !== "object") return []
		const candidate = item as SolutionCandidate
		return [
			{ ...candidate, id: asString(candidate.id) ?? `candidate_${index + 1}`, description: candidate.description ?? "" },
		]
	})
}

function massDimensions(candidate: SolutionCandidate) {
	const scopeRank = { focused: 1, integration: 2, subsystem: 3, full: 4 }
	const surfaceRank = { low: 1, medium: 2, high: 3 }
	return {
		existingAuthoritiesReused:
			candidate.existingAuthoritiesReused === undefined ? null : -candidate.existingAuthoritiesReused,
		filesTouched: candidate.filesTouched ?? null,
		publicInterfaces: candidate.publicInterfaces ?? null,
		dependencies: candidate.dependencies ?? null,
		persistedFormats: candidate.persistedFormats ?? null,
		newAuthorities: candidate.newAuthorities ?? null,
		newAbstractions: candidate.newAbstractions ?? null,
		runtimeWork: candidate.runtimeWork ? surfaceRank[candidate.runtimeWork] : null,
		validationScope: candidate.validationScope ? scopeRank[candidate.validationScope] : null,
		regressionExposure: candidate.regressionExposure ? surfaceRank[candidate.regressionExposure] : null,
		reviewBurden: candidate.reviewBurden ? surfaceRank[candidate.reviewBurden] : null,
		removalDifficulty: candidate.removalDifficulty ? surfaceRank[candidate.removalDifficulty] : null,
		maintenanceSurface: candidate.maintenanceSurface ? surfaceRank[candidate.maintenanceSurface] : null,
		correctnessConfidence: candidate.correctnessConfidence ? 4 - surfaceRank[candidate.correctnessConfidence] : null,
		uncertainty: candidate.uncertainty ? surfaceRank[candidate.uncertainty] : null,
	}
}

function deterministicMassComparison(input: SolutionCandidate[]) {
	const assessed = input.map((candidate) => ({ candidate, dimensions: massDimensions(candidate) }))
	const numericKeys = Object.keys(assessed[0]?.dimensions ?? {}) as Array<keyof ReturnType<typeof massDimensions>>
	const dominates = (left: (typeof assessed)[number], right: (typeof assessed)[number]) => {
		const comparable = numericKeys.filter((key) => left.dimensions[key] !== null && right.dimensions[key] !== null)
		return (
			comparable.length > 0 &&
			comparable.every((key) => Number(left.dimensions[key]) <= Number(right.dimensions[key])) &&
			comparable.some((key) => Number(left.dimensions[key]) < Number(right.dimensions[key]))
		)
	}
	const undominated = assessed.filter((left) => !assessed.some((right) => right !== left && dominates(right, left)))
	return {
		candidates: assessed,
		lowestMassCandidate: undominated.length === 1 ? undominated[0].candidate.id : undefined,
		strongestCorrectnessCandidate: [...assessed]
			.filter((item) => item.dimensions.correctnessConfidence !== null)
			.sort(
				(a, b) =>
					Number(a.dimensions.correctnessConfidence) - Number(b.dimensions.correctnessConfidence) ||
					a.candidate.id.localeCompare(b.candidate.id),
			)[0]?.candidate.id,
		tradeoffs:
			undominated.length > 1
				? [`No single candidate dominates: ${undominated.map((item) => item.candidate.id).join(", ")}.`]
				: [],
		insufficientEvidence: assessed
			.filter((item) => numericKeys.every((key) => item.dimensions[key] === null))
			.map((item) => item.candidate.id),
		conditionsThatChangeRecommendation: assessed
			.filter((item) => item.dimensions.uncertainty === null)
			.map((item) => `Resolve uncertainty for ${item.candidate.id}.`),
	}
}

export class GoldenCartridgeToolHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.GOLDEN_CARTRIDGE

	constructor(private readonly adapters: GoldenCartridgeAdapters) {}

	static fromValidator(validator: ToolValidator): GoldenCartridgeToolHandler {
		return new GoldenCartridgeToolHandler({
			projectMap: new ProjectMapHandler(),
			search: new SearchFilesToolHandler(validator),
			definitions: new ListCodeDefinitionNamesToolHandler(validator),
			snapshot: new CognitiveMemorySnapshotHandler(),
			condense: new CondenseHandler(),
			patch: new ApplyPatchHandler(validator),
			command: new ExecuteCommandToolHandler(validator),
		})
	}

	getDescription(block: ToolUse): string {
		return `[golden cartridge: ${block.params.verb ?? "unknown"}]`
	}

	getApprovalIntent(block: ToolUse) {
		let payload: Payload = {}
		try {
			const parsed = block.params.payload ? JSON.parse(block.params.payload) : {}
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Payload
		} catch {
			// Malformed payload is operation validation; the intent remains a fail-closed read declaration.
		}
		const verb = block.params.verb as GoldenCartridgeVerb | undefined
		const target = asString(payload.target) ?? asString(payload.path) ?? "."
		const declaredCommands = [
			...new Set([...asStrings(payload.proposedCommands), ...asStrings(payload.knownRepositoryCommands)]),
		]
		const requirements: ApprovalRequirement[] = [
			{
				capability: "workspace_read" as const,
				scope: "workspace" as const,
				risk: "low" as const,
				requestedSideEffects: ["inspect repository evidence"],
				autoApprovalEligible: true,
			},
		]
		if (verb === "compress") {
			requirements.push({
				capability: "internal_state",
				risk: "elevated",
				requestedSideEffects: ["replace active context or persist cognitive memory"],
				autoApprovalEligible: false,
			})
		}
		if (verb === "patch_smallest") {
			const files = patchFiles(asString(payload.proposedChange) ?? "")
			for (const filePath of files) {
				requirements.push({
					capability: "workspace_write",
					path: filePath,
					risk: "high",
					requestedSideEffects: ["apply delegated workspace patch"],
					autoApprovalEligible: true,
				})
			}
		}
		if (verb === "disprove" && payload.execute !== false) {
			requirements.push({
				capability: "command",
				risk: payload.requiresApproval === false ? "elevated" : "high",
				requestedSideEffects: ["execute delegated validation command"],
				autoApprovalEligible: true,
			})
		}
		return declareApprovalIntent(block, {
			description: `Run Golden Cartridge ${verb ?? "operation"}`,
			requirements,
			notification: `DietCode wants to run Golden Cartridge ${verb ?? "operation"}`,
			normalizedArguments: {
				verb: verb ?? "unknown",
				target,
				commands: declaredCommands,
			},
		})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const verb = block.params.verb as GoldenCartridgeVerb | undefined
		if (!verb || !VERBS.has(verb)) return `Error: Unknown Golden Cartridge verb '${verb ?? ""}'.`

		let payload: Payload = {}
		if (block.params.payload) {
			try {
				const parsed = JSON.parse(block.params.payload)
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload must be an object")
				payload = parsed as Payload
			} catch (error) {
				return `Error: Invalid Golden Cartridge payload: ${(error as Error).message}`
			}
		}

		try {
			const canonicalRevision = config.cwd
				? await NativeMutationManager.getInstance().getWorkspaceRevision(config.cwd)
				: config.taskState.goldenCartridgeCanonicalWorkspaceRevision
			if (
				config.taskState.goldenCartridgeCanonicalWorkspaceRevision !== undefined &&
				canonicalRevision !== undefined &&
				config.taskState.goldenCartridgeCanonicalWorkspaceRevision !== canonicalRevision
			) {
				const invalidated = config.taskState.goldenCartridgeEvidenceCache.size
				config.taskState.goldenCartridgeEvidenceCache.clear()
				config.taskState.goldenCartridgeMetrics.evidenceItemsInvalidated += invalidated
				config.taskState.goldenCartridgeMetrics.repositoryRevisionChanges++
				config.taskState.goldenCartridgeMetrics.validationInvalidated +=
					config.taskState.goldenCartridgeValidationHistory.filter(
						(item) => !item.repositoryRevision.startsWith(`${canonicalRevision}:`),
					).length
			}
			if (canonicalRevision !== undefined) config.taskState.goldenCartridgeCanonicalWorkspaceRevision = canonicalRevision
			if (!config.taskState.didEditFile) {
				config.taskState.goldenCartridgeObservedMutationFlag = false
			} else if (!config.taskState.goldenCartridgeObservedMutationFlag) {
				const invalidated = config.taskState.goldenCartridgeEvidenceCache.size
				config.taskState.goldenCartridgeObservedMutationFlag = true
				config.taskState.goldenCartridgeEvidenceGeneration++
				config.taskState.goldenCartridgeEvidenceCache.clear()
				config.taskState.goldenCartridgeMetrics.evidenceItemsInvalidated += invalidated
			}
			config.taskState.goldenCartridgeMetrics.callsByVerb[verb] =
				(config.taskState.goldenCartridgeMetrics.callsByVerb[verb] ?? 0) + 1
			const cacheable = ["trace", "slice", "resolve_authority", "find_reuse"].includes(verb)
			const cacheKey = stableIdentity(verb, payload)
			const cached = config.taskState.goldenCartridgeEvidenceCache.get(cacheKey)
			if (
				cacheable &&
				payload.refresh !== true &&
				payload.bypassCache !== true &&
				cached?.revision === config.taskState.goldenCartridgeEvidenceGeneration
			) {
				config.taskState.goldenCartridgeMetrics.cacheHits++
				config.taskState.goldenCartridgeMetrics.repositoryCollectionsReused++
				config.taskState.goldenCartridgeMetrics.evidenceItemsReused += cached.evidence.length
				return JSON.stringify({
					...(cached.result as GoldenCartridgeResult),
					observations: {
						...((cached.result as GoldenCartridgeResult).observations ?? {}),
						evidenceReused: true,
						revisionSource: "NativeMutationManager.workspaceRevision + task mutation signal",
						externalStaleRisk: "Changes outside canonical mutation tracking may require refresh: true.",
					},
				})
			}
			if (cacheable) config.taskState.goldenCartridgeMetrics.cacheMisses++
			const result = await this.dispatch(config, block, verb, payload)
			if (!["measure", "seal"].includes(verb)) config.taskState.goldenCartridgeRecentResults.set(verb, result.result)
			if (cacheable) {
				config.taskState.goldenCartridgeEvidenceCache.set(cacheKey, {
					revision: config.taskState.goldenCartridgeEvidenceGeneration,
					verb,
					result,
					evidence: result.evidence,
					createdAt: Date.now(),
				})
				result.observations = { ...(result.observations ?? {}), evidenceReused: false }
			}
			return JSON.stringify(result, null, 2)
		} catch (error) {
			const failure: GoldenCartridgeResult = {
				verb,
				summary: `${verb} failed in its delegated authority: ${error instanceof Error ? error.message : String(error)}`,
				evidence: [],
				result: { error: error instanceof Error ? error.message : String(error) },
				limitations: ["The underlying primitive failure was preserved; no fallback work was started."],
				sideEffects: SIDE_EFFECTS[verb],
			}
			return JSON.stringify(failure, null, 2)
		}
	}

	private envelope<T>(
		verb: GoldenCartridgeVerb,
		summary: string,
		result: T,
		evidence: GoldenCartridgeEvidence[] = [],
		extra: Pick<GoldenCartridgeResult, "limitations" | "suggestedNextVerb" | "observations"> = {},
	): GoldenCartridgeResult<T> {
		return { verb, summary, evidence, result, sideEffects: SIDE_EFFECTS[verb], ...extra }
	}

	private async dispatch(
		config: TaskConfig,
		parentBlock: ToolUse,
		verb: GoldenCartridgeVerb,
		payload: Payload,
	): Promise<GoldenCartridgeResult> {
		const target = asString(payload.target)
		const question = asString(payload.question)
		const suppliedEvidence = asEvidence(payload.evidence ?? payload.workingSet ?? payload.validationEvidence)

		switch (verb) {
			case "trace": {
				const output = await executionFunnel.dispatchAuthorizedDelegatedOperation(
					config,
					parentBlock,
					delegatedBlock(DietCodeDefaultTool.PROJECT_MAP, {
						query: question ?? target ?? "",
						symbol: target ?? "",
						maxFiles: "8",
					}),
					this.adapters.projectMap,
				)
				const map = parseObject(output)
				const mapFailure = delegatedFailure("project_map", output)
				const starts = Array.isArray(map?.startingPoint) ? (map.startingPoint as Array<Record<string, unknown>>) : []
				const connections = Array.isArray(map?.connections) ? (map.connections as Array<Record<string, unknown>>) : []
				const orderedCandidates = [
					...starts.sort((left, right) => String(left.path ?? "").localeCompare(String(right.path ?? ""))),
					...connections.sort(
						(left, right) =>
							Number(right.weight ?? 0) - Number(left.weight ?? 0) ||
							String(left.path ?? "").localeCompare(String(right.path ?? "")),
					),
				]
				const seenPaths = new Set<string>()
				const nodes = orderedCandidates
					.filter((item) => {
						const path = String(item.path ?? "")
						if (!path || seenPaths.has(path)) return false
						seenPaths.add(path)
						return true
					})
					.slice(0, 6)
				const confidence = typeof map?.confidence === "number" ? map.confidence : 0
				const criticalPath = nodes.map((item, index) => ({
					from: index === 0 ? (target ?? question ?? "reported requirement") : String(nodes[index - 1].path),
					to: String(item.path),
					relation: String(item.reason ?? item.category ?? "mapped connection"),
					confidence: Math.max(0.1, Math.min(confidence, Number(item.weight ?? confidence) || confidence)),
					evidenceSource: "project_map",
				}))
				const testPaths = nodes.map((item) => String(item.path)).filter((path) => /(?:test|spec)/i.test(path))
				return this.envelope(
					verb,
					"Projected the shortest supported, deduplicated route from the canonical project map.",
					{
						start: target ?? question,
						criticalPath,
						callersAndConsumers: connections.slice(0, 5).map((item) => item.path),
						candidateAuthority: starts[0]?.path,
						candidateMutationBoundary: starts[0]?.path,
						tests: stableUnique(testPaths, (path) => path),
						unresolvedEdges: Array.isArray(map?.factChecks)
							? map.factChecks
							: ["Project-map structure was unavailable."],
					},
					[
						...suppliedEvidence,
						...(mapFailure ? [mapFailure] : []),
						{
							source: "project_map",
							provenance: "repository",
							statement: "Structural route returned by the existing project-map authority.",
						},
					],
					{
						limitations: criticalPath.length
							? ["Candidate authority remains an inference until writers and consumers are verified."]
							: [compactText(output, 300)],
						suggestedNextVerb: "slice",
					},
				)
			}
			case "slice": {
				const operations: Array<{ authority: string; output: string }> = []
				if (target) {
					const definitions = await executionFunnel.dispatchAuthorizedDelegatedOperation(
						config,
						parentBlock,
						delegatedBlock(DietCodeDefaultTool.LIST_CODE_DEF, { path: target }),
						this.adapters.definitions,
					)
					operations.push({ authority: "list_code_definition_names", output: responseText(definitions) })
				}
				if (question) {
					const search = await executionFunnel.dispatchAuthorizedDelegatedOperation(
						config,
						parentBlock,
						delegatedBlock(DietCodeDefaultTool.SEARCH, {
							path: target ?? ".",
							regex: escapeRegex(question),
							file_pattern: "*",
						}),
						this.adapters.search,
					)
					operations.push({ authority: "search_files", output: responseText(search) })
				}
				const referencedPaths = stableUnique(
					operations.flatMap((item) => pathsFromText(item.output)),
					(path) => path,
				)
				return this.envelope(
					verb,
					"Collected focused definitions and matching source context through existing readers.",
					{
						target,
						definitions: operations
							.filter((item) => item.authority === "list_code_definition_names")
							.map((item) => compactText(item.output, 900)),
						references: referencedPaths,
						tests: referencedPaths.filter((path) => /(?:test|spec)/i.test(path)),
						slice_reason: target
							? "Target definitions plus direct lexical references."
							: "Focused lexical references.",
						omitted_context: ["Unmatched file bodies", "Transitive callers beyond direct evidence"],
						additional_context_available: operations.length > 0,
					},
					operations.map(
						(item) =>
							delegatedFailure(item.authority, item.output) ?? {
								source: item.authority,
								provenance: "repository" as const,
								statement: "Direct output from the existing focused read authority.",
							},
					),
					{
						limitations: operations.length ? undefined : ["Provide target and/or question to select a source slice."],
						suggestedNextVerb: "resolve_authority",
					},
				)
			}
			case "resolve_authority":
			case "find_reuse": {
				const requirement = asString(payload.requirement) ?? question ?? target ?? ""
				const map = await executionFunnel.dispatchAuthorizedDelegatedOperation(
					config,
					parentBlock,
					delegatedBlock(DietCodeDefaultTool.PROJECT_MAP, { query: requirement, path: target ?? "", maxFiles: "10" }),
					this.adapters.projectMap,
				)
				const search = requirement
					? await executionFunnel.dispatchAuthorizedDelegatedOperation(
							config,
							parentBlock,
							delegatedBlock(DietCodeDefaultTool.SEARCH, {
								path: ".",
								regex: escapeRegex(
									requirement
										.split(/\s+/)
										.filter((word) => word.length > 3)
										.slice(0, 3)
										.join("|"),
								),
								file_pattern: "*",
							}),
							this.adapters.search,
						)
					: "No lexical probe supplied."
				const mapObject = parseObject(map)
				const mapped = [
					...(Array.isArray(mapObject?.startingPoint)
						? (mapObject.startingPoint as Array<Record<string, unknown>>)
						: []),
					...(Array.isArray(mapObject?.connections) ? (mapObject.connections as Array<Record<string, unknown>>) : []),
				]
				const startingPaths = new Set(
					(Array.isArray(mapObject?.startingPoint)
						? (mapObject.startingPoint as Array<Record<string, unknown>>)
						: []
					).map((item) => String(item.path ?? "")),
				)
				const candidatePaths = [...new Set([...mapped.map((item) => String(item.path ?? "")), ...pathsFromText(search)])]
					.filter(Boolean)
					.slice(0, 8)
				const ranked = candidatePaths.map((path, index) => ({
					path,
					role: "unknown",
					confidence: Math.max(0.2, Number(mapObject?.confidence ?? 0.5) - index * 0.05),
					supportingEvidence: mapped
						.filter((item) => item.path === path)
						.map((item) => item.reason)
						.filter(Boolean),
					contradictingEvidence: ["Writer, generation, and synchronization evidence not yet verified."],
					knownWriters: [],
					knownConsumers: mapped
						.filter((item) => item.path === path && item.category === "used_by")
						.map((item) => item.path),
				}))
				const reuseRanked = ranked
					.map((item, index) => ({
						...item,
						semanticFit: item.supportingEvidence.length > 0 ? "structurally-supported" : "unverified",
						existingAdoption: item.knownConsumers.length,
						ownershipStability: "unknown",
						ownershipFit: startingPaths.has(item.path) ? "candidate_owner" : "consumer_or_related",
						integrationCost: index === 0 ? "focused" : "unknown",
						publicSurfaceImpact: "unknown",
						testCoverage: /(?:test|spec)/i.test(item.path) ? [item.path] : [],
						validationScope: /(?:test|spec)/i.test(item.path) ? "focused" : "unknown",
						distortionRisk: item.supportingEvidence.length > 0 ? "unknown" : "high",
					}))
					.sort(
						(left, right) =>
							Number(right.ownershipFit === "candidate_owner") - Number(left.ownershipFit === "candidate_owner") ||
							right.existingAdoption - left.existingAdoption ||
							right.supportingEvidence.length - left.supportingEvidence.length ||
							left.path.localeCompare(right.path),
					)
				const result =
					verb === "resolve_authority"
						? {
								candidates: ranked,
								recommendedMutationSurface: undefined,
								ambiguous: true,
							}
						: {
								bestCandidate: reuseRanked[0],
								partialCandidates: reuseRanked.slice(1, 4),
								rejectedCandidates: reuseRanked
									.slice(4)
									.map((item) => ({ path: item.path, reason: "Lower structural support." })),
								localImplementationMayBeCheaper: ranked.length === 0,
							}
				return this.envelope(
					verb,
					verb === "resolve_authority"
						? "Ranked authority evidence without declaring an unsupported canonical owner."
						: "Collected structural and lexical reuse candidates from existing indexes.",
					result,
					[
						...suppliedEvidence,
						{
							source: "project_map/search_files",
							provenance: "repository",
							statement: "Direct repository evidence from existing authorities.",
						},
					],
					{
						limitations: [
							verb === "resolve_authority"
								? "Canonical authority is intentionally unset until evidence identifies a writer or source-of-truth contract."
								: "Semantic fit must be confirmed against the returned implementation context.",
						],
						suggestedNextVerb: "slice",
					},
				)
			}
			case "compress": {
				const retained = {
					requirement: asString(payload.requirement),
					authority: payload.authority,
					invariants: asStrings(payload.invariants),
					evidence: suppliedEvidence,
					unresolved: asStrings(payload.unresolved),
					changedSurfaces: asStrings(payload.changedSurfaces),
					validationState: payload.validationState,
				}
				config.taskState.goldenCartridgeWorkingSet = retained
				config.taskState.goldenCartridgeMetrics.compressions++
				let snapshot: ToolResponse | undefined
				if (payload.persistDurableMemory === true) {
					snapshot = await executionFunnel.dispatchAuthorizedDelegatedOperation(
						config,
						parentBlock,
						delegatedBlock(DietCodeDefaultTool.MEM_SNAPSHOT, {
							content: JSON.stringify(retained),
							metadata: JSON.stringify({ source: "golden_cartridge", explicitlyRequested: true }),
						}),
						this.adapters.snapshot,
					)
				}
				let releaseOutput: string | undefined
				const release = asStrings(payload.release)
				if (release.length > 0) {
					releaseOutput = responseText(
						await executionFunnel.dispatchAuthorizedDelegatedOperation(
							config,
							parentBlock,
							delegatedBlock(DietCodeDefaultTool.CONDENSE, { context: JSON.stringify(retained) }),
							this.adapters.condense,
						),
					)
				}
				return this.envelope(
					verb,
					"Updated the task working set; active context and durable memory changed only when explicitly requested.",
					{
						active_context: { released: release, changed: Boolean(releaseOutput) },
						task_working_set: { content: retained, changed: true },
						durable_cognitive_memory: {
							changed: snapshot !== undefined,
							result: snapshot === undefined ? undefined : compactText(snapshot, 500),
						},
					},
					[
						{
							source: "TaskState",
							provenance: "runtime",
							statement: "Task-local working set updated.",
						},
						...(snapshot !== undefined
							? [
									{
										source: "cognitive_memory",
										provenance: "runtime" as const,
										statement: "Durable snapshot explicitly requested through the existing memory authority.",
									},
								]
							: []),
					],
					{
						limitations: release.length
							? undefined
							: ["No active context was released because no release references were supplied."],
					},
				)
			}
			case "compare_mass": {
				const comparison = deterministicMassComparison(candidates(payload.candidates))
				return this.envelope(
					verb,
					"Compared explicit permanent-surface dimensions without line-count scoring.",
					comparison,
					suppliedEvidence,
					{ limitations: comparison.candidates.length ? undefined : ["No candidates were supplied."] },
				)
			}
			case "design_compact": {
				const requirement = asString(payload.requirement) ?? ""
				const options = [
					["duplicated decision logic", "existing invariant", "duplicate conditions", "none", "focused"],
					[
						"independent mirrored state",
						"canonical record with generated projection",
						"duplicate state",
						"projection",
						"integration",
					],
					["stateful helper", "local pure function or lookup table", "incidental state", "pure function", "focused"],
					["repeated runtime work", "precomputation or deletion", "duplicate work", "precomputed value", "subsystem"],
				]
				const matches = options.map((option, index) => ({
					id: `option_${index + 1}`,
					currentRepresentation: option[0],
					proposedRepresentation: option[1],
					conceptsRemoved: [option[2]],
					conceptsIntroduced: option[3] === "none" ? [] : [option[3]],
					expectedValidationSurface: option[4],
					readability: "Preserves named domain concepts; does not optimize for character count.",
					whyCompression: "Reduces independently maintained representations.",
					fitEvidence: suppliedEvidence.filter((item) =>
						option.some((term) => item.statement.toLowerCase().includes(term.split(" ").at(-1) ?? "")),
					),
				}))
				return this.envelope(
					verb,
					"Generated bounded representation options from existing compact forms.",
					{
						requirement,
						compactOptions: suppliedEvidence.length ? matches : [],
						recommendedOption: matches.find((item) => item.fitEvidence.length)?.id,
						rejectedOptions: [],
					},
					suppliedEvidence,
					{
						limitations: suppliedEvidence.length
							? undefined
							: ["No repository evidence was supplied, so no option is recommended."],
					},
				)
			}
			case "patch_smallest": {
				const patch = asString(payload.proposedChange)
				if (!patch)
					return this.envelope(
						verb,
						"Prepared a narrow mutation request but did not mutate without an explicit patch.",
						{ requirement: asString(payload.requirement), target, executed: false },
						suppliedEvidence,
						{ limitations: ["proposedChange must contain an explicit patch for delegated execution."] },
					)
				const intendedFiles = patchFiles(patch)
				const canonicalTarget = asString(payload.canonicalTarget) ?? target
				const allowedFiles = asStrings(payload.allowedFiles)
				const unexpected = allowedFiles.length ? intendedFiles.filter((file) => !allowedFiles.includes(file)) : []
				config.taskState.goldenCartridgeMetrics.patchAttempts++
				const output = await executionFunnel.dispatchAuthorizedDelegatedOperation(
					config,
					parentBlock,
					delegatedBlock(DietCodeDefaultTool.APPLY_PATCH, { input: patch }),
					this.adapters.patch,
				)
				const failed = commandFailed(output) || delegatedFailure("apply_patch", output) !== undefined
				if (failed) config.taskState.goldenCartridgeMetrics.patchFailures++
				else {
					const priorIdentity = repositoryIdentity(config)
					config.taskState.goldenCartridgeMetrics.validationInvalidated +=
						config.taskState.goldenCartridgeValidationHistory.filter(
							(item) => item.repositoryRevision === priorIdentity,
						).length
					config.taskState.goldenCartridgeMetrics.evidenceItemsInvalidated +=
						config.taskState.goldenCartridgeEvidenceCache.size
					config.taskState.goldenCartridgeEvidenceGeneration++
					config.taskState.goldenCartridgeObservedMutationFlag = config.taskState.didEditFile
					config.taskState.goldenCartridgeMetrics.lastMutationAt = Date.now()
					config.taskState.goldenCartridgeEvidenceCache.clear()
				}
				return this.envelope(
					verb,
					"Delegated the explicit narrow patch to the canonical patch handler.",
					{
						executed: true,
						delegatedResult: compactText(output, 1_000),
						actualFilesAffected: failed
							? []
							: stableUnique([...intendedFiles, ...pathsFromText(output)], (path) => path),
						authorityAlignment: canonicalTarget
							? intendedFiles.includes(canonicalTarget)
								? "aligned"
								: "mismatch"
							: "unresolved",
						unexpectedMutationSurface: unexpected,
						followUpValidationCandidates: asStrings(payload.validationCandidates),
						cacheInvalidated: !failed,
					},
					[
						...suppliedEvidence,
						{
							source: "apply_patch",
							provenance: "runtime",
							statement: "Mutation result returned unchanged by the existing patch authority.",
						},
					],
				)
			}
			case "disprove": {
				const validationQuestion = asString(payload.validationQuestion) ?? asString(payload.requirement)
				const relevantSurfaces = stableUnique(
					[...asStrings(payload.changedSurfaces), ...asStrings(payload.relevantSurfaces)],
					(path) => path,
				)
				let discoveredTests = asStrings(payload.testFiles)
				if (validationQuestion && discoveredTests.length === 0) {
					const search = await executionFunnel.dispatchAuthorizedDelegatedOperation(
						config,
						parentBlock,
						delegatedBlock(DietCodeDefaultTool.SEARCH, {
							path: ".",
							regex: escapeRegex(
								validationQuestion
									.split(/\s+/)
									.filter((word) => word.length > 3)
									.slice(0, 2)
									.join("|"),
							),
							file_pattern: "*{test,spec}*",
						}),
						this.adapters.search,
					)
					discoveredTests = pathsFromText(search).filter((path) => /(?:test|spec)/i.test(path))
				}
				const suppliedCommands = asStrings(payload.proposedCommands)
				const knownCommands = asStrings(payload.knownRepositoryCommands)
				const admissionCommands = new Set([...suppliedCommands, ...knownCommands])
				let configured: Array<{ command: string; source: string }> = []
				if (payload.discoverRepositoryCommands !== false) {
					const metadata = await executionFunnel.dispatchAuthorizedDelegatedOperation(
						config,
						parentBlock,
						delegatedBlock(DietCodeDefaultTool.SEARCH, {
							path: ".",
							regex: '("(test|check|typecheck|lint)(:[^"]+)?"\\s*:|^(test|check|typecheck|lint)\\s*:)',
							file_pattern: "{package.json,Makefile,makefile}",
						}),
						this.adapters.search,
					)
					configured = configuredCommands(metadata)
				}
				const derivedCommands = discoveredTests.slice(0, 3).flatMap((file) => {
					if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return [`npm test -- ${file}`]
					if (file.endsWith(".py")) return [`pytest ${file}`]
					if (file.endsWith(".rs")) return ["cargo test"]
					return []
				})
				const historicalCommands = config.taskState.goldenCartridgeValidationHistory
					.filter(
						(item) =>
							item.outcome.status === "passed" &&
							(relevantSurfaces.length === 0 ||
								item.relevantSurfaces.some((surface) => relevantSurfaces.includes(surface))),
					)
					.map((item) => item.command)
				const commands = [
					...new Set([
						...derivedCommands,
						...historicalCommands,
						...configured.map((item) => item.command),
						...knownCommands,
						...suppliedCommands,
					]),
				]
				const candidateChecks = commands
					.map((command) => {
						const testFile = discoveredTests.find((file) => command.includes(file))
						const history = config.taskState.goldenCartridgeValidationHistory.find((item) => item.command === command)
						const configuredSource = configured.find((item) => item.command === command)?.source
						const directSurface = relevantSurfaces.some((surface) => command.includes(surface))
						const behaviorCheck = /(?:test|pytest|cargo test|make test)/i.test(command)
						const relevance = directSurface || testFile ? "direct" : behaviorCheck ? "behavioral" : "static"
						const confidence = relevance === "direct" ? "high" : relevance === "behavioral" ? "medium" : "low"
						return {
							command,
							relevance,
							expected_scope: testFile
								? "focused"
								: /(?:lint|typecheck|check)/i.test(command)
									? "package"
									: "repository",
							expected_cost: testFile ? "low" : "unknown",
							confidence,
							evidence: [
								testFile ? `nearby_test:${testFile}` : undefined,
								history ? `task_history:${history.sequence}` : undefined,
								configuredSource,
								suppliedCommands.includes(command) ? "caller" : undefined,
							].filter(Boolean),
							limitations: behaviorCheck ? [] : ["Static check may not exercise runtime behavior."],
							approval_required: payload.requiresApproval !== false,
						}
					})
					.sort((left, right) => {
						const rank: Record<string, number> = { direct: 0, behavioral: 1, static: 2 }
						return rank[left.relevance] - rank[right.relevance] || left.command.localeCompare(right.command)
					})
				config.taskState.goldenCartridgeMetrics.validationRecommended += candidateChecks.length
				const selected = candidateChecks[0]
				const currentRevision = repositoryIdentity(config)
				const reusable = selected
					? [...config.taskState.goldenCartridgeValidationHistory]
							.reverse()
							.find(
								(item) =>
									item.command === selected.command &&
									item.repositoryRevision === currentRevision &&
									item.outcome.status === "passed" &&
									(relevantSurfaces.length === 0 ||
										item.relevantSurfaces.some((surface) => relevantSurfaces.includes(surface))) &&
									payload.refresh !== true &&
									payload.rerun !== true,
							)
					: undefined
				if (reusable) {
					config.taskState.goldenCartridgeMetrics.validationReused++
					return this.envelope(
						verb,
						"Reused a still-valid structured validation result for the current repository revision.",
						{
							validation_question: validationQuestion,
							candidate_checks: candidateChecks,
							selected_check: selected,
							validation_outcome: reusable.outcome,
							executed: false,
							reused: true,
						},
						suppliedEvidence,
					)
				}
				if (!selected || payload.execute === false || !admissionCommands.has(selected.command))
					return this.envelope(
						verb,
						selected
							? admissionCommands.has(selected.command)
								? "Ranked trustworthy validation candidates without executing them."
								: "Ranked validation candidates without executing an undeclared command."
							: "No trustworthy check was discovered.",
						{
							validation_question: validationQuestion,
							candidate_checks: candidateChecks,
							selected_check: selected,
							selection_reason: selected ? "Highest relevance, then deterministic command order." : undefined,
							estimated_scope: selected?.expected_scope,
							approval_required: selected?.approval_required,
							executed: false,
						},
						suppliedEvidence,
						{
							limitations: selected
								? admissionCommands.has(selected.command)
									? undefined
									: ["Execution requires a new invocation that declares the exact selected command."]
								: ["No repository-defined or caller-supplied safe command was available."],
						},
					)
				const output = await executionFunnel.dispatchAuthorizedDelegatedOperation(
					config,
					parentBlock,
					delegatedBlock(DietCodeDefaultTool.BASH, {
						command: selected.command,
						requires_approval: payload.requiresApproval === false ? "false" : "true",
					}),
					this.adapters.command,
				)
				const executionEvidence = readCommandExecutionEvidence(output)
				const outcome = validationStatus(executionEvidence)
				const observation: GoldenCartridgeValidationObservation = {
					question: validationQuestion,
					command: selected.command,
					relevantSurfaces,
					outcome,
					repositoryRevision: currentRevision,
					sequence: config.taskState.goldenCartridgeValidationHistory.length + 1,
					provenance: "runtime",
				}
				config.taskState.goldenCartridgeValidationHistory.push(observation)
				config.taskState.goldenCartridgeMetrics.commands++
				config.taskState.goldenCartridgeMetrics.testCommands++
				config.taskState.goldenCartridgeMetrics.commandDurationMs += outcome.durationMs ?? 0
				return this.envelope(
					verb,
					`Canonical command evidence classified validation as ${outcome.status}.`,
					{
						validation_question: validationQuestion,
						candidate_checks: candidateChecks,
						selected_check: selected,
						selection_reason: "Highest relevance, then deterministic command order.",
						estimated_scope: selected.expected_scope,
						approval_required: selected.approval_required,
						executed: executionEvidence?.started === true,
						command: selected.command,
						passed: outcome.status === "passed",
						validation_outcome: outcome,
						output_summary: commandOutputSummary(output),
						reused: false,
						broaderValidationJustified: commands.length > 1,
					},
					[
						...suppliedEvidence,
						{
							source: "execute_command",
							provenance: "runtime",
							statement: "Command result returned by the existing execution authority.",
						},
					],
				)
			}
			case "measure": {
				const reads = [...config.taskState.taskReadHistory.entries()]
				const metrics = config.taskState.goldenCartridgeMetrics
				return this.envelope(
					verb,
					"Projected measurements exposed by current task state; unavailable metrics were omitted.",
					{
						taskAgeMs: Date.now() - config.taskState.taskStartTimeMs,
						apiRequests: config.taskState.apiRequestCount,
						reads: {
							total: reads.reduce((sum, [, count]) => sum + count, 0),
							uniqueFiles: reads.length,
							repeated: reads.reduce((sum, [, count]) => sum + Math.max(0, count - 1), 0),
						},
						goldenCartridgeCallsByVerb: { ...metrics.callsByVerb },
						commands: { total: metrics.commands, tests: metrics.testCommands, durationMs: metrics.commandDurationMs },
						patches: { attempts: metrics.patchAttempts, failures: metrics.patchFailures },
						contextCompressions: metrics.compressions,
						cache: {
							hits: metrics.cacheHits,
							misses: metrics.cacheMisses,
							entries: config.taskState.goldenCartridgeEvidenceCache.size,
						},
						validation: {
							recommended: metrics.validationRecommended,
							executed: config.taskState.goldenCartridgeValidationHistory.length,
							reused: metrics.validationReused,
							invalidated: metrics.validationInvalidated,
							outcomes: Object.fromEntries(
								["passed", "failed", "denied", "timed_out", "execution_error", "inconclusive"].map((status) => [
									status,
									config.taskState.goldenCartridgeValidationHistory.filter(
										(item) => item.outcome.status === status,
									).length,
								]),
							),
						},
						observedAvoidance: {
							repository_collections_reused: metrics.repositoryCollectionsReused,
							validation_runs_reused: metrics.validationReused,
							evidence_items_reused: metrics.evidenceItemsReused,
							evidence_items_invalidated: metrics.evidenceItemsInvalidated,
						},
						repositoryRevision: {
							identity: repositoryIdentity(config),
							source: "NativeMutationManager.workspaceRevision + task mutation generation",
							changesObserved: metrics.repositoryRevisionChanges,
						},
						timeSinceLastMutationMs: metrics.lastMutationAt ? Date.now() - metrics.lastMutationAt : undefined,
						goldenCartridge: { active: config.taskState.goldenCartridgeActive },
						mutationObserved: config.taskState.didEditFile,
					},
					[
						{
							source: "TaskState",
							provenance: "telemetry",
							statement: "Values are observational projections of existing task-local state.",
						},
					],
					{
						limitations: [
							"Global tool-call groups, tokens, subagent totals, and diff lines are omitted because this task state does not expose them here.",
						],
					},
				)
			}
			case "reclaim": {
				const surfaces = asStrings(payload.candidateSurfaces)
				const duplicateStatements = suppliedEvidence.filter(
					(item, index, all) => all.findIndex((candidate) => candidate.statement === item.statement) !== index,
				)
				return this.envelope(
					verb,
					"Identified caller-supplied context and proposal mass that can be reconsidered without mutating it.",
					{
						context_safe_to_release: duplicateStatements.map((item) => ({
							item,
							reason: "Duplicate evidence statement.",
						})),
						cached_evidence_invalid_or_superseded: [...config.taskState.goldenCartridgeEvidenceCache.entries()]
							.filter(([, entry]) => entry.revision !== config.taskState.goldenCartridgeEvidenceGeneration)
							.map(([key]) => key),
						proposed_work_no_longer_needed: asStrings(payload.supersededWork).map((item) => ({
							item,
							reason: "Caller marked superseded by current evidence.",
						})),
						patch_scope_candidates: surfaces.map((surface) => ({
							surface,
							reason: "Not yet supported by authority evidence.",
						})),
						redundant_validation: asStrings(payload.redundantValidation),
						requires_explicit_mutation: surfaces,
					},
					suppliedEvidence,
					{ limitations: ["No code was deleted or reverted; explicit canonical mutation remains required."] },
				)
			}
			case "seal": {
				const validationEvidence = asEvidence(payload.validationEvidence)
				const cachedResults = [...config.taskState.goldenCartridgeEvidenceCache.values()]
				const cachedByVerb = (name: GoldenCartridgeVerb) =>
					cachedResults
						.filter((entry) => entry.verb === name)
						.map((entry) => (entry.result as GoldenCartridgeResult).result)
				const currentRevision = repositoryIdentity(config)
				const currentValidation = config.taskState.goldenCartridgeValidationHistory.filter(
					(item) => item.repositoryRevision === currentRevision,
				)
				const passedValidation = currentValidation.filter((item) => item.outcome.status === "passed")
				const priorValidationEvidence: GoldenCartridgeEvidence[] = passedValidation.map((item) => ({
					source: `validation:${item.sequence}:${item.command}`,
					provenance: "runtime",
					statement: `Relevant validation passed with exit code ${item.outcome.exitCode}.`,
				}))
				const allValidationEvidence = stableUnique(
					[...validationEvidence, ...priorValidationEvidence],
					(item) => `${item.source}:${item.statement}`,
				)
				const requirement =
					asString(payload.requirement) ?? asString(config.taskState.goldenCartridgeWorkingSet?.requirement)
				const criticalPath = cachedByVerb("trace").at(-1)
				const authority = cachedByVerb("resolve_authority").at(-1) as
					| { candidates?: Array<{ supportingEvidence?: unknown[]; contradictingEvidence?: unknown[] }> }
					| undefined
				const reuse = cachedByVerb("find_reuse").at(-1)
				const changedSurfaces = asStrings(payload.changedSurfaces)
				const mutationRecorded =
					changedSurfaces.length > 0 || config.taskState.goldenCartridgeMetrics.lastMutationAt !== undefined
				const authoritySupported = Boolean(
					authority?.candidates?.some((item) => (item.supportingEvidence?.length ?? 0) > 0),
				)
				const authorityContradicted = Boolean(
					authority?.candidates?.some(
						(item) => (item.contradictingEvidence?.length ?? 0) > (item.supportingEvidence?.length ?? 0),
					),
				)
				const basis = [
					requirement ? "acceptance condition identified" : undefined,
					authoritySupported ? "authoritative surface supported" : undefined,
					mutationRecorded ? "mutation recorded" : undefined,
					passedValidation.length ? "relevant validation passed" : undefined,
				].filter((item): item is string => Boolean(item))
				const missing = [
					!requirement ? "identified requirement" : undefined,
					!authoritySupported ? "supported authoritative surface" : undefined,
					!mutationRecorded ? "recorded mutation" : undefined,
					!passedValidation.length ? "relevant passing validation" : undefined,
					...asStrings(payload.missingEvidence),
				].filter((item): item is string => Boolean(item))
				const confidence = missing.length === 0 && !authorityContradicted ? "high" : basis.length >= 3 ? "medium" : "low"
				const metrics = config.taskState.goldenCartridgeMetrics
				const receipt = {
					requirement,
					critical_path: criticalPath,
					authority: cachedByVerb("resolve_authority").at(-1),
					reuse,
					solution_choice:
						config.taskState.goldenCartridgeRecentResults.get("compare_mass") ??
						config.taskState.goldenCartridgeRecentResults.get("design_compact"),
					changed_surfaces: changedSurfaces,
					validation: currentValidation,
					evidence_reused: metrics.evidenceItemsReused,
					evidence_invalidated: metrics.evidenceItemsInvalidated,
					observed_cost: {
						apiRequests: config.taskState.apiRequestCount,
						reads: config.taskState.taskReadHistory.size,
						cacheHits: config.taskState.goldenCartridgeMetrics.cacheHits,
						cacheMisses: config.taskState.goldenCartridgeMetrics.cacheMisses,
						validationDurationMs: metrics.commandDurationMs,
					},
					reclaimed: config.taskState.goldenCartridgeRecentResults.get("reclaim") ?? asStrings(payload.reclaimed),
					completion_evidence: {
						observed: missing.length === 0,
						basis,
						missing,
						confidence,
					},
					unresolved_ambiguity: asStrings(payload.unresolved),
					residual_risk: asStrings(payload.residualRisks),
				}
				return this.envelope(
					verb,
					"Projected a non-authoritative cartridge receipt from supplied evidence and existing task observations.",
					receipt,
					[...suppliedEvidence, ...allValidationEvidence],
					{
						limitations: [
							"This receipt does not invoke completion, authorize completion, or infer validation beyond supplied evidence.",
						],
					},
				)
			}
		}
	}
}
