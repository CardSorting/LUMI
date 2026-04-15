import { SovereignForensics } from "@/core/policy/SovereignForensics"
import { SovereignProtocol } from "@/core/policy/SovereignProtocol"

/**
 * SovereignScribe: The validator for scratchpad.md compliance.
 * Enforces the Sovereign Drafting V12 standard.
 */
export class SovereignScribe {
	constructor(
		private cwd: string,
		private forensics?: SovereignForensics,
	) {}

	/**
	 * Static helper to extract the latest scratchpad content from conversation history.
	 * V27 HARDENING: Performs multi-pass search and synthesized fallback detection.
	 */
	public static getLatestScratchpadContent(history: any[]): { content: string; source: "disk" | "history" | "synthesized" } {
		let content = ""
		// Pass 1: Direct find in tool call inputs (Physical write detection)
		for (let i = history.length - 1; i >= 0; i--) {
			const msg = history[i]
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				const editCall = msg.content.find(
					(c: any) =>
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
					if (block.type === "text" && block.text.includes(SovereignProtocol.HEADERS.AUDIT)) {
						return { content: block.text, source: "synthesized" }
					}
				}
			}
		}

		return { content: "", source: "disk" }
	}

	/**
	 * V29: Scans conversation history for a "Virtual Audit" using semantic fuzzy matching.
	 */
	public static findVirtualAuditInHistory(history: any[]): { content: string; valid: boolean } {
		const { content, source } = SovereignScribe.getLatestScratchpadContent(history)

		if (source === "synthesized" || source === "history") {
			// V29: Fuzzy Recognition logic - Allow audits drafted in natural language
			const hasAuditHeader = SovereignProtocol.SEMANTIC_PATTERNS.AUDIT.test(content)
			const hasArchitect = SovereignProtocol.SEMANTIC_PATTERNS.ARCHITECT.test(content)
			const hasResolution = SovereignProtocol.SEMANTIC_PATTERNS.RESOLUTION.test(content)

			const valid = hasAuditHeader && hasArchitect && hasResolution
			if (valid) return { content, valid: true }
		}

		return { content: "", valid: false }
	}

	/**
	 * Validates the scratchpad content against the Sovereign V12 protocol.
	 * V29: Added path awareness for implicit Agile Mode detection.
	 */
	public async validate(
		content: string,
		isAgile = false,
		targetPath?: string,
	): Promise<{ success: boolean; errors: string[]; ok?: boolean; report?: string; synthesis?: string }> {
		const errors: string[] = []
		const diagnosticHints: string[] = []

		// V29: Implicit Agility Detection
		const isImplicitAgile = targetPath ? SovereignProtocol.isImplicitAgileSafe(targetPath) : false
		const isExplicitlyAgile = content.includes(SovereignProtocol.HEADERS.AGILE) || isAgile || isImplicitAgile

		if (isImplicitAgile) {
			diagnosticHints.push(
				`💡 IMPLICIT AGILITY: \`${targetPath}\` detected as safe architectural domain. Triad requirements demoted.`,
			)
		}

		// Extract all cited paths for forensic verification
		const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g
		const citedPaths = Array.from(content.matchAll(pathRegexp)).map((m) => m[0])

		if (this.forensics && !isExplicitlyAgile) {
			const { errors: forensicErrors, warnings: forensicWarnings } = await this.forensics.verifyEvidenceGrounding(content)
			errors.push(...forensicErrors)
			diagnosticHints.push(...forensicWarnings)
		}

		// 1. Check for Protocol Identity
		if (content.includes(SovereignProtocol.HEADERS.BREATH)) {
			// Sovereign Breath Turn - Lightweight validation
			if (content.length < 100) {
				errors.push("Sovereign Breath turn is too brief (min 100 characters).")
			}
			return { success: errors.length === 0, errors }
		}

		const hasAuditHeader =
			content.includes(SovereignProtocol.HEADERS.AUDIT) || SovereignProtocol.SEMANTIC_PATTERNS.AUDIT.test(content)

		if (!hasAuditHeader) {
			return {
				success: isExplicitlyAgile,
				errors: isExplicitlyAgile
					? []
					: ["No # SOVEREIGN AUDIT section found. You must structure your audit around the Sovereign Protocol."],
			}
		}

		// 2. Check for Triad Probes
		const probes = [
			{
				name: "THE ARCHITECT",
				header: SovereignProtocol.HEADERS.ARCHITECT,
				pattern: SovereignProtocol.SEMANTIC_PATTERNS.ARCHITECT,
			},
			{ name: "THE CRITIC", header: SovereignProtocol.HEADERS.CRITIC },
			{ name: "THE SRE", header: SovereignProtocol.HEADERS.SRE },
		]

		for (const probe of probes) {
			const hasProbe = content.includes(probe.header) || (probe.pattern && probe.pattern.test(content))

			if (!hasProbe) {
				if (isExplicitlyAgile) {
					diagnosticHints.push(`💡 AGILE MODE: Skipping triad probe: ${probe.name}`)
				} else {
					errors.push(`Missing mandatory triad probe: ${probe.name}`)
				}
				continue
			}

			const startIndex = content.indexOf(probe.header) + probe.header.length
			const nextProbe = probes[probes.indexOf(probe) + 1]?.header || SovereignProtocol.HEADERS.RESOLUTION
			const endIndex = content.indexOf(nextProbe) > startIndex ? content.indexOf(nextProbe) : content.length
			const probeContent = content.substring(startIndex, endIndex).trim()

			// Substantive Validation for Probes
			if (probeContent.length < 50 && !isExplicitlyAgile) {
				diagnosticHints.push(`💡 ${probe.name}: Analysis is too superficial (min 50 chars).`)
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
			content.includes(SovereignProtocol.HEADERS.RESOLUTION) || SovereignProtocol.SEMANTIC_PATTERNS.RESOLUTION.test(content)

		if (!hasResolution) {
			if (!isExplicitlyAgile) errors.push("Missing mandatory section: ## [FINAL RESOLUTION]")
		}

		const hasMantra = content.includes(SovereignProtocol.MANTRA)
		if (!hasMantra && !isExplicitlyAgile) {
			errors.push(`Missing the Sovereign Mantra: "${SovereignProtocol.MANTRA}"`)
		}

		// 4. Check for Diagnostics
		if (!content.includes(SovereignProtocol.HEADERS.DIAGNOSTICS)) {
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
					? "🛑 SOVEREIGN AUDIT FAILURE:\n" + combinedErrors.map((e) => `  - ${e}`).join("\n")
					: undefined,
			synthesis,
		}
	}
}
