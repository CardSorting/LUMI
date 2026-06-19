/**
 * [LAYER: CORE]
 * Internal JoyRide execution cache API.
 */

export { JoyRideCache } from "./JoyRideCache"
export {
	createCommandResultCacheKey,
	createDiffCacheKey,
	createFileMetadataCacheKey,
	createGrepResultCacheKey,
	createJoyRideFingerprint,
	createJoyRideKey,
	createScratchArtifactCacheKey,
	createVerificationCacheKey,
	stableStringify,
} from "./keys"
export { summarizeJoyRideCommandOutput } from "./summaries"
export type {
	JoyRideBudgetConfig,
	JoyRideCacheEntry,
	JoyRideCacheKind,
	JoyRideCacheScope,
	JoyRideCacheStats,
	JoyRideDurability,
	JoyRideEntrySummary,
	JoyRideExplainResult,
	JoyRideInvalidateTarget,
	JoyRideInvalidationReason,
	JoyRideSafetyClassification,
	JoyRideSetMetadata,
	JoyRideSetResult,
	JoyRideTrimResult,
	JoyRideValidationFingerprint,
} from "./types"

import { JoyRideCache } from "./JoyRideCache"

const joyRideCache = new JoyRideCache()

export function getJoyRideCache(): JoyRideCache {
	return joyRideCache
}
