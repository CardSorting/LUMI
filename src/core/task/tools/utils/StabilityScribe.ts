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

		// V270: Sovereign & Agile Detection
		const isImplicitAgile = targetPath ? IntegrityProtocol.isImplicitAgileSafe(targetPath) : false
		const isSovereign = content.includes(IntegrityProtocol.HEADERS.SOVEREIGN) || content.includes("#BYPASS")
		const isExplicitlyAgile = content.includes(IntegrityProtocol.HEADERS.AGILE) || isAgile || isImplicitAgile || isSovereign

		if (isImplicitAgile) {
			diagnosticHints.push(
				`💡 IMPLICIT AGILITY: \`${targetPath}\` detected as non-critical layer. Triad requirements demoted.`,
			)
		}
		if (isSovereign) {
			diagnosticHints.push(`🛡️ SOVEREIGN MODE: Protocol enforcement suspended for high-velocity turn.`)
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
			return { success: true, errors: [] } // V270: Stability Break is always success
		}

		const hasAuditHeader =
			content.includes(IntegrityProtocol.HEADERS.AUDIT) || IntegrityProtocol.SEMANTIC_PATTERNS.AUDIT.test(content)

		if (!hasAuditHeader) {
			return {
				success: isExplicitlyAgile,
				errors: isExplicitlyAgile
					? []
					: ["No # STRATEGIC REVIEW section found. Structure your review around the stability protocol."],
			}
		}

		// 2. Check for Stability Gates
		const probes = [
			{
				name: "THE FOUNDATION",
				header: IntegrityProtocol.HEADERS.ARCHITECT,
				pattern: IntegrityProtocol.SEMANTIC_PATTERNS.ARCHITECT,
			},
			{
				name: "THE QUALITY CHECK",
				header: IntegrityProtocol.HEADERS.CRITIC,
				pattern: IntegrityProtocol.SEMANTIC_PATTERNS.CRITIC,
			},
			{
				name: "THE STABILITY GUARD",
				header: IntegrityProtocol.HEADERS.SRE,
				pattern: IntegrityProtocol.SEMANTIC_PATTERNS.SRE,
			},
		]

		const hazardLevel = targetPath && this.forensics ? this.forensics.getHazardLevel(targetPath) : 0
		const isHighHazard = hazardLevel > 0.6 // V270: Increased threshold (was 0.5)

		// V270: Surgical/Micro-Agile Detection
		// If the proposed solution is surgical (few steps), reduce blocking pressure.
		const stepCount = (content.match(/- \[ \]/g) || []).length
		const isSurgical = stepCount <= 5
		const isMicroAgile = isSurgical && isExplicitlyAgile

		for (const probe of probes) {
			const hasHeader = content.includes(probe.header)
			const hasPattern = probe.pattern && probe.pattern.test(content)
			const hasFuzzyMatch = content.toLowerCase().includes(probe.name.toLowerCase())

			if (!hasHeader && !hasPattern && !hasFuzzyMatch) {
				if (isExplicitlyAgile && !isHighHazard) {
					diagnosticHints.push(`💡 AGILE MODE: Skipping gate check: ${probe.name}`)
				} else if (isMicroAgile) {
					diagnosticHints.push(`💡 SURGICAL BYPASS: Gate check ${probe.name} skipped for minor fix.`)
				} else {
					errors.push(`Missing mandatory gate check: ${probe.name}${isHighHazard ? " (High Hazard Enforcement)" : ""}`)
				}
				continue
			}

			// Substantive Validation for Probes
			const threshold = isExplicitlyAgile ? 20 : 100 // V270: Pragmatic thresholds

			// Find content for this probe
			const startIndex = content.toLowerCase().indexOf(probe.name.toLowerCase())
			const probeChunk = content.substring(startIndex, startIndex + 300) // Small sample for length check

			if (probeChunk.length < threshold && !isMicroAgile) {
				diagnosticHints.push(`💡 ${probe.name}: Analysis is brief. Ensure your rationale is sound.`)
			}
		}

		// 3. Final Checks
		const hasResolution =
			content.includes(IntegrityProtocol.HEADERS.RESOLUTION) || IntegrityProtocol.SEMANTIC_PATTERNS.RESOLUTION.test(content)
		if (!hasResolution && !isExplicitlyAgile) {
			errors.push("Missing mandatory section: ## [FINAL STEPS]")
		}

		const success = errors.length === 0
		const combinedErrors = [...errors, ...diagnosticHints]

		return {
			success,
			errors: combinedErrors,
			ok: success,
			report:
				combinedErrors.length > 0
					? "🛑 STRATEGIC REVIEW FEEDBACK:\n" + combinedErrors.map((e) => `  - ${e}`).join("\n")
					: undefined,
		}
	}
}
