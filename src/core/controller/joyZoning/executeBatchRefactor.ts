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
		// 1. Apex Orchestration: Symbol-Level Dependency Sequencing
		const sortedRequests = sortRequestsBySymbolDependency(request.requests, spider)
		const groupedRequests = groupRequestsByContext(sortedRequests, spider)

		let manifest = "JOY_ZONING ADAPTIVE ORCHESTRATION MANIFEST (v8.0)\n"
		manifest += "===================================================\n\n"
		manifest += "This manifest is governed by the SOVEREIGN ARCHITECTURAL POLICY.\n"
		manifest += "Each refactor step is subject to a TECHNICAL DEBT BUDGET and mandatory SELF-REVIEW.\n\n"

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
					const step = plan.steps.find(
						(s) => s.action === req.action || `${s.action}: ${s.target}`.includes(req.action),
					)
					if (step) {
						manifest += `- RATIONALE: ${step.reason}\n`
						if (step.destination) manifest += `- DESTINATION: ${step.destination}\n`
						if (step.boilerplate) {
							manifest += `- MISSION-FOCUSED TEMPLATE:\n\`\`\`typescript\n${step.boilerplate}\n\`\`\`\n`
						}
					}
				}

				// Tactical SOP Integration
				const sop = TACTICAL_SOP[req.action] || TACTICAL_SOP["MOVE"]
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
		Logger.info(`[BatchRefactor] Launching agentic manifest with ${request.requests.length} operations.`)

		// Create the task through the controller interface
		const taskId = await controller.createTask(manifest)

		return JoyZoningBatchRefactorResponse.create({
			success: true,
			message: `Batch refactor launched successfully with ${request.requests.length} operations.`,
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
	const nodeMap = new Map(requests.map((r) => [engine.normalizePath(r.path), r]))
	const sorted: JoyZoningRefactorRequest[] = []
	const visited = new Set<string>()
	const visiting = new Set<string>()

	const visit = (path: string) => {
		if (visiting.has(path)) return // Cycle detected, fallback
		if (visited.has(path)) return

		visiting.add(path)
		const node = engine.nodes.get(path)
		if (node) {
			for (const imp of node.imports || []) {
				const targetId = engine.resolveImportToNodeId(node.path, imp)
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

	for (const req of requests) {
		visit(engine.normalizePath(req.path))
	}

	// For any remaining requests not in the dependency graph, sort by layer as fallback
	const remaining = requests.filter((r) => !visited.has(engine.normalizePath(r.path)))
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

	return [...requests].sort((a, b) => {
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
		const node = engine.nodes.get(engine.normalizePath(req.path))
		const context = node?.layer || "unassigned"
		if (!groups[context]) groups[context] = []
		groups[context].push(req)
	}
	return groups
}
