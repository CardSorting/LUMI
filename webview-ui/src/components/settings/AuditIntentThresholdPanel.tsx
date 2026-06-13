import { serializeIntentThresholdOverrides } from "@shared/audit/auditGateReadiness"
import { DEFAULT_INTENT_THRESHOLD_ADJUSTMENTS, parseIntentThresholdOverrides } from "@shared/audit/gatePolicy"
import type { IntentClassification } from "@shared/audit/types"
import { memo, useCallback, useMemo } from "react"
import SettingsSlider from "./SettingsSlider"
import { updateSetting } from "./utils/settingsHandlers"

const CONFIGURABLE_INTENTS: IntentClassification[] = ["FIX", "TEST", "DELETE", "INVESTIGATE"]

interface AuditIntentThresholdPanelProps {
	enabled: boolean
	overridesJson?: string
}

export const AuditIntentThresholdPanel = memo(({ enabled, overridesJson }: AuditIntentThresholdPanelProps) => {
	const overrides = useMemo(() => parseIntentThresholdOverrides(overridesJson), [overridesJson])

	const handleChange = useCallback(
		(intent: IntentClassification, value: number) => {
			const defaultAdj = DEFAULT_INTENT_THRESHOLD_ADJUSTMENTS[intent] ?? 0
			const next = { ...overrides }
			if (value <= 0 || value === defaultAdj) {
				delete next[intent]
			} else {
				next[intent] = value
			}
			updateSetting("auditIntentThresholdOverrides", serializeIntentThresholdOverrides(next))
		},
		[overrides],
	)

	if (!enabled) {
		return null
	}

	return (
		<div className="ml-6 mb-2 space-y-2 border-l border-editor-widget-border/50 pl-3">
			<div className="text-[10px] text-description/70 uppercase tracking-wider font-semibold">
				Intent threshold adjustments (+points to base gate)
			</div>
			{CONFIGURABLE_INTENTS.map((intent) => {
				const defaultAdj = DEFAULT_INTENT_THRESHOLD_ADJUSTMENTS[intent] ?? 0
				const value = overrides[intent] ?? defaultAdj
				return (
					<SettingsSlider
						key={intent}
						label={`${intent} (+${defaultAdj} default)`}
						max={30}
						min={0}
						onChange={(next) => handleChange(intent, next)}
						step={1}
						value={value}
						valueWidth="w-6"
					/>
				)
			})}
		</div>
	)
})

AuditIntentThresholdPanel.displayName = "AuditIntentThresholdPanel"
