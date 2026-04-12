import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { OpenCodemarieSidebarPanelRequest, OpenCodemarieSidebarPanelResponse } from "@/shared/proto/index.host"

export async function openCodemarieSidebarPanel(_: OpenCodemarieSidebarPanelRequest): Promise<OpenCodemarieSidebarPanelResponse> {
	await vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)
	return {}
}
