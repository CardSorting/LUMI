import type { IntentClassification } from "./types"

export const COMPLETION_GATE_SCORE_THRESHOLD = 50

/** Stricter gates for high-risk intent classes (mirrors CI branch protection tiers). */
export const DEFAULT_INTENT_THRESHOLD_ADJUSTMENTS: Partial<Record<IntentClassification, number>> = {
	FIX: 10,
	TEST: 10,
	DELETE: 5,
	INVESTIGATE: 5,
}

export function parseIntentThresholdOverrides(raw?: string): Partial<Record<IntentClassification, number>> {
	if (!raw?.trim()) {
		return {}
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>
		const result: Partial<Record<IntentClassification, number>> = {}
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "number" && Number.isFinite(value)) {
				result[key as IntentClassification] = Math.max(0, Math.min(50, Math.round(value)))
			}
		}
		return result
	} catch {
		return {}
	}
}

export function resolveEffectiveGateThreshold(
	baseThreshold: number,
	intent?: IntentClassification,
	options?: {
		intentAdjustmentsEnabled?: boolean
		overrides?: Partial<Record<IntentClassification, number>>
	},
): number {
	if (options?.intentAdjustmentsEnabled === false) {
		return baseThreshold
	}
	const custom = intent ? options?.overrides?.[intent] : undefined
	const adjustment = custom ?? (intent ? (DEFAULT_INTENT_THRESHOLD_ADJUSTMENTS[intent] ?? 0) : 0)
	return Math.max(0, Math.min(100, baseThreshold + adjustment))
}

export function getIntentThresholdAdjustment(
	intent?: IntentClassification,
	overrides?: Partial<Record<IntentClassification, number>>,
): number {
	if (!intent) return 0
	return overrides?.[intent] ?? DEFAULT_INTENT_THRESHOLD_ADJUSTMENTS[intent] ?? 0
}
