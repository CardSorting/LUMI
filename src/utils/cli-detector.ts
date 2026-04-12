import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Check if the DietCode CLI tool is installed on the system
 * @returns true if CLI is installed, false otherwise
 */
export async function isDietCodeCliInstalled(): Promise<boolean> {
	try {
		// Try to get the version of the dietcode CLI tool
		// This will fail if the tool is not installed
		const { stdout } = await execAsync("dietcode version", {
			timeout: 5000, // 5 second timeout
		})

		// If we get here, the CLI is installed
		// We could also validate the version if needed
		return stdout.includes("DietCode CLI Version") || stdout.includes("DietCode Core Version")
	} catch (_error) {
		// Command failed, which likely means CLI is not installed
		// or not in PATH
		return false
	}
}
