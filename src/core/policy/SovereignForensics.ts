import * as path from "path"
import { MetabolicMonitor } from "../integrity/MetabolicMonitor"

/**
 * SovereignForensics: Verifies the integrity of architectural evidence.
 * Ensures that an agent has actually "observed" the files and symbols they cite.
 */
export class SovereignForensics {
	constructor(
		private cwd: string,
		private metabolicMonitor: MetabolicMonitor,
	) {}

	/**
	 * Verifies that all file paths and symbols cited in the scratchpad have a high-fidelity observation history.
	 */
	public verifyEvidenceGrounding(content: string): { errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []
		const registry = this.metabolicMonitor.getForensicRegistry()

		// 1. File-Level Verification
		const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g
		const citedPaths = Array.from(new Set(Array.from(content.matchAll(pathRegexp)).map((m) => m[0])))

		for (const cited of citedPaths) {
			const absoluteCited = path.resolve(this.cwd, cited)
			const metrics = registry.get(absoluteCited)

			if (!metrics || metrics.reads === 0) {
				errors.push(
					`FORENSIC HALLUCINATION: You cited \`${cited}\` but have no read history for it. You must investigate the substrate before making claims about it.`,
				)
				continue
			}

			// Staleness Check (V26: 20 minute window)
			const stalenessMs = Date.now() - metrics.lastReadTimestamp
			if (stalenessMs > 1200000) {
				warnings.push(
					`⚠️ STALE EVIDENCE: Your observation of \`${cited}\` is over 20 minutes old. Structural drift may have occurred. Re-verifying is recommended.`,
				)
			}
		}

		// 2. Symbol-Level Verification (V26 Neural Hardening)
		const symbolRegexp = /\b(?:[A-Z][a-zA-Z0-9]+|[a-z]+(?:_[a-z0-9]+)+)\b/g
		const uniqueSymbols = new Set(Array.from(content.matchAll(symbolRegexp)).map((m) => m[0]))

		// Exclude known common symbols/keywords
		const commonKeywords = new Set([
			"SOVEREIGN",
			"AUDIT",
			"BREATH",
			"MANTRA",
			"THE",
			"ARCHITECT",
			"CRITIC",
			"SRE",
			"FINAL",
			"RESOLUTION",
		])
		const citedSymbols = Array.from(uniqueSymbols).filter((s) => !commonKeywords.has(s.toUpperCase()))

		for (const symbol of citedSymbols) {
			let observed = false
			for (const metrics of registry.values()) {
				if (metrics.symbolObservations.has(symbol)) {
					observed = true
					break
				}
			}

			if (!observed) {
				// We allow symbols if they were at least in the file content of a read file (simple heuristic)
				// But V26 "Neural Hardening" encourages explicit symbol logging.
				warnings.push(
					`💡 UNVERIFIED SYMBOL: \`${symbol}\` cited but not explicitly logged as observed. Ensure your triad probes are grounded in verified symbols.`,
				)
			}
		}

		return { errors, warnings }
	}

	/**
	 * Generates a high-fidelity Forensic Trace for the scratchpad.
	 */
	public generateForensicTrace(): string {
		const registry = this.metabolicMonitor.getForensicRegistry()
		const trace: string[] = []

		const recentEntries = Array.from(registry.entries() as IterableIterator<[string, any]>)
			.filter(([_, m]) => m.reads > 0)
			.sort(([__, ma], [___, mb]) => mb.lastReadTimestamp - ma.lastReadTimestamp)
			.slice(0, 5)

		for (const [p, m] of recentEntries) {
			const relPath = path.relative(this.cwd, p)
			const symbols = Array.from(m.symbolObservations).slice(0, 3).join(", ")
			trace.push(`- **OBSERVED**: \`${relPath}\` (${m.reads} reads)${symbols ? ` + Symbols: [${symbols}]` : ""}`)
		}

		return (
			`## [FORENSIC TRACE]\n` +
			`*Architectural Investigative History:*\n\n` +
			(trace.length > 0 ? trace.join("\n") : "_No forensic evidence recorded in current session._")
		)
	}
}
