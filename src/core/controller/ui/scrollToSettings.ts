import type { IController as Controller } from "@core/controller/types"
import { KeyValuePair, StringRequest } from "@shared/proto/dietcode/common"

/**
 * Executes a scroll to settings action
 * @param controller The controller instance
 * @param request The request containing the ID of the settings section to scroll to
 * @returns KeyValuePair with action and value fields for the UI to process
 */
export async function scrollToSettings(_controller: Controller, request: StringRequest): Promise<KeyValuePair> {
	return KeyValuePair.create({
		key: "scrollToSettings",
		value: request.value || "",
	})
}
