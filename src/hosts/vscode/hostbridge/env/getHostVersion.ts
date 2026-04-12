import { EmptyRequest } from "@shared/proto/codemarie/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { CodemarieClient } from "@/shared/codemarie"
import { GetHostVersionResponse } from "@/shared/proto/index.host"

export async function getHostVersion(_: EmptyRequest): Promise<GetHostVersionResponse> {
	return {
		platform: vscode.env.appName,
		version: vscode.version,
		codemarieType: CodemarieClient.VSCode,
		codemarieVersion: ExtensionRegistryInfo.version,
	}
}
