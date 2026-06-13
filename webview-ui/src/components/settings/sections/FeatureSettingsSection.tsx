import { UpdateSettingsRequest } from "@shared/proto/dietcode/state"
import { memo, type ReactNode, useCallback } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AuditIntentThresholdPanel } from "../AuditIntentThresholdPanel"
import Section from "../Section"
import SettingsSlider from "../SettingsSlider"
import { updateSetting } from "../utils/settingsHandlers"

// Reusable checkbox component for feature settings
interface FeatureCheckboxProps {
	checked: boolean | undefined
	onChange: (checked: boolean) => void
	label: string
	description: ReactNode
	disabled?: boolean
	isRemoteLocked?: boolean
	remoteTooltip?: string
	isVisible?: boolean
}

// Interface for feature toggle configuration
interface FeatureToggle {
	id: string
	label: string
	description: ReactNode
	settingKey: keyof UpdateSettingsRequest
	stateKey: string
	/** If set, the setting value is nested with this key (e.g., "enabled" -> { enabled: checked }) */
	nestedKey?: string
}

const agentFeatures: FeatureToggle[] = [
	{
		id: "subagents",
		label: "Subagents",
		description: "Let DietCode run focused subagents in parallel to explore the codebase for you.",
		stateKey: "subagentsEnabled",
		settingKey: "subagentsEnabled",
	},
	{
		id: "native-tool-call",
		label: "Native Tool Call",
		description: "Use native function calling when available",
		stateKey: "nativeToolCallSetting",
		settingKey: "nativeToolCallEnabled",
	},
	{
		id: "parallel-tool-calling",
		label: "Parallel Tool Calling",
		description: "Execute multiple tool calls simultaneously",
		stateKey: "enableParallelToolCalling",
		settingKey: "enableParallelToolCalling",
	},
	{
		id: "strict-plan-mode",
		label: "Strict Plan Mode",
		description: "Prevents file edits while in Plan mode",
		stateKey: "strictPlanModeEnabled",
		settingKey: "strictPlanModeEnabled",
	},
	{
		id: "auto-compact",
		label: "Auto Compact",
		description: "Automatically compress conversation history.",
		stateKey: "useAutoCondense",
		settingKey: "useAutoCondense",
	},
	{
		id: "focus-chain",
		label: "Focus Chain",
		description: "Maintain context focus across interactions",
		stateKey: "focusChainEnabled",
		settingKey: "focusChainSettings",
		nestedKey: "enabled",
	},
]

const editorFeatures: FeatureToggle[] = [
	{
		id: "background-edit",
		label: "Background Edit",
		description: "Allow edits without stealing editor focus",
		stateKey: "backgroundEditEnabled",
		settingKey: "backgroundEditEnabled",
	},
	{
		id: "checkpoints",
		label: "Checkpoints",
		description: "Save progress at key points for easy rollback",
		stateKey: "enableCheckpointsSetting",
		settingKey: "enableCheckpointsSetting",
	},
	{
		id: "dietcode-web-tools",
		label: "DietCode Web Tools",
		description: "Access web browsing and search capabilities",
		stateKey: "dietcodeWebToolsEnabled",
		settingKey: "dietcodeWebToolsEnabled",
	},
	{
		id: "worktrees",
		label: "Worktrees",
		description: "Enables git worktree management for running parallel DietCode tasks.",
		stateKey: "worktreesEnabled",
		settingKey: "worktreesEnabled",
	},
]

const experimentalFeatures: FeatureToggle[] = [
	{
		id: "yolo",
		label: "Yolo Mode",
		description:
			"Execute tasks without user's confirmation. Auto-switches from Plan to Act mode and disables the ask question tool. Use with extreme caution.",
		stateKey: "yoloModeToggled",
		settingKey: "yoloModeToggled",
	},
	{
		id: "double-check-completion",
		label: "Double-Check Completion",
		description:
			"Rejects the first completion attempt and asks the model to re-verify its work against the original task requirements before accepting.",
		stateKey: "doubleCheckCompletionEnabled",
		settingKey: "doubleCheckCompletionEnabled",
	},
	{
		id: "audit-completion-gate",
		label: "Audit Completion Gate",
		description:
			"Blocks attempt_completion when the architectural hardening audit fails (Grade F with policy violations). Mirrors production quality gates in CI/CD pipelines.",
		stateKey: "auditCompletionGateEnabled",
		settingKey: "auditCompletionGateEnabled",
	},
	{
		id: "audit-gate-critical-only",
		label: "Critical-Only Completion Gate",
		description:
			"When enabled, only critical-severity violations block completion. Warning-level issues are advisory — mirrors SonarQube blocker vs. major severities.",
		stateKey: "auditCompletionGateCriticalOnly",
		settingKey: "auditCompletionGateCriticalOnly",
	},
	{
		id: "audit-act-mode-advisory",
		label: "Act Mode Audit Advisory",
		description:
			"Runs lightweight hardening checks on act_mode_respond progress updates and injects remediation hints before completion.",
		stateKey: "auditActModeAdvisoryEnabled",
		settingKey: "auditActModeAdvisoryEnabled",
	},
	{
		id: "audit-advisory-escalation",
		label: "Advisory Escalation Gate",
		description:
			"Blocks completion when critical act-mode advisory findings remain unresolved — mirrors CI escalation from warning to blocker.",
		stateKey: "auditAdvisoryEscalationEnabled",
		settingKey: "auditAdvisoryEscalationEnabled",
	},
	{
		id: "audit-plan-regression-gate",
		label: "Plan Regression Gate",
		description: "Blocks completion when hardening score drops significantly from the last plan audit baseline.",
		stateKey: "auditPlanRegressionGateEnabled",
		settingKey: "auditPlanRegressionGateEnabled",
	},
	{
		id: "audit-tool-output-advisory",
		label: "Command Output Audit Advisory",
		description: "Audits verification command output (tests, lint, build) and injects remediation hints into tool results.",
		stateKey: "auditToolOutputAdvisoryEnabled",
		settingKey: "auditToolOutputAdvisoryEnabled",
	},
	{
		id: "audit-file-write-advisory",
		label: "File Write Audit Advisory",
		description:
			"Flags TODO/FIXME/placeholder markers in written file content before completion — mirrors pre-commit content scanners.",
		stateKey: "auditFileWriteAdvisoryEnabled",
		settingKey: "auditFileWriteAdvisoryEnabled",
	},
	{
		id: "audit-intent-threshold-adjustments",
		label: "Intent-Adjusted Gate Thresholds",
		description:
			"Raises completion gate thresholds for high-risk intents (FIX +10, TEST +10) — mirrors CI branch protection tiers.",
		stateKey: "auditIntentThresholdAdjustmentsEnabled",
		settingKey: "auditIntentThresholdAdjustmentsEnabled",
	},
	{
		id: "audit-sarif-hook-export",
		label: "SARIF Export on TaskComplete",
		description:
			"Includes SARIF 2.1.0 report in TaskComplete hook metadata for CI/CD ingestion (GitHub Code Scanning, Azure DevOps).",
		stateKey: "auditSarifHookExportEnabled",
		settingKey: "auditSarifHookExportEnabled",
	},
	{
		id: "audit-workspace-artifacts",
		label: "Workspace Audit Artifacts",
		description:
			"Writes SARIF and markdown audit reports to `.audit/` in the workspace on completion and gate blocks — mirrors CI artifact upload.",
		stateKey: "auditWorkspaceArtifactsEnabled",
		settingKey: "auditWorkspaceArtifactsEnabled",
	},
]

const FeatureRow = memo(
	({
		checked = false,
		onChange,
		label,
		description,
		disabled,
		isRemoteLocked,
		isVisible = true,
		remoteTooltip,
	}: FeatureCheckboxProps) => {
		if (!isVisible) {
			return null
		}

		const checkbox = (
			<div className="flex items-center justify-between w-full">
				<div>{label}</div>
				<div>
					<Switch
						checked={checked}
						className="shrink-0"
						disabled={disabled || isRemoteLocked}
						id={label}
						onCheckedChange={onChange}
						size="lg"
					/>
					{isRemoteLocked && <VscIcon className="text-description text-sm" name="lock" />}
				</div>
			</div>
		)

		return (
			<div className="flex flex-col items-start justify-between gap-4 py-3 w-full">
				<div className="space-y-0.5 flex-1 w-full">
					{isRemoteLocked ? (
						<Tooltip>
							<TooltipTrigger asChild>{checkbox}</TooltipTrigger>
							<TooltipContent className="max-w-xs" side="top">
								{remoteTooltip}
							</TooltipContent>
						</Tooltip>
					) : (
						checkbox
					)}
				</div>
				<div className="text-xs text-description">{description}</div>
			</div>
		)
	},
)

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		mcpDisplayMode,
		strictPlanModeEnabled,
		yoloModeToggled,
		useAutoCondense,
		subagentsEnabled,
		dietcodeWebToolsEnabled,
		worktreesEnabled,
		focusChainSettings,
		remoteConfigSettings,
		nativeToolCallSetting,
		enableParallelToolCalling,
		backgroundEditEnabled,
		doubleCheckCompletionEnabled,
		auditCompletionGateEnabled,
		auditCompletionGateThreshold,
		auditCompletionGateCriticalOnly,
		auditActModeAdvisoryEnabled,
		auditAdvisoryEscalationEnabled,
		auditPlanRegressionGateEnabled,
		auditToolOutputAdvisoryEnabled,
		auditFileWriteAdvisoryEnabled,
		auditIntentThresholdAdjustmentsEnabled,
		auditIntentThresholdOverrides,
		auditSarifHookExportEnabled,
		auditWorkspaceArtifactsEnabled,
	} = useExtensionState()

	const handleFocusChainIntervalChange = useCallback(
		(value: number) => {
			updateSetting("focusChainSettings", { ...focusChainSettings, remindDietcodeInterval: value })
		},
		[focusChainSettings],
	)

	const isYoloRemoteLocked = remoteConfigSettings?.yoloModeToggled !== undefined

	// State lookup for mapped features
	const featureState: Record<string, boolean | undefined> = {
		enableCheckpointsSetting,
		strictPlanModeEnabled,
		nativeToolCallSetting,
		focusChainEnabled: focusChainSettings?.enabled,
		useAutoCondense,
		subagentsEnabled,
		dietcodeWebToolsEnabled: dietcodeWebToolsEnabled?.user,
		worktreesEnabled: worktreesEnabled?.user,
		enableParallelToolCalling,
		backgroundEditEnabled,
		doubleCheckCompletionEnabled,
		auditCompletionGateEnabled,
		auditCompletionGateCriticalOnly,
		auditActModeAdvisoryEnabled,
		auditAdvisoryEscalationEnabled,
		auditPlanRegressionGateEnabled,
		auditToolOutputAdvisoryEnabled,
		auditFileWriteAdvisoryEnabled,
		auditIntentThresholdAdjustmentsEnabled,
		auditSarifHookExportEnabled,
		auditWorkspaceArtifactsEnabled,
		yoloModeToggled: isYoloRemoteLocked ? remoteConfigSettings?.yoloModeToggled : yoloModeToggled,
	}

	// Visibility lookup for features with feature flags
	const featureVisibility: Record<string, boolean | undefined> = {
		dietcodeWebToolsEnabled: dietcodeWebToolsEnabled?.featureFlag,
		worktreesEnabled: worktreesEnabled?.featureFlag,
	}

	// Handler for feature toggle changes, supports nested settings like focusChainSettings
	const handleFeatureChange = useCallback(
		(feature: FeatureToggle, checked: boolean) => {
			if (feature.nestedKey) {
				// For nested settings, spread the existing value and set the nested key
				let currentValue = {}
				if (feature.settingKey === "focusChainSettings") {
					currentValue = focusChainSettings ?? {}
				}
				updateSetting(feature.settingKey, { ...currentValue, [feature.nestedKey]: checked })
			} else {
				updateSetting(feature.settingKey, checked)
			}
		},
		[focusChainSettings],
	)

	return (
		<div className="mb-2">
			{renderSectionHeader("features")}
			<Section>
				<div className="mb-5 flex flex-col gap-3">
					{/* Core features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Agent</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="agent-features">
							{agentFeatures.map((feature) => (
								<div key={feature.id}>
									<FeatureRow
										checked={featureState[feature.stateKey]}
										description={feature.description}
										isVisible={featureVisibility[feature.stateKey] ?? true}
										key={feature.id}
										label={feature.label}
										onChange={(checked) =>
											feature.nestedKey === "enabled"
												? handleFeatureChange(feature, checked)
												: updateSetting(feature.settingKey, checked)
										}
									/>
									{feature.id === "audit-completion-gate" && featureState[feature.stateKey] && (
										<SettingsSlider
											label="Gate Score Threshold (0-100)"
											max={100}
											min={0}
											onChange={(value) => updateSetting("auditCompletionGateThreshold", value)}
											step={5}
											value={auditCompletionGateThreshold ?? 50}
											valueWidth="w-8"
										/>
									)}
									{feature.id === "audit-intent-threshold-adjustments" && featureState[feature.stateKey] && (
										<AuditIntentThresholdPanel
											enabled={!!featureState[feature.stateKey]}
											overridesJson={auditIntentThresholdOverrides}
										/>
									)}
									{feature.id === "focus-chain" && featureState[feature.stateKey] && (
										<SettingsSlider
											label="Reminder Interval (1-10)"
											max={10}
											min={1}
											onChange={handleFocusChainIntervalChange}
											step={1}
											value={focusChainSettings?.remindDietcodeInterval || 6}
											valueWidth="w-6"
										/>
									)}
								</div>
							))}
						</div>
					</div>

					{/* Editor features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Editor</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="optional-features">
							{editorFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => handleFeatureChange(feature, checked)}
								/>
							))}
						</div>
					</div>

					{/* Experimental features */}
					<div>
						<div className="text-xs font-medium uppercase tracking-wider mb-3 text-warning/80">Experimental</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50 w-full"
							id="experimental-features">
							{experimentalFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									disabled={feature.id === "yolo" && isYoloRemoteLocked}
									isRemoteLocked={feature.id === "yolo" && isYoloRemoteLocked}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => handleFeatureChange(feature, checked)}
									remoteTooltip="This setting is managed by your organization's remote configuration"
								/>
							))}
						</div>
					</div>
				</div>

				{/* Advanced */}
				<div>
					<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Advanced</div>
					<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="advanced-features">
						<div className="space-y-3">
							{/* MCP Display Mode */}
							<div className="space-y-2">
								<Label className="text-sm font-medium text-foreground">MCP Display Mode</Label>
								<p className="text-xs text-muted-foreground">Controls how MCP responses are displayed</p>
								<Select onValueChange={(v) => updateSetting("mcpDisplayMode", v)} value={mcpDisplayMode}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="plain">Plain Text</SelectItem>
										<SelectItem value="rich">Rich Display</SelectItem>
										<SelectItem value="markdown">Markdown</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
export default memo(FeatureSettingsSection)
