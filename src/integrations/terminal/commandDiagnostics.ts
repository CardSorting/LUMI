export interface CommandDiagnosticResult {
	suggestion?: string
}

function firstMatch(output: string, patterns: RegExp[]): string | undefined {
	for (const pattern of patterns) {
		const match = output.match(pattern)
		if (match?.[1]) {
			return match[1].trim()
		}
	}
	return undefined
}

function pythonExecutable(command: string): string {
	return firstMatch(command, [/(?:^|[;&|]\s*)(python(?:2|3)?)(?:\s|$)/i]) ?? "python"
}

/**
 * Adds concise, non-destructive recovery guidance for common command failures.
 * Suggestions intentionally diagnose before mutating system or repository state.
 */
export function analyzeCommandFailure(command: string, exitCode: number, output: string): CommandDiagnosticResult {
	if (exitCode === 0) {
		return {}
	}

	const lowerOutput = output.toLowerCase()

	if (lowerOutput.includes("eaddrinuse") || lowerOutput.includes("address already in use")) {
		const port = firstMatch(output, [/(?:port|address|:\s*)(\d{2,5})\b/i])
		return {
			suggestion: port
				? `Port ${port} is already in use. Identify the listener first (for example, lsof -nP -iTCP:${port} -sTCP:LISTEN), then stop or reuse it only if it belongs to this task.`
				: "A network address is already in use. Identify the listening process and port before deciding whether to reuse or stop it.",
		}
	}

	if (
		lowerOutput.includes("index.lock") &&
		(lowerOutput.includes("another git process") || lowerOutput.includes("file exists"))
	) {
		return {
			suggestion:
				"Git found an index lock. Check for an active Git process first; remove .git/index.lock only after confirming the lock is stale.",
		}
	}

	if (
		exitCode === 127 ||
		exitCode === 9009 ||
		lowerOutput.includes("command not found") ||
		lowerOutput.includes("is not recognized as an internal or external command")
	) {
		const executable = firstMatch(output, [
			/(?:bash|dash|fish|sh|zsh):\s*(?:line \d+:\s*)?([^:\s]+):\s*command not found/i,
			/'([^']+)'\s+is not recognized/i,
			/([^:\s]+):\s*command not found/i,
		])
		return {
			suggestion: executable
				? `Executable '${executable}' was not found. Verify the project dependency install and PATH, then retry with the repository's package runner or an absolute path.`
				: "The executable was not found. Verify project dependencies and PATH before retrying.",
		}
	}

	if (lowerOutput.includes("permission denied") || lowerOutput.includes("eacces") || exitCode === 126) {
		return {
			suggestion:
				"Permission was denied. Inspect the target's ownership and mode first; add execute permission only when the target is intended to be executable.",
		}
	}

	if (
		lowerOutput.includes("could not get lock") ||
		lowerOutput.includes("unable to acquire the dpkg frontend lock") ||
		lowerOutput.includes("dpkg status database is locked")
	) {
		return {
			suggestion:
				"The package manager is locked by another process. Wait for that process to finish and verify package-manager health before retrying; do not delete lock files while it is active.",
		}
	}

	if (lowerOutput.includes("modulenotfounderror") || lowerOutput.includes("no module named")) {
		const moduleName = firstMatch(output, [/(?:modulenotfounderror:\s*)?no module named\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i])
		const interpreter = pythonExecutable(command)
		return {
			suggestion: moduleName
				? `Python cannot import '${moduleName}'. Check the active environment and dependency manifest; if installation is appropriate, use ${interpreter} -m pip with the distribution name (which may differ from the import name).`
				: `Python cannot import a required module. Check the active environment and install the project's declared dependencies with ${interpreter} -m pip.`,
		}
	}

	if (lowerOutput.includes("cannot find module") || lowerOutput.includes("err_module_not_found")) {
		const moduleName = firstMatch(output, [
			/cannot find module\s*['"]?([a-zA-Z0-9_@/.-]+)['"]?/i,
			/package\s*['"]?([a-zA-Z0-9_@/.-]+)['"]?\s*(?:is not installed|could not be resolved)/i,
		])
		const isLocalPath = moduleName?.startsWith(".") || moduleName?.startsWith("/")
		return {
			suggestion:
				moduleName && !isLocalPath
					? `Node.js cannot resolve '${moduleName}'. Run the repository's dependency install first and verify that the package is declared before adding a new dependency.`
					: "Node.js cannot resolve a local module. Verify the path, filename casing, build output, and package export map.",
		}
	}

	if (lowerOutput.includes("enospc") || lowerOutput.includes("no space left on device")) {
		return {
			suggestion:
				"Storage is exhausted (or the file-watcher limit was reached). Check free disk space and inode/watcher limits before deleting caches or increasing limits.",
		}
	}

	if (
		lowerOutput.includes("enotfound") ||
		lowerOutput.includes("temporary failure in name resolution") ||
		lowerOutput.includes("could not resolve host")
	) {
		return {
			suggestion:
				"Name resolution failed. Verify the hostname, network/VPN connectivity, and proxy configuration before retrying.",
		}
	}

	if (lowerOutput.includes("certificate") && (lowerOutput.includes("expired") || lowerOutput.includes("unable to verify"))) {
		return {
			suggestion:
				"TLS certificate verification failed. Check the system clock, proxy/CA configuration, and certificate chain; avoid disabling certificate verification.",
		}
	}

	if (lowerOutput.includes("heap out of memory") || lowerOutput.includes("allocation failed")) {
		return {
			suggestion:
				"The process exhausted memory. Reduce command concurrency/input size or use the tool's documented memory limit after checking for an underlying leak.",
		}
	}

	return {}
}
