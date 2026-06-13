import { detectVerificationOutputFailures } from "./auditFileWrite"
import { runAdvisoryAudit } from "./completionAudit"
import { formatViolationLabel } from "./taskAuditUtils"
import type { TaskAuditMetadata } from "./types"

const VERIFICATION_COMMAND_PATTERNS: RegExp[] = [
	/\b(npm|pnpm|yarn|bun)\s+(test|run\s+test)\b/i,
	/\b(pytest|jest|vitest|mocha|cargo\s+test|go\s+test)\b/i,
	/\b(npm|pnpm|yarn|bun)\s+run\s+(lint|typecheck|check|build)\b/i,
	/\btsc\b/i,
	/\beslint\b/i,
]

export function isVerificationCommand(command: string): boolean {
	const normalized = command.trim().replace(/\s+/g, " ")
	return VERIFICATION_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function extractTextFromToolResponse(result: unknown): string {
	if (typeof result === "string") {
		return result
	}
	if (Array.isArray(result)) {
		return result
			.filter((block): block is { type: string; text?: string } => typeof block === "object" && block !== null)
			.map((block) => (block.type === "text" && block.text ? block.text : ""))
			.filter(Boolean)
			.join("\n")
	}
	return ""
}

export function appendTextToToolResponse(result: unknown, suffix: string): unknown {
	if (!suffix) {
		return result
	}
	if (typeof result === "string") {
		return result + suffix
	}
	if (Array.isArray(result)) {
		const copy = [...result]
		for (let i = copy.length - 1; i >= 0; i--) {
			const block = copy[i] as { type?: string; text?: string }
			if (block?.type === "text" && typeof block.text === "string") {
				copy[i] = { ...block, text: block.text + suffix }
				return copy
			}
		}
		copy.push({ type: "text", text: suffix.trimStart() })
		return copy
	}
	return result
}

export async function buildCommandOutputAuditAdvisory(
	taskId: string,
	taskDescription: string,
	command: string,
	output: string,
): Promise<string> {
	if (!isVerificationCommand(command) || output.trim().length < 20) {
		return ""
	}

	const outputFailures = detectVerificationOutputFailures(output)
	if (outputFailures.length > 0) {
		return (
			`\n\n<command_audit_advisory grade="F" score="0">` +
			`\nVerification command reported failures in output.` +
			`\nFix failing tests/lint/build before attempt_completion.` +
			`\n</command_audit_advisory>`
		)
	}

	const excerpt = output.slice(0, 3000)
	const metadata = await runAdvisoryAudit(taskId, taskDescription, excerpt, taskDescription)
	if (!metadata.divergence_detected && (metadata.violations?.length ?? 0) === 0) {
		return ""
	}
	const topViolations = (metadata.violations ?? []).slice(0, 2).map(formatViolationLabel)
	if (topViolations.length === 0) {
		return ""
	}
	return (
		`\n\n<command_audit_advisory grade="${metadata.hardening_grade ?? "?"}" score="${metadata.hardening_score ?? "?"}">` +
		`\nVerification output flagged: ${topViolations.join(", ")}.` +
		`\nAddress before attempt_completion.` +
		`\n</command_audit_advisory>`
	)
}

export function buildAdvisoryEscalationSection(advisory: TaskAuditMetadata): string {
	return (
		`\n\n**Advisory Escalation:** Critical issues flagged during act-mode progress were not resolved before completion. ` +
		`Grade at last advisory: ${advisory.hardening_grade ?? "?"} (${advisory.hardening_score ?? "?"}/100).`
	)
}
