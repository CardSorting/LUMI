/**
 * External ROADMAP.md edits — invalidate cache and mark validation_pending.
 * Mirrors dietcode workspace_state.record_file_mutation for out-of-band edits.
 */
import * as path from "path"
import { invalidateRoadmapWorkspaceCache } from "./RoadmapCache"
import { getRoadmapConfig } from "./RoadmapConfig"
import { RoadmapService } from "./RoadmapService"

export async function handleExternalRoadmapChange(workspace: string, source = "external"): Promise<void> {
	const cfg = getRoadmapConfig()
	if (!cfg.enabled) return

	const ws = path.resolve(workspace)
	invalidateRoadmapWorkspaceCache(ws)
	await RoadmapService.getInstance().recordFileMutation(ws, source, "ROADMAP.md")
}

export interface RoadmapFileWatcherHandle {
	dispose: () => void
}

export interface RoadmapFileWatcherFactory {
	getWorkspaceFolders: () => string[]
	watchRoadmapFile: (workspace: string, onChange: () => void) => RoadmapFileWatcherHandle | null
}

let activeHandles: RoadmapFileWatcherHandle[] = []

export function registerRoadmapFileWatcher(factory: RoadmapFileWatcherFactory): void {
	disposeRoadmapFileWatcher()

	for (const workspace of factory.getWorkspaceFolders()) {
		const handle = factory.watchRoadmapFile(workspace, () => {
			handleExternalRoadmapChange(workspace).catch(() => {
				// non-fatal — watcher must not crash extension
			})
		})
		if (handle) activeHandles.push(handle)
	}
}

export function disposeRoadmapFileWatcher(): void {
	for (const handle of activeHandles) {
		try {
			handle.dispose()
		} catch {
			// non-fatal
		}
	}
	activeHandles = []
}
