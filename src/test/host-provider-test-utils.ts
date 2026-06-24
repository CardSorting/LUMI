import {
	CommentReviewControllerCreator,
	DiffViewProviderCreator,
	HostProvider,
	TerminalManagerCreator,
	WebviewProviderCreator,
} from "../hosts/host-provider"
import { HostBridgeClientProvider } from "../hosts/host-provider-types"
import { vscodeHostBridgeClient } from "../hosts/vscode/hostbridge/client/host-grpc-client"
import { ITerminalManager } from "../integrations/terminal/types"

const noopAsync = async () => ({}) as Record<string, never>

/** Minimal host bridge for integration tests — methods exist so sinon can stub them. */
const integrationTestHostBridge = {
	workspaceClient: {
		getWorkspacePaths: async () => ({ paths: [] as string[] }),
		getDiagnostics: async () => ({ fileDiagnostics: [] }),
		saveOpenDocumentIfDirty: noopAsync,
		openProblemsPanel: noopAsync,
		openInFileExplorerPanel: noopAsync,
		openTerminalPanel: noopAsync,
		openDietCodeSidebarPanel: noopAsync,
		openFolder: noopAsync,
	},
	envClient: {
		getHostVersion: async () => ({ platform: "test" }),
		getTelemetrySettings: async () => ({}),
		getIdeRedirectUri: async () => ({ value: "http://localhost" }),
		clipboardWriteText: noopAsync,
		clipboardReadText: async () => ({ value: "" }),
		openExternal: noopAsync,
		debugLog: noopAsync,
		subscribeToTelemetrySettings: () => () => {},
	},
	windowClient: {
		showMessage: noopAsync,
		getOpenTabs: async () => ({ paths: [] as string[] }),
		getVisibleTabs: async () => ({ paths: [] as string[] }),
		getActiveEditor: async () => ({ filePath: "" }),
		showOpenDialogue: noopAsync,
		openFile: noopAsync,
		showTextDocument: noopAsync,
		openSettings: noopAsync,
		showInputBox: noopAsync,
	},
	diffClient: {
		openMultiFileDiff: noopAsync,
	},
} as unknown as HostBridgeClientProvider

function defaultHostBridgeClient(): HostBridgeClientProvider {
	return process.env.INTEGRATION_TEST ? integrationTestHostBridge : vscodeHostBridgeClient
}

/**
 * Initializes the HostProvider with test defaults.
 * This is a common setup used across multiple test files.
 *
 * @param options Optional overrides for the default test configuration
 */
export function setVscodeHostProviderMock(options?: {
	webviewProviderCreator?: WebviewProviderCreator
	diffViewProviderCreator?: DiffViewProviderCreator
	commentReviewControllerCreator?: CommentReviewControllerCreator
	terminalManagerCreator?: TerminalManagerCreator
	hostBridgeClient?: HostBridgeClientProvider
	logToChannel?: (message: string) => void
	getCallbackUri?: (path: string) => Promise<string>
	getBinaryLocation?: (name: string) => Promise<string>
	extensionFsPath?: string
	globalStorageFsPath?: string
}) {
	HostProvider.reset()
	HostProvider.initialize(
		options?.webviewProviderCreator ?? ((() => {}) as WebviewProviderCreator),
		options?.diffViewProviderCreator ?? ((() => {}) as DiffViewProviderCreator),
		options?.commentReviewControllerCreator ?? ((() => {}) as CommentReviewControllerCreator),
		options?.terminalManagerCreator ?? ((() => ({}) as ITerminalManager) as TerminalManagerCreator),
		options?.hostBridgeClient ?? defaultHostBridgeClient(),
		options?.logToChannel ?? ((_: string) => {}),
		options?.getCallbackUri ?? (async (path: string) => `http://example.com:1234${path}`),
		options?.getBinaryLocation ?? (async (n: string) => `/mock/path/to/binary/${n}`),
		options?.extensionFsPath ?? "/mock/path/to/extension",
		options?.globalStorageFsPath ?? "/mock/path/to/globalstorage",
	)
}
