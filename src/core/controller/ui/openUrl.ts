import type { IController as Controller } from "@core/controller/types"
import type { StringRequest } from "@shared/proto/dietcode/common"
import { Empty } from "@shared/proto/dietcode/common"
import { Logger } from "@/shared/services/Logger"
import { openUrlInBrowser } from "../../../utils/github-url-utils"

/**
 * Opens a URL in the default browser
 * @param controller The controller instance
 * @param request The URL to open
 * @returns Empty response
 */
export async function openUrl(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		await openUrlInBrowser(request.value)
		return Empty.create({})
	} catch (error) {
		Logger.error(`Failed to open URL: ${error}`)
		throw error
	}
}
