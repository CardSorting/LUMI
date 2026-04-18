import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { printInfo, printWarning } from "../utils/display"

/**
 * Shared utility for building the remote-ui for web platform
 * Runs npm run build in the remote-ui directory
 */
export async function buildRemoteUi(extensionDir: string): Promise<void> {
	const uiPath = path.join(extensionDir, "..", "remote-ui")

	if (!existsSync(path.join(uiPath, "package.json"))) {
		printWarning(`Could not find remote-ui package at ${uiPath}. Skipping build.`)
		return
	}

	printInfo("Building remote-ui...")
	try {
		execSync("npm run build", {
			cwd: uiPath,
			stdio: "inherit",
		})
	} catch (error) {
		printWarning(`Failed to build remote-ui: ${error instanceof Error ? error.message : String(error)}`)
		throw error
	}
}
