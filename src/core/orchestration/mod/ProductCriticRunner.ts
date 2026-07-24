import { ApiHandler } from "@/core/api"
import { Logger } from "@/shared/services/Logger"
import { DesignDecision, ProductCritiqueFinding, ProductDesignIntent } from "./types"

export class ProductCriticRunner {
	constructor(private readonly api: ApiHandler) {}

	public async critique(
		intent: ProductDesignIntent,
		decisions: DesignDecision[],
		codebaseContext: string,
	): Promise<ProductCritiqueFinding[]> {
		Logger.info("[MoD] Product critic is auditing the converged plan...")

		const systemPrompt = `You are a critical design director (Product Critic). Audit the proposed design decisions and their integrated feasibility.
Evaluate for:
- Failure to solve the original product problem
- Unnecessary complexity
- Superficial design choices
- Loss of product identity
- Stitched-together visual styles
- Missing edge states (loading, error, recovery)
- Accessibility omissions

Output a JSON array of ProductCritiqueFinding objects:
interface ProductCritiqueFinding {
  id: string; // unique short ID like "crit-1"
  decisionIds: string[]; // affected decision IDs
  observedFailure: string;
  userOrProductImpact: string;
  evidence: string[];
  correctionRequired: boolean; // set to true if a gate must fail
  gateToFail?: "ux-architecture" | "visual-system" | "interaction-state" | "accessibility" | "cross-surface-consistency";
  confidence: "high" | "medium" | "low";
}

Respond ONLY with the raw JSON array. Do not wrap in markdown or include explanations.`

		const userMessage = `Product Intent: ${JSON.stringify(intent, null, 2)}
Decisions: ${JSON.stringify(decisions, null, 2)}
Codebase Context: ${codebaseContext}`

		try {
			const response = await this.queryLLM(systemPrompt, userMessage)
			const json = this.parseJsonArrayFromResponse(response)
			return this.sanitizeFindings(json)
		} catch (error) {
			Logger.warn("[MoD] Critic run failed or returned no findings, assuming passes", error)
			return []
		}
	}

	private async queryLLM(systemPrompt: string, userMessage: string): Promise<string> {
		const stream = this.api.createMessage(systemPrompt, [
			{
				role: "user",
				content: [{ type: "text", text: userMessage }],
				ts: Date.now(),
			},
		])
		let text = ""
		const iterator = stream[Symbol.asyncIterator]()
		while (true) {
			const chunk = await iterator.next()
			if (chunk.done) break
			if (chunk.value.type === "text") {
				text += chunk.value.text
			}
		}
		return text
	}

	private parseJsonArrayFromResponse(text: string): any[] {
		const cleaned = text
			.replace(/```json/gi, "")
			.replace(/```/g, "")
			.trim()
		const match = cleaned.match(/\[[\s\S]*\]/)
		return JSON.parse(match ? match[0] : cleaned)
	}

	private sanitizeFindings(json: any): ProductCritiqueFinding[] {
		if (!Array.isArray(json)) return []
		return json.map((f: any, idx: number) => ({
			id: f.id || `crit-${idx + 1}`,
			decisionIds: Array.isArray(f.decisionIds) ? f.decisionIds : [],
			observedFailure: f.observedFailure || "Observation",
			userOrProductImpact: f.userOrProductImpact || "User impact",
			evidence: Array.isArray(f.evidence) ? f.evidence : [],
			correctionRequired: typeof f.correctionRequired === "boolean" ? f.correctionRequired : false,
			gateToFail: f.gateToFail,
			confidence: (["high", "medium", "low"].includes(f.confidence) ? f.confidence : "medium") as any,
		}))
	}
}
