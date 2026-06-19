/**
 * [LAYER: CORE]
 * Operational controls for JoyRide — kill switches and safe modes.
 */

export type JoyRideOperationalMode = "enabled" | "diagnostics-only" | "disabled"

export interface JoyRideOperationalConfig {
	mode: JoyRideOperationalMode
	commandReuseDisabled: boolean
	verificationCacheDisabled: boolean
	scratchCacheDisabled: boolean
	searchCacheDisabled: boolean
}

const DEFAULT_CONFIG: JoyRideOperationalConfig = {
	mode: "enabled",
	commandReuseDisabled: false,
	verificationCacheDisabled: false,
	scratchCacheDisabled: false,
	searchCacheDisabled: false,
}

let activeConfig: JoyRideOperationalConfig = { ...DEFAULT_CONFIG }

let degradedMode = false
let degradedReason: string | undefined

function parseBoolEnv(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined
	}
	const normalized = value.trim().toLowerCase()
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false
	}
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true
	}
	return undefined
}

function parseModeEnv(value: string | undefined): JoyRideOperationalMode | undefined {
	if (!value) {
		return undefined
	}
	const normalized = value.trim().toLowerCase()
	if (normalized === "enabled" || normalized === "on") {
		return "enabled"
	}
	if (normalized === "diagnostics-only" || normalized === "diagnostics" || normalized === "observe") {
		return "diagnostics-only"
	}
	if (normalized === "disabled" || normalized === "off") {
		return "disabled"
	}
	return undefined
}

function envDisablesFeature(primary: string | undefined, explicit: string | undefined): boolean | undefined {
	const primaryVal = parseBoolEnv(primary)
	if (primaryVal === false) {
		return true
	}
	return parseBoolEnv(explicit)
}

/** Load config from environment. Safe to call multiple times. */
export function loadJoyRideConfigFromEnv(env: NodeJS.ProcessEnv = process.env): JoyRideOperationalConfig {
	const mode = parseModeEnv(env.JOYRIDE_MODE) ?? activeConfig.mode
	const commandReuseDisabled =
		envDisablesFeature(env.JOYRIDE_COMMAND_REUSE, env.JOYRIDE_COMMAND_REUSE_DISABLED) ?? activeConfig.commandReuseDisabled
	const verificationCacheDisabled =
		envDisablesFeature(env.JOYRIDE_VERIFICATION_CACHE, env.JOYRIDE_VERIFICATION_CACHE_DISABLED) ??
		activeConfig.verificationCacheDisabled
	const scratchCacheDisabled =
		envDisablesFeature(env.JOYRIDE_SCRATCH_CACHE, env.JOYRIDE_SCRATCH_CACHE_DISABLED) ?? activeConfig.scratchCacheDisabled
	const searchCacheDisabled =
		envDisablesFeature(env.JOYRIDE_SEARCH_CACHE, env.JOYRIDE_SEARCH_CACHE_DISABLED) ?? activeConfig.searchCacheDisabled

	return {
		mode,
		commandReuseDisabled: mode === "disabled" ? true : commandReuseDisabled,
		verificationCacheDisabled: mode === "disabled" ? true : verificationCacheDisabled,
		scratchCacheDisabled: mode === "disabled" ? true : scratchCacheDisabled,
		searchCacheDisabled: mode === "disabled" ? true : searchCacheDisabled,
	}
}

export function getJoyRideConfig(): JoyRideOperationalConfig {
	return activeConfig
}

export function setJoyRideConfig(config: Partial<JoyRideOperationalConfig>): JoyRideOperationalConfig {
	activeConfig = {
		...activeConfig,
		...config,
	}
	if (activeConfig.mode === "disabled") {
		activeConfig.commandReuseDisabled = true
		activeConfig.verificationCacheDisabled = true
		activeConfig.scratchCacheDisabled = true
		activeConfig.searchCacheDisabled = true
	}
	return activeConfig
}

export function resetJoyRideConfig(): JoyRideOperationalConfig {
	activeConfig = { ...DEFAULT_CONFIG }
	resetJoyRideDegraded()
	return activeConfig
}

/** Whether active reuse (skipping expensive work) is permitted. */
export function canJoyRideSkipWork(): boolean {
	return activeConfig.mode === "enabled" && !degradedMode
}

/** Whether entries may be stored (diagnostics-only and enabled allow storage). */
export function canJoyRideStore(): boolean {
	return activeConfig.mode !== "disabled"
}

export function canJoyRideReuseCommands(): boolean {
	return canJoyRideSkipWork() && !activeConfig.commandReuseDisabled
}

export function canJoyRideReuseVerification(): boolean {
	return canJoyRideSkipWork() && !activeConfig.verificationCacheDisabled
}

export function canJoyRideReuseSearch(): boolean {
	return canJoyRideSkipWork() && !activeConfig.searchCacheDisabled
}

export function canJoyRideRetainScratch(): boolean {
	return canJoyRideStore() && !activeConfig.scratchCacheDisabled
}

// Initialize from environment on module load
activeConfig = loadJoyRideConfigFromEnv()

export function isJoyRideDisabled(): boolean {
	return activeConfig.mode === "disabled"
}

export function isDiagnosticsOnly(): boolean {
	return activeConfig.mode === "diagnostics-only"
}

export function isCommandReuseEnabled(): boolean {
	return canJoyRideReuseCommands()
}

export function isVerificationCacheEnabled(): boolean {
	return canJoyRideReuseVerification()
}

export function isSearchCacheEnabled(): boolean {
	return canJoyRideReuseSearch()
}

export function isScratchCacheEnabled(): boolean {
	return canJoyRideRetainScratch()
}

export function isJoyRideDegraded(): boolean {
	return degradedMode
}

export function markJoyRideDegraded(reason: string): void {
	degradedMode = true
	degradedReason = reason
}

export function resetJoyRideDegraded(): void {
	degradedMode = false
	degradedReason = undefined
}

export function getJoyRideDegradedReason(): string | undefined {
	return degradedReason
}

export function explainJoyRideConfig(): string {
	const c = getJoyRideConfig()
	const lines = [
		`mode=${c.mode}`,
		`commandReuse=${!c.commandReuseDisabled}`,
		`verificationCache=${!c.verificationCacheDisabled}`,
		`searchCache=${!c.searchCacheDisabled}`,
		`scratchCache=${!c.scratchCacheDisabled}`,
		`degraded=${degradedMode}${degradedReason ? ` reason=${degradedReason}` : ""}`,
	]
	return lines.join(" ")
}

export function resetJoyRideForTest(): JoyRideOperationalConfig {
	resetJoyRideDegraded()
	return resetJoyRideConfig()
}
