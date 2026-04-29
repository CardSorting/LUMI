import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { StabilityMetrics, StabilityMonitor } from "../integrity/StabilityMonitor"
import type { SpiderEngine } from "./spider/SpiderEngine"

export interface ForensicMessage {
	role: string
	content: string | Array<{ text?: string; input?: Record<string, unknown> }>
}

/**
 * StabilityForensics: Verifies the integrity of architectural evidence.
 * Ensures that an assistant has actually "observed" the files and symbols they cite.
 */
export class StabilityForensics {
	constructor(
		private cwd: string,
		private stabilityMonitor: StabilityMonitor,
		private spiderEngine?: SpiderEngine, // V34: Hardened Typed Persistence
	) {}

	/**
	 * Verifies that all file paths and symbols cited in the strategic review have a clear observation history.
	 * V30: Now includes Structural Sync Detection for synchronization.
	 * V31: Uses Structural Hashing to ignore aesthetic changes (comments, whitespace).
	 * V33: Uses Identity Persistence to verify citations via project history.
	 */
	public async verifyEvidenceVerification(
		content: string,
		history: ForensicMessage[] = [],
	): Promise<{ errors: string[]; warnings: string[] }> {
		const errors: string[] = []
		const warnings: string[] = []
		const registry = this.stabilityMonitor.getForensicRegistry()

		// V34: Conversational Grounding
		const historyPaths = this.extractPathsFromHistory(history)

		// 1. File-Level Verification
		// V34: Surgical Path Regex (Prevents version numbers/metrics from being flagged as phantom paths)
		const pathRegexp = /(?:\/|^)(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g
		const citedPaths = Array.from(
			new Set(Array.from(content.matchAll(pathRegexp)).map((m) => (m[0].startsWith("/") ? m[0].slice(1) : m[0]))),
		)

		for (const cited of citedPaths) {
			const absoluteCited = path.resolve(this.cwd, cited)
			const metrics = this.stabilityMonitor.getMetrics(absoluteCited)

			if (!metrics || metrics.reads === 0) {
				// V34: Contextual Leniency (Conversational Grounding)
				if (historyPaths.has(absoluteCited)) {
					warnings.push(
						`💡 CONVERSATIONAL GROUNDING: \`${cited}\` was discussed in recent dialogue. Grounding assumed via neural context.`,
					)
					continue
				}

				// V33: Identity Persistence (Substrate-Aware Verification)
				const relPath = this.stabilityMonitor.normalize(absoluteCited)
				const node = this.spiderEngine?.nodes.get(relPath)
				if (node) {
					warnings.push(
						`💡 INVESTIGATION PERSISTENCE: \`${cited}\` cited without recent read, but structural identity is verifiably stable. Verification assumed.`,
					)
					continue
				}

				warnings.push(
					`⚠️ UNVERIFIED FILE CITATION: You cited \`${cited}\` but I don't see a recent read history for it. Please take a look at the file so we can stay in sync!`,
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
						warnings.push(
							`⚠️ RECENT FILE CHANGES DETECTED: \`${cited}\` has been updated since your last look. ` +
								`There might be new logic or structure. Please re-read the file to ensure your plan is still accurate.`,
						)
					}
				} catch (_e) {
					warnings.push(`⚠️ FORENSIC NOTICE: Missing file or unreadable substrate at \`${cited}\`.`)
				}
			}

			// Staleness Check (V26: 20 minute window)
			const stalenessMs = Date.now() - metrics.lastReadTimestamp
			if (stalenessMs > 1200000) {
				warnings.push(
					`⚠️ OLD OBSERVATION: Your latest look at \`${cited}\` is over 20 minutes old. It might be worth a quick re-check to ensure nothing has changed.`,
				)
			}
		}

		// 2. Symbol-Level Verification (V26 Neural Hardening)
		const symbolRegexp = /\b(?:[A-Z][a-zA-Z0-9]+|[a-z]+(?:_[a-z0-9]+)+)\b/g
		const uniqueSymbols = new Set(Array.from(content.matchAll(symbolRegexp)).map((m) => m[0]))

		// Exclude known common symbols/keywords
		const commonKeywords = new Set([
			"STRATEGIC",
			"REVIEW",
			"STABILITY",
			"BREAK",
			"GUIDANCE",
			"THE",
			"FOUNDATION",
			"QUALITY",
			"CHECK",
			"GUARD",
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
					`💡 UNVERIFIED SYMBOL: \`${symbol}\` cited but not explicitly logged as observed. Ensure your strategic review probes are linked to verified symbols.`,
				)
			}
		}

		return { errors, warnings }
	}

	/**
	 * V235: Multivariate Hazard Sensing.
	 * Returns the hazard score for a specific file from the structural substrate.
	 */
	public getHazardLevel(filePath: string): number {
		if (!this.spiderEngine) return 0
		const relPath = this.stabilityMonitor.normalize(path.resolve(this.cwd, filePath))
		const node = this.spiderEngine.nodes.get(relPath)
		return node?.hazardScore || 0
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
	 * Generates a helpful Investigation Trace for the strategic review.
	 */
	public generateInvestigationTrace(): string {
		const registry = this.stabilityMonitor.getForensicRegistry()
		const trace: string[] = []

		const recentEntries = Array.from(registry.entries() as IterableIterator<[string, StabilityMetrics]>)
			.filter(([_, m]) => m.reads > 0)
			.sort(([__, ma], [___, mb]) => mb.lastReadTimestamp - ma.lastReadTimestamp)
			.slice(0, 5)

		for (const [p, m] of recentEntries) {
			const relPath = path.relative(this.cwd, p)
			const symbols = Array.from(m.symbolObservations).slice(0, 3).join(", ")
			trace.push(`- **VIEWED**: \`${relPath}\` (${m.reads} times)${symbols ? ` + Details: [${symbols}]` : ""}`)
		}

		return (
			`## [INVESTIGATION TRACE]\n` +
			`*Recent Project Investigation History:*\n\n` +
			(trace.length > 0 ? trace.join("\n") : "_No recent file investigations recorded._")
		)
	}

	/**
	 * Extracts file paths from the last N assistant turns in conversation history.
	 * V34: Expanded Conversational Grounding (Lookback 5).
	 */
	public extractPathsFromHistory(history: ForensicMessage[]): Set<string> {
		const paths = new Set<string>()
		if (!history || !Array.isArray(history)) return paths

		const assistantTurns = history.filter((m) => m.role === "assistant").slice(-5)
		const pathRegexp = /(?:\/|^)(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g

		for (const msg of assistantTurns) {
			const text = Array.isArray(msg.content)
				? msg.content
						.map((c: { text?: string; input?: Record<string, unknown> }) => c.text || JSON.stringify(c.input || {}))
						.join(" ")
				: String(msg.content)
			const matches = text.matchAll(pathRegexp)
			for (const match of matches) {
				const rawPath = match[0].startsWith("/") ? match[0].slice(1) : match[0]
				paths.add(path.resolve(this.cwd, rawPath))
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

	/**
	 * V220: Industrial Hygiene (Disposal).
	 * Releases retained service references during policy-engine teardown.
	 */
	public dispose(): void {
		this.stabilityMonitor = null as unknown as StabilityMonitor
		this.spiderEngine = undefined
		Logger.info("[StabilityForensics] Forensic substrate released.")
	}
}
