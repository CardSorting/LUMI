import { EmptyRequest } from "@shared/proto/dietcode/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { DietCodeClient } from "@/shared/dietcode"
import { GetHostVersionResponse } from "@/shared/proto/index.host"

export async function getHostVersion(_: EmptyRequest): Promise<GetHostVersionResponse> {
	return {
		platform: vscode.env.appName,
		version: vscode.version,
		dietcodeType: DietCodeClient.VSCode,
		dietcodeVersion: ExtensionRegistryInfo.version,
	}
}
