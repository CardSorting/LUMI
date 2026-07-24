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
			return this.getFallbackClassification(requestText)
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
		const cleaned = text
			.replace(/```json/gi, "")
			.replace(/```/g, "")
			.trim()
		const match = cleaned.match(/\{[\s\S]*\}/)
		return JSON.parse(match ? match[0] : cleaned)
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

	public getFallbackClassification(requestText = ""): ProductProblemClassification {
		const lower = requestText.toLowerCase()
		const problems: ProductProblemClassification["problems"] = []

		if (
			lower.includes("accessibility") ||
			lower.includes("aria") ||
			lower.includes("screen reader") ||
			lower.includes("keyboard")
		) {
			problems.push({
				id: "prob-fallback-1",
				dimension: "accessibility",
				target: "General UI",
				observation: "Accessibility or screen reader compliance requires auditing",
				userImpact: "Assisted tech users experience barriers",
				evidence: [requestText],
				severity: "high",
				confidence: "medium",
			})
		}

		if (
			lower.includes("visual") ||
			lower.includes("style") ||
			lower.includes("color") ||
			lower.includes("theme") ||
			lower.includes("layout")
		) {
			problems.push({
				id: "prob-fallback-2",
				dimension: "visual-hierarchy",
				target: "General UI",
				observation: "Visual structure, spacing, or visual hierarchy needs refinement",
				userImpact: "Visual scanning efficiency is impaired",
				evidence: [requestText],
				severity: "medium",
				confidence: "medium",
			})
		}

		if (
			lower.includes("click") ||
			lower.includes("hover") ||
			lower.includes("state") ||
			lower.includes("modal") ||
			lower.includes("button")
		) {
			problems.push({
				id: "prob-fallback-3",
				dimension: "interaction",
				target: "Interactive Components",
				observation: "Interaction state feedback or control response needs auditing",
				userImpact: "User action feedback is ambiguous",
				evidence: [requestText],
				severity: "medium",
				confidence: "medium",
			})
		}

		// Default baseline problem if no keyword matched
		if (problems.length === 0) {
			problems.push({
				id: "prob-fallback-0",
				dimension: "workflow",
				target: "General Area",
				observation: "Overall experience workflow structure needs optimization",
				userImpact: "Workflow clarity and efficiency can be improved",
				evidence: [requestText],
				severity: "medium",
				confidence: "medium",
			})
		}

		return {
			problems,
			preservedStrengths: ["Existing design system foundation"],
			insufficientEvidence: [],
		}
	}
}
