import { RemoteWebviewProvider } from "@/core/webview/RemoteWebviewProvider"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import * as proto from "@/shared/proto"
import { Logger } from "@/shared/services/Logger"
import {
	CliDiffServiceClient,
	CliEnvServiceClient,
	CliWindowServiceClient,
	CliWorkspaceServiceClient,
} from "../../cli/src/controllers"
import { HostProvider } from "./host-provider"
import { HostBridgeClientProvider } from "./host-provider-types"

/**
 * RemoteHostHostBridge provides HostBridge services that are compatible
 * with a remote control environment.
 *
 * It uses local CLI logic for most operations (e.g. file system) but
 * proxies UI-related actions to the remote webapp via WebSocket.
 */
export function createRemoteHostHostBridgeProvider(): HostBridgeClientProvider {
	const proxyToWebview = async (method: string, ...args: unknown[]) => {
		try {
			const webview = HostProvider.get().createWebviewProvider() as RemoteWebviewProvider
			return await webview.postMessage({
				type: "host_action",
				host_action: { method, args },
			} as unknown as ExtensionMessage)
		} catch (error) {
			Logger.error(`[RemoteHostHostBridge] Failed to proxy ${method}:`, error)
			return undefined
		}
	}

	class RemoteWindowServiceClient extends CliWindowServiceClient {
		override async showMessage(request: proto.host.ShowMessageRequest): Promise<proto.host.SelectedResponse> {
			// Print locally first
			await super.showMessage(request)

			// Then proxy to webview
			const method =
				request.type === proto.host.ShowMessageType.ERROR
					? "showErrorMessage"
					: request.type === proto.host.ShowMessageType.WARNING
						? "showWarningMessage"
						: "showInformationMessage"

			const result = (await proxyToWebview(method, request.message)) as string | undefined
			return proto.host.SelectedResponse.create({ selectedOption: result || "" })
		}

		override async showTextDocument(request: proto.host.ShowTextDocumentRequest): Promise<proto.host.TextEditorInfo> {
			await super.showTextDocument(request)
			await proxyToWebview("showTextDocument", request.path)
			return proto.host.TextEditorInfo.create({ documentPath: request.path })
		}
	}

	class RemoteEnvServiceClient extends CliEnvServiceClient {
		override async openExternal(request: proto.codemarie.StringRequest): Promise<proto.codemarie.Empty> {
			await super.openExternal(request)
			await proxyToWebview("openExternal", request.value)
			return proto.codemarie.Empty.create()
		}
	}

	class RemoteDiffServiceClient extends CliDiffServiceClient {
		override async openDiff(request: proto.host.OpenDiffRequest): Promise<proto.host.OpenDiffResponse> {
			await super.openDiff(request)
			await proxyToWebview("openDiff", request.path, request.content)
			return proto.host.OpenDiffResponse.create()
		}
	}

	return {
		workspaceClient: new CliWorkspaceServiceClient(),
		envClient: new RemoteEnvServiceClient(),
		windowClient: new RemoteWindowServiceClient(),
		diffClient: new RemoteDiffServiceClient(),
	}
}
