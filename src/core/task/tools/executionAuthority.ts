import path from "node:path"
import type { LaneExecutionMode } from "@shared/subagent/governedExecution"
import { DietCodeDefaultTool } from "@shared/tools"
import { SafeNumber } from "@shared/utils/SafeNumber"
import type { SpiderEngine } from "@/core/policy/spider/SpiderEngine"
import type { TaskConfig } from "./types/TaskConfig"

/** Local read/diagnostic tools — parent and lane I/O execution authority fast path. */
export const IO_AUTHORITY_TOOLS = new Set<DietCodeDefaultTool>([
	DietCodeDefaultTool.FILE_READ,
	DietCodeDefaultTool.LIST_FILES,
	DietCodeDefaultTool.SEARCH,
	DietCodeDefaultTool.LIST_CODE_DEF,
	DietCodeDefaultTool.STABILITY_DIAGNOSE,
])

/** Tools that can change workspace files and therefore invalidate query caches. */
export const LOCAL_MUTATION_TOOLS = new Set<DietCodeDefaultTool>([
	DietCodeDefaultTool.FILE_NEW,
	DietCodeDefaultTool.FILE_EDIT,
	DietCodeDefaultTool.NEW_RULE,
	DietCodeDefaultTool.APPLY_PATCH,
	DietCodeDefaultTool.DIETCODE_KERNEL,
])

const NON_MUTATING_MODES: LaneExecutionMode[] = [
	"read_only",
	"audit_only",
	"planning_only",
	"documentation_only",
	"diagnostic_only",
]

export function isIoAuthorityTool(toolName: string): boolean {
	return IO_AUTHORITY_TOOLS.has(toolName as DietCodeDefaultTool)
}

export function isLocalMutationTool(toolName: string): boolean {
	return LOCAL_MUTATION_TOOLS.has(toolName as DietCodeDefaultTool)
}

/**
 * Workspace-local queries already have task authority. Ignore rules remain the
 * security boundary, but an additional approval dialog adds no mutation safety.
 */
export function hasWorkspaceLocalIoAuthority(isSubagentExecution: boolean, isLocatedInWorkspace: boolean): boolean {
	return isSubagentExecution || isLocatedInWorkspace
}

/** Parent main thread — skip UniversalGuard for pure I/O tools (shift-right enforcement). */
export function shouldBypassGuardForParentIoTool(toolName: string): boolean {
	return isIoAuthorityTool(toolName)
}

export function isNonMutatingLaneMode(mode: LaneExecutionMode): boolean {
	return NON_MUTATING_MODES.includes(mode)
}

/** Subagent lanes — I/O tools on non-mutating lanes only. */
export function shouldBypassGuardForLaneIoTool(mode: LaneExecutionMode, toolName: string): boolean {
	return isNonMutatingLaneMode(mode) && isIoAuthorityTool(toolName)
}

/** Whether reads should use lightweight substrate tracking (no advisory header injection). */
export function shouldUseIoAuthorityReadFastPath(toolName: string, laneMode?: LaneExecutionMode): boolean {
	if (!isIoAuthorityTool(toolName)) {
		return false
	}
	if (laneMode !== undefined) {
		return isNonMutatingLaneMode(laneMode)
	}
	return true
}

/** Bulkhead reservation scales with pool capacity (mirrors resilience4j / Hystrix bulkhead sizing). */
export function computeFastIoReservedSlots(poolCapacity: number): number {
	if (poolCapacity <= 1) {
		return 0
	}
	return Math.min(Math.max(1, Math.floor(poolCapacity / 3)), poolCapacity - 1)
}

/** Parent I/O tools skip PreToolUse when hooks would only add observability latency. */
export function shouldSkipPreToolUseForParentIoTool(toolName: string, isSubagentExecution: boolean): boolean {
	return !isSubagentExecution && isIoAuthorityTool(toolName)
}

/** Lane I/O on non-mutating lanes — skip PreToolUse hook latency (mirrors parent hot path). */
export function shouldSkipPreToolUseForLaneIoTool(mode: LaneExecutionMode, toolName: string): boolean {
	return shouldBypassGuardForLaneIoTool(mode, toolName)
}

/**
 * Shift-right guard post-exec on parent act-mode — GC/merkle/snapshot run after tool result is pushed.
 * Mirrors async observability patterns (OpenTelemetry export, CI post-merge checks).
 */
export function shouldDeferParentGuardPostExecution(toolName: string, isSubagentExecution: boolean): boolean {
	return !isSubagentExecution && !isIoAuthorityTool(toolName)
}

/** Lane mutation tools defer post-guard after result push — same shift-right pattern as parent. */
export function shouldDeferLaneGuardPostExecution(mode: LaneExecutionMode, toolName: string): boolean {
	return !shouldBypassGuardForLaneIoTool(mode, toolName)
}

/** Reuse warm UniversalGuard spider substrate — avoids loadRegistry rebuild on planning tools. */
export function resolveSessionSpiderEngine(config: TaskConfig): SpiderEngine | undefined {
	return config.universalGuard?.getSpiderEngine()
}

/** Whether parent should close an active browser session before non-browser tools. */
export function shouldCloseBrowserBetweenTools(toolName: string, hasActiveBrowserSession: boolean): boolean {
	return hasActiveBrowserSession && toolName !== DietCodeDefaultTool.BROWSER
}

/** Skip joy-zoning layer injection on parent I/O authority tools. */
export function shouldSkipLayerInjectionForParentIoTool(toolName: string): boolean {
	return isIoAuthorityTool(toolName)
}

/**
 * Append stability context from the warm session graph only — never triggers loadRegistry rebuild.
 * Cache-aside: skip injection when the node is not already in the guard substrate.
 */
export function appendSessionStabilityContext(config: TaskConfig, relPath: string, fileText: string): string {
	const guard = config.universalGuard
	if (!guard || config.isSubagentExecution) {
		return fileText
	}

	const nodes = guard.engine.getNodes()
	const absPath = path.resolve(config.cwd, relPath)
	let node = nodes.get(relPath) ?? nodes.get(absPath)
	if (!node) {
		for (const [key, candidate] of nodes) {
			if (key === relPath || key.endsWith(`/${relPath}`) || key.endsWith(`\\${relPath}`)) {
				node = candidate
				break
			}
		}
	}
	if (!node) {
		return fileText
	}

	const intentMatch = fileText.match(/\[INTEGRITY_INTENT:\s*(.*?)\]/)
	const intent = intentMatch ? intentMatch[1] : "Not explicitly documented."
	const contextBlock =
		`\n\n[STABILITY_CONTEXT]\n` +
		`Layer: ${node.layer?.toUpperCase() || "UNKNOWN"}\n` +
		`Architectural Intent: ${intent}\n` +
		`Metrics: Logic Density: ${SafeNumber.format(node.logicDensity, 2)}, I/O Entropy: ${SafeNumber.format(node.ioEntropy, 2)}\n` +
		`Status: ${node.orphaned ? "ORPHANED" : "INTEGRATED"}\n`
	return fileText + contextBlock
}
