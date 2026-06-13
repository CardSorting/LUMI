import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { ApiProvider, DEFAULT_API_PROVIDER, ModelInfo } from "@shared/api"
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DietCodeRulesToggles } from "@shared/dietcode-rules"
import { DEFAULT_FOCUS_CHAIN_SETTINGS, FocusChainSettings } from "@shared/FocusChainSettings"
import { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_MCP_DISPLAY_MODE, McpDisplayMode } from "@shared/McpDisplayMode"
import { WorkspaceRoot } from "@shared/multi-root/types"
import { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { Mode } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { UserInfo } from "@shared/UserInfo"
import { BlobStoreSettings } from "./DietCodeBlobStorage"

// ============================================================================
// SINGLE SOURCE OF TRUTH FOR STORAGE KEYS
//
// Property definitions with types, default values, and metadata
// NOTE: When adding a new field, the scripts/generate-state-proto.mjs will be
// executed automatically to regenerate the proto/dietcode/state.proto file with the
// new fields once the file is staged and committed.
// ============================================================================

/**
 * Defines the shape of a field definition. Each field must have a `default` value,
 * and optionally can have `isAsync`, `isComputed`, or `transform` metadata.
 *
 * The type casting on `default` (e.g., `true as boolean`) is necessary because
 * TypeScript would otherwise infer the literal type (`true`) instead of the
 * wider type (`boolean`). This ensures the generated interfaces allow any
 * value of that type, not just the default literal.
 */
type FieldDefinition<T> = {
	default: T // The default value for the field with proper type casting using as (e.g., `true as boolean | undefined`)
	isAsync?: boolean
	isComputed?: boolean
	transform?: (value: unknown) => T
}

type FieldDefinitions = Record<string, FieldDefinition<unknown>>

export type ConfiguredAPIKeys = Partial<Record<ApiProvider, boolean>>
const REMOTE_CONFIG_EXTRA_FIELDS = {
	remoteConfiguredProviders: { default: [] as ApiProvider[] },
	allowedMCPServers: { default: [] as Array<{ id: string }> },
	remoteMCPServers: { default: undefined as Array<{ name: string; url: string; alwaysEnabled?: boolean }> | undefined },
	previousRemoteMCPServers: { default: undefined as Array<{ name: string; url: string }> | undefined },
	remoteGlobalRules: { default: undefined as GlobalInstructionsFile[] | undefined },
	remoteGlobalWorkflows: { default: undefined as GlobalInstructionsFile[] | undefined },
	blockPersonalRemoteMCPServers: { default: false as boolean },
	openTelemetryOtlpHeaders: { default: undefined as Record<string, string> | undefined },
	otlpMetricsHeaders: { default: undefined as Record<string, string> | undefined },
	otlpLogsHeaders: { default: undefined as Record<string, string> | undefined },
	blobStoreConfig: { default: undefined as BlobStoreSettings | undefined },
	configuredApiKeys: { default: {} as ConfiguredAPIKeys | undefined },
	vertexApiKey: { default: undefined as string | undefined },
	cloudflareApiToken: { default: undefined as string | undefined },
} satisfies FieldDefinitions

const GLOBAL_STATE_FIELDS = {
	dietcodeVersion: { default: undefined as string | undefined },
	"dietcode.generatedMachineId": { default: undefined as string | undefined }, // Note, distinctId reads/writes this directly from/to StorageContext before StateManager is initialized.
	lastShownAnnouncementId: { default: undefined as string | undefined },
	taskHistory: { default: [] as HistoryItem[], isAsync: true },
	userInfo: { default: undefined as UserInfo | undefined },
	favoritedModelIds: { default: [] as string[] },
	mcpMarketplaceEnabled: { default: true as boolean },
	mcpResponsesCollapsed: { default: false as boolean },
	terminalReuseEnabled: { default: true as boolean },
	vscodeTerminalExecutionMode: {
		default: "vscodeTerminal" as "vscodeTerminal",
	},
	isNewUser: { default: true as boolean },
	welcomeViewCompleted: { default: undefined as boolean | undefined },
	mcpDisplayMode: { default: DEFAULT_MCP_DISPLAY_MODE as McpDisplayMode },
	workspaceRoots: { default: undefined as WorkspaceRoot[] | undefined },
	primaryRootIndex: { default: 0 as number },
	multiRootEnabled: { default: true as boolean },
	lastDismissedInfoBannerVersion: { default: 0 as number },
	lastDismissedModelBannerVersion: { default: 0 as number },
	lastDismissedCliBannerVersion: { default: 0 as number },
	nativeToolCallEnabled: { default: true as boolean },
	remoteRulesToggles: { default: {} as DietCodeRulesToggles },
	remoteWorkflowToggles: { default: {} as DietCodeRulesToggles },
	dismissedBanners: { default: [] as Array<{ bannerId: string; dismissedAt: number }> },
	// Path to worktree that should auto-open DietCode sidebar when launched
	worktreeAutoOpenPath: { default: undefined as string | undefined },
	// Tracks architectural violations (Strikes) per file to enable progressive enforcement
	architecturalStrikes: { default: {} as Record<string, number> },
	// Persistent trust for specific tools (auto-approved if present)
	trustedTools: { default: [] as string[] },
	// Persistent trust for specific command prefixes (auto-approved if present)
	trustedCommands: { default: [] as string[] },
	// Persistent trust for specific MCP servers (auto-approved if present)
	trustedMcpServers: { default: [] as string[] },
	// Authentication token for remote control
	remoteAuthToken: { default: undefined as string | undefined },
	// Persistent environmental lease to prevent redundant pre-flight probes
	environmentalLease: { default: undefined as unknown | undefined },
	// Stores the last triggered JoyZoning report for UI restoration
	lastJoyZoningReport: { default: undefined as unknown | undefined },
	// Stores historical scores for trend analysis
	joyZoningHistory: { default: [] as Array<{ timestamp: string; health: number; stability: number; maintainability: number }> },
	// Stores the violation count from the last scan for delta analysis
	lastViolationCount: { default: 0 as number },
} satisfies FieldDefinitions

// Fields that map directly to ApiHandlerOptions in @shared/api.ts
const API_HANDLER_SETTINGS_FIELDS = {
	// Global configuration (not mode-specific)
	openAiHeaders: { default: {} as Record<string, string> },
	openRouterProviderSorting: { default: undefined as string | undefined },
	cloudflareAccountId: { default: undefined as string | undefined },

	// Embedding configuration
	embeddingProvider: { default: DEFAULT_API_PROVIDER as ApiProvider },
	embeddingModelId: { default: undefined as string | undefined },
	embeddingOpenAiBaseUrl: { default: undefined as string | undefined },

	// Plan mode configurations
	planModeApiModelId: { default: undefined as string | undefined },
	planModeThinkingBudgetTokens: { default: undefined as number | undefined },
	planModeReasoningEffort: { default: undefined as string | undefined },
	planModeOpenRouterModelId: { default: undefined as string | undefined },
	planModeOpenRouterModelInfo: { default: undefined as ModelInfo | undefined },
	planModeNousResearchModelId: { default: undefined as string | undefined },

	// Act mode configurations
	actModeApiModelId: { default: undefined as string | undefined },
	actModeThinkingBudgetTokens: { default: undefined as number | undefined },
	actModeReasoningEffort: { default: undefined as string | undefined },
	actModeOpenRouterModelId: { default: undefined as string | undefined },
	actModeOpenRouterModelInfo: { default: undefined as ModelInfo | undefined },
	actModeNousResearchModelId: { default: undefined as string | undefined },

	// Model-specific settings
	planModeApiProvider: { default: DEFAULT_API_PROVIDER as ApiProvider },
	actModeApiProvider: { default: DEFAULT_API_PROVIDER as ApiProvider },
} satisfies FieldDefinitions

const USER_SETTINGS_FIELDS = {
	// Settings that are NOT part of ApiHandlerOptions
	autoApprovalSettings: {
		default: DEFAULT_AUTO_APPROVAL_SETTINGS as AutoApprovalSettings,
	},
	globalDietCodeRulesToggles: { default: {} as DietCodeRulesToggles },
	globalWorkflowToggles: { default: {} as DietCodeRulesToggles },
	globalSkillsToggles: { default: {} as Record<string, boolean> },
	browserSettings: {
		default: DEFAULT_BROWSER_SETTINGS as BrowserSettings,
		transform: (v: unknown) => ({ ...DEFAULT_BROWSER_SETTINGS, ...(v as object) }),
	},
	telemetrySetting: { default: "unset" as TelemetrySetting },
	planActSeparateModelsSetting: { default: false as boolean, isComputed: true },
	enableCheckpointsSetting: { default: true as boolean },
	shellIntegrationTimeout: { default: 4000 as number },
	defaultTerminalProfile: { default: "default" as string },
	terminalOutputLineLimit: { default: 500 as number },
	maxConsecutiveMistakes: { default: 3 as number },
	strictPlanModeEnabled: { default: false as boolean },
	yoloModeToggled: { default: false as boolean },
	autoApproveAllToggled: { default: false as boolean },
	safeYoloModeToggled: { default: false as boolean },
	useAutoCondense: { default: false as boolean },
	subagentsEnabled: { default: false as boolean },
	maxSwarmDepth: { default: 3 as number },
	dietcodeWebToolsEnabled: { default: true as boolean },
	worktreesEnabled: { default: false as boolean },
	preferredLanguage: { default: "English" as string },
	mode: { default: "act" as Mode },
	focusChainSettings: { default: DEFAULT_FOCUS_CHAIN_SETTINGS as FocusChainSettings },
	customPrompt: { default: undefined as "compact" | undefined },
	enableParallelToolCalling: { default: true as boolean },
	backgroundEditEnabled: { default: false as boolean },
	optOutOfRemoteConfig: { default: false as boolean },
	doubleCheckCompletionEnabled: { default: false as boolean },
	masEnabled: { default: true as boolean },

	// OpenTelemetry configuration
	openTelemetryEnabled: { default: true as boolean },
	openTelemetryMetricsExporter: { default: undefined as string | undefined },
	openTelemetryLogsExporter: { default: undefined as string | undefined },
	openTelemetryOtlpProtocol: { default: "http/json" as string | undefined },
	openTelemetryOtlpEndpoint: { default: "http://localhost:4318" as string | undefined },
	openTelemetryOtlpMetricsProtocol: { default: undefined as string | undefined },
	openTelemetryOtlpMetricsEndpoint: { default: undefined as string | undefined },
	openTelemetryOtlpLogsProtocol: { default: undefined as string | undefined },
	openTelemetryOtlpLogsEndpoint: { default: undefined as string | undefined },
	openTelemetryMetricExportInterval: { default: 60000 as number | undefined },
	openTelemetryOtlpInsecure: { default: false as boolean | undefined },
	openTelemetryLogBatchSize: { default: 512 as number | undefined },
	openTelemetryLogBatchTimeout: { default: 5000 as number | undefined },
	openTelemetryLogMaxQueueSize: { default: 2048 as number | undefined },
} satisfies FieldDefinitions

const SETTINGS_FIELDS = { ...API_HANDLER_SETTINGS_FIELDS, ...USER_SETTINGS_FIELDS }
const GLOBAL_STATE_AND_SETTINGS_FIELDS = { ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }

// ============================================================================
// SECRET KEYS AND LOCAL STATE - Static definitions
// ============================================================================

// Secret keys used in Api Configuration
const SECRETS_KEYS = [
	"apiKey",
	"dietcodeApiKey",
	"dietcodeAccountId", // DietCode Account ID for Firebase
	"dietcode:dietcodeAccountId",
	"dietcode:googleAuthInfo",
	"dietcode:googleOAuthState",
	"openRouterApiKey",
	"awsAccessKey",
	"awsSecretKey",
	"awsSessionToken",
	"awsBedrockApiKey",
	"openAiApiKey",
	"geminiApiKey",
	"vertexApiKey",
	"openAiNativeApiKey",
	"ollamaApiKey",
	"deepSeekApiKey",
	"requestyApiKey",
	"togetherApiKey",
	"fireworksApiKey",
	"qwenApiKey",
	"doubaoApiKey",
	"mistralApiKey",
	"liteLlmApiKey",
	"authNonce",
	"asksageApiKey",
	"xaiApiKey",
	"moonshotApiKey",
	"zaiApiKey",
	"huggingFaceApiKey",
	"nebiusApiKey",
	"sambanovaApiKey",
	"cerebrasApiKey",
	"sapAiCoreClientId",
	"sapAiCoreClientSecret",
	"groqApiKey",
	"huaweiCloudMaasApiKey",
	"basetenApiKey",
	"vercelAiGatewayApiKey",
	"difyApiKey",
	"minimaxApiKey",
	"hicapApiKey",
	"aihubmixApiKey",
	"nousResearchApiKey",
	"remoteLiteLlmApiKey",
	"cloudflareApiToken",
	"ocaApiKey",
	"ocaRefreshToken",
	"mcpOAuthSecrets",
	"openai-codex-oauth-credentials", // JSON blob containing OAuth tokens for OpenAI Codex (ChatGPT subscription)
	"embeddingApiKey",
] as const

// WARNING, these are not ALL of the local state keys in practice. For example, FileContextTracker
// uses dynamic keys like pendingFileContextWarning_${taskId}.
export const LocalStateKeys = [
	"localDietCodeRulesToggles",
	"localCursorRulesToggles",
	"localWindsurfRulesToggles",
	"localAgentsRulesToggles",
	"localSkillsToggles",
	"workflowToggles",
] as const

// ============================================================================
// GENERATED TYPES - Auto-generated from property definitions
// ============================================================================

type ExtractDefault<T> = T extends { default: infer U } ? U : never
// biome-ignore lint/suspicious/noExplicitAny: any is required for generic type inference in BuildInterface
type BuildInterface<T extends Record<string, { default: any }>> = { [K in keyof T]: ExtractDefault<T[K]> }

export type GlobalState = BuildInterface<typeof GLOBAL_STATE_FIELDS>
export type Settings = BuildInterface<typeof SETTINGS_FIELDS>
type RemoteConfigExtra = BuildInterface<typeof REMOTE_CONFIG_EXTRA_FIELDS>
export type ApiHandlerOptionSettings = BuildInterface<typeof API_HANDLER_SETTINGS_FIELDS>
export type ApiHandlerSettings = ApiHandlerOptionSettings & Secrets
export type GlobalStateAndSettings = GlobalState & Settings
export type RemoteConfigFields = GlobalStateAndSettings & RemoteConfigExtra

// ============================================================================
// TYPE ALIASES
// ============================================================================

export type Secrets = { [K in (typeof SecretKeys)[number]]: string | undefined }
export type LocalState = { [K in (typeof LocalStateKeys)[number]]: DietCodeRulesToggles }
export type SecretKey = (typeof SecretKeys)[number]
export type GlobalStateKey = keyof GlobalState
export type LocalStateKey = keyof LocalState
export type SettingsKey = keyof Settings
export type GlobalStateAndSettingsKey = keyof GlobalStateAndSettings

// ============================================================================
// GENERATED KEYS AND LOOKUP SETS - Auto-generated from property definitions
// ============================================================================

const GlobalStateKeys = new Set(Object.keys(GLOBAL_STATE_FIELDS))
const SettingsKeysSet = new Set(Object.keys(SETTINGS_FIELDS))
const GlobalStateAndSettingsKeySet = new Set(Object.keys(GLOBAL_STATE_AND_SETTINGS_FIELDS))
const ApiHandlerSettingsKeysSet = new Set(Object.keys(API_HANDLER_SETTINGS_FIELDS))

export const SecretKeys = Array.from(SECRETS_KEYS)
export const SettingsKeys = Array.from(SettingsKeysSet) as (keyof Settings)[]
export const ApiHandlerSettingsKeys = Array.from(ApiHandlerSettingsKeysSet) as (keyof ApiHandlerOptionSettings)[]
export const GlobalStateAndSettingKeys = Array.from(GlobalStateAndSettingsKeySet) as GlobalStateAndSettingsKey[]

// GENERATED DEFAULTS - Auto-generated from property definitions
// ============================================================================

export const GLOBAL_STATE_DEFAULTS = extractDefaults(GLOBAL_STATE_FIELDS)
export const SETTINGS_DEFAULTS = extractDefaults(SETTINGS_FIELDS)
export const SETTINGS_TRANSFORMS = extractTransforms(SETTINGS_FIELDS)
export const ASYNC_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }, "isAsync")
export const COMPUTED_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }, "isComputed")

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export const isGlobalStateKey = (key: string): key is GlobalStateKey => GlobalStateKeys.has(key)
export const isSettingsKey = (key: string): key is SettingsKey => SettingsKeysSet.has(key)
export const isSecretKey = (key: string): key is SecretKey => new Set(SECRETS_KEYS).has(key as SecretKey)
export const isLocalStateKey = (key: string): key is LocalStateKey => new Set(LocalStateKeys).has(key as LocalStateKey)

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export const isAsyncProperty = (key: string): boolean => ASYNC_PROPERTIES.has(key)
export const isComputedProperty = (key: string): boolean => COMPUTED_PROPERTIES.has(key)

export const getDefaultValue = <K extends GlobalStateAndSettingsKey>(key: K): GlobalStateAndSettings[K] | undefined => {
	return ((GLOBAL_STATE_DEFAULTS as Record<string, unknown>)[key] ?? (SETTINGS_DEFAULTS as Record<string, unknown>)[key]) as
		| GlobalStateAndSettings[K]
		| undefined
}

export const hasTransform = (key: string): boolean => key in SETTINGS_TRANSFORMS
export const applyTransform = <T>(key: string, value: T): T => {
	const transform = SETTINGS_TRANSFORMS[key]
	return transform ? (transform(value) as T) : value
}

function extractDefaults<T extends Record<string, { default: unknown }>>(props: T): Partial<BuildInterface<T>> {
	return Object.fromEntries(
		Object.entries(props)
			.map(([key, prop]) => [key, (prop as { default: unknown }).default])
			.filter(([_, value]) => value !== undefined),
	) as unknown as Partial<BuildInterface<T>>
}

function extractTransforms<T extends Record<string, { default: unknown }>>(
	props: T,
): Record<string, (value: unknown) => unknown> {
	return Object.fromEntries(
		Object.entries(props)
			.filter(([_, prop]) => "transform" in (prop as object) && (prop as { transform?: unknown }).transform !== undefined)
			.map(([key, prop]) => [key, (prop as unknown as { transform: (value: unknown) => unknown }).transform]),
	)
}

function extractMetadata<T extends Record<string, { default: unknown }>>(props: T, field: string): Set<string> {
	return new Set(
		Object.entries(props)
			.filter(([_, prop]) => field in (prop as object) && (prop as Record<string, unknown>)[field] === true)
			.map(([key]) => key),
	)
}
