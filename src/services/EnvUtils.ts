import { isMultiRootWorkspace } from "@/core/workspace/utils/workspace-detection"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/codemarie/common"
import { Logger } from "@/shared/services/Logger"

// Canonical header names for extra client/host context
export const CodemarieHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CLIENT_TYPE: "X-CLIENT-TYPE",
	CORE_VERSION: "X-CORE-VERSION",
	IS_MULTIROOT: "X-IS-MULTIROOT",
} as const
export type CodemarieHeaderName = (typeof CodemarieHeaders)[keyof typeof CodemarieHeaders]

export function buildExternalBasicHeaders(): Record<string, string> {
	return {
		"User-Agent": `Codemarie/${ExtensionRegistryInfo.version}`,
	}
}

export async function buildBasicCodemarieHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = buildExternalBasicHeaders()
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[CodemarieHeaders.PLATFORM] = host.platform || "unknown"
		headers[CodemarieHeaders.PLATFORM_VERSION] = host.version || "unknown"
		headers[CodemarieHeaders.CLIENT_TYPE] = host.codemarieType || "unknown"
		headers[CodemarieHeaders.CLIENT_VERSION] = host.codemarieVersion || "unknown"
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[CodemarieHeaders.PLATFORM] = "unknown"
		headers[CodemarieHeaders.PLATFORM_VERSION] = "unknown"
		headers[CodemarieHeaders.CLIENT_TYPE] = "unknown"
		headers[CodemarieHeaders.CLIENT_VERSION] = "unknown"
	}
	headers[CodemarieHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}

export async function buildCodemarieExtraHeaders(): Promise<Record<string, string>> {
	const headers = await buildBasicCodemarieHeaders()

	try {
		const isMultiRoot = await isMultiRootWorkspace()
		headers[CodemarieHeaders.IS_MULTIROOT] = isMultiRoot ? "true" : "false"
	} catch (error) {
		Logger.log("Failed to detect multi-root workspace", error)
		headers[CodemarieHeaders.IS_MULTIROOT] = "false"
	}

	return headers
}
