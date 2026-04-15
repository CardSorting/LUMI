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
	 */
	public static getLatestScratchpadContent(history: any[]): { content: string } {
		let content = ""
		for (let i = history.length - 1; i >= 0; i--) {
			const msg = history[i]
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				const editCall = msg.content.find(
					(c: any) =>
						c.type === "tool_use" &&
						(c.name === "edit_file" || c.name === "write_to_file") &&
						c.input?.path?.endsWith("scratchpad.md"),
				)
				if (editCall) {
					content = editCall.input.content || ""
					break
				}
			}
		}
		return { content }
	}

	/**
	 * Validates the scratchpad content against the Sovereign V12 protocol.
	 */
	public async validate(
		content: string,
		isAgile = false,
	): Promise<{ success: boolean; errors: string[]; ok?: boolean; report?: string; synthesis?: string }> {
		const errors: string[] = []
		const diagnosticHints: string[] = []

		// Extract all cited paths for forensic verification
		const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g
		const citedPaths = Array.from(content.matchAll(pathRegexp)).map((m) => m[0])

		if (this.forensics && !isAgile) {
			const { errors: forensicErrors, warnings: forensicWarnings } = this.forensics.verifyEvidenceGrounding(content)
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

		if (!content.includes(SovereignProtocol.HEADERS.AUDIT)) {
			return {
				success: false,
				errors: ["No # SOVEREIGN AUDIT section found. You must structure your audit around the Sovereign Protocol."],
			}
		}

		// 2. Check for Triad Probes
		const probes = [
			{ name: "THE ARCHITECT", header: SovereignProtocol.HEADERS.ARCHITECT },
			{ name: "THE CRITIC", header: SovereignProtocol.HEADERS.CRITIC },
			{ name: "THE SRE", header: SovereignProtocol.HEADERS.SRE },
		]

		for (const probe of probes) {
			if (!content.includes(probe.header)) {
				errors.push(`Missing mandatory triad probe: ${probe.name}`)
				continue
			}

			const startIndex = content.indexOf(probe.header) + probe.header.length
			const nextProbe = probes[probes.indexOf(probe) + 1]?.header || SovereignProtocol.HEADERS.RESOLUTION
			const endIndex = content.indexOf(nextProbe) > startIndex ? content.indexOf(nextProbe) : content.length
			const probeContent = content.substring(startIndex, endIndex).trim()

			// Substantive Validation for Probes
			if (probeContent.length < 50) {
				diagnosticHints.push(`💡 ${probe.name}: Analysis is too superficial (min 50 chars).`)
			}

			// Symbol/Delta detection in probe content
			const deltaRegex = /(?:~|before|after|changing|updating|fixing|transformation)/i
			const hasDelta = deltaRegex.test(probeContent)
			if (!hasDelta && !isAgile) {
				diagnosticHints.push(
					`💡 ${probe.name}: No structural transformation cited. Use the '~' operator (e.g. SymbolA ~ SymbolB).`,
				)
			}
		}

		// 3. Check for Final Resolution and Mantra
		if (!content.includes(SovereignProtocol.HEADERS.RESOLUTION)) {
			errors.push("Missing mandatory section: ## [FINAL RESOLUTION]")
		}

		const hasMantra = content.includes(SovereignProtocol.MANTRA)
		if (!hasMantra) {
			errors.push(`Missing the Sovereign Mantra: "${SovereignProtocol.MANTRA}"`)
		}

		// 4. Check for Diagnostics
		if (!content.includes(SovereignProtocol.HEADERS.DIAGNOSTICS)) {
			diagnosticHints.push("💡 GUIDANCE: Consider including ## [SYSTEM DIAGNOSTICS] for better grounding.")
		}

		const success = errors.length === 0 && (isAgile || diagnosticHints.length === 0)
		const combinedErrors = [...errors, ...diagnosticHints]

		// Extract resolution for synthesis
		const resolutionMatch = content.match(/## \[FINAL RESOLUTION\]\s*([\s\S]*?)(?:\n##|$)/)
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
