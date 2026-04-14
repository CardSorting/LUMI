import * as fs from "node:fs"
import * as path from "node:path"
import { DietCodeDefaultTool } from "@/shared/tools"

export interface SovereignAuditResult {
	ok: boolean
	report: string
	synthesis?: string
}

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
			const msg = history[i] as { role?: string; content?: any }
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					const b = block as { type: string; name?: string; input?: any }
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
	 * Validates the scratchpad content against Sovereign V6 standards.
	 */
	async validate(content: string, cwd: string): Promise<SovereignAuditResult> {
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
		const pathRegex = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+|[a-zA-Z0-9_\-.]+\.ts|[a-zA-Z0-9_\-.]+\.js/g
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
					const absolutePath = path.isAbsolute(sanitizedPath) ? sanitizedPath : path.join(cwd, sanitizedPath)
					if (!fs.existsSync(absolutePath)) {
						nonExistentPaths.push(sanitizedPath)
					}
				}
			}

			const isPlaceholder =
				probeContent.includes("[Where is the boundary weakest?]") ||
				probeContent.includes("[Which assumption is most dangerous?]") ||
				probeContent.includes("[What happens during partial failure?]")

			if (probeContent.length < 40 || paths.length === 0 || isPlaceholder || nonExistentPaths.length > 0) {
				missingMarkers.push(`${probe.name} (Quality Check)`)
				if (probeContent.length < 40)
					diagnosticHints.push(`💡 ${probe.name}: Analysis is too brief. Be more descriptive.`)
				if (paths.length === 0)
					diagnosticHints.push(`💡 ${probe.name}: Cite specific file paths or code segments as evidence.`)
				if (nonExistentPaths.length > 0)
					diagnosticHints.push(
						`💡 ${probe.name}: Hallucination detected! The following paths do not exist: ${nonExistentPaths.join(", ")}`,
					)
				if (isPlaceholder)
					diagnosticHints.push(`💡 ${probe.name}: Remove template placeholders and replace with real investigation.`)
			}
		}

		// 4. Check Final Resolution sections
		const hasMantra = content.toLowerCase().includes("double down on this concept")
		const synthesisMatch = content.match(/- \*\*Synthesis\*\*: ([\s\S]+?)(?=\n- \*\*MANTRA\*\*|$)/i)
		const synthesis = synthesisMatch ? synthesisMatch[1].trim() : ""

		// Synthesis Depth Check
		const isShallowSynthesis =
			synthesis.length < 40 ||
			synthesis.includes("[Summary of hardening applied]") ||
			/hardened the (plan|logic|code)/i.test(synthesis)

		if (!hasMantra || isShallowSynthesis) {
			if (!hasMantra) {
				missingMarkers.push("Double Down MANTRA")
				diagnosticHints.push("💡 The mandatory Double Down MANTRA is missing or incorrect.")
			}
			if (isShallowSynthesis) {
				missingMarkers.push("Synthesis (Hardened Summary)")
				diagnosticHints.push(
					"💡 Your Synthesis block must be a unique, substantive summary of specific hardening actions (min 40 chars).",
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
