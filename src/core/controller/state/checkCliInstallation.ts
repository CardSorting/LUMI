import { Boolean } from "@shared/proto/dietcode/common"
import { isDietCodeCliInstalled } from "@/utils/cli-detector"
import { Controller } from ".."

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
