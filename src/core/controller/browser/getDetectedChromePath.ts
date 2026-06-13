import type { IController as Controller } from "@core/controller/types"
import { ChromePath } from "@shared/proto/dietcode/browser"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import { Logger } from "@/shared/services/Logger"
import { BrowserSession } from "../../../services/browser/BrowserSession"

/**
 * Get the detected Chrome executable path
 * @param controller The controller instance
 * @param request The empty request message
 * @returns The detected Chrome path and whether it's bundled
 */
export async function getDetectedChromePath(controller: Controller, _: EmptyRequest): Promise<ChromePath> {
	try {
		const browserSession = new BrowserSession(controller.stateManager)
		const result = await browserSession.getDetectedChromePath()

		return ChromePath.create({
			path: result.path,
			isBundled: result.isBundled,
		})
	} catch (error) {
		Logger.error("Error getting detected Chrome path:", error)
		return ChromePath.create({
			path: "",
			isBundled: false,
		})
	}
}
