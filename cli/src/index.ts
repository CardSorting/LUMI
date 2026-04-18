/**
 * DietCode CLI - TypeScript implementation with React Ink
 */

import { existsSync } from "node:fs"
import path from "node:path"
import { exit } from "node:process"
import type { ApiProvider } from "@shared/api"
import { Command } from "commander"
import { render } from "ink"
import React from "react"
import { DietCodeEndpoint } from "@/config"
import type { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { RemoteWebviewProvider } from "@/core/webview/RemoteWebviewProvider"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { ErrorService } from "@/services/error/ErrorService"
import { AuditLogService } from "@/services/logging/AuditLogService"
import { telemetryService } from "@/services/telemetry"
import { PostHogClientProvider } from "@/services/telemetry/providers/posthog/PostHogClientProvider"
import { HistoryItem } from "@/shared/HistoryItem"
import { Logger } from "@/shared/services/Logger"
import { Session } from "@/shared/services/Session"
import { getProviderModelIdKey } from "@/shared/storage"
import { isOpenaiReasoningEffort, OPENAI_REASONING_EFFORT_OPTIONS, type OpenaiReasoningEffort } from "@/shared/storage/types"
import { version as CLI_VERSION } from "../package.json"
import { runAcpMode } from "./acp/index.js"
import { App } from "./components/App"
import { checkRawModeSupport } from "./context/StdinContext"
import { createCliHostBridgeProvider } from "./controllers"
import { CliCommentReviewController } from "./controllers/CliCommentReviewController"
import { CliWebviewProvider } from "./controllers/CliWebviewProvider"
import { RemoteServer } from "./server/RemoteServer"
import { isAuthConfigured } from "./utils/auth"
import { restoreConsole, suppressConsoleUnlessVerbose } from "./utils/console"
import { printError, printInfo, printSuccess, printWarning, style } from "./utils/display"
import { selectOutputMode } from "./utils/mode-selection"
import { parseImagesFromInput, processImagePaths } from "./utils/parser"
import { CLINE_CLI_DIR, getCliBinaryPath } from "./utils/path"
import { readStdinIfPiped } from "./utils/piped"
import { runPlainTextTask } from "./utils/plain-text-task"
import { applyProviderConfig } from "./utils/provider-config"
import { getValidCliProviders, isValidCliProvider } from "./utils/providers"
import { autoUpdateOnStartup, checkForUpdates } from "./utils/update"
import { initializeCliContext } from "./vscode-context"
import { CLI_LOG_FILE, type ExtensionContext, shutdownEvent, window } from "./vscode-shim"

// CLI-only behavior: suppress console output unless verbose mode is enabled.
// Kept explicit here so importing the library bundle does not mutate global console methods.
suppressConsoleUnlessVerbose()

/**
 * Common options shared between runTask and resumeTask
 */
interface TaskOptions {
	act?: boolean
	plan?: boolean
	model?: string
	verbose?: boolean
	cwd?: string
	config?: string
	thinking?: boolean | string
	reasoningEffort?: string
	maxConsecutiveMistakes?: string
	yolo?: boolean
	safeYolo?: boolean
	doubleCheckCompletion?: boolean
	timeout?: string
	json?: boolean
	stdinWasPiped?: boolean
	trace?: boolean
	mas?: boolean
}

let telemetryDisposed = false

async function disposeTelemetryServices(): Promise<void> {
	if (telemetryDisposed) {
		return
	}

	telemetryDisposed = true
	await Promise.allSettled([telemetryService.dispose(), PostHogClientProvider.getInstance().dispose()])
}

async function disposeCliContext(ctx: CliContext): Promise<void> {
	await ctx.controller.stateManager.flushPendingState()
	await ctx.controller.dispose()
	await ErrorService.get().dispose()
	await disposeTelemetryServices()
}

function setModeScopedState(currentMode: "act" | "plan", setter: (mode: "act" | "plan") => void): void {
	const stateManager = StateManager.get()
	setter(currentMode)

	const separateModels = stateManager.getGlobalSettingsKey("planActSeparateModelsSetting") ?? false
	if (!separateModels) {
		const otherMode: "act" | "plan" = currentMode === "act" ? "plan" : "act"
		setter(otherMode)
	}
}

function normalizeReasoningEffort(value?: string): OpenaiReasoningEffort | undefined {
	if (value === undefined) {
		return undefined
	}

	const normalized = value.toLowerCase()
	if (isOpenaiReasoningEffort(normalized)) {
		return normalized
	}

	printWarning(
		`Invalid --reasoning-effort '${value}'. Using 'medium'. Valid values: ${OPENAI_REASONING_EFFORT_OPTIONS.join(", ")}.`,
	)
	return "medium"
}

function normalizeMaxConsecutiveMistakes(value?: string): number | undefined {
	if (value === undefined) {
		return undefined
	}

	const parsed = Number.parseInt(value, 10)
	if (Number.isNaN(parsed) || parsed < 1) {
		printWarning(`Invalid --max-consecutive-mistakes value '${value}'. Expected integer >= 1.`)
		return undefined
	}

	return parsed
}

/**
 * Apply task-related options (mode, model, thinking, yolo) to StateManager.
 * Shared between runTask and resumeTask to avoid duplication.
 */
function applyTaskOptions(options: TaskOptions): void {
	// Apply mode flag
	if (options.plan) {
		StateManager.get().setGlobalState("mode", "plan")
		telemetryService.captureHostEvent("mode_flag", "plan")
	} else if (options.act) {
		StateManager.get().setGlobalState("mode", "act")
		telemetryService.captureHostEvent("mode_flag", "act")
	}

	// Apply trace flag
	if (options.trace) {
		Logger.setVerbose(true)
		telemetryService.captureHostEvent("trace_flag", "true")
	}

	// Apply model override if specified
	if (options.model) {
		const selectedMode = (StateManager.get().getGlobalSettingsKey("mode") || "act") as "act" | "plan"
		const providerKey = selectedMode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = StateManager.get().getGlobalSettingsKey(providerKey) as ApiProvider
		const modelKey = getProviderModelIdKey(currentProvider, selectedMode)
		if (modelKey) {
			StateManager.get().setGlobalState(modelKey, options.model)
		}
		telemetryService.captureHostEvent("model_flag", options.model)
	}

	// Set thinking budget based on --thinking flag (boolean or number)
	let thinkingBudget = 0
	if (options.thinking) {
		if (typeof options.thinking === "string") {
			const parsed = Number.parseInt(options.thinking, 10)
			if (Number.isNaN(parsed) || parsed < 0) {
				printWarning(`Invalid --thinking value '${options.thinking}'. Using default 1024.`)
				thinkingBudget = 1024
			} else {
				thinkingBudget = parsed
			}
		} else {
			thinkingBudget = 1024
		}
	}
	const currentMode = (StateManager.get().getGlobalSettingsKey("mode") || "act") as "act" | "plan"
	setModeScopedState(currentMode, (mode) => {
		const thinkingKey = mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
		StateManager.get().setGlobalState(thinkingKey, thinkingBudget)
	})
	if (options.thinking) {
		telemetryService.captureHostEvent("thinking_flag", "true")
	}

	const reasoningEffort = normalizeReasoningEffort(options.reasoningEffort)
	if (reasoningEffort !== undefined) {
		setModeScopedState(currentMode, (mode) => {
			const reasoningKey = mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"
			StateManager.get().setGlobalState(reasoningKey, reasoningEffort)
		})
		telemetryService.captureHostEvent("reasoning_effort_flag", reasoningEffort)
	}

	const maxConsecutiveMistakes = normalizeMaxConsecutiveMistakes(options.maxConsecutiveMistakes)
	if (maxConsecutiveMistakes !== undefined) {
		StateManager.get().setGlobalState("maxConsecutiveMistakes", maxConsecutiveMistakes)
		telemetryService.captureHostEvent("max_consecutive_mistakes_flag", String(maxConsecutiveMistakes))
	}

	// Set yolo mode as a session-scoped override so AutoApprove picks it up,
	// but it is never persisted to disk (setSessionOverride never touches pendingGlobalState).
	if (options.yolo) {
		StateManager.get().setSessionOverride("yoloModeToggled", true)
		telemetryService.captureHostEvent("yolo_flag", "true")
	}

	// Set safe-yolo mode as a session-scoped override
	if (options.safeYolo) {
		StateManager.get().setSessionOverride("safeYoloModeToggled", true)
		telemetryService.captureHostEvent("safe_yolo_flag", "true")
	}

	// Set double-check completion based on flag
	if (options.doubleCheckCompletion) {
		StateManager.get().setGlobalState("doubleCheckCompletionEnabled", true)
		telemetryService.captureHostEvent("double_check_completion_flag", "true")
	}

	// Set MAS mode based on flag
	if (options.mas) {
		StateManager.get().setGlobalState("masEnabled", true)
		telemetryService.captureHostEvent("mas_flag", "true")
	}
}

/**
 * Get mode selection result using the extracted, testable selectOutputMode function.
 * This wrapper provides the current process TTY state.
 */
function getModeSelection(options: TaskOptions) {
	return selectOutputMode({
		stdoutIsTTY: process.stdout.isTTY === true,
		stdinIsTTY: process.stdin.isTTY === true,
		stdinWasPiped: options.stdinWasPiped ?? false,
		json: options.json,
		yolo: options.yolo,
	})
}

/**
 * Determine if plain text mode should be used based on options and environment.
 */
function shouldUsePlainTextMode(options: TaskOptions): boolean {
	return getModeSelection(options).usePlainTextMode
}

/**
 * Get the reason for using plain text mode (for telemetry).
 */
function getPlainTextModeReason(options: TaskOptions): string {
	return getModeSelection(options).reason
}

/**
 * Run a task in plain text mode (no Ink UI).
 * Handles auth check, task execution, cleanup, and exit.
 */
async function runTaskInPlainTextMode(
	ctx: CliContext,
	options: TaskOptions,
	taskConfig: {
		prompt?: string
		taskId?: string
		imageDataUrls?: string[]
	},
): Promise<never> {
	// Set flag so shutdown handler knows not to clear Ink UI lines
	isPlainTextMode = true

	// Check if auth is configured before attempting to run the task
	// In plain text mode we can't show the interactive auth flow
	const hasAuth = await isAuthConfigured()
	if (!hasAuth) {
		printWarning("Not authenticated. Please run 'dietcode auth' first to configure your API credentials.")
		await disposeCliContext(ctx)
		exit(1)
	}

	const reason = getPlainTextModeReason(options)
	telemetryService.captureHostEvent("plain_text_mode", reason)

	// Plain text mode: no Ink rendering, just clean text output
	const success = await runPlainTextTask({
		controller: ctx.controller,
		prompt: taskConfig.prompt,
		taskId: taskConfig.taskId,
		imageDataUrls: taskConfig.imageDataUrls,
		verbose: options.verbose,
		jsonOutput: options.json,
		timeoutSeconds: options.timeout ? Number.parseInt(options.timeout, 10) : undefined,
	})

	// Cleanup
	await disposeCliContext(ctx)

	// Ensure stdout is fully drained before exiting - critical for piping
	await drainStdout()
	exit(success ? 0 : 1)
}

/**
 * Create the standard cleanup function for Ink apps.
 */
function createInkCleanup(ctx: CliContext, onTaskError?: () => boolean): () => Promise<void> {
	return async () => {
		await disposeCliContext(ctx)
		if (onTaskError?.()) {
			printWarning("Task ended with errors.")
			exit(1)
		}
		exit(0)
	}
}

// Track active context for graceful shutdown
let activeContext: CliContext | null = null
let isShuttingDown = false
// Track if we're in plain text mode (no Ink UI) - set by runTask when piped stdin detected
let isPlainTextMode = false

/**
 * Wait for stdout to fully drain before exiting.
 * Critical for piping - ensures data is flushed to the next command in the pipe.
 */
async function drainStdout(): Promise<void> {
	return new Promise<void>((resolve) => {
		// Check if stdout needs draining
		if (process.stdout.writableNeedDrain) {
			process.stdout.once("drain", resolve)
		} else {
			// Give a small delay to ensure any pending writes complete
			setImmediate(resolve)
		}
	})
}

function setupSignalHandlers() {
	const shutdown = async (signal: string) => {
		if (isShuttingDown) {
			// Force exit on second signal
			process.exit(1)
		}
		isShuttingDown = true

		// Notify components to hide UI before shutdown
		shutdownEvent.fire()

		// Only clear Ink UI lines if we're not in plain text mode
		// In plain text mode, there's no Ink UI to clear and the ANSI codes
		// would corrupt the streaming output
		if (!isPlainTextMode) {
			// Clear several lines to remove the input field and footer from display
			// Move cursor up and clear lines (input box + footer rows)
			const linesToClear = 8 // Input box (3 lines with border) + footer (4-5 lines)
			process.stdout.write(`\x1b[${linesToClear}A\x1b[J`)
		}

		printWarning(`${signal} received, shutting down...`)

		try {
			if (activeContext) {
				const task = activeContext.controller.task
				if (task) {
					task.abortTask()
				}
				await disposeCliContext(activeContext)
			} else {
				// Best-effort flush of restored yolo state when no active context
				try {
					await StateManager.get().flushPendingState()
				} catch {
					// StateManager may not be initialized yet
				}
				await ErrorService.get().dispose()
				await disposeTelemetryServices()
			}
		} catch {
			// Best effort cleanup
		}

		process.exit(0)
	}

	process.on("SIGINT", () => shutdown("SIGINT"))
	process.on("SIGTERM", () => shutdown("SIGTERM"))

	// Suppress known abort errors from unhandled rejections
	// These occur when task is cancelled and async operations throw "DietCode instance aborted"
	process.on("unhandledRejection", async (reason: unknown) => {
		const message = reason instanceof Error ? reason.message : String(reason)
		// Silently ignore abort-related errors - they're expected during task cancellation
		if (message.includes("aborted") || message.includes("abort")) {
			Logger.info("Suppressed unhandled rejection due to abort:", message)
			return
		}
		// For other unhandled rejections, log to file via Logger (if available)
		// This won't show in terminal but will be in log files for debugging
		Logger.error("Unhandled rejection:", reason)

		// Best-effort flush of state before potential crash
		if (activeContext) {
			await activeContext.controller.stateManager.flushPendingState()
		}
	})

	process.on("uncaughtException", async (error: Error) => {
		Logger.error("Uncaught exception:", error)
		if (activeContext) {
			await activeContext.controller.stateManager.flushPendingState()
		}
		printError(`Fatal error: ${error.message}`)
		process.exit(1)
	})
}

setupSignalHandlers()

interface CliContext {
	extensionContext: ExtensionContext
	dataDir: string
	extensionDir: string
	workspacePath: string
	controller: Controller
}

interface InitOptions {
	config?: string
	cwd?: string
	verbose?: boolean
	enableAuth?: boolean
	isRemote?: boolean
}

/**
 * Initialize all CLI infrastructure and return context needed for commands
 */
async function initializeCli(options: InitOptions): Promise<CliContext> {
	const workspacePath = options.cwd || process.cwd()
	const { extensionContext, storageContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		dietcodeDir: options.config,
		workspaceDir: workspacePath,
	})

	// Set up output channel and Logger early so DietCodeEndpoint.initialize logs are captured
	const outputChannel = window.createOutputChannel("DietCode CLI")
	const logToChannel = (message: string) => outputChannel.appendLine(message)

	// Configure the shared Logging class early to capture all initialization logs
	Logger.subscribe(logToChannel)

	await DietCodeEndpoint.initialize(EXTENSION_DIR)

	// Auto-update check (after endpoints initialized, so we can detect bundled configs)
	autoUpdateOnStartup(CLI_VERSION)

	// Initialize/reset session tracking for this CLI run
	Session.reset()

	if (options.enableAuth) {
		AuthHandler.getInstance().setEnabled(true)
	}

	outputChannel.appendLine(
		`DietCode CLI initialized. Data dir: ${DATA_DIR}, Extension dir: ${EXTENSION_DIR}, Log dir: ${CLINE_CLI_DIR.log}`,
	)

	// Start system guardrails
	const { SystemGuardrails } = await import("@/core/resource/SystemGuardrails")
	SystemGuardrails.getInstance().start()

	const webviewProviderCreator = options.isRemote
		? () => new RemoteWebviewProvider(extensionContext as unknown as ExtensionContext)
		: () => new CliWebviewProvider(extensionContext as unknown as ExtensionContext)

	const hostBridgeProvider = options.isRemote
		? (await import("@/hosts/RemoteHostHostBridge")).createRemoteHostHostBridgeProvider()
		: createCliHostBridgeProvider(workspacePath)

	HostProvider.initialize(
		webviewProviderCreator,
		() => new FileEditProvider(),
		() => new CliCommentReviewController(),
		() => new StandaloneTerminalManager(),
		hostBridgeProvider,
		logToChannel,
		async (path: string) => (options.enableAuth ? AuthHandler.getInstance().getCallbackUrl(path) : ""),
		getCliBinaryPath,
		EXTENSION_DIR,
		DATA_DIR,
	)

	await StateManager.initialize(storageContext)
	await ErrorService.initialize()

	const webview = HostProvider.get().createWebviewProvider()
	const controller = webview.controller

	await telemetryService.captureExtensionActivated()
	await telemetryService.captureHostEvent("dietcode_cli", "initialized")

	const ctx: CliContext = {
		extensionContext: extensionContext as unknown as ExtensionContext,
		dataDir: DATA_DIR,
		extensionDir: EXTENSION_DIR,
		workspacePath,
		controller,
	}
	activeContext = ctx
	return ctx
}

/**
 * Run an Ink app with proper cleanup handling
 */
async function runInkApp(element: React.ReactElement, cleanup: () => Promise<void>): Promise<void> {
	// Clear terminal for clean UI - robot will render at row 1
	process.stdout.write("\x1b[2J\x1b[3J\x1b[H")

	// Note: incrementalRendering is disabled because it causes UI glitches on terminal resize.
	// Ink's incremental rendering tries to erase N lines based on previous output height,
	// but when the terminal shrinks, this leaves artifacts. Gemini CLI only enables
	// incrementalRendering when alternateBuffer is also enabled (which we don't use).
	const { waitUntilExit, unmount } = render(element, { exitOnCtrlC: true })

	try {
		await waitUntilExit()
	} finally {
		try {
			unmount()
		} catch {
			// Already unmounted
		}
		restoreConsole()
		await cleanup()
	}
}

/**
 * Run a task with the given prompt - uses welcome view for consistent behavior
 */
async function runTask(prompt: string, options: TaskOptions & { images?: string[] }, existingContext?: CliContext) {
	const ctx = existingContext || (await initializeCli({ ...options, enableAuth: true }))

	// Parse images from the prompt text (e.g., @/path/to/image.png)
	const { prompt: cleanPrompt, imagePaths: parsedImagePaths } = parseImagesFromInput(prompt)

	// Combine parsed image paths with explicit --images option
	const allImagePaths = [...(options.images || []), ...parsedImagePaths]
	// Convert image file paths to base64 data URLs
	const imageDataUrls = await processImagePaths(allImagePaths)

	// Use clean prompt (with image refs removed)
	const taskPrompt = cleanPrompt || prompt

	// Task without prompt starts in interactive mode
	telemetryService.captureHostEvent("task_command", prompt ? "task" : "interactive")

	// Apply shared task options (mode, model, thinking, yolo)
	applyTaskOptions(options)
	await StateManager.get().flushPendingState()

	// Use plain text mode when output is redirected, stdin was piped, JSON mode is enabled, or --yolo flag is used
	if (shouldUsePlainTextMode(options)) {
		return runTaskInPlainTextMode(ctx, options, {
			prompt: taskPrompt,
			imageDataUrls: imageDataUrls.length > 0 ? imageDataUrls : undefined,
		})
	}

	// Interactive mode: Render the welcome view with optional initial prompt/images
	// If prompt provided (dietcode task "prompt"), ChatView will auto-submit
	// If no prompt (dietcode interactive), user will type it in
	let taskError = false

	await runInkApp(
		React.createElement(App, {
			view: "welcome",
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			initialPrompt: taskPrompt || undefined,
			initialImages: imageDataUrls.length > 0 ? imageDataUrls : undefined,
			onError: () => {
				taskError = true
			},
			onWelcomeExit: () => {
				// User pressed Esc; Ink exits and cleanup handles process exit.
			},
		}),
		createInkCleanup(ctx, () => taskError),
	)
}

/**
 * List task history
 */
async function listHistory(options: { config?: string; limit?: number; page?: number }) {
	const ctx = await initializeCli(options)

	const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
	// Sort by timestamp (newest first) before pagination
	const sortedHistory = [...taskHistory].sort((a, b) => (b.ts || 0) - (a.ts || 0))
	const limit = typeof options.limit === "string" ? Number.parseInt(options.limit, 10) : options.limit || 10
	const initialPage = typeof options.page === "string" ? Number.parseInt(options.page, 10) : options.page || 1
	const totalCount = sortedHistory.length
	const totalPages = Math.ceil(totalCount / limit)

	telemetryService.captureHostEvent("history_command", "executed")

	if (sortedHistory.length === 0) {
		printInfo("No task history found.")
		await disposeCliContext(ctx)
		exit(0)
	}

	await runInkApp(
		React.createElement(App, {
			view: "history",
			historyItems: [],
			historyAllItems: sortedHistory,
			controller: ctx.controller,
			historyPagination: { page: initialPage, totalPages, totalCount, limit },
			isRawModeSupported: checkRawModeSupport(),
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(0)
		},
	)
}

/**
 * Show current configuration
 */
async function showConfig(options: { config?: string }) {
	const ctx = await initializeCli(options)
	const stateManager = StateManager.get()

	// Dynamically import the wrapper to avoid circular dependencies
	const { ConfigViewWrapper } = await import("./components/ConfigViewWrapper")

	telemetryService.captureHostEvent("config_command", "executed")

	await runInkApp(
		React.createElement(ConfigViewWrapper, {
			controller: ctx.controller,
			dataDir: ctx.dataDir,
			globalState: stateManager.getAllGlobalStateEntries(),
			workspaceState: stateManager.getAllWorkspaceStateEntries(),
			hooksEnabled: true,
			skillsEnabled: true,
			isRawModeSupported: checkRawModeSupport(),
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(0)
		},
	)
}

/**
 * Run authentication flow
 */
/**
 * Perform quick auth setup without UI - validates and saves configuration directly
 */
async function performQuickAuthSetup(
	ctx: CliContext,
	options: { provider: string; apikey: string; modelid: string; baseurl?: string },
): Promise<{ success: boolean; error?: string }> {
	const { provider, apikey, modelid, baseurl } = options

	const normalizedProvider = provider.toLowerCase().trim()

	if (!isValidCliProvider(normalizedProvider)) {
		const validProviders = getValidCliProviders()
		return { success: false, error: `Invalid provider '${provider}'. Supported providers: ${validProviders.join(", ")}` }
	}

	if (normalizedProvider === "bedrock") {
		return {
			success: false,
			error: "Bedrock provider is not supported for quick setup due to complex authentication requirements. Please use interactive setup.",
		}
	}

	if (baseurl && !["openai", "openai-native"].includes(normalizedProvider)) {
		return { success: false, error: "Base URL is only supported for OpenAI and OpenAI-compatible providers" }
	}

	// Save configuration using shared utility
	await applyProviderConfig({
		providerId: normalizedProvider,
		apiKey: apikey,
		modelId: modelid,
		baseUrl: baseurl,
		controller: ctx.controller,
	})

	// Mark onboarding as complete
	StateManager.get().setGlobalState("welcomeViewCompleted", true)
	await StateManager.get().flushPendingState()

	return { success: true }
}

async function runAuth(options: {
	provider?: string
	apikey?: string
	modelid?: string
	baseurl?: string
	verbose?: boolean
	cwd?: string
	config?: string
}) {
	const ctx = await initializeCli({ ...options, enableAuth: true })

	const hasQuickSetupFlags = options.provider && options.apikey && options.modelid

	telemetryService.captureHostEvent("auth_command", hasQuickSetupFlags ? "quick_setup" : "interactive")

	// Quick setup mode - no UI, just save configuration and exit
	if (hasQuickSetupFlags) {
		const result = await performQuickAuthSetup(ctx, {
			provider: options.provider || "",
			apikey: options.apikey || "",
			modelid: options.modelid || "",
			baseurl: options.baseurl,
		})

		if (!result.success) {
			printWarning(result.error || "Quick setup failed")
			await telemetryService.captureHostEvent("auth", "error")
			await disposeCliContext(ctx)
			exit(1)
		}

		await telemetryService.captureHostEvent("auth", "completed")
		await disposeCliContext(ctx)
		exit(0)
	}

	// Interactive mode - show Ink UI
	let authError = false

	await runInkApp(
		React.createElement(App, {
			view: "auth",
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onComplete: () => {
				telemetryService.captureHostEvent("auth", "completed")
			},
			onError: () => {
				telemetryService.captureHostEvent("auth", "error")
				authError = true
			},
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(authError ? 1 : 0)
		},
	)
}

/**
 * Run the remote server
 */
async function runServer(options: {
	port: string
	host: string
	verbose?: boolean
	config?: string
	cwd?: string
	build?: boolean
}) {
	const port = Number.parseInt(options.port, 10)
	const host = options.host
	const ctx = await initializeCli({ ...options, enableAuth: true, isRemote: true })

	// Resolve static path for remote-ui
	// If we're in a source checkout, it's in the root
	let staticPath = path.join(ctx.extensionDir, "remote-ui", "dist")
	if (!existsSync(staticPath)) {
		// Fallback for different structures (e.g. if extensionDir is cli/)
		staticPath = path.join(ctx.extensionDir, "..", "remote-ui", "dist")
	}

	// Automatic build if requested or if dist is missing and we're in a source tree
	if (
		options.build ||
		(!existsSync(staticPath) && existsSync(path.join(ctx.extensionDir, "..", "remote-ui", "package.json")))
	) {
		printInfo("Building remote-ui...")
		try {
			const { execSync } = await import("node:child_process")
			execSync("npm run build", {
				cwd: path.join(ctx.extensionDir, "..", "remote-ui"),
				stdio: "inherit",
			})
		} catch (error) {
			printWarning(`Failed to build remote-ui: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	// Ensure we have a token if requested, or generate one/reuse existing
	let authToken = process.env.DIETCODE_REMOTE_AUTH_TOKEN
	if (!authToken) {
		authToken = StateManager.get().getGlobalStateKey("remoteAuthToken")
		if (!authToken) {
			authToken = Math.random().toString(36).substring(2, 15)
			StateManager.get().setGlobalState("remoteAuthToken", authToken)
			await StateManager.get().flushPendingState()
		}
		process.env.DIETCODE_REMOTE_AUTH_TOKEN = authToken
	}

	printInfo(`Remote control authentication token: ${authToken}`)
	printInfo(`Access URL: http://${host}:${port}/?token=${authToken}`)

	const server = new RemoteServer(ctx.controller, {
		port,
		host,
		staticPath: existsSync(staticPath) ? staticPath : undefined,
	})

	server.start({ port, host })

	if (!existsSync(staticPath)) {
		printWarning(`Webview UI dist folder not found at ${staticPath}. Server will only provide API/WebSocket services.`)
		printInfo("To build the UI, run: npm run build:remote-ui")
	}

	// Keep the process alive
	process.stdin.resume()
}

// Setup CLI commands
const program = new Command()

program.name("dietcode").description("DietCode CLI - AI coding assistant in your terminal").version(CLI_VERSION)

// Enable positional options to avoid conflicts between root and subcommand options with the same name
program.enablePositionalOptions()

program
	.command("task")
	.alias("t")
	.description("Run a new task")
	.argument("<prompt>", "The task prompt")
	.option("-a, --act", "Run in act mode")
	.option("-p, --plan", "Run in plan mode")
	.option("-y, --yolo", "Enable yes/yolo mode (auto-approve all actions)")
	.option("-s, --safe-yolo", "Enable safe-yolo mode (auto-approve read-only and trusted actions)")
	.option("-t, --timeout <seconds>", "Optional timeout in seconds (applies only when provided)")
	.option("-m, --model <model>", "Model to use for the task")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory for the task")
	.option("--config <path>", "Path to DietCode configuration directory")
	.option("--thinking [tokens]", "Enable extended thinking (default: 1024 tokens)")
	.option("--reasoning-effort <effort>", "Reasoning effort: none|low|medium|high|xhigh")
	.option("--max-consecutive-mistakes <count>", "Maximum consecutive mistakes before halting in yolo mode")
	.option("--json", "Output messages as JSON instead of styled text")
	.option("--double-check-completion", "Reject first completion attempt to force re-verification")
	.option("-T, --taskId <id>", "Resume an existing task by ID")
	.option("--trace", "Enable high-verbosity tool execution logging")
	.action((prompt, options) => {
		if (options.taskId) {
			return resumeTask(options.taskId, { ...options, initialPrompt: prompt })
		}
		return runTask(prompt, { ...options, safeYolo: options.safeYolo })
	})

program
	.command("history")
	.alias("h")
	.description("List task history")
	.option("-n, --limit <number>", "Number of tasks to show", "10")
	.option("-p, --page <number>", "Page number (1-based)", "1")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(listHistory)

const session = program.command("session").alias("s").description("Manage tasks/sessions")

session
	.command("list")
	.alias("ls")
	.description("List task history")
	.option("-n, --limit <number>", "Number of tasks to show", "10")
	.option("-p, --page <number>", "Page number (1-based)", "1")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(listHistory)

session
	.command("delete <id>")
	.description("Delete a task by ID")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (id, options) => {
		const ctx = await initializeCli(options)
		const history = StateManager.get().getGlobalStateKey("taskHistory") || []
		const newHistory = history.filter((item) => item.id !== id)
		if (newHistory.length === history.length) {
			printError(`Task with ID '${id}' not found.`)
		} else {
			StateManager.get().setGlobalState("taskHistory", newHistory)
			await StateManager.get().flushPendingState()
			printSuccess(`Task '${id}' deleted.`)
		}
		await disposeCliContext(ctx)
		exit(0)
	})

session
	.command("open <id>")
	.description("Resume a task by ID")
	.option("-v, --verbose", "Show verbose output")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action((id, options) => {
		return resumeTask(id, options)
	})

session
	.command("export <id> [file]")
	.description("Export a session to a JSON file")
	.option("--config <path>", "Path to DietCode configuration directory")
	.option("-f, --force", "Overwrite existing file")
	.action(async (id, file, options) => {
		const ctx = await initializeCli({ config: options.config })
		try {
			const exportData = await ctx.controller.getExportData(id)
			const outputPath = file || `dietcode-session-${id}.json`

			const fs = await import("fs/promises")
			const { fileExistsAtPath } = await import("@utils/fs")
			if ((await fileExistsAtPath(outputPath)) && !options.force) {
				printError(`File ${outputPath} already exists. Use --force to overwrite.`)
				await disposeCliContext(ctx)
				process.exit(1)
			}

			await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2))
			printSuccess(`Session '${id}' exported to ${outputPath}`)
		} catch (error) {
			printError(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

session
	.command("import <file>")
	.description("Import a session from a JSON file")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (file, options) => {
		const ctx = await initializeCli({ config: options.config })
		try {
			const fs = await import("fs/promises")
			const { fileExistsAtPath } = await import("@utils/fs")
			if (!(await fileExistsAtPath(file))) {
				printError(`File ${file} not found.`)
				await disposeCliContext(ctx)
				process.exit(1)
			}
			const content = await fs.readFile(file, "utf8")
			const importData = JSON.parse(content)

			if (!importData.historyItem || !importData.historyItem.id) {
				printError("Invalid import file format.")
				await disposeCliContext(ctx)
				process.exit(1)
			}

			await ctx.controller.importTask(importData)
			printSuccess(`Session '${importData.historyItem.id}' imported successfully.`)
		} catch (error) {
			printError(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

session
	.command("delete <id>")
	.description("Delete a session and all its associated data")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (id, options) => {
		const ctx = await initializeCli(options)
		try {
			const history = StateManager.get().getGlobalStateKey("taskHistory") || []
			const item = history.find((h) => h.id === id)

			if (!item) {
				printError(`Session ${id} not found in history.`)
				return
			}

			const fs = await import("node:fs/promises")
			const { HostProvider } = await import("@/hosts/host-provider")
			const sessionDir = path.join(HostProvider.get().globalStorageFsPath, "tasks", id)

			await fs.rm(sessionDir, { recursive: true, force: true })
			const filtered = history.filter((h) => h.id !== id)
			StateManager.get().setGlobalState("taskHistory", filtered)
			await StateManager.get().flushPendingState()

			printSuccess(`Session ${id} deleted successfully.`)
		} catch (error) {
			printError(`Deletion failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

const config = program.command("config").description("Show or manage configuration")

config
	.description("Show current configuration")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(showConfig)

config
	.command("clear-trust")
	.description("Clear persistent trust for tools and commands")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options) => {
		const ctx = await initializeCli(options)
		StateManager.get().clearPersistentTrust()
		await StateManager.get().flushPendingState()
		printInfo("Persistent trust cleared.")
		await disposeCliContext(ctx)
		exit(0)
	})

const doctor = program.command("doctor")
doctor
	.command("run")
	.description("Run system diagnostics")
	.option("--config <path>", "Path to DietCode configuration directory")
	.option("--sanitize", "Scan configuration for unmasked secrets")
	.action(async (options) => {
		const ctx = await initializeCli(options)
		try {
			const { DiagnosticService } = await import("./services/diagnostic/DiagnosticService")
			const ds = DiagnosticService.getInstance()
			let results = await ds.runAllDiagnostics()

			if (options.sanitize) {
				const { HostProvider } = await import("@/hosts/host-provider")
				const sanitizationResults = await ds.runSanitizationScan(options.config || HostProvider.get().globalStorageFsPath)
				results = [...results, ...sanitizationResults]
			}

			printInfo("Running DietCode Diagnostics...")
			const configDiag = results.find((r) => r.name === "Configuration Integrity")

			if (configDiag && configDiag.status === "ok") {
				printSuccess("Configuration integrity validated.")
			} else if (configDiag) {
				printError(`Configuration error: ${configDiag.message}`)
				if (configDiag.remediation) printInfo(`Remediation: ${configDiag.remediation}`)
			}

			const history = StateManager.get().getGlobalStateKey("taskHistory") || []
			const historyIds = new Set(history.map((h) => h.id))

			const fs = await import("node:fs/promises")
			const { HostProvider } = await import("@/hosts/host-provider")
			const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")

			if (existsSync(tasksDir)) {
				const dirs = await fs.readdir(tasksDir)
				const orphaned = dirs.filter((d) => !historyIds.has(d) && !d.startsWith("."))
				if (orphaned.length > 0) {
					printWarning(`Found ${orphaned.length} orphaned task directories (not in history).`)
					printInfo("Run `dietcode config prune` to clean them up.")
				}
			}
		} catch (error) {
			printError(`Validation failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

config
	.command("prune")
	.description("Scavenge and remove stale session data")
	.option("-d, --days <number>", "Remove sessions older than N days", "30")
	.option("--config <path>", "Path to DietCode configuration directory")
	.option("--dry-run", "Show what would be removed without deleting")
	.action(async (options) => {
		const ctx = await initializeCli(options)
		try {
			const days = Number.parseInt(options.days, 10)
			const threshold = Date.now() - days * 24 * 60 * 60 * 1000

			const history = StateManager.get().getGlobalStateKey("taskHistory") || []
			const toRemove = history.filter((h) => h.ts < threshold)

			if (toRemove.length === 0) {
				printInfo("No stale sessions found.")
			} else {
				printInfo(`Found ${toRemove.length} sessions older than ${days} days.`)
				const fs = await import("node:fs/promises")
				const { HostProvider } = await import("@/hosts/host-provider")
				const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")

				for (const item of toRemove) {
					if (options.dryRun) {
						printInfo(`[DRY RUN] Would delete session ${item.id} (${item.task})`)
					} else {
						const dir = path.join(tasksDir, item.id)
						await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
						printInfo(`Deleted session persistence for ${item.id}`)
					}
				}

				if (!options.dryRun) {
					const filtered = history.filter((h) => h.ts >= threshold)
					StateManager.get().setGlobalState("taskHistory", filtered)
					await StateManager.get().flushPendingState()
					printSuccess(`Successfully pruned ${toRemove.length} sessions.`)
				}
			}

			const fs = await import("node:fs/promises")
			const { HostProvider } = await import("@/hosts/host-provider")
			const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")
			if (existsSync(tasksDir)) {
				const historyIds = new Set(history.map((h) => h.id))
				const dirs = await fs.readdir(tasksDir)
				const orphaned = dirs.filter((d) => !historyIds.has(d) && !d.startsWith("."))
				if (orphaned.length > 0) {
					printInfo(`Found ${orphaned.length} orphaned directories.`)
					for (const d of orphaned) {
						if (options.dryRun) {
							printInfo(`[DRY RUN] Would delete orphaned directory ${d}`)
						} else {
							await fs.rm(path.join(tasksDir, d), { recursive: true, force: true })
							printInfo(`Deleted orphaned directory ${d}`)
						}
					}
				}
			}
		} catch (error) {
			printError(`Pruning failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

program
	.command("auth")
	.description("Authenticate a provider and configure what model is used")
	.option("-p, --provider <id>", "Provider ID for quick setup (e.g., openai-native, anthropic, moonshot)")
	.option("-k, --apikey <key>", "API key for the provider")
	.option("-m, --modelid <id>", "Model ID to configure (e.g., gpt-4o, claude-sonnet-4-6, kimi-k2.5)")
	.option("-b, --baseurl <url>", "Base URL (optional, only for openai provider)")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory for the task")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(runAuth)

program
	.command("stats")
	.description("Show token usage and cost statistics")
	.option("-d, --days <number>", "Show stats for the last N days (default: all time)")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options: { days?: string; config?: string }) => {
		const ctx = await initializeCli({ config: options.config })
		const history = StateManager.get().getGlobalStateKey("taskHistory") || []

		const days = options.days ? Number.parseInt(options.days, 10) : undefined
		const now = Date.now()
		const filteredHistory = days ? history.filter((item) => now - item.ts <= days * 24 * 60 * 60 * 1000) : history

		const stats = {
			totalSessions: filteredHistory.length,
			totalTokensIn: 0,
			totalTokensOut: 0,
			totalCacheReads: 0,
			totalCacheWrites: 0,
			totalCost: 0,
		}

		for (const item of filteredHistory) {
			stats.totalTokensIn += item.tokensIn || 0
			stats.totalTokensOut += item.tokensOut || 0
			stats.totalCacheReads += item.cacheReads || 0
			stats.totalCacheWrites += item.cacheWrites || 0
			stats.totalCost += item.totalCost || 0
		}

		const width = 56
		const renderRow = (label: string, value: string) => {
			const padding = Math.max(0, width - label.length - value.length - 4)
			return `│ ${label}${" ".repeat(padding)} ${value} │`
		}

		console.log("┌" + "─".repeat(width - 2) + "┐")
		console.log("│" + " OVERVIEW ".padStart((width + 8) / 2).padEnd(width - 2) + "│")
		console.log("├" + "─".repeat(width - 2) + "┤")
		console.log(renderRow("Sessions", stats.totalSessions.toLocaleString()))
		console.log(renderRow("Days", (days || "All time").toString()))
		console.log("├" + "─".repeat(width - 2) + "┤")
		console.log("│" + " COST & TOKENS ".padStart((width + 13) / 2).padEnd(width - 2) + "│")
		console.log("├" + "─".repeat(width - 2) + "┤")
		console.log(renderRow("Total Cost", `$${stats.totalCost.toFixed(2)}`))
		console.log(renderRow("Input Tokens", stats.totalTokensIn.toLocaleString()))
		console.log(renderRow("Output Tokens", stats.totalTokensOut.toLocaleString()))
		console.log(renderRow("Cache Reads", (stats.totalCacheReads || 0).toLocaleString()))
		console.log(renderRow("Cache Writes", (stats.totalCacheWrites || 0).toLocaleString()))
		console.log("└" + "─".repeat(width - 2) + "┘")

		await disposeCliContext(ctx)
		process.exit(0)
	})

program
	.command("models")
	.description("Manage models")
	.action(() => {
		printInfo("Use 'dietcode models list [provider]' to see available models.")
	})

program
	.command("models")
	.command("list [provider]")
	.description("List available models for a provider")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (providerId, options) => {
		const ctx = await initializeCli(options)
		const apiConfig = StateManager.get().getApiConfiguration()
		const provider = providerId || apiConfig.planModeApiProvider || "anthropic"

		let models: Record<string, any> = {}

		const { anthropicModels, bedrockModels, vertexModels, openAiNativeModels, geminiModels, deepSeekModels, mistralModels } =
			(await import("@shared/api")) as any

		switch (provider) {
			case "anthropic":
				models = anthropicModels
				break
			case "openrouter":
				const cached = await ctx.controller.readOpenRouterModels()
				models = cached || {}
				break
			case "bedrock":
				models = bedrockModels
				break
			case "vertex":
				models = vertexModels
				break
			case "openai-native":
				models = openAiNativeModels
				break
			case "gemini":
				models = geminiModels
				break
			case "deepseek":
				models = deepSeekModels
				break
			case "mistral":
				models = mistralModels
				break
			default:
				printWarning(`No built-in model list for '${provider}'. Showing current config only.`)
				const mId = apiConfig.planModeApiModelId || apiConfig.actModeApiModelId
				models = mId ? { [mId]: {} } : {}
		}

		if (Object.keys(models).length === 0) {
			console.log("No models found.")
		} else {
			console.log(style.bold(`\n${provider.toUpperCase()} Models:`))
			const sortedModels = Object.entries(models).sort(([a], [b]) => a.localeCompare(b))
			for (const [id, info] of sortedModels) {
				const details = []
				if (info.contextWindow) details.push(`${(info.contextWindow / 1000).toFixed(0)}k context`)
				if (info.supportsPromptCache) details.push("caches")
				if (info.supportsReasoning) details.push("reasoning")

				const detailsStr = details.length > 0 ? style.dim(` (${details.join(", ")})`) : ""
				console.log(`- ${style.info(id)}${detailsStr}`)
			}
			console.log()
		}

		await disposeCliContext(ctx)
		exit(0)
	})

program
	.command("pr <number>")
	.description("Checkout a GitHub PR and start a task")
	.option("-p, --plan", "Run in plan mode")
	.option("-y, --yolo", "Enable yolo mode")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (number, options) => {
		const { execSync } = await import("node:child_process")
		try {
			printInfo(`Checking out PR #${number}...`)
			execSync(`gh pr checkout ${number}`, { stdio: "inherit" })

			const prDataRaw = execSync(`gh pr view ${number} --json title,body`, { encoding: "utf8" })
			const prData = JSON.parse(prDataRaw)
			const prompt = `I've checked out PR #${number}: ${prData.title}\n\nDescription:\n${prData.body}\n\nHow can I help with this PR?`

			printInfo("Starting DietCode task...")
			const ctx = await initializeCli(options)
			return runTask(prompt, { ...options, act: true }, ctx)
		} catch (error) {
			printError("Failed to checkout PR. Ensure 'gh' CLI is installed and you are in a git repository.")
			process.exit(1)
		}
	})

program
	.command("mcp")
	.command("list")
	.description("List all configured MCP servers")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options: { config?: string }) => {
		const ctx = await initializeCli({ config: options.config })
		const connections = ctx.controller.mcpHub.connections

		if (connections.length === 0) {
			console.log("No MCP servers configured.")
		} else {
			console.log(style.bold("\nConfigured MCP Servers:"))
			for (const conn of connections) {
				const status = conn.server.disabled
					? style.dim("Disabled")
					: conn.server.status === "connected"
						? style.success("Connected")
						: style.error(conn.server.status)
				const authStatus = conn.server.oauthRequired
					? conn.server.oauthAuthStatus === "authenticated"
						? style.success(" [Auth OK]")
						: style.warning(" [Auth Required]")
					: ""
				const name = style.info(conn.server.name)
				console.log(`- ${name} [${status}]${authStatus}`)
				if (conn.server.error) {
					console.log(style.dim(`  Error: ${conn.server.error.split("\n")[0]}`))
				}
			}
			console.log()
		}

		await disposeCliContext(ctx)
		process.exit(0)
	})

program
	.command("mcp")
	.command("auth <name>")
	.description("Authenticate with an MCP server (OAuth)")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (name: string, options: { config?: string }) => {
		const ctx = await initializeCli({ config: options.config })
		try {
			const mcpHub = ctx.controller.mcpHub
			const connection = mcpHub.connections.find((c) => c.server.name === name)
			if (!connection) {
				printError(`MCP server '${name}' not found.`)
				await disposeCliContext(ctx)
				process.exit(1)
			}

			if (!connection.server.oauthRequired) {
				printInfo(`Server '${name}' does not require OAuth.`)
				return
			}

			printInfo(`Initiating OAuth flow for '${name}'...`)
			await mcpHub.initiateOAuth(name)
			printSuccess("Please complete the authentication in your browser.")
			printInfo("Once completed, DietCode will automatically detect the tokens and reconnect.")
		} catch (error) {
			printError(`Failed to initiate auth: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

program
	.command("mcp")
	.command("logout <name>")
	.description("Logout and clear OAuth tokens for an MCP server")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (name: string, options: { config?: string }) => {
		const ctx = await initializeCli({ config: options.config })
		try {
			const mcpHub = ctx.controller.mcpHub
			const connection = mcpHub.connections.find((c) => c.server.name === name)
			if (!connection) {
				printError(`MCP server '${name}' not found.`)
				return
			}

			printInfo(`Logging out from server '${name}'...`)
			await mcpHub.logoutServer(name)
			printSuccess(`Logged out from '${name}'. OAuth tokens cleared.`)
		} catch (error) {
			printError(`Failed to logout: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

program
	.command("hooks")
	.command("run <name>")
	.description("Run a specific hook from .dietcoderules/hooks")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (name: string, options: { config?: string }) => {
		const ctx = await initializeCli({ config: options.config })
		try {
			const { HostProvider } = await import("@/hosts/host-provider")
			const path = await import("node:path")
			const fs = await import("node:fs/promises")

			const hooksDirs = [
				path.join(HostProvider.get().globalStorageFsPath, "hooks"),
				path.join(process.cwd(), ".dietcoderules", "hooks"),
			]

			let hookPath: string | null = null
			for (const dir of hooksDirs) {
				const candidate = path.join(dir, name)
				if (
					await fs
						.access(candidate)
						.then(() => true)
						.catch(() => false)
				) {
					hookPath = candidate
					break
				}
			}

			if (!hookPath) {
				printError(`Hook '${name}' not found in any hooks directory.`)
				return
			}

			printInfo(`Running hook '${name}'...`)
			const { exec } = await import("node:child_process")
			const { promisify } = await import("node:util")
			const execAsync = promisify(exec)

			const { stdout, stderr } = await execAsync(`chmod +x "${hookPath}" && "${hookPath}"`)
			if (stdout) console.log(stdout)
			if (stderr) console.error(stderr)
			printSuccess(`Hook '${name}' completed successfully.`)
		} catch (error) {
			printError(`Hook execution failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

program
	.command("workspace")
	.command("index")
	.description("Build a semantic index of the current workspace")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options: { config?: string }) => {
		const ctx = await initializeCli({ config: options.config })
		try {
			printInfo("Building workspace index...")
			const { regexSearchFiles } = await import("@/services/ripgrep")
			const pattern = "(class|function|interface|export const|export enum) [a-zA-Z0-9_]+"
			const results = await regexSearchFiles(process.cwd(), process.cwd(), pattern, "*.{ts,tsx,js,jsx,py,go,rs}")

			const path = await import("node:path")
			const fs = await import("node:fs/promises")
			const indexPath = path.join(process.cwd(), ".dietcode-index.json")

			await fs.writeFile(
				indexPath,
				JSON.stringify(
					{
						ts: Date.now(),
						results: results.split("\n").filter((l) => l.includes("│")).length,
						raw: results,
					},
					null,
					2,
				),
			)

			printSuccess(`Workspace indexed. Index saved to .dietcode-index.json`)
		} catch (error) {
			printError(`Indexing failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
		program
			.command("mcp")
			.command("toggle <name>")
			.description("Enable or disable an MCP server")
			.option("--config <path>", "Path to DietCode configuration directory")
			.action(async (name: string, options: { config?: string }) => {
				const ctx = await initializeCli({ config: options.config })
				try {
					const conn = ctx.controller.mcpHub.connections.find((c) => c.server.name === name)
					if (!conn) {
						printError(`MCP server '${name}' not found.`)
						return
					}

					const newState = !conn.server.disabled
					await ctx.controller.mcpHub.toggleServerDisabledRPC(name, newState)
					printSuccess(`MCP server '${name}' ${newState ? "disabled" : "enabled"}.`)
				} catch (error) {
					printError(`Failed to toggle: ${error instanceof Error ? error.message : String(error)}`)
				} finally {
					await disposeCliContext(ctx)
				}
			})
	})

program
	.command("chaos")
	.description("Resilience test bed: Inject environmental chaos to verify CLI immunity")
	.command("inject <type>")
	.description("Inject a specific type of failure (corruption, latency, outage)")
	.action(async (type) => {
		const { style } = await import("./utils/display")
		const path = await import("node:path")
		const fs = await import("node:fs/promises")
		const { HostProvider } = await import("@/hosts/host-provider")

		switch (type) {
			case "corruption":
				const settingsPath = path.join(HostProvider.get().globalStorageFsPath, "settings", "dietcode_mcp_settings.json")
				if (
					await fs
						.access(settingsPath)
						.then(() => true)
						.catch(() => false)
				) {
					await fs.writeFile(settingsPath, "INVALID_JSON_FOR_CHAOS_TESTING", "utf8")
					console.log(style.error("Injecting configuration corruption... DONE."))
				}
				break
			case "latency":
				console.log(
					style.warning("Injecting artificial substrate latency... (NOT IMPLEMENTED - requires dynamic interceptor)"),
				)
				break
			default:
				console.log(style.error(`Unknown chaos type: ${type}`))
		}
	})

program
	.command("config")
	.command("repair")
	.description("Repair configuration using forensic backups")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options: { config?: string }) => {
		const ctx = await initializeCli({ config: options.config })
		try {
			const { verifyIntegrity } = await import("@/core/storage/disk")
			const { HostProvider } = await import("@/hosts/host-provider")
			const path = await import("node:path")
			const fs = await import("node:fs/promises")

			const settingsDir = path.join(HostProvider.get().globalStorageFsPath, "settings")
			const integrity = await verifyIntegrity(settingsDir)

			if (integrity.ok) {
				printSuccess("All configuration files are structurally sound. No repair needed.")
				return
			}

			for (const filename of integrity.mismatched) {
				const backupPath = path.join(settingsDir, "backups", `${filename}.bak`)
				if (
					await fs
						.access(backupPath)
						.then(() => true)
						.catch(() => false)
				) {
					printInfo(`Repairing ${filename} from forensic backup...`)
					await fs.copyFile(backupPath, path.join(settingsDir, filename))
				} else {
					printError(`No backup found for ${filename}. Repair impossible.`)
				}
			}
			printSuccess("Substrate repair completed.")
		} catch (error) {
			printError(`Repair failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

program
	.command("history")
	.command("audit")
	.description("Perform a clinical scan of task history and directories")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options: { config?: string }) => {
		const ctx = await initializeCli({ config: options.config })
		try {
			const { StateManager } = await import("@/core/storage/StateManager")
			const { HostProvider } = await import("@/hosts/host-provider")
			const fs = await import("node:fs/promises")
			const path = await import("node:path")

			const history = StateManager.get().getGlobalStateKey("taskHistory") || []
			const taskDirs = await fs.readdir(path.join(HostProvider.get().globalStorageFsPath, "tasks")).catch(() => [])

			printInfo(`Auditing ${history.length} history items and ${taskDirs.length} task directories...`)

			const linkedDirs = new Set(history.map((item) => item.id))
			const orphanedDirs = taskDirs.filter((dir) => !linkedDirs.has(dir))

			if (orphanedDirs.length > 0) {
				printWarning(`Detected ${orphanedDirs.length} orphaned task directories (not in history).`)
				console.log(orphanedDirs.join(", "))
			} else {
				printSuccess("No orphaned directories detected.")
			}

			// Detect sequence breaks
			let sequenceBreaks = 0
			for (let i = 1; i < history.length; i++) {
				if (history[i].ts < history[i - 1].ts) {
					sequenceBreaks++
				}
			}

			if (sequenceBreaks > 0) {
				printWarning(`Detected ${sequenceBreaks} sequence breaks (time-travel anomalies).`)
			} else {
				printSuccess("Timeline integrity verified.")
			}
		} catch (error) {
			printError(`Audit failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

program
	.command("agent")
	.description("Manage custom agents")
	.action(() => {
		printInfo("Use 'dietcode agent list' or 'dietcode agent create'")
	})

program
	.command("agent")
	.command("list")
	.description("List all custom agents")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options: { config?: string }) => {
		const { AgentConfigLoader } = await import("@/core/task/tools/subagent/AgentConfigLoader")
		const loader = AgentConfigLoader.getInstance()
		await loader.ready()
		const configs = loader.getAllCachedConfigs()

		if (configs.size === 0) {
			console.log("No custom agents found.")
			console.log(style.dim(`Agents are loaded from: ${loader.getConfigPath()}`))
		} else {
			console.log(style.bold("\nCustom Agents:"))
			for (const [name, config] of configs.entries()) {
				console.log(`- ${style.info(config.name)}: ${config.description}`)
			}
			console.log()
		}
		process.exit(0)
	})

program
	.command("agent")
	.command("create")
	.description("Interactively create a new custom agent")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options: { config?: string }) => {
		const prompts = (await import("prompts")).default
		const { getAgentsConfigPath } = await import("@/core/task/tools/subagent/AgentConfigLoader")
		const fs = await import("fs/promises")

		const response = await prompts([
			{
				type: "text",
				name: "name",
				message: "Agent name:",
				validate: (val: string) => (val.length > 0 ? true : "Name is required"),
			},
			{
				type: "select",
				name: "template",
				message: "Choose a template profile:",
				choices: [
					{ title: "Custom (Manual selection)", value: "custom" },
					{ title: "Reviewer (Explorer + Browser)", value: "reviewer" },
					{ title: "Architect (Heavy Analysis)", value: "architect" },
					{ title: "Debugger (Execution tools)", value: "debugger" },
				],
			},
			{
				type: "text",
				name: "description",
				message: "Agent description:",
				validate: (val: string) => (val.length > 0 ? true : "Description is required"),
			},
			{
				type: "text",
				name: "systemPrompt",
				message: "System prompt:",
				validate: (val: string) => (val.length > 0 ? true : "System prompt is required"),
			},
		])

		if (!response.name) return

		let tools: string[] = ["read_file", "list_files", "attempt"]
		if (response.template === "reviewer") {
			tools = [...tools, "search_files", "browser_action"]
		} else if (response.template === "architect") {
			tools = [...tools, "grep_search", "list_code_definition", "search_files"]
		} else if (response.template === "debugger") {
			tools = [...tools, "run_command", "browser_action"]
		} else {
			// Custom - could add more prompts here but for now use default set
			tools = [...tools, "search_files"]
		}

		const fileName = `${response.name.toLowerCase().replace(/\s+/g, "-")}.yaml`
		const filePath = path.join(getAgentsConfigPath(), fileName)

		const content = `---
name: ${response.name}
description: ${response.description}
tools:
${tools.map((t) => `  - ${t}`).join("\n")}
---
${response.systemPrompt}`

		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content, "utf8")
		printSuccess(`Agent '${response.name}' created at ${filePath}`)
		process.exit(0)
	})

const agent = program.command("agent").description("Manage agents")

agent
	.command("search <query>")
	.description("Search for agents in the local and remote registry")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (query: string, options: { config?: string }) => {
		const ctx = await initializeCli(options)
		try {
			const { AgentConfigLoader } = await import("@core/task/tools/subagent/AgentConfigLoader")
			const configs = await AgentConfigLoader.getInstance().load()

			const results = Array.from(configs.values()).filter(
				(c) =>
					c.name.toLowerCase().includes(query.toLowerCase()) ||
					c.description.toLowerCase().includes(query.toLowerCase()),
			)

			if (results.length === 0) {
				printInfo(`No agents found matching '${query}'`)
			} else {
				printInfo(`Found ${results.length} agents:`)
				for (const res of results) {
					console.log(`${style.bold(res.name)} - ${res.description}`)
				}
			}
		} catch (error) {
			printError(`Search failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			await disposeCliContext(ctx)
		}
	})

program
	.command("github")
	.command("run")
	.description("Run DietCode as a GitHub Agent (used in GitHub Actions)")
	.option("--token <token>", "GitHub token")
	.option("--config <path>", "Path to DietCode configuration directory")
	.action(async (options) => {
		const token = options.token || process.env.GITHUB_TOKEN
		if (!token) {
			printError("GitHub token is required. Set GITHUB_TOKEN environment variable or use --token.")
			process.exit(1)
		}

		const ctx = await initializeCli(options)
		const { GithubRunner } = await import("./github/github")
		const runner = new GithubRunner(token)

		await runner.run(ctx.controller, runTask)

		await disposeCliContext(ctx)
		process.exit(0)
	})

program
	.command("github")
	.command("install")
	.description("Install DietCode GitHub Actions workflow")
	.action(async () => {
		const fs = await import("fs/promises")
		const workflowDir = path.join(process.cwd(), ".github", "workflows")
		const workflowPath = path.join(workflowDir, "dietcode.yml")

		const workflowContent = `name: DietCode
on:
  issue_comment:
    types: [created]

jobs:
  dietcode:
    if: contains(github.event.comment.body, '@dietcode')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - name: DietCode PR
        uses: CardSorting/DietCodeMarie@dev
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: \${{ secrets.ANTHROPIC_API_KEY }}
`
		await fs.mkdir(workflowDir, { recursive: true })
		await fs.writeFile(workflowPath, workflowContent, "utf8")
		printSuccess(`GitHub Actions workflow installed at ${workflowPath}`)
		process.exit(0)
	})

program
	.command("version")
	.description("Show DietCode CLI version number")
	.action(() => printInfo(`DietCode CLI version: ${CLI_VERSION}`))

program
	.command("update")
	.description("Check for updates and install if available")
	.option("-v, --verbose", "Show verbose output")
	.action(() => checkForUpdates(CLI_VERSION))

program
	.command("doctor")
	.description("Run diagnostics to verify your system environment")
	.option("-r, --repair", "Attempt to automatically repair detected issues")
	.action(async (options: { repair?: boolean }) => {
		const { DiagnosticService } = await import("./services/diagnostic/DiagnosticService")
		const diagnostics = DiagnosticService.getInstance()
		const results = await diagnostics.runAllDiagnostics()

		let hasError = false
		for (const result of results) {
			const statusSymbol = result.status === "ok" ? "✔" : result.status === "warning" ? "⚠" : "✖"
			const styledName = style.bold(result.name)
			const styledMessage = result.message

			if (result.status === "ok") {
				console.log(`${style.success(statusSymbol)} ${styledName}: ${styledMessage}`)
			} else if (result.status === "warning") {
				console.log(`${style.warning(statusSymbol)} ${styledName}: ${styledMessage}`)
			} else {
				console.log(`${style.error(statusSymbol)} ${styledName}: ${styledMessage}`)
				hasError = true
			}

			if (result.remediation) {
				console.log(style.dim(`   └─ ${result.remediation}`))
			}
		}

		if (options.repair && (hasError || results.some((r) => r.status === "warning"))) {
			printInfo("\nAttempting to repair issues...")
			const repairResults = await diagnostics.runRepair(results)
			for (const result of repairResults) {
				const statusSymbol = result.status === "ok" ? "✔" : result.status === "warning" ? "⚠" : "✖"
				const styledName = style.bold(result.name)
				if (result.status === "ok") {
					console.log(`${style.success(statusSymbol)} ${styledName}: ${result.message}`)
				} else {
					console.log(`${style.error(statusSymbol)} ${styledName}: ${result.message}`)
				}
			}
		} else if (hasError) {
			printError("\nSome diagnostics failed. Please follow the remediation steps above, or run `dietcode doctor --repair`.")
			process.exit(1)
		} else {
			printSuccess("\nAll systems operational!")
		}
	})

// Dev command with subcommands
const devCommand = program.command("dev").description("Developer tools and utilities")

devCommand
	.command("log")
	.description("Open the log file")
	.action(async () => {
		const { openExternal } = await import("@/utils/env")
		await openExternal(CLI_LOG_FILE)
	})

/**
 * Validate that a task exists in history
 * @returns The task history item if found, null otherwise
 */
function findTaskInHistory(taskId: string): HistoryItem | null {
	const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
	return taskHistory.find((item) => item.id === taskId) || null
}

/**
 * Resume an existing task by ID
 * Loads the task and optionally prefills the input with a prompt
 */
async function resumeTask(taskId: string, options: TaskOptions & { initialPrompt?: string }) {
	const ctx = await initializeCli({ ...options, enableAuth: true })

	// Validate task exists
	const historyItem = findTaskInHistory(taskId)
	if (!historyItem) {
		printWarning(`Task not found: ${taskId}`)
		printInfo("Use 'dietcode history' to see available tasks.")
		await disposeCliContext(ctx)
		exit(1)
	}

	telemetryService.captureHostEvent("resume_task_command", options.initialPrompt ? "with_prompt" : "interactive")

	// Apply shared task options (mode, model, thinking, yolo)
	applyTaskOptions(options)
	await StateManager.get().flushPendingState()

	// Use plain text mode for non-interactive scenarios
	if (shouldUsePlainTextMode(options)) {
		return runTaskInPlainTextMode(ctx, options, {
			prompt: options.initialPrompt,
			taskId: taskId,
		})
	}

	// Interactive mode: render the task view with the existing task
	let taskError = false

	await runInkApp(
		React.createElement(App, {
			view: "task",
			taskId: taskId,
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			initialPrompt: options.initialPrompt || undefined,
			onError: () => {
				taskError = true
			},
			onWelcomeExit: () => {
				// User pressed Esc; Ink exits and cleanup handles process exit.
			},
		}),
		createInkCleanup(ctx, () => taskError),
	)
}

/**
 * Show welcome prompt and wait for user input
 * If auth is not configured, show auth flow first
 */
async function showWelcome(options: { verbose?: boolean; cwd?: string; config?: string; thinking?: boolean }) {
	const ctx = await initializeCli({ ...options, enableAuth: true })

	// Check if auth is configured
	const hasAuth = await isAuthConfigured()

	let hadError = false

	await runInkApp(
		React.createElement(App, {
			// Start with auth view if not configured, otherwise welcome
			view: hasAuth ? "welcome" : "auth",
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onWelcomeExit: () => {
				// User pressed Esc; Ink exits and cleanup handles process exit.
			},
			onError: () => {
				hadError = true
			},
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(hadError ? 1 : 0)
		},
	)
}

// Interactive mode (default when no command given)
program
	.argument("[prompt]", "Task prompt (starts task immediately)")
	.option("-a, --act", "Run in act mode")
	.option("-p, --plan", "Run in plan mode")
	.option("-y, --yolo", "Enable yolo mode (auto-approve actions)")
	.option("-t, --timeout <seconds>", "Optional timeout in seconds (applies only when provided)")
	.option("-m, --model <model>", "Model to use for the task")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory")
	.option("--config <path>", "Configuration directory")
	.option("--thinking [tokens]", "Enable extended thinking (default: 1024 tokens)")
	.option("--reasoning-effort <effort>", "Reasoning effort: none|low|medium|high|xhigh")
	.option("--max-consecutive-mistakes <count>", "Maximum consecutive mistakes before halting in yolo mode")
	.option("--json", "Output messages as JSON instead of styled text")
	.option("--double-check-completion", "Reject first completion attempt to force re-verification")
	.option("--acp", "Run in ACP (Agent Client Protocol) mode for editor integration")
	.option("-T, --taskId <id>", "Resume an existing task by ID")
	.option("--trace", "Enable high-verbosity tool execution logging")
	.option("--mas", "Enable Multi-Agent Stream system (Ikigai, JoyZoning, Kanban, Kaizen)")
	.action(async (prompt, options) => {
		// Check for ACP mode first - this takes precedence over everything else
		if (options.acp) {
			await runAcpMode({
				config: options.config,
				cwd: options.cwd,
				verbose: options.verbose,
			})
			return
		}

		// Always check for piped stdin content
		const stdinInput = await readStdinIfPiped()

		// Track whether stdin was actually piped (even if empty) vs not piped (null)
		// stdinInput === null means stdin wasn't piped (TTY or not FIFO/file)
		// stdinInput === "" means stdin was piped but empty
		// stdinInput has content means stdin was piped with data
		const stdinWasPiped = stdinInput !== null

		// Error if stdin was piped but empty AND no prompt was provided
		// This handles:
		// - `echo "" | dietcode` -> error (empty stdin, no prompt)
		// - `dietcode "prompt"` in GitHub Actions -> OK (empty stdin ignored, has prompt)
		// - `cat file | dietcode "explain"` -> OK (has stdin AND prompt)
		if (stdinInput === "" && !prompt) {
			printWarning("Empty input received from stdin. Please provide content to process.")
			exit(1)
		}

		// If no prompt argument, check if input is piped via stdin
		let effectivePrompt = prompt
		if (stdinInput) {
			if (effectivePrompt) {
				// Prepend stdin content to the prompt
				effectivePrompt = `${stdinInput}\n\n${effectivePrompt}`
			} else {
				effectivePrompt = stdinInput
			}

			telemetryService.captureHostEvent("piped", "detached")

			// Debug: show that we received piped input
			if (options.verbose) {
				process.stderr.write(`[debug] Received ${stdinInput.length} bytes from stdin\n`)
			}
		}

		// Handle --taskId flag to resume an existing task
		if (options.taskId) {
			await resumeTask(options.taskId, {
				...options,
				initialPrompt: effectivePrompt,
				stdinWasPiped,
			})
			return
		}

		if (effectivePrompt) {
			// Pass stdinWasPiped flag so runTask knows to use plain text mode
			await runTask(effectivePrompt, { ...options, stdinWasPiped })
		} else {
			// Show welcome prompt if no prompt given
			await showWelcome(options)
		}
	})

program
	.command("server")
	.description("Start the remote control server")
	.option("-p, --port <number>", "Port to listen on", "26042")
	.option("-H, --host <address>", "Host to listen on", "127.0.0.1")
	.option("-v, --verbose", "Show verbose output")
	.option("--config <path>", "Path to DietCode configuration directory")
	.option("-c, --cwd <path>", "Working directory for the task")
	.option("--build", "Automatically build the webview-ui for remote platform")
	.action(runServer)

// Parse and run
const startTime = Date.now()
program.hook("preAction", async (thisCommand, actionCommand) => {
	const configDir = thisCommand.opts().config
	await AuditLogService.getInstance().initialize(configDir)
	await AuditLogService.getInstance().log({
		command: actionCommand.name(),
		args: actionCommand.args,
	})

	// Run autonomous hooks if applicable
	if (["act", "run", "plan"].includes(actionCommand.name())) {
		const path = await import("node:path")
		const fs = await import("node:fs/promises")
		const preHook = path.join(process.cwd(), ".dietcoderules", "hooks", "pre-task")
		if (
			await fs
				.access(preHook)
				.then(() => true)
				.catch(() => false)
		) {
			console.log(style.dim(`[Substrate] Running autonomous pre-task hook...`))
			const { exec } = await import("node:child_process")
			try {
				const { promisify } = await import("node:util")
				await promisify(exec)(`chmod +x "${preHook}" && "${preHook}"`)
			} catch (err) {
				Logger.error("Pre-task hook failed:", err)
			}
		}
	}
})

program.hook("postAction", async (thisCommand, actionCommand) => {
	const duration = Date.now() - startTime
	await AuditLogService.getInstance().log({
		command: actionCommand.name(),
		args: actionCommand.args,
		duration,
		exitCode: (process.exitCode as number) || 0,
	})
})

program.parse()
