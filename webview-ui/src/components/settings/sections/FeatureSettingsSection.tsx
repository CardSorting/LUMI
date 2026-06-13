import { ADVISORY_AUTO_SCROLL_MODE_LABELS } from "@shared/audit/auditAutoScrollPolicy"
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
		label: "Think together",
		description: "Explore a few parts of your codebase at once — like having extra helpers.",
		stateKey: "subagentsEnabled",
		settingKey: "subagentsEnabled",
	},
	{
		id: "native-tool-call",
		label: "Direct tool calls",
		description: "Use built-in tool calling when your model supports it.",
		stateKey: "nativeToolCallSetting",
		settingKey: "nativeToolCallEnabled",
	},
	{
		id: "parallel-tool-calling",
		label: "Multitask a little",
		description: "Handle a few small steps at once when possible.",
		stateKey: "enableParallelToolCalling",
		settingKey: "enableParallelToolCalling",
	},
	{
		id: "strict-plan-mode",
		label: "Plan mode stays read-only",
		description: "In Plan mode, MIRA won't edit files until you switch to Act.",
		stateKey: "strictPlanModeEnabled",
		settingKey: "strictPlanModeEnabled",
	},
	{
		id: "auto-compact",
		label: "Shorten long chats",
		description: "Automatically tidy up when the conversation gets very long.",
		stateKey: "useAutoCondense",
		settingKey: "useAutoCondense",
	},
	{
		id: "focus-chain",
		label: "Gentle reminders",
		description: "Soft nudges to stay on track during longer tasks.",
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
		label: "Browse the web",
		description: "Let MIRA search the web and open pages when you need outside info.",
		stateKey: "dietcodeWebToolsEnabled",
		settingKey: "dietcodeWebToolsEnabled",
	},
	{
		id: "worktrees",
		label: "Worktrees",
		description: "Run a few MIRA tasks side by side with git worktrees.",
		stateKey: "worktreesEnabled",
		settingKey: "worktreesEnabled",
	},
]

const experimentalFeatures: FeatureToggle[] = [
	{
		id: "yolo",
		label: "Skip confirmations",
		description: "Let MIRA move ahead without asking each time. Only turn this on if you really trust the workflow.",
		stateKey: "yoloModeToggled",
		settingKey: "yoloModeToggled",
	},
	{
		id: "double-check-completion",
		label: "Double-check my work",
		description: "Before saying we're done, MIRA takes a second look at what you originally asked for.",
		stateKey: "doubleCheckCompletionEnabled",
		settingKey: "doubleCheckCompletionEnabled",
	},
	{
		id: "audit-completion-gate",
		label: "Look things over before finishing",
		description: "Pause at the finish line if something still looks off.",
		stateKey: "auditCompletionGateEnabled",
		settingKey: "auditCompletionGateEnabled",
	},
	{
		id: "audit-gate-critical-only",
		label: "Only pause on serious issues",
		description: "Smaller warnings stay as gentle notes — only big problems block finishing.",
		stateKey: "auditCompletionGateCriticalOnly",
		settingKey: "auditCompletionGateCriticalOnly",
	},
	{
		id: "audit-act-mode-advisory",
		label: "Helpful nudges while coding",
		description: "Light suggestions as you go, before wrapping up.",
		stateKey: "auditActModeAdvisoryEnabled",
		settingKey: "auditActModeAdvisoryEnabled",
	},
	{
		id: "audit-advisory-escalation",
		label: "Don't finish with open concerns",
		description: "Ask to resolve important nudges before marking a task complete.",
		stateKey: "auditAdvisoryEscalationEnabled",
		settingKey: "auditAdvisoryEscalationEnabled",
	},
	{
		id: "audit-plan-regression-gate",
		label: "Check we didn't backslide",
		description: "Notice if things look worse than when we started planning.",
		stateKey: "auditPlanRegressionGateEnabled",
		settingKey: "auditPlanRegressionGateEnabled",
	},
	{
		id: "audit-tool-output-advisory",
		label: "Review command output",
		description: "Glance at test or build output and suggest fixes when something looks wrong.",
		stateKey: "auditToolOutputAdvisoryEnabled",
		settingKey: "auditToolOutputAdvisoryEnabled",
	},
	{
		id: "audit-file-write-advisory",
		label: "Catch rough drafts",
		description: "Flag TODOs or placeholders left in files before we call it done.",
		stateKey: "auditFileWriteAdvisoryEnabled",
		settingKey: "auditFileWriteAdvisoryEnabled",
	},
	{
		id: "audit-intent-threshold-adjustments",
		label: "Stricter checks for risky tasks",
		description: "A little extra care when fixing bugs or writing tests.",
		stateKey: "auditIntentThresholdAdjustmentsEnabled",
		settingKey: "auditIntentThresholdAdjustmentsEnabled",
	},
	{
		id: "audit-sarif-hook-export",
		label: "Export check results (advanced)",
		description: "Include structured reports for teams that want them. Most people can leave this off.",
		stateKey: "auditSarifHookExportEnabled",
		settingKey: "auditSarifHookExportEnabled",
	},
	{
		id: "audit-workspace-artifacts",
		label: "Save check notes in your project",
		description: "Write summary notes to a `.audit/` folder in your workspace when you finish.",
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
		auditAdvisoryAutoScrollMode,
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
						<div className="text-xs font-medium text-foreground/70 mb-3">While you chat</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-lg border border-editor-widget-border/40"
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
											label="How picky before finishing (0–100)"
											max={100}
											min={0}
											onChange={(value) => updateSetting("auditCompletionGateThreshold", value)}
											step={5}
											value={auditCompletionGateThreshold ?? 50}
											valueWidth="w-8"
										/>
									)}
									{feature.id === "audit-act-mode-advisory" && featureState[feature.stateKey] && (
										<div className="ml-6 mb-2 space-y-1">
											<Label className="text-[10px] text-description/80">Auto-scroll to nudges</Label>
											<Select
												onValueChange={(value) => updateSetting("auditAdvisoryAutoScrollMode", value)}
												value={auditAdvisoryAutoScrollMode ?? "critical"}>
												<SelectTrigger className="h-7 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{(
														Object.keys(ADVISORY_AUTO_SCROLL_MODE_LABELS) as Array<
															keyof typeof ADVISORY_AUTO_SCROLL_MODE_LABELS
														>
													).map((mode) => (
														<SelectItem key={mode} value={mode}>
															{ADVISORY_AUTO_SCROLL_MODE_LABELS[mode]}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
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
						<div className="text-xs font-medium text-foreground/70 mb-3">In your editor</div>
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
						<div className="text-xs font-medium mb-3 text-description/80">Optional — for power users</div>
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
					<div className="text-xs font-medium text-foreground/70 mb-3">More options</div>
					<div className="relative p-3 my-3 rounded-lg border border-editor-widget-border/40" id="advanced-features">
						<div className="space-y-3">
							<div className="space-y-2">
								<Label className="text-sm font-medium text-foreground">Tool reply style</Label>
								<p className="text-xs text-muted-foreground">How responses from extra tools appear in chat</p>
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
