import * as fs from "node:fs"
import * as path from "node:path"
import { DietCodeDefaultTool } from "@/shared/tools"

export interface SovereignAuditResult {
	ok: boolean
	report: string
	synthesis?: string
}

import { PathogenStore } from "../../../integrity/PathogenStore"
import { SpiderEngine } from "../../../policy/spider/SpiderEngine"

/**
 * SovereignScribe: Shared logic for validating the Double Down Planning scratchpad.
 * Provides real-time feedback and final "Hard Lock" validation.
 */
export const SovereignScribe = {
	/**
	 * Scans conversation history to find the latest scratchpad content.
	 */
	getLatestScratchpadContent(history: unknown[]): { content: string; synthesis: string } {
		let latestScratchpadContent = ""
		let synthesis = ""

		for (let i = history.length - 1; i >= 0; i--) {
			const msg = history[i] as { role?: string; content?: unknown }
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					const b = block as { type: string; name?: string; input?: Record<string, unknown> }
					if (b.type === "tool_use" && b.name === DietCodeDefaultTool.FILE_NEW) {
						const input = b.input as Record<string, string>
						const targetPath = input.path || input.TargetFile || ""
						if (targetPath.endsWith("scratchpad.md")) {
							latestScratchpadContent = input.content || input.CodeContent || ""
							const match = latestScratchpadContent.match(
								/- \*\*Synthesis\*\*: ([\s\S]+?)(?=\n- \*\*MANTRA\*\*|$)/i,
							)
							if (match) synthesis = match[1].trim()
							break
						}
					}
				}
			}
			if (latestScratchpadContent) break
		}

		return { content: latestScratchpadContent, synthesis }
	},

	/**
	 * Validates the scratchpad content against Sovereign V8 standards.
	 */
	async validate(
		content: string,
		cwd: string,
		_spider?: SpiderEngine,
		pathogens?: PathogenStore,
	): Promise<SovereignAuditResult> {
		if (!content) {
			return {
				ok: false,
				report:
					"⚠️ SOVEREIGN DRAFTER VIOLATION: Mandatory `scratchpad.md` drafting phase not found.\n" +
					"In PLAN MODE, you MUST first externalize your architectural investigation using the **Sovereign Triad V6 Template** in `scratchpad.md`.",
			}
		}

		const missingMarkers: string[] = []
		const diagnosticHints: string[] = []

		// 1. Hallucination Protection: Check for <scratchpad> tags within the file content
		if (content.includes("<scratchpad>") || content.includes("</scratchpad>")) {
			missingMarkers.push("Tool Isolation Violation")
			diagnosticHints.push(
				"💡 FORBIDDEN PATTERN: You included `<scratchpad>` tags inside the file. Write raw markdown only.",
			)
		}

		// 2. Check title
		if (!content.includes("# SOVEREIGN AUDIT") || content.includes("[Task Name]")) {
			missingMarkers.push("# SOVEREIGN AUDIT (Descriptive Title)")
			if (content.includes("[Task Name]"))
				diagnosticHints.push("💡 Title still contains the template placeholder '[Task Name]'.")
		}

		// 3. Check Probes & Substantive Content
		// PRODUCTION HARDENING: Improved regex to capture aliased paths and more extensions (.tsx, .js, .json, .md)
		const pathRegex = /(?:@[\w-]+\/|(?:[a-zA-Z0-9_-]+\/)+)[a-zA-Z0-9_-]+\.[a-z]+|[a-zA-Z0-9_-]+\.(?:ts|tsx|js|jsx|json|md)/g
		const probePatterns = [
			{ name: "### 1. THE ARCHITECT", pattern: /### 1\. THE ARCHITECT \(Boundary Probe\)\n([\s\S]+?)(?=### 2|$)/i },
			{ name: "### 2. THE CRITIC", pattern: /### 2\. THE CRITIC \(Assumption Probe\)\n([\s\S]+?)(?=### 3|$)/i },
			{ name: "### 3. THE SRE", pattern: /### 3\. THE SRE \(Atomic Probe\)\n([\s\S]+?)(?=## \[FINAL RESOLUTION\]|$)/i },
		]

		for (const probe of probePatterns) {
			const match = content.match(probe.pattern)
			if (!match) {
				missingMarkers.push(probe.name)
				diagnosticHints.push(`💡 Mandatory header missing: ${probe.name}`)
				continue
			}

			const probeContent = match[1].trim()
			const pathMatch = probeContent.match(pathRegex)
			const paths = pathMatch ? Array.from(new Set(pathMatch)) : []
			const nonExistentPaths: string[] = []

			if (paths.length > 0) {
				for (const p of paths) {
					const sanitizedPath = p.replace(/[`*]/g, "")
					// RESOLUTION HARDENING: Use a more robust mapping for aliases in scratchpad validation
					let resolvedPath = sanitizedPath
					if (sanitizedPath.startsWith("@/")) resolvedPath = sanitizedPath.replace("@/", "src/")
					else if (sanitizedPath.startsWith("@api/")) resolvedPath = sanitizedPath.replace("@api/", "src/core/api/")
					else if (sanitizedPath.startsWith("@core/")) resolvedPath = sanitizedPath.replace("@core/", "src/core/")
					else if (sanitizedPath.startsWith("@infra/"))
						resolvedPath = sanitizedPath.replace("@infra/", "src/infrastructure/")
					else if (sanitizedPath.startsWith("@shared/")) resolvedPath = sanitizedPath.replace("@shared/", "src/shared/")
					else if (sanitizedPath.startsWith("@utils/")) resolvedPath = sanitizedPath.replace("@utils/", "src/utils/")

					const absolutePath = path.isAbsolute(resolvedPath) ? resolvedPath : path.join(cwd, resolvedPath)

					// PRODUCTION HARDENING: check for existence with common extensions if not provided
					let exists = fs.existsSync(absolutePath)
					if (!exists && !path.extname(absolutePath)) {
						for (const ext of [".ts", ".tsx", ".js", ".json", ".md"]) {
							if (fs.existsSync(absolutePath + ext)) {
								exists = true
								break
							}
						}
					}

					if (!exists) {
						nonExistentPaths.push(sanitizedPath)
					} else if (pathogens) {
						// PRODUCTION HARDENING: Surface Stress Zone warnings during drafting
						const prediction = pathogens.predictFailure(absolutePath)
						if (prediction.likely) {
							diagnosticHints.push(`⚠️ SOVEREIGN FORESIGHT: ${prediction.reason}`)
						}
					}
				}
			}

			const isPlaceholder =
				probeContent.includes("[Where is the boundary weakest?]") ||
				probeContent.includes("[Which assumption is most dangerous?]") ||
				probeContent.includes("[What happens during partial failure?]")

			// PRODUCTION HARDENING: Evidence Density & Semantic Anchoring check.
			// Probes MUST recite at least 2 unique files AND mention at least one symbol from those files.

			// Extract potential symbols mentioned in the probe (CamelCase or snake_case)
			const symbolRegex = /\b(?:[A-Z][a-zA-Z0-9]+|[a-z]+(?:_[a-z0-9]+)+)\b/g
			const mentionedSymbols = probeContent.match(symbolRegex) || []
			const uniqueSymbols = new Set(mentionedSymbols)

			// isPlaceholder already declared above at line 147

			// PRODUCTION HARDENING: Semantic Delta Verification.
			// Agents MUST describe the transformation (~ operator or before/after)
			const deltaRegex = /(?:~|before|after|changing|updating|fixing|transformation)/i
			const hasDelta = deltaRegex.test(probeContent)

			if (
				probeContent.length < 40 ||
				paths.length < 2 ||
				uniqueSymbols.size < 2 ||
				!hasDelta ||
				isPlaceholder ||
				nonExistentPaths.length > 0
			) {
				missingMarkers.push(`${probe.name} (Substantive Grounding)`)
				if (probeContent.length < 40)
					diagnosticHints.push(`💡 ${probe.name}: Analysis is too brief. Be more descriptive.`)
				if (paths.length < 2)
					diagnosticHints.push(`💡 ${probe.name}: Insufficient evidence density. Cite at least 2 unique file paths.`)
				if (uniqueSymbols.size < 2 && !isPlaceholder)
					diagnosticHints.push(
						`💡 ${probe.name}: SEMANTIC DISORIENTATION: Mention specific classes, functions, or variables you investigated.`,
					)
				if (!hasDelta && !isPlaceholder)
					diagnosticHints.push(
						`💡 ${probe.name}: DELTA DISORIENTATION: Describe the transformation of your symbols using the '~' operator or "Before/After" notation.`,
					)
				if (nonExistentPaths.length > 0)
					diagnosticHints.push(
						`💡 ${probe.name}: Hallucination detected! The following paths do not exist: ${nonExistentPaths.join(", ")}`,
					)
				if (isPlaceholder)
					diagnosticHints.push(`💡 ${probe.name}: Remove template placeholders and replace with real investigation.`)
			}
		}

		// 4. Check Final Resolution sections
		// PRODUCTION HARDENING: Mantra must be the exact "Double down on this concept" string.
		const hasMantra = content.toLowerCase().includes("double down on this concept")
		const synthesisMatch = content.match(/- \*\*Synthesis\*\*: ([\s\S]+?)(?=\n- \*\*MANTRA\*\*|$)/i)
		const synthesis = synthesisMatch ? synthesisMatch[1].trim() : ""

		// Synthesis Depth Check
		// PRODUCTION HARDENING: Synthesis must contain structural outcomes (e.g. 'hardened', 'refined', 'migrated')
		const isShallowSynthesis =
			synthesis.length < 60 ||
			synthesis.includes("[Summary of hardening applied]") ||
			!/(hardened|refined|migrated|aligned|interdicted|harden|refine)/i.test(synthesis)

		if (!hasMantra || isShallowSynthesis) {
			if (!hasMantra) {
				missingMarkers.push("Double Down MANTRA")
				diagnosticHints.push("💡 The mandatory Double Down MANTRA is missing or incorrect.")
			}
			if (isShallowSynthesis) {
				missingMarkers.push("Synthesis (Sovereign Summary)")
				diagnosticHints.push(
					"💡 Your Synthesis block is too shallow. Provide a substantive summary (min 60 chars) of specific structural hardening or refactoring outcomes (use keywords like 'hardened', 'refined', etc.).",
				)
			}
		}

		if (missingMarkers.length > 0) {
			let report = "⚠️ SOVEREIGN QUALITY AUDIT: FAILED\n"
			report += `**Missing/Inferior Components:**\n${missingMarkers.map((m) => `- ${m}`).join("\n")}\n\n`
			report += `**Diagnostic Hints:**\n${diagnosticHints.join("\n")}\n\n`
			report +=
				"You MUST deeply investigate all three probes and cite evidence in `scratchpad.md` before the planning phase can conclude."
			return { ok: false, report, synthesis }
		}

		return {
			ok: true,
			report: "✅ SOVEREIGN QUALITY AUDIT: PASSED\nArchitectural integrity verified. You may now proceed with `plan_mode_respond`.",
			synthesis,
		}
	},
}
