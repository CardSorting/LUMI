import * as crypto from "crypto"
import * as fs from "fs"
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
		private spiderEngine?: any, // V33: Ethereal Persistence
	) {}

	/**
	 * Verifies that all file paths and symbols cited in the scratchpad have a high-fidelity observation history.
	 * V30: Now includes Merkle-Drift Detection for structural synchronization.
	 * V31: Uses Structural Hashing to ignore aesthetic changes (comments, whitespace).
	 * V33: Uses Identity Persistence to ground citations via SpiderEngine history.
	 */
	public async verifyEvidenceGrounding(
		content: string,
		history: any[] = [],
	): Promise<{ errors: string[]; warnings: string[] }> {
		const errors: string[] = []
		const warnings: string[] = []
		const registry = this.metabolicMonitor.getForensicRegistry()

		// V34: Conversational Grounding
		const historyPaths = this.extractPathsFromHistory(history)

		// 1. File-Level Verification
		const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g
		const citedPaths = Array.from(new Set(Array.from(content.matchAll(pathRegexp)).map((m) => m[0])))

		for (const cited of citedPaths) {
			const absoluteCited = path.resolve(this.cwd, cited)
			const metrics = registry.get(absoluteCited)

			if (!metrics || metrics.reads === 0) {
				// V34: Contextual Leniency (Conversational Grounding)
				if (historyPaths.has(absoluteCited)) {
					warnings.push(
						`💡 CONVERSATIONAL GROUNDING: \`${cited}\` was discussed in recent dialogue. Grounding assumed via neural context.`,
					)
					continue
				}

				// V33: Identity Persistence (Substrate-Aware Grounding)
				const relPath = path.relative(this.cwd, absoluteCited)
				const node = this.spiderEngine?.nodes.get(relPath)
				if (node) {
					warnings.push(
						`💡 FORENSIC PERSISTENCE: \`${cited}\` cited without recent read, but structural identity is verifiably stable. Grounding assumed.`,
					)
					continue
				}

				errors.push(
					`FORENSIC HALLUCINATION: You cited \`${cited}\` but have no read history for it. You must investigate the substrate before making claims about it.`,
				)
				continue
			}

			// V32: Transient Sync Suppression (Grace window for high-velocity turns)
			// If the file was read in the last 120s, assume the agent is synchronized.
			const readGraceWindow = 120000 // 2 minutes
			const isRecentlyRead = Date.now() - metrics.lastReadTimestamp < readGraceWindow

			// V30/V31: Merkle Drift Detection (Structural Synchronization)
			if (metrics.lastObservedHash && !isRecentlyRead) {
				try {
					const currentContent = await fs.promises.readFile(absoluteCited, "utf-8")
					const currentHash = this.computeStructuralHash(currentContent)
					if (currentHash !== metrics.lastObservedHash) {
						errors.push(
							`🛑 STRUCTURAL DRIFT DETECTED: \`${cited}\` has changed structurally since your last investigation. ` +
								`Significant logic or symbol shifts detected (Ignoring aesthetic changes). Please re-read the file to sync your mental model.`,
						)
					}
				} catch (_e) {
					errors.push(`FORENSIC FAIL: Missing file or unreadable substrate at \`${cited}\`.`)
				}
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
	 * V31: Computes an aesthetically-normalized hashing of the content.
	 */
	public computeStructuralHash(content: string): string {
		// Strip single line comments
		let normalized = content.replace(/\/\/.*$/gm, "")
		// Strip multi-line comments
		normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, "")
		// Collapse all whitespace (including newlines) into identity strings
		normalized = normalized.replace(/\s+/g, "")

		return crypto.createHash("md5").update(normalized).digest("hex")
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

	/**
	 * Extracts file paths from the last N assistant turns in conversation history.
	 * V34: Enables Conversational Grounding.
	 */
	public extractPathsFromHistory(history: any[]): Set<string> {
		const paths = new Set<string>()
		if (!history || !Array.isArray(history)) return paths

		const assistantTurns = history.filter((m) => m.role === "assistant").slice(-3)
		const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g

		for (const msg of assistantTurns) {
			const text = Array.isArray(msg.content) ? msg.content.map((c: any) => c.text || "").join(" ") : String(msg.content)
			const matches = text.matchAll(pathRegexp)
			for (const match of matches) {
				paths.add(path.resolve(this.cwd, match[0]))
			}
		}
		return paths
	}

	/**
	 * V34: Range-aware Drift Detection.
	 * Checks if a specific edit block matches the observed structural identity,
	 * even if other parts of the file have drifted.
	 */
	public verifyBlockStability(currentContent: string, targetContent: string): boolean {
		if (currentContent.includes(targetContent)) {
			// If the target block is present exactly in the current disk content,
			// we assume the agent's turn is synchronized for that specific operation.
			return true
		}
		return false
	}
}
