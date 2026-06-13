import { detectReplanIntent } from "@shared/detectReplanIntent"
import type { Mode } from "@shared/storage/types"

/**
 * When the user redirects scope during ACT MODE, transition back to PLAN MODE automatically.
 * Returns true when a mode switch was performed.
 */
export async function maybeTransitionToReplanMode(params: {
	feedback?: string
	currentMode: Mode
	yoloModeToggled: boolean
	switchToPlanMode: () => Promise<boolean>
	sayInfo?: (message: string) => Promise<void>
}): Promise<boolean> {
	if (params.yoloModeToggled || params.currentMode !== "act") {
		return false
	}

	if (!detectReplanIntent(params.feedback)) {
		return false
	}

	const switched = await params.switchToPlanMode()
	if (switched && params.sayInfo) {
		await params.sayInfo("Returning to planning based on your feedback.")
	}

	return switched
}
