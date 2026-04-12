const SUBAGENT_TOOL_NAME_PREFIX = "use_subagent_"
const SUBAGENT_TOOL_NAME_MAX_LENGTH = 64

function sanitizeAgentName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
}

function hashString(value: string): string {
	let hash = 2166136261
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(36)
}

export function buildSubagentToolName(agentName: string): string {
	const sanitized = sanitizeAgentName(agentName) || "agent"
	const fullHash = hashString(agentName)
	const shortHash = fullHash.slice(0, 4)

	// Max length for the name part before the underscore and hash
	const maxNameLength = SUBAGENT_TOOL_NAME_MAX_LENGTH - SUBAGENT_TOOL_NAME_PREFIX.length - shortHash.length - 1
	const body = sanitized.slice(0, maxNameLength)

	return `${SUBAGENT_TOOL_NAME_PREFIX}${body}_${shortHash}`
}

export function isSubagentToolName(toolName: string): boolean {
	return toolName.startsWith(SUBAGENT_TOOL_NAME_PREFIX)
}
