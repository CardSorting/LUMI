/** Unified workspace cache invalidation — snapshot + session brief. */

import { invalidateSessionBriefCache } from "./RoadmapSession"
import { invalidateSnapshotCache } from "./RoadmapSnapshot"

export function invalidateRoadmapWorkspaceCache(workspace?: string): void {
	invalidateSnapshotCache(workspace)
	invalidateSessionBriefCache(workspace)
}
