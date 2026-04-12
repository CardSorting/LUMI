import { Empty, StringRequest } from "@shared/proto/codemarie/common"
import * as vscode from "vscode"

const CODEMARIE_OUTPUT_CHANNEL = vscode.window.createOutputChannel("Codemarie")

// Appends a log message to all Codemarie output channels.
export async function debugLog(request: StringRequest): Promise<Empty> {
	CODEMARIE_OUTPUT_CHANNEL.appendLine(request.value)
	return Empty.create({})
}

// Register the Codemarie output channel within the VSCode extension context.
export function registerCodemarieOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(CODEMARIE_OUTPUT_CHANNEL)
	return CODEMARIE_OUTPUT_CHANNEL
}
