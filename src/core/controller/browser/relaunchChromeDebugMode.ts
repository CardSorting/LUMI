import { EmptyRequest, String as StringMessage } from "@shared/proto/dietcode/common"
import { BrowserSession } from "../../../services/browser/BrowserSession"
import { Controller } from "../index"

/**
 * Relaunch Chrome in debug mode
 * @param controller The controller instance
 * @param request The empty request message
 * @returns The browser relaunch result as a string message
 */
export async function relaunchChromeDebugMode(controller: Controller, _: EmptyRequest): Promise<StringMessage> {
	try {
		const browserSession = new BrowserSession(controller.stateManager)

		// Relaunch Chrome in debug mode
		await browserSession.relaunchChromeDebugMode(controller)

		// BrowserSession posts detailed progress separately; this response acknowledges command receipt.
		return { value: "Chrome relaunch initiated" }
	} catch (error) {
		throw new Error(`Error relaunching Chrome: ${error instanceof Error ? error.message : globalThis.String(error)}`)
	}
}
