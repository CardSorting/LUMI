import type { ComponentFunction } from "../types"

/**
 * Renders the discovered environment context (toolchains, manifests, project types)
 * into the system prompt to ensure the agent is aware of available runtimes.
 */
export const getEnvironmentStateSection: ComponentFunction = async (_variant, context) => {
	const blueprint = context.environmentBlueprint
	if (!blueprint || blueprint.detectedProjectTypes.length === 0) {
		return ""
	}

	const sections: string[] = []

	// 1. Project Context
	sections.push(`Detected Project Types: ${blueprint.detectedProjectTypes.join(", ")}`)
	sections.push(`Manifests Found: ${blueprint.manifests.join(", ")}`)

	// 2. Toolchain Status
	const toolchainLines: string[] = []
	for (const [name, info] of Object.entries(blueprint.toolchain)) {
		const statusChar = info.status === "found" ? "✅" : info.status === "broken" ? "❌" : "❓"
		toolchainLines.push(`${statusChar} ${name}: ${info.version || "Unknown version"} (${info.status})`)
	}

	if (toolchainLines.length > 0) {
		sections.push(`\nToolchain Status:\n${toolchainLines.join("\n")}`)
	}

	return [
		"# ENVIRONMENT STATE",
		"The following environmental toolchains and project manifests have been detected in the current workspace. Ensure any command execution or file modification is aligned with these runtimes.",
		"",
		sections.join("\n"),
	].join("\n")
}
