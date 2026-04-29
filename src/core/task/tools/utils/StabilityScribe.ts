import { IntegrityProtocol } from "@/core/policy/IntegrityProtocol"
import { StabilityForensics } from "@/core/policy/StabilityForensics"

interface ScratchpadEditCall {
	type: "tool_use"
	name: string
	input: {
		path?: string
		TargetFile?: string
		content?: string
		ReplacementChunks?: Array<{ ReplacementContent: string }>
	}
}

/**
 * StabilityScribe: The validator for strategic review compliance.
 * Enforces the Stability Focused Design standard.
 */
export class StabilityScribe {
	constructor(
		private cwd: string,
		private forensics?: StabilityForensics,
	) {}

	/**
	 * Static helper to extract the latest scratchpad content from conversation history.
	 * V27 HARDENING: Performs multi-pass search and synthesized fallback detection.
	 */
	public static getLatestScratchpadContent(history: Array<{ role: string; content: any }>): {
		content: string
		source: "disk" | "history" | "synthesized"
	} {
		let content = ""
		// Pass 1: Direct find in tool call inputs (Physical write detection)
		for (let i = history.length - 1; i >= 0; i--) {
			const msg = history[i]
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				const editCall = (msg.content as unknown as ScratchpadEditCall[]).find(
					(c) =>
						c.type === "tool_use" &&
						(c.name === "edit_file" ||
							c.name === "write_to_file" ||
							c.name === "replace_file_content" ||
							c.name === "multi_replace_file_content") &&
						(c.input?.path?.endsWith("scratchpad.md") ||
							c.input?.TargetFile?.endsWith("scratchpad.md") ||
							c.input?.TargetFile?.includes("scratchpad.md")),
				)
				if (editCall) {
					content = editCall.input.content || ""
					// Handle multi_replace_file_content or replace_file_content which might have different param names
					if (!content && editCall.input.ReplacementChunks) {
						content = editCall.input.ReplacementChunks[0]?.ReplacementContent || ""
					}
					if (content) return { content, source: "history" }
				}
			}
		}

		// Pass 2: Search for protocol headers in any text block (Neural Draft detection)
		for (let i = history.length - 1; i >= 0; i--) {
			const msg = history[i]
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text" && block.text.includes(IntegrityProtocol.HEADERS.AUDIT)) {
						return { content: block.text, source: "synthesized" }
					}
				}
			}
		}

		return { content: "", source: "disk" }
	}

	/**
	 * V29: Scans conversation history for a "Virtual Review" using semantic fuzzy matching.
	 */
	public static findVirtualReviewInHistory(history: any[]): { content: string; valid: boolean } {
		const { content, source } = StabilityScribe.getLatestScratchpadContent(history)

		if (source === "synthesized" || source === "history") {
			// V29: Fuzzy Recognition logic - Allow audits drafted in natural language
			const hasAuditHeader = IntegrityProtocol.SEMANTIC_PATTERNS.AUDIT.test(content)
			const hasArchitect = IntegrityProtocol.SEMANTIC_PATTERNS.ARCHITECT.test(content)
			const hasResolution = IntegrityProtocol.SEMANTIC_PATTERNS.RESOLUTION.test(content)

			const valid = hasAuditHeader && hasArchitect && hasResolution
			if (valid) return { content, valid: true }
		}

		return { content: "", valid: false }
	}

	/**
	 * Validates the scratchpad content against the Stability V12 protocol.
	 * V29: Added path awareness for implicit Agile Mode detection.
	 */
	public async validate(
		content: string,
		isAgile = false,
		targetPath?: string,
		history: any[] = [], // V34: Neural Support
	): Promise<{ success: boolean; errors: string[]; ok?: boolean; report?: string; synthesis?: string }> {
		const errors: string[] = []
		const diagnosticHints: string[] = []

		// V29: Implicit Agility Detection
		const isImplicitAgile = targetPath ? IntegrityProtocol.isImplicitAgileSafe(targetPath) : false
		const isExplicitlyAgile = content.includes(IntegrityProtocol.HEADERS.AGILE) || isAgile || isImplicitAgile

		if (isImplicitAgile) {
			diagnosticHints.push(
				`💡 IMPLICIT AGILITY: \`${targetPath}\` detected as safe architectural domain. Triad requirements demoted.`,
			)
		}

		if (this.forensics && !isExplicitlyAgile) {
			const { errors: forensicErrors, warnings: forensicWarnings } = await this.forensics.verifyEvidenceVerification(
				content,
				history,
			)
			errors.push(...forensicErrors)
			diagnosticHints.push(...forensicWarnings)
		}

		// 1. Check for Protocol Identity
		if (content.includes(IntegrityProtocol.HEADERS.BREATH)) {
			// Stability Break Turn - Lightweight validation
			if (content.length < 100) {
				errors.push("Stability Break turn is too brief (min 100 characters).")
			}
			return { success: errors.length === 0, errors }
		}

		const hasAuditHeader =
			content.includes(IntegrityProtocol.HEADERS.AUDIT) || IntegrityProtocol.SEMANTIC_PATTERNS.AUDIT.test(content)

		if (!hasAuditHeader) {
			return {
				success: isExplicitlyAgile,
				errors: isExplicitlyAgile
					? []
					: ["No # STRATEGIC REVIEW section found. You must structure your review around the stability protocol."],
			}
		}

		// 2. Check for Stability Gates
		const probes = [
			{
				name: "THE FOUNDATION",
				header: IntegrityProtocol.HEADERS.ARCHITECT,
				pattern: IntegrityProtocol.SEMANTIC_PATTERNS.ARCHITECT,
			},
			{ name: "THE QUALITY CHECK", header: IntegrityProtocol.HEADERS.CRITIC },
			{ name: "THE STABILITY GUARD", header: IntegrityProtocol.HEADERS.SRE },
		]

		for (const probe of probes) {
			const hasProbe = content.includes(probe.header) || (probe.pattern && probe.pattern.test(content))

			if (!hasProbe) {
				if (isExplicitlyAgile) {
					diagnosticHints.push(`💡 AGILE MODE: Skipping gate check: ${probe.name}`)
				} else {
					errors.push(`Missing mandatory gate check: ${probe.name}`)
				}
				continue
			}

			const startIndex = content.indexOf(probe.header) + probe.header.length
			const nextProbe = probes[probes.indexOf(probe) + 1]?.header || IntegrityProtocol.HEADERS.RESOLUTION
			const endIndex = content.indexOf(nextProbe) > startIndex ? content.indexOf(nextProbe) : content.length
			const probeContent = content.substring(startIndex, endIndex).trim()

			// Substantive Validation for Probes
			const threshold = isExplicitlyAgile ? 10 : 50
			if (probeContent.length < threshold) {
				diagnosticHints.push(`💡 ${probe.name}: Analysis is too superficial (min ${threshold} chars).`)
			}

			// Symbol/Delta detection in probe content
			const deltaRegex = /(?:~|before|after|changing|updating|fixing|transformation)/i
			const hasDelta = deltaRegex.test(probeContent)
			if (!hasDelta && !isExplicitlyAgile) {
				diagnosticHints.push(
					`💡 ${probe.name}: No structural transformation cited. Use the '~' operator (e.g. SymbolA ~ SymbolB).`,
				)
			}
		}

		// 3. Check for Final Resolution and Mantra
		const hasResolution =
			content.includes(IntegrityProtocol.HEADERS.RESOLUTION) || IntegrityProtocol.SEMANTIC_PATTERNS.RESOLUTION.test(content)

		if (!hasResolution) {
			if (isExplicitlyAgile) {
				diagnosticHints.push("💡 AGILE: Missing ## [FINAL STEPS] section.")
			} else {
				errors.push("Missing mandatory section: ## [FINAL STEPS]")
			}
		}

		const hasMantra = content.includes(IntegrityProtocol.MANTRA)
		if (!hasMantra) {
			diagnosticHints.push(`💡 STANDARD: The Stability Standard is missing. Discipline ensures project health.`)
		}

		// 4. Check for Diagnostics
		if (!content.includes(IntegrityProtocol.HEADERS.DIAGNOSTICS)) {
			diagnosticHints.push("💡 GUIDANCE: Consider including ## [SYSTEM DIAGNOSTICS] for better grounding.")
		}

		const success = errors.length === 0 && (isExplicitlyAgile || diagnosticHints.length === 0)
		const combinedErrors = [...errors, ...diagnosticHints]

		// Extract resolution for synthesis
		const resolutionMatch = content.match(/(?:## \[FINAL RESOLUTION\]|Final Resolution)\s*([\s\S]*?)(?:\n##|$)/i)
		const synthesis = resolutionMatch ? resolutionMatch[1].trim().split("\n")[0] : undefined

		return {
			success,
			errors: combinedErrors,
			ok: success,
			report:
				combinedErrors.length > 0
					? "🛑 STRATEGIC REVIEW FEEDBACK:\n" + combinedErrors.map((e) => `  - ${e}`).join("\n")
					: undefined,
			synthesis,
		}
	}
}
