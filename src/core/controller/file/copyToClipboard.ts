import type { IController as Controller } from "@core/controller/types"
import { Empty, StringRequest } from "@shared/proto/dietcode/common"
import { Logger } from "@/shared/services/Logger"
import { writeTextToClipboard } from "@/utils/env"

/**
 * Copies text to the system clipboard
 * @param controller The controller instance
 * @param request The request containing the text to copy
 * @returns Empty response
 */
export async function copyToClipboard(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (request.value) {
			await writeTextToClipboard(request.value)
		}
	} catch (error) {
		Logger.error("Error copying to clipboard:", error)
	}
	return Empty.create()
}
