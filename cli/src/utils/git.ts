import { execSync } from "node:child_process"

/**
 * Get current git branch name
 */
export function getGitBranch(cwd?: string): string | null {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: cwd || process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()
		return branch
	} catch {
		return null
	}
}

/**
 * Get the username from git config
 */
export function getGitUsername(cwd?: string): string | null {
	try {
		return execSync("git config user.name", {
			cwd: cwd || process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()
	} catch {
		return null
	}
}
