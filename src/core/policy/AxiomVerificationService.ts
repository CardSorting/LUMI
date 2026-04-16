import { DietCodeDefaultTool } from "@shared/tools"
import * as path from "path"
import { isLayerTagSupported } from "@/utils/joy-zoning"
import { ToolUse } from "../assistant-message"
import { PathogenStore } from "../integrity/PathogenStore"
import { SemanticAxiomEngine } from "./SemanticAxiomEngine"
import { SovereignForensics } from "./SovereignForensics"
import { SpiderEngine } from "./spider/SpiderEngine"

export interface VerificationResult {
	success: boolean
	error?: string
	warning?: string
}

/**
 * AxiomVerificationService: The Architectural Gatekeeper.
 * Encapsulates the logic for validating tool context, layer alignment, and axiomatic integrity.
 */
export class AxiomVerificationService {
	constructor(
		private cwd: string,
		private spiderEngine: SpiderEngine,
		private axiomEngine: SemanticAxiomEngine,
		private pathogens: PathogenStore,
		private forensics: SovereignForensics,
	) {}

	/**
	 * Returns proactive architectural guidance for a given file's layer.
	 */
	public getFileLayerContext(filePath: string, layer: string): string {
		const fileName = path.basename(filePath)
		switch (layer) {
			case "domain":
				return `📍 ${fileName} → DOMAIN layer\n  ✅ Pure business logic, models, rules, value objects\n  🚫 No I/O, no external imports, no side effects`
			case "core":
				return `📍 ${fileName} → CORE layer\n  ✅ Orchestration, task coordination, prompt assembly\n  🚫 Avoid raw I/O — delegate to Infrastructure adapters`
			case "infrastructure":
				return `📍 ${fileName} → INFRASTRUCTURE layer\n  ✅ Adapters, API clients, persistence, external services\n  🚫 No business rules (keep those in Domain)`
			default:
				return `📍 ${fileName} → ${layer.toUpperCase()} layer\n  ✅ Respect established layer boundaries.`
		}
	}

	/**
	 * Generates a concise, actionable correction hint for architectural violations.
	 */
	public getCorrectionHint(errors: string[], filePath?: string, layer?: string): string {
		const fixes: string[] = []
		const snippets: string[] = []
		const supportsTags = filePath ? isLayerTagSupported(filePath) : true

		for (const err of errors) {
			if ((err.includes("tag") || err.includes("Missing mandatory")) && supportsTags) {
				const currentLayer = (layer || "DOMAIN").toUpperCase()
				fixes.push(`Add a mandatory [LAYER: ${currentLayer}] tag to the file header.`)
				snippets.push(`/**\n * [LAYER: ${currentLayer}]\n */`)
			} else if (err.includes("Geographic Misalignment")) {
				fixes.push("Move the file to the physical directory that matches its declared [LAYER] tag.")
			} else if (err.includes("relative navigation")) {
				fixes.push("Flatten the project structure or use '@/' aliases to avoid deep relative imports (max 3 levels).")
				snippets.push("import { ... } from '@/core/logic'")
			} else if (err.includes("circular") || err.includes("Circular Dependency")) {
				fixes.push(
					"Break the circular dependency by extracting shared logic to a lower layer (Plumbing) or using Dependency Inversion.",
				)
				snippets.push("// Pattern: Extract shared state/logic to src/plumbing/shared-utils.ts")
			} else if (err.includes("Sovereign Leak") || err.includes("DEPENDENCY_INVERSION")) {
				fixes.push("Domain/Core logic cannot depend on concrete Infrastructure. Extract an interface.")
				snippets.push("export interface IService { sync(): Promise<void>; }")
			} else {
				fixes.push("Review the violation and restructure accordingly.")
			}
		}

		const uniqueFixes = [...new Set(fixes)]
		let response = `💡 How to fix:\n${uniqueFixes.map((f) => `  → ${f}`).join("\n")}`
		if (snippets.length > 0) {
			response += `\n\n📝 Suggested Code:\n${snippets.map((s) => `\`\`\`typescript\n${s}\n\`\`\``).join("\n")}`
		}
		return response
	}

	/**
	 * Performs a deep forensic check of a proposed edit against semantic axioms.
	 */
	public async checkAxioms(filePath: string, content: string): Promise<string[]> {
		const currentViolations = this.axiomEngine.validateAxioms(filePath, content, this.spiderEngine)
		return currentViolations.map((v) => `[AXIOM: ${v.axiom}] ${v.message}\n   -> Remediation: ${v.remediation}`)
	}

	/**
	 * Detects pathogens in the violation list.
	 */
	public detectPathogens(violations: string[]): string[] {
		return violations.filter((v) => this.pathogens.isPathogenic(v))
	}

	/**
	 * V150: Checks for axiomatic drift between original and proposed content.
	 */
	public calculateAxiomaticDrift(
		filePath: string,
		content: string,
	): { status: "POSITIVE" | "ZERO_SUM" | "NEGATIVE"; message?: string } {
		const node = this.spiderEngine.nodes.get(this.spiderEngine.normalizePath(filePath))
		if (!node) return { status: "POSITIVE" }

		const newViolations = this.axiomEngine.validateAxioms(filePath, content, this.spiderEngine)
		const oldViolations = this.spiderEngine.getViolations().filter((v) => v.path === path.resolve(this.cwd, filePath))

		const oldAxiomMapped = oldViolations.map((v) => ({
			axiom: v.id,
			severity: (v.severity === "INFO" ? "WARN" : v.severity) as "WARN" | "ERROR",
			message: v.message,
		}))

		return this.axiomEngine.compareAxiomSessions(oldAxiomMapped, newViolations)
	}

	/**
	 * V30: Harmonic Audit Inheritance.
	 */
	public isImplicitlyAudited(filePath: string, scratchpadContent: string, block?: ToolUse): boolean {
		const absolutePath = path.resolve(this.cwd, filePath)

		if (scratchpadContent.includes("# SOVEREIGN_AGILE")) return true

		// 1. Directory-level coverage
		const pathRegexp = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+(?:\/|$)/g
		const citedPaths = Array.from(scratchpadContent.matchAll(pathRegexp)).map((m) => m[0])
		const isCoveredByDir = citedPaths.some((p) => absolutePath.includes(p))
		if (isCoveredByDir) return true

		// 2. Aesthetic Agility (V34)
		if (block?.name === DietCodeDefaultTool.FILE_EDIT || block?.name === DietCodeDefaultTool.APPLY_PATCH) {
			const params = block.params as {
				targetContent?: string
				TargetContent?: string
				replacementContent?: string
				ReplacementContent?: string
			}
			const target = params.targetContent || params.TargetContent
			const replacement = params.replacementContent || params.ReplacementContent

			if (target && replacement) {
				const targetHash = this.forensics.computeStructuralHash(target)
				const replacementHash = this.forensics.computeStructuralHash(replacement)
				if (targetHash === replacementHash) {
					return true
				}
			}
		}

		// 3. Terminal Node Agility (Leaf nodes)
		const node = this.spiderEngine.nodes.get(this.spiderEngine.normalizePath(filePath))
		if (node && node.dependents.length === 0) {
			return true
		}

		return false
	}

	/**
	 * V18: Detects if the proposed tool execution is an attempt to heal known architectural violations.
	 */
	public detectHealingIntent(block: ToolUse): string | null {
		const content = (block.params as { content?: string })?.content || ""
		if (!content) return null

		const violations = this.spiderEngine.getViolations()
		for (const v of violations) {
			if (!v.remediation) continue

			// Match suggested import lines
			const importMatch = v.remediation.match(/Suggested Import: (.*)/)
			if (importMatch && content.includes(importMatch[1])) {
				return `Resolved Ghost: ${v.message}`
			}

			// Match explicit intention markers or remediation keywords
			if (content.includes("#HEAL") || content.includes("[HEALING]")) {
				return "Explicit Healing Intention"
			}
		}

		return null
	}
}
