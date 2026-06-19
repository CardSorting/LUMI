/**
 * [LAYER: CORE]
 * JoyRide hot-path entry and lookup option types.
 */

import type { summarizeJoyRideCommandOutput } from "./summaries"

export interface JoyRideCommandCacheEntry {
	command: string
	cwd: string
	userRejected: boolean
	exitCode?: number
	outputSummary: ReturnType<typeof summarizeJoyRideCommandOutput>
	capturedAt: number
	diagnosticOnly: boolean
	classificationReason?: string
}

export interface JoyRideGrepCacheEntry {
	results: string
	resultCount: number
	capturedAt: number
}

export interface JoyRideSearchLookupOptions {
	includeGlobs?: string[]
	excludeGlobs?: string[]
	cwd: string
	caseSensitive?: boolean
}
