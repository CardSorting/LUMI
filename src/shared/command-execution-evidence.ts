import { appendTextToToolResponse, extractTextFromToolResponse } from "@shared/audit/auditPostTool"
import type { DietCodeToolResponseContent } from "@shared/messages"

export interface CommandExecutionEvidence {
	command: string
	approvalStatus: "approved" | "denied" | "not_required" | "unknown"
	started: boolean
	completed: boolean
	exitCode?: number
	signal?: string
	timedOut: boolean
	durationMs?: number
	stdoutAvailable: boolean
	stderrAvailable: boolean
	executionError?: string
}

const PREFIX = "\n<command_execution_evidence>"
const SUFFIX = "</command_execution_evidence>"

export function attachCommandExecutionEvidence(
	content: DietCodeToolResponseContent,
	evidence: CommandExecutionEvidence,
): DietCodeToolResponseContent {
	const marker = `${PREFIX}${JSON.stringify(evidence)}${SUFFIX}`
	if (typeof content === "string") return `${stripEvidence(content)}${marker}`
	const cleaned = content.map((block) => (block.type === "text" ? { ...block, text: stripEvidence(block.text) } : block))
	return appendTextToToolResponse(cleaned, marker)
}

export function readCommandExecutionEvidence(content: unknown): CommandExecutionEvidence | undefined {
	const text = extractTextFromToolResponse(content)
	const start = text.lastIndexOf(PREFIX)
	const end = text.indexOf(SUFFIX, start + PREFIX.length)
	if (start < 0 || end < 0) return undefined
	try {
		const parsed = JSON.parse(text.slice(start + PREFIX.length, end))
		return parsed && typeof parsed === "object" ? (parsed as CommandExecutionEvidence) : undefined
	} catch {
		return undefined
	}
}

export function commandOutputSummary(content: unknown, limit = 1_200): string {
	const text = stripEvidence(extractTextFromToolResponse(content))
	const normalized = text.replace(/\s+/g, " ").trim()
	return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

function stripEvidence(text: string): string {
	return text.replace(/\n?<command_execution_evidence>.*?<\/command_execution_evidence>/gs, "")
}
