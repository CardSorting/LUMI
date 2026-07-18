import { realpathSync } from "node:fs"
import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { classifyCommand } from "@core/joyride"
import { DietCodeDefaultTool } from "@shared/tools"
import { isIoAuthorityTool, isLocalMutationTool } from "../execution/ExecutionFunnel"

export type SiblingResourceAccess = "read" | "write"

export interface SiblingResourceClaim {
	key: string
	access: SiblingResourceAccess
	kind: "path" | "workspace" | "environment" | "approval" | "external" | "completion" | "presentation"
}

export type SiblingToolCategory = "query" | "mutation" | "command" | "approval" | "external" | "completion" | "unknown"

export interface SiblingToolDependencyNode {
	id: string
	sequence: number
	block: ToolUse
	category: SiblingToolCategory
	claims: SiblingResourceClaim[]
	dependsOn: number[]
	dependencyEdges: SiblingDependencyEdge[]
	capturePresentation: boolean
	requiresCheckpoint: boolean
	requiresAssistantHistory: boolean
}

export type SiblingDependencyKind = "conflict" | "prerequisite" | "barrier"

export interface SiblingDependencyEdge {
	sequence: number
	kind: SiblingDependencyKind
	reason: "resource-overlap" | "explicit-dependency" | "result-reference" | "completion-barrier"
}

export interface SiblingDependencyModelOptions {
	/** False means a query may require the existing external-path approval channel. */
	workspaceLocalBySequence?: readonly boolean[]
	invocationPrefix?: string
	/** Scheduler-prewarmed canonical targets avoid another realpath walk for queries. */
	canonicalTargetBySequence?: readonly (string | undefined)[]
}

const EXTERNAL_TOOLS = new Set<string>([
	DietCodeDefaultTool.BROWSER,
	DietCodeDefaultTool.MCP_USE,
	DietCodeDefaultTool.MCP_ACCESS,
	DietCodeDefaultTool.WEB_FETCH,
	DietCodeDefaultTool.WEB_SEARCH,
])

function normalizedPath(cwd: string, rawPath?: string): string | undefined {
	const raw = rawPath?.trim()
	if (!raw) return undefined
	const resolved = path.resolve(cwd, raw)
	let cursor = resolved
	const missingSegments: string[] = []
	while (true) {
		try {
			return path.join(realpathSync.native(cursor), ...missingSegments.reverse())
		} catch {
			const parent = path.dirname(cursor)
			if (parent === cursor) return resolved
			missingSegments.push(path.basename(cursor))
			cursor = parent
		}
	}
}

function normalizedTarget(cwd: string, block: ToolUse): string | undefined {
	return normalizedPath(cwd, block.params.path)
}

function mutationTargets(cwd: string, block: ToolUse): string[] {
	if (block.name === DietCodeDefaultTool.APPLY_PATCH) {
		const targets = new Set<string>()
		for (const line of block.params.input?.split("\n") ?? []) {
			const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s+(.+)$/.exec(line.trim())
			const target = normalizedPath(cwd, match?.[1])
			if (target) targets.add(target)
		}
		return [...targets]
	}
	const target = normalizedTarget(cwd, block)
	return target ? [target] : []
}

/** Known verification commands are workspace readers, while unknown shell is a workspace mutation fence. */
export function isReadOnlyVerificationCommand(command = ""): boolean {
	const tier = classifyCommand(command).tier
	return tier === "safe-readonly" || tier === "verification"
}

function invocationId(block: ToolUse, sequence: number, prefix = "sibling"): string {
	return block.call_id?.trim() || `${prefix}-${sequence}`
}

function classifyCategory(block: ToolUse): SiblingToolCategory {
	const target = block.params.path?.trim()
	// read_file has legacy create-on-miss behavior for scratchpad.md, so it is
	// conservatively treated as a mutation fence instead of a pure query.
	if (block.name === DietCodeDefaultTool.FILE_READ && target && path.basename(target).toLowerCase() === "scratchpad.md") {
		return "mutation"
	}
	if (isIoAuthorityTool(block.name)) return "query"
	if (isLocalMutationTool(block.name)) return "mutation"
	if (block.name === DietCodeDefaultTool.BASH) return "command"
	if (block.name === DietCodeDefaultTool.ASK) return "approval"
	if (block.name === DietCodeDefaultTool.ATTEMPT || block.name === DietCodeDefaultTool.RUN_FINALIZATION) {
		return "completion"
	}
	if (EXTERNAL_TOOLS.has(block.name)) return "external"
	return "unknown"
}

function explicitDependencies(block: ToolUse): string[] {
	const value = (block as ToolUse & { depends_on?: unknown }).depends_on
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function referencesResult(block: ToolUse, invocationId: string): boolean {
	if (!invocationId || invocationId.startsWith("sibling-")) return false
	const markers = [`tool_result:${invocationId}`, `{{${invocationId}}}`, `$${invocationId}`]
	return Object.values(block.params).some(
		(value) => typeof value === "string" && markers.some((marker) => value.includes(marker)),
	)
}

function claimsFor(block: ToolUse, cwd: string, category: SiblingToolCategory, canonicalTarget?: string): SiblingResourceClaim[] {
	const target = canonicalTarget ?? normalizedTarget(cwd, block)
	switch (category) {
		case "query":
			return target
				? [{ key: target, access: "read", kind: "path" }]
				: [{ key: `diagnostic:${block.name}`, access: "read", kind: "workspace" }]
		case "mutation": {
			const targets = mutationTargets(cwd, block)
			return [
				...(targets.length > 0
					? targets.map((key): SiblingResourceClaim => ({ key, access: "write", kind: "path" }))
					: ([{ key: "workspace:*", access: "write", kind: "workspace" }] as SiblingResourceClaim[])),
				{ key: "workspace-mutation", access: "write", kind: "workspace" },
				{ key: "interactive-presentation", access: "write", kind: "presentation" },
			]
		}
		case "command":
			if (isReadOnlyVerificationCommand(block.params.command)) {
				return [
					{ key: "command-lane", access: "write", kind: "environment" },
					{ key: "workspace:*", access: "read", kind: "workspace" },
					{ key: "interactive-presentation", access: "write", kind: "presentation" },
				]
			}
			return [
				{ key: "command-environment", access: "write", kind: "environment" },
				{ key: "workspace:*", access: "write", kind: "workspace" },
				{ key: "interactive-presentation", access: "write", kind: "presentation" },
			]
		case "approval":
			return [
				{ key: "user-approval", access: "write", kind: "approval" },
				{ key: "interactive-presentation", access: "write", kind: "presentation" },
			]
		case "external":
			return [
				{ key: `external:${block.name}`, access: "write", kind: "external" },
				{ key: "interactive-presentation", access: "write", kind: "presentation" },
			]
		case "completion":
			return [{ key: "task-completion", access: "write", kind: "completion" }]
		default:
			return [
				{ key: "workspace:*", access: "write", kind: "workspace" },
				{ key: "interactive-presentation", access: "write", kind: "presentation" },
			]
	}
}

function pathsOverlap(left: string, right: string): boolean {
	if (left === right) return true
	const separator = path.sep
	return left.startsWith(`${right}${separator}`) || right.startsWith(`${left}${separator}`)
}

export function siblingClaimsConflict(left: SiblingResourceClaim, right: SiblingResourceClaim): boolean {
	if (left.access === "read" && right.access === "read") return false
	if (left.key === "workspace:*" || right.key === "workspace:*") return true
	if (left.kind === "path" && right.kind === "path") return pathsOverlap(left.key, right.key)
	return left.key === right.key
}

export function siblingNodesConflict(left: SiblingToolDependencyNode, right: SiblingToolDependencyNode): boolean {
	if (left.category === "completion" || right.category === "completion") return true
	return left.claims.some((leftClaim) => right.claims.some((rightClaim) => siblingClaimsConflict(leftClaim, rightClaim)))
}

/** Build deterministic dependency edges from model-emission order. */
export function buildSiblingToolDependencyModel(
	blocks: ToolUse[],
	cwd: string,
	options: SiblingDependencyModelOptions = {},
): SiblingToolDependencyNode[] {
	const nodes: SiblingToolDependencyNode[] = []
	for (const [sequence, block] of blocks.entries()) {
		const category = classifyCategory(block)
		const workspaceLocal = options.workspaceLocalBySequence?.[sequence] ?? true
		const queryNeedsApproval = category === "query" && !workspaceLocal
		const readOnlyVerificationCommand = category === "command" && isReadOnlyVerificationCommand(block.params.command)
		const claims = claimsFor(block, cwd, category, options.canonicalTargetBySequence?.[sequence])
		if (queryNeedsApproval) {
			claims.push(
				{ key: "user-approval", access: "write", kind: "approval" },
				{ key: "interactive-presentation", access: "write", kind: "presentation" },
			)
		}
		const node: SiblingToolDependencyNode = {
			id: invocationId(block, sequence, options.invocationPrefix),
			sequence,
			block,
			category,
			claims,
			dependsOn: [],
			dependencyEdges: [],
			capturePresentation: category === "query" && workspaceLocal,
			requiresCheckpoint:
				category === "mutation" || (category === "command" && !readOnlyVerificationCommand) || category === "unknown",
			requiresAssistantHistory: category !== "query" || queryNeedsApproval,
		}
		for (const previous of nodes) {
			let edge: SiblingDependencyEdge | undefined
			if (explicitDependencies(block).includes(previous.id)) {
				edge = { sequence: previous.sequence, kind: "prerequisite", reason: "explicit-dependency" }
			} else if (referencesResult(block, previous.id)) {
				edge = { sequence: previous.sequence, kind: "prerequisite", reason: "result-reference" }
			} else if (category === "completion") {
				edge = { sequence: previous.sequence, kind: "barrier", reason: "completion-barrier" }
			} else if (siblingNodesConflict(previous, node)) {
				edge = { sequence: previous.sequence, kind: "conflict", reason: "resource-overlap" }
			}
			if (edge) node.dependencyEdges.push(edge)
		}
		node.dependsOn = node.dependencyEdges.map((edge) => edge.sequence)
		nodes.push(node)
	}
	return nodes
}
