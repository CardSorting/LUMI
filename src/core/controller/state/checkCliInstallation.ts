import type { IController as Controller } from "@core/controller/types"
import { Boolean } from "@shared/proto/dietcode/common"
import { isDietCodeCliInstalled } from "@/utils/cli-detector"

/**
 * Check if the DietCode CLI is installed
 * @param controller The controller instance
 * @returns Boolean indicating if CLI is installed
 */
export async function checkCliInstallation(_controller: Controller): Promise<Boolean> {
	try {
		const isInstalled = await isDietCodeCliInstalled()
		return Boolean.create({ value: isInstalled })
	} catch {
		return Boolean.create({ value: false })
	}
}
