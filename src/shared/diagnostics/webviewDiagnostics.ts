import type { DietCodeMessage } from "../ExtensionMessage"

export interface CompletionGateDiagnostic {
	authority: "advisory"
	envelope?: unknown
	rawXml?: string
}

export interface StabilityAuditDiagnostic {
	success: boolean
	errors: string[]
}

export interface SubstrateTelemetryDiagnostic {
	layer?: string
	pressure?: number
	vitality?: number
	health?: number
	[key: string]: unknown
}

/**
 * Backend diagnostic data may be retained on a message for traces and explicit
 * developer inspection. Normal webview projections remove this property.
 */
export interface InternalDiagnosticMetadata {
	completionGateEnvelope?: CompletionGateDiagnostic
	stabilityAudit?: StabilityAuditDiagnostic
	substrateTelemetry?: SubstrateTelemetryDiagnostic
}

const INTERNAL_XML_ELEMENT_NAMES = [
	"completion_gate(?:_[\\w-]+)?",
	"advisory_gate(?:_[\\w-]+)?",
	"lifecycle_(?:gate|status|envelope)(?:_[\\w-]+)?",
	"legacy_lifecycle(?:_[\\w-]+)?",
	"governance_(?:gate|envelope|advisory)(?:_[\\w-]+)?",
	"(?:diagnostic|telemetry|control_plane)_envelope",
	"system_nudge",
	"pre_completion_checklist",
	"parent_audit_context",
	"audit_(?:preview|advisory)",
	"command_audit_advisory",
	"file_write_audit_advisory",
].join("|")

const PAIRED_INTERNAL_XML = new RegExp(`<(${INTERNAL_XML_ELEMENT_NAMES})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi")
const SELF_CLOSING_INTERNAL_XML = new RegExp(`<(?:${INTERNAL_XML_ELEMENT_NAMES})\\b[^>]*/\\s*>`, "gi")
const INTERNAL_XML_TAG = new RegExp(`<\\/?(?:${INTERNAL_XML_ELEMENT_NAMES})\\b`, "i")
const CONTAINS_INTERNAL_DIAGNOSTIC = new RegExp(
	[
		`<(?:${INTERNAL_XML_ELEMENT_NAMES})\\b`,
		"\\bSOVEREIGN\\b",
		"\\bSUBSTRATE\\b",
		"STRUCTURAL AUDIT",
		"STABILITY AUDIT",
		"(?:Pressure|Vitality|Health):",
		"Stability Protocol (?:Alert|Failure|Failed):",
		"No # STRATEGIC REVIEW section found",
		"STRATEGIC REVIEW",
		"COGNITIVE REFLECTION",
		"breather nudge",
		"taking a breather",
		"re-orient",
		"system_nudge",
		"Finalization not_applicable",
		"Engineering In Progress",
		"INFRASTRUCTURE layer",
		"Next:\\s*attempt_completion\\s*,\\s*run_verification",
		"gate:preflight(?:\\.[\\w-]+)*(?::[\\w-]+)?",
		"validation_pending",
		"governance_policy",
		"bootstrap incomplete",
		"(?:INTERNAL DIAGNOSTIC|SUBSTRATE TELEMETRY)",
		"completion_gate_envelope",
		"\\[(?:INTEGRITY|FORENSIC|STABILITY|SUBSTRATE|COMPLETION)[_-](?:ADVISORY|DIAGNOSTIC|AUDIT|TELEMETRY)\\]",
		"(?:#{1,6}\\s*)?(?:🛡️|📊|💓|⚠️)\\s*(?:\\[[^\\]]+\\]\\s*)?[A-Z][A-Z0-9 _-]{3,}(?::|$)",
		"(?:#{1,6}\\s*)?(?:🛡️|📊|💓|⚠️).*\\b(?:NOTICE|WARNING|ERRORS?|ALERT|DETECTED|BLOCK|SUMMARY|STALENESS|RECOVERY|ADVISORY)\\b",
	].join("|"),
	"i",
)

const INTERNAL_JSON_KEYS =
	/^(?:diagnostics?|internalDiagnostics?|completionGateEnvelope|stabilityAudit|substrateTelemetry|completion_gate(?:_[\w-]+)?|advisory_gate(?:_[\w-]+)?|legacyLifecycle)$/i

/**
 * Removes backend-only diagnostics from prose before it can enter a rendered
 * webview surface. This is intentionally independent of message type because
 * diagnostics have historically leaked through both `text` and `info`.
 */
function sanitizePlainWebviewContent(content: string): string {
	let sanitized = content

	// Repeat paired removal so nested diagnostic elements cannot leave an outer
	// envelope behind after the inner element is removed.
	let previous: string
	do {
		previous = sanitized
		sanitized = sanitized.replace(PAIRED_INTERNAL_XML, "")
	} while (sanitized !== previous)
	sanitized = sanitized.replace(SELF_CLOSING_INTERNAL_XML, "")

	const lines = sanitized.split(/\r?\n/)
	const retained: string[] = []
	let strippingStabilityFailure = false
	let strippingSovereignBlock = false

	for (const line of lines) {
		const trimmed = line.trim()

		if (/STABILITY AUDIT FAILED/i.test(line)) {
			strippingStabilityFailure = true
			continue
		}
		if (strippingStabilityFailure) {
			if (/^[-*]\s+/.test(trimmed) || !trimmed) {
				continue
			}
			strippingStabilityFailure = false
		}

		if (/\bSOVEREIGN\b|\bSUBSTRATE\b|STRUCTURAL AUDIT/i.test(line)) {
			strippingSovereignBlock = true
			continue
		}
		if (strippingSovereignBlock) {
			if (
				!trimmed ||
				/(?:Pressure|Vitality|Health):/i.test(line) ||
				/^Detected Drift:/i.test(trimmed) ||
				/^[-*]\s+/.test(trimmed)
			) {
				continue
			}
			strippingSovereignBlock = false
		}

		if (/(?:Pressure|Vitality|Health):/i.test(line)) continue
		if (/STABILITY AUDIT/i.test(line)) continue
		if (/Stability Protocol (?:Alert|Failure|Failed):/i.test(line)) continue
		if (/No # STRATEGIC REVIEW section found/i.test(line)) continue
		if (/STRATEGIC REVIEW/i.test(line)) continue
		if (/COGNITIVE REFLECTION|breather nudge|taking a breather|re-orient|system_nudge/i.test(line)) continue
		if (/Finalization not_applicable/i.test(line)) continue
		if (/Engineering In Progress|INFRASTRUCTURE layer/i.test(line)) continue
		if (/Next:\s*attempt_completion\s*,\s*run_verification/i.test(line)) continue
		if (/gate:preflight(?:\.[\w-]+)*(?::[\w-]+)?/i.test(line)) continue
		if (/validation_pending|governance_policy|bootstrap incomplete|ROADMAP\.md pending validation/i.test(line)) continue
		if (INTERNAL_XML_TAG.test(line)) continue
		if (/completion_gate_envelope/i.test(line)) continue
		if (/\[(?:INTEGRITY|FORENSIC|STABILITY|SUBSTRATE|COMPLETION)[_-](?:ADVISORY|DIAGNOSTIC|AUDIT|TELEMETRY)\]/i.test(line))
			continue
		if (/^\s*(?:⚠️|🛡️).*(?:INTERNAL DIAGNOSTIC|SUBSTRATE TELEMETRY)\b/i.test(line)) continue
		if (
			/^\s*(?:#{1,6}\s*)?(?:🛡️|📊|💓|⚠️)\s*(?:\[[^\]]+\]\s*)?.*(?:DIAGNOSTIC|TELEMETRY|GOVERNANCE|STABILITY|AUDIT|GATE)\b/i.test(
				line,
			)
		)
			continue
		if (/^\s*(?:#{1,6}\s*)?(?:🛡️|📊|💓|⚠️)\s*(?:\[[^\]]+\]\s*)?[A-Z][A-Z0-9 _-]{3,}(?::|$)/.test(line)) continue
		if (
			/^\s*(?:#{1,6}\s*)?(?:🛡️|📊|💓|⚠️).*\b(?:NOTICE|WARNING|ERRORS?|ALERT|DETECTED|BLOCK|SUMMARY|STALENESS|RECOVERY|ADVISORY)\b/i.test(
				line,
			)
		)
			continue

		retained.push(line)
	}

	return retained
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}

function sanitizeJsonValue(value: unknown): unknown {
	if (typeof value === "string") {
		return CONTAINS_INTERNAL_DIAGNOSTIC.test(value) ? sanitizePlainWebviewContent(value) : value
	}
	if (Array.isArray(value)) {
		return value.map(sanitizeJsonValue)
	}
	if (value && typeof value === "object") {
		const sanitized: Record<string, unknown> = {}
		for (const [key, nestedValue] of Object.entries(value)) {
			if (INTERNAL_JSON_KEYS.test(key)) continue
			sanitized[key] = sanitizeJsonValue(nestedValue)
		}
		return sanitized
	}
	return value
}

export function sanitizeWebviewMessageContent(content: string): string {
	if (!content) return content
	if (!CONTAINS_INTERNAL_DIAGNOSTIC.test(content)) return content

	const trimmed = content.trim()
	if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
		try {
			return JSON.stringify(sanitizeJsonValue(JSON.parse(content)))
		} catch {
			// Fall through for mixed prose/JSON and incomplete streaming payloads.
		}
	}

	return sanitizePlainWebviewContent(content)
}

export function buildCanonicalCompletionSummary(message: Pick<DietCodeMessage, "canonicalLifecycleDecision">): string {
	const nextAction = message.canonicalLifecycleDecision?.nextAllowedAction ?? "none"
	return `Completion diagnostics: advisory\nCanonical next action: ${nextAction}`
}

export interface WebviewDiagnosticProjectionOptions {
	showInternalDiagnostics?: boolean
}

export function isInternalDiagnosticsEnabled(value: string | undefined): boolean {
	return value === "true"
}

/**
 * Final backend-to-webview projection boundary. The returned object is a copy,
 * so persisted task history retains structured diagnostics for backend use.
 */
export function projectMessageForWebview(
	message: DietCodeMessage,
	options: WebviewDiagnosticProjectionOptions = {},
): DietCodeMessage {
	const projected: DietCodeMessage = {
		...message,
		text: message.text === undefined ? undefined : sanitizeWebviewMessageContent(message.text),
		reasoning: message.reasoning === undefined ? undefined : sanitizeWebviewMessageContent(message.reasoning),
		canonicalLifecycleDecision: message.canonicalLifecycleDecision
			? {
					...message.canonicalLifecycleDecision,
					canonicalInstruction: sanitizeWebviewMessageContent(message.canonicalLifecycleDecision.canonicalInstruction),
					reason: sanitizeWebviewMessageContent(message.canonicalLifecycleDecision.reason),
				}
			: undefined,
	}

	if (!options.showInternalDiagnostics) {
		delete projected.diagnostics
		delete projected.gateLifecycleStatus
		delete projected.auditMetadata
	}

	return projected
}

export function projectMessagesForWebview(
	messages: readonly DietCodeMessage[],
	options: WebviewDiagnosticProjectionOptions = {},
): DietCodeMessage[] {
	return messages.map((message) => projectMessageForWebview(message, options))
}
