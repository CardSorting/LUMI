import { Empty, StringRequest } from "@shared/proto/dietcode/common"
import * as vscode from "vscode"

const DIETCODE_OUTPUT_CHANNEL = vscode.window.createOutputChannel("DietCode")

// Appends a log message to all DietCode output channels.
export async function debugLog(request: StringRequest): Promise<Empty> {
	DIETCODE_OUTPUT_CHANNEL.appendLine(request.value)
	return Empty.create({})
}

// Register the DietCode output channel within the VSCode extension context.
export function registerDietCodeOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(DIETCODE_OUTPUT_CHANNEL)
	return DIETCODE_OUTPUT_CHANNEL
}
