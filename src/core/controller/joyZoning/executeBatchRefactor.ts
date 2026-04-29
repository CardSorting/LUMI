import { IController } from "@core/controller/types"
import { SovereignDecomposer } from "@core/policy/SovereignDecomposer"
import { SpiderEngine } from "@core/policy/spider/SpiderEngine"
import {
	JoyZoningBatchRefactorRequest,
	JoyZoningBatchRefactorResponse,
	JoyZoningRefactorRequest,
} from "@shared/proto/dietcode/joyzoning"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

const normalizeRequestField = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

function normalizeBatchRequests(requests: unknown): {
	requests: JoyZoningRefactorRequest[]
	rejectedCount: number
	dedupedCount: number
} {
	const input = Array.isArray(requests) ? requests : []
	const deduped = new Map<string, JoyZoningRefactorRequest>()
	let rejectedCount = Array.isArray(requests) ? 0 : 1
	let duplicateCount = 0

	for (const raw of input) {
		if (!raw || typeof raw !== "object") {
			rejectedCount++
			continue
		}
		const item = raw as Partial<JoyZoningRefactorRequest>
		const action = normalizeRequestField(item.action)
		const path = normalizeRequestField(item.path)
		if (!action || !path) {
			rejectedCount++
			continue
		}

		const key = JSON.stringify([action, path])
		if (deduped.has(key)) duplicateCount++
		deduped.set(key, JoyZoningRefactorRequest.create({ ...item, action, path }))
	}

	return { requests: Array.from(deduped.values()), rejectedCount, dedupedCount: duplicateCount }
}

function getStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter(isNonEmptyString).map((entry) => entry.trim()) : []
}

function resolveNodeImport(engine: SpiderEngine, sourcePath: unknown, specifier: unknown): string | null {
	if (!isNonEmptyString(sourcePath) || !isNonEmptyString(specifier)) return null
	return engine.resolveImportToNodeId(sourcePath, specifier)
}

/**
 * V500: Industrial Batch Orchestration.
 * Orchestrates multi-file refactors using dependency-aware sorting and context grouping.
 */
export async function executeBatchRefactor(
	controller: IController,
	request: JoyZoningBatchRefactorRequest,
): Promise<JoyZoningBatchRefactorResponse> {
	const spider = await controller.getSpiderEngine()
	const decomposer = new SovereignDecomposer()

	try {
		const normalized = normalizeBatchRequests(request?.requests)
		if (normalized.requests.length === 0) {
			return JoyZoningBatchRefactorResponse.create({
				success: false,
				message:
					"No valid batch refactor requests were provided. Select tasks with non-empty action and path, then try again.",
			})
		}

		// 1. Apex Orchestration: Symbol-Level Dependency Sequencing
		const sortedRequests = sortRequestsBySymbolDependency(normalized.requests, spider)
		const groupedRequests = groupRequestsByContext(sortedRequests, spider)

		let manifest = "JOY_ZONING ADAPTIVE ORCHESTRATION MANIFEST (v8.0)\n"
		manifest += "===================================================\n\n"
		manifest += "This manifest is governed by the SOVEREIGN ARCHITECTURAL POLICY.\n"
		manifest += "Each refactor step is subject to a TECHNICAL DEBT BUDGET and mandatory SELF-REVIEW.\n\n"
		if (normalized.rejectedCount > 0 || normalized.dedupedCount > 0) {
			manifest += `[BOUNDARY VALIDATION] Ignored ${normalized.rejectedCount} malformed request(s) and deduplicated ${normalized.dedupedCount} duplicate request(s).\n\n`
		}

		for (const [groupName, groupItems] of Object.entries(groupedRequests)) {
			manifest += `## [TRANSACTION] ARCHITECTURAL BLOCK: ${groupName.toUpperCase()}\n`
			manifest += "------------------------------------\n"
			for (const req of groupItems) {
				const node = spider.nodes.get(spider.normalizePath(req.path))
				manifest += `### ACTION: ${req.action} on ${req.path}\n`

				// Blast Radius Visualization
				const impactedCount = node?.afferentCoupling || 0
				manifest += `[APEX SIGNAL] Impact Radius: ${impactedCount} consumers will require import updates.\n`

				const absPath = path.resolve(spider.cwd, req.path)
				if (fs.existsSync(absPath)) {
					const content = fs.readFileSync(absPath, "utf-8")
					const plan = decomposer.analyze(req.path, content, node)
					const step = plan.steps.find((s) => {
						const stepAction = normalizeRequestField(s.action)
						const stepTarget = normalizeRequestField(s.target)
						return stepAction === req.action || (!!stepTarget && `${stepAction}: ${stepTarget}`.includes(req.action))
					})
					if (step) {
						manifest += `- RATIONALE: ${step.reason}\n`
						if (step.destination) manifest += `- DESTINATION: ${step.destination}\n`
						if (step.boilerplate) {
							manifest += `- MISSION-FOCUSED TEMPLATE:\n\`\`\`typescript\n${step.boilerplate}\n\`\`\`\n`
						}
					}
				}

				// Tactical SOP Integration
				const sop = TACTICAL_SOP[req.action] || TACTICAL_SOP.GENERIC
				manifest += `\nTACTICAL SOP:\n${sop}\n`
				manifest += `\nHEAL PROTOCOL: Use \`grep\` to ripple changes to all ${impactedCount} consumers for this specific action.\n\n`
			}
		}

		manifest += "ADAPTIVE EXECUTION PROTOCOL:\n"
		manifest += "1. TRANSACTION: Work within the current ARCHITECTURAL BLOCK.\n"
		manifest += "2. TRANSFORM & HEAL: Execute the Tactical SOP and ripple changes.\n"
		manifest += "3. SOVEREIGN PEER REVIEW: Before committing, verify the following:\n"
		manifest += "   - Does this change introduce a CROSS-LAYER dependency?\n"
		manifest += "   - Is the 'Hotspot Heat' reduced for the target file?\n"
		manifest += "   - Are all new symbols following the MISSION-FOCUSED naming convention?\n"
		manifest += "4. VALIDATE: Ensure zero type errors and zero lint violations.\n"
		manifest += "5. BUDGET CHECK: If the change increases structural entropy, REVISE or ROLLBACK.\n\n"

		manifest += "SURGICAL RECOVERY (Adaptive Retry):\n"
		manifest += "- If a step fails, do not abandon the batch. Attempt a localized fix.\n"
		manifest += "- If the fix requires moving logic elsewhere, update the manifest's MISSION-FOCUSED plan accordingly.\n"

		if (request.dryRun) {
			return JoyZoningBatchRefactorResponse.create({
				success: true,
				message: "Dry run successful",
				planSummary: manifest,
			})
		}

		// Stability Lock: Log the batch operation
		Logger.info(`[BatchRefactor] Launching agentic manifest with ${normalized.requests.length} operations.`)

		// Create the task through the controller interface
		const taskId = await controller.createTask(manifest)

		return JoyZoningBatchRefactorResponse.create({
			success: true,
			message: `Batch refactor launched successfully with ${normalized.requests.length} operations.`,
			taskId: taskId,
			planSummary: manifest,
		})
	} catch (error) {
		Logger.error("[BatchRefactor] Critical failure during manifest execution:", error)
		return JoyZoningBatchRefactorResponse.create({
			success: false,
			message: `Internal Error: ${(error as Error).message}`,
		})
	}
}

/**
 * V600: Apex Topological Sorting (Symbol-Level).
 * Ensures Producers are refactored before Consumers.
 */
function sortRequestsBySymbolDependency(requests: JoyZoningRefactorRequest[], engine: SpiderEngine): JoyZoningRefactorRequest[] {
	const validRequests = requests.filter((request) => isNonEmptyString(request.action) && isNonEmptyString(request.path))
	const nodeMap = new Map(validRequests.map((r) => [engine.normalizePath(r.path), r]))
	const sorted: JoyZoningRefactorRequest[] = []
	const visited = new Set<string>()
	const visiting = new Set<string>()

	const visit = (path: string) => {
		if (visiting.has(path)) return // Cycle detected, fallback
		if (visited.has(path)) return

		visiting.add(path)
		const node = engine.nodes.get(path)
		if (node) {
			for (const imp of getStringArray(node.imports)) {
				const targetId = resolveNodeImport(engine, node.path, imp)
				if (targetId && nodeMap.has(targetId)) {
					visit(targetId)
				}
			}
		}
		visiting.delete(path)
		visited.add(path)
		const req = nodeMap.get(path)
		if (req) sorted.push(req)
	}

	for (const req of validRequests) {
		visit(engine.normalizePath(req.path))
	}

	// For any remaining requests not in the dependency graph, sort by layer as fallback
	const remaining = validRequests.filter((r) => !visited.has(engine.normalizePath(r.path)))
	const layerSortedRemaining = sortRequestsByDependency(remaining, engine)

	return [...sorted, ...layerSortedRemaining]
}

/**
 * V500: Topological-ish sort based on Layer and Blast Radius.
 */
function sortRequestsByDependency(requests: JoyZoningRefactorRequest[], engine: SpiderEngine): JoyZoningRefactorRequest[] {
	const layerOrder: Record<string, number> = {
		plumbing: 0,
		core: 1,
		domain: 2,
		infrastructure: 3,
		ui: 4,
		unassigned: 5,
	}

	return [...requests]
		.filter((request) => isNonEmptyString(request.path))
		.sort((a, b) => {
			const nodeA = engine.nodes.get(engine.normalizePath(a.path))
			const nodeB = engine.nodes.get(engine.normalizePath(b.path))
			const layerA = layerOrder[nodeA?.layer || "unassigned"] ?? 10
			const layerB = layerOrder[nodeB?.layer || "unassigned"] ?? 10

			if (layerA !== layerB) return layerA - layerB
			return (nodeB?.blastRadius || 0) - (nodeA?.blastRadius || 0)
		})
}

/**
 * V600: Tactical Standard Operating Procedures.
 */
const TACTICAL_SOP: Record<string, string> = {
	DECOMPOSE:
		"1. Identify independent sub-vocabularies.\n2. Extract logic into MISSION-FOCUSED modules.\n3. Re-export from the original entry point to maintain compatibility.",
	MOVE: "1. Update file location.\n2. Perform GLOBAL SEARCH/REPLACE for all import specifiers.\n3. Verify new location doesn't violate layer gravity.",
	EXTRACT:
		"1. Create new abstraction layer.\n2. Move concrete implementation into the new substrate.\n3. Inject the new dependency back into the original consumer.",
	PRUNE: "1. Verify zero project-wide consumers.\n2. Check for dynamic or reflection-based usage.\n3. Delete the file and cleanup its directory if empty.",
	ALIGN_TAGS:
		"1. Audit architectural metadata tags.\n2. Align with Sovereign Policy layer config.\n3. Propagate changes to all dependent modules.",
	HEAL_STATELESSNESS:
		"1. Identify hidden state dependencies.\n2. Formalize state substrate using Immutable patterns.\n3. Verify function purity across the module.",
	HARDEN: "1. Identify unsafe or unused structural edges.\n2. Remove or replace the smallest risky primitive.\n3. Verify imports, tests, and public behavior remain stable.",
	DECOUPLE:
		"1. Identify bidirectional or cross-layer coupling.\n2. Extract a stable boundary or interface.\n3. Redirect consumers through the new dependency seam.",
	FIX_STRUCTURAL_VIOLATION:
		"1. Read the reported violation and remediation.\n2. Apply the smallest structural correction that restores policy alignment.\n3. Re-run validation and inspect dependent imports.",
	GENERIC:
		"1. Inspect the target file and requested action.\n2. Apply a minimal, policy-aligned refactor.\n3. Validate type safety, imports, and architectural boundaries.",
}

/**
 * V500: Contextual Grouping by Layer.
 */
function groupRequestsByContext(
	requests: JoyZoningRefactorRequest[],
	engine: SpiderEngine,
): Record<string, JoyZoningRefactorRequest[]> {
	const groups: Record<string, JoyZoningRefactorRequest[]> = {}
	for (const req of requests) {
		if (!isNonEmptyString(req.path)) continue
		const node = engine.nodes.get(engine.normalizePath(req.path))
		const context = node?.layer || "unassigned"
		if (!groups[context]) groups[context] = []
		groups[context].push(req)
	}
	return groups
}
