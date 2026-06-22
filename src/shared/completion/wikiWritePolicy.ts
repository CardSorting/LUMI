import type { TaskConfig } from "@core/task/tools/types/TaskConfig"

/** Authorized paths for in-session finalization lane (.wiki writes). */
export function isWikiPath(relPath: string): boolean {
	const normalized = relPath.replace(/\\/g, "/")
	return normalized.startsWith(".wiki/") || normalized.includes("/.wiki/")
}

/** Main agents may write .wiki only during authorized finalization or subagent execution. */
export function isWikiWriteAuthorized(config: Pick<TaskConfig, "isSubagentExecution" | "finalizationMode">): boolean {
	return config.isSubagentExecution || config.finalizationMode === true
}
