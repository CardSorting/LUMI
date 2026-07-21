import { ApiHandler } from "@/core/api"
import { Logger } from "@/shared/services/Logger"
import { ProductProblemClassification, ProductProblemDimension } from "./types"

export class ProblemClassifier {
	constructor(private readonly api: ApiHandler) {}

	public async classify(requestText: string, codebaseContext: string): Promise<ProductProblemClassification> {
		const systemPrompt = `You are a product critic and auditor. Analyze the user's design request and the codebase context.
Categorize the problems into the following dimensions if applicable:
- "product-strategy"
- "information-architecture"
- "workflow"
- "interaction"
- "system-status"
- "visual-hierarchy"
- "content"
- "design-system"
- "accessibility"
- "responsive-design"
- "implementation-quality"
- "agentic-control"
- "generative-workflow"
- "cross-surface-consistency"

Output a JSON object that strictly adheres to the following ProductProblemClassification schema:

interface ClassifiedProductProblem {
  id: string; // unique short ID like "prob-1", "prob-2"
  dimension: ProductProblemDimension;
  target: string; // target file, component or area
  observation: string;
  userImpact: string;
  evidence: string[]; // specific lines, file names or behaviors
  severity: "critical" | "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
}

interface ProductProblemClassification {
  problems: ClassifiedProductProblem[];
  preservedStrengths: string[];
  insufficientEvidence: string[];
}

Respond ONLY with the raw JSON object. Do not wrap in markdown or include explanations.`

		const userMessage = `User request: ${requestText}
Codebase Context: ${codebaseContext}`

		Logger.info("[MoD] Classifying product problems...")

		try {
			const response = await this.queryLLM(systemPrompt, userMessage)
			const json = this.parseJsonFromResponse(response)
			return this.sanitizeClassification(json)
		} catch (error) {
			Logger.warn("[MoD] Failed to classify problems, using fallback", error)
			return this.getFallbackClassification()
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

	private parseJsonFromResponse(text: string): any {
		const match = text.match(/\{[\s\S]*\}/)
		if (match) {
			return JSON.parse(match[0])
		}
		return JSON.parse(text)
	}

	private sanitizeClassification(json: any): ProductProblemClassification {
		const problems = Array.isArray(json.problems)
			? json.problems.map((p: any, idx: number) => ({
					id: p.id || `prob-${idx + 1}`,
					dimension: (p.dimension || "workflow") as ProductProblemDimension,
					target: p.target || "General",
					observation: p.observation || "General issue",
					userImpact: p.userImpact || "User experience issue",
					evidence: Array.isArray(p.evidence) ? p.evidence : [],
					severity: (["critical", "high", "medium", "low"].includes(p.severity) ? p.severity : "medium") as any,
					confidence: (["high", "medium", "low"].includes(p.confidence) ? p.confidence : "medium") as any,
				}))
			: []

		return {
			problems,
			preservedStrengths: Array.isArray(json.preservedStrengths) ? json.preservedStrengths : [],
			insufficientEvidence: Array.isArray(json.insufficientEvidence) ? json.insufficientEvidence : [],
		}
	}

	private getFallbackClassification(): ProductProblemClassification {
		return {
			problems: [],
			preservedStrengths: [],
			insufficientEvidence: [],
		}
	}
}
