import { ApiHandler } from "@/core/api"
import { Logger } from "@/shared/services/Logger"
import { ProductDesignIntent } from "./types"

export class IntentAnalyzer {
	constructor(private readonly api: ApiHandler) {}

	public async analyze(requestText: string, codebaseContext: string): Promise<ProductDesignIntent> {
		const systemPrompt = `You are a product designer and strategist. Analyze the user's request and the codebase context.
Output a JSON object that strictly adheres to the following ProductDesignIntent schema:

interface ProductDesignIntent {
  request: {
    originalRequest: string;
    interpretedGoal: string;
    explicitRequirements: string[];
    implicitRequirements: string[];
  };
  product: {
    productArea: string;
    productPurpose: string;
    targetUsers: string[];
    userExperienceLevels: Array<"new" | "returning" | "advanced">;
    primaryJobs: string[];
    secondaryJobs: string[];
  };
  currentExperience: {
    workflow: string[];
    strengths: string[];
    weaknesses: string[];
    frictionPoints: string[];
    existingPatterns: string[];
    unresolvedQuestions: string[];
  };
  constraints: {
    technical: string[];
    product: string[];
    brand: string[];
    accessibility: string[];
    performance: string[];
    platform: string[];
  };
  boundaries: {
    preserve: string[];
    allowedToChange: string[];
    outOfScope: string[];
  };
  success: {
    desiredOutcomes: string[];
    measurableSignals: string[];
    qualitativeSignals: string[];
    failureConditions: string[];
  };
}

Respond ONLY with the raw JSON object. Do not wrap in markdown or include explanations.`

		const userMessage = `User request: ${requestText}
Codebase Context: ${codebaseContext}`

		Logger.info("[MoD] Analyzing product design intent...")

		try {
			const response = await this.queryLLM(systemPrompt, userMessage)
			const json = this.parseJsonFromResponse(response)
			return this.sanitizeIntent(json, requestText)
		} catch (error) {
			Logger.warn("[MoD] Failed to analyze intent, using fallback", error)
			return this.getFallbackIntent(requestText)
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

	private sanitizeIntent(json: any, requestText: string): ProductDesignIntent {
		return {
			request: {
				originalRequest: json.request?.originalRequest || requestText,
				interpretedGoal: json.request?.interpretedGoal || requestText,
				explicitRequirements: Array.isArray(json.request?.explicitRequirements) ? json.request.explicitRequirements : [],
				implicitRequirements: Array.isArray(json.request?.implicitRequirements) ? json.request.implicitRequirements : [],
			},
			product: {
				productArea: json.product?.productArea || "Main Area",
				productPurpose: json.product?.productPurpose || "Core Feature",
				targetUsers: Array.isArray(json.product?.targetUsers) ? json.product.targetUsers : ["general"],
				userExperienceLevels: Array.isArray(json.product?.userExperienceLevels)
					? json.product.userExperienceLevels.filter((l: string) => ["new", "returning", "advanced"].includes(l))
					: ["returning"],
				primaryJobs: Array.isArray(json.product?.primaryJobs) ? json.product.primaryJobs : [],
				secondaryJobs: Array.isArray(json.product?.secondaryJobs) ? json.product.secondaryJobs : [],
			},
			currentExperience: {
				workflow: Array.isArray(json.currentExperience?.workflow) ? json.currentExperience.workflow : [],
				strengths: Array.isArray(json.currentExperience?.strengths) ? json.currentExperience.strengths : [],
				weaknesses: Array.isArray(json.currentExperience?.weaknesses) ? json.currentExperience.weaknesses : [],
				frictionPoints: Array.isArray(json.currentExperience?.frictionPoints)
					? json.currentExperience.frictionPoints
					: [],
				existingPatterns: Array.isArray(json.currentExperience?.existingPatterns)
					? json.currentExperience.existingPatterns
					: [],
				unresolvedQuestions: Array.isArray(json.currentExperience?.unresolvedQuestions)
					? json.currentExperience.unresolvedQuestions
					: [],
			},
			constraints: {
				technical: Array.isArray(json.constraints?.technical) ? json.constraints.technical : [],
				product: Array.isArray(json.constraints?.product) ? json.constraints.product : [],
				brand: Array.isArray(json.constraints?.brand) ? json.constraints.brand : [],
				accessibility: Array.isArray(json.constraints?.accessibility) ? json.constraints.accessibility : [],
				performance: Array.isArray(json.constraints?.performance) ? json.constraints.performance : [],
				platform: Array.isArray(json.constraints?.platform) ? json.constraints.platform : [],
			},
			boundaries: {
				preserve: Array.isArray(json.boundaries?.preserve) ? json.boundaries.preserve : [],
				allowedToChange: Array.isArray(json.boundaries?.allowedToChange) ? json.boundaries.allowedToChange : [],
				outOfScope: Array.isArray(json.boundaries?.outOfScope) ? json.boundaries.outOfScope : [],
			},
			success: {
				desiredOutcomes: Array.isArray(json.success?.desiredOutcomes) ? json.success.desiredOutcomes : [],
				measurableSignals: Array.isArray(json.success?.measurableSignals) ? json.success.measurableSignals : [],
				qualitativeSignals: Array.isArray(json.success?.qualitativeSignals) ? json.success.qualitativeSignals : [],
				failureConditions: Array.isArray(json.success?.failureConditions) ? json.success.failureConditions : [],
			},
		}
	}

	private getFallbackIntent(requestText: string): ProductDesignIntent {
		return {
			request: {
				originalRequest: requestText,
				interpretedGoal: requestText,
				explicitRequirements: [requestText],
				implicitRequirements: [],
			},
			product: {
				productArea: "Main Area",
				productPurpose: "Core workflow",
				targetUsers: ["returning"],
				userExperienceLevels: ["returning"],
				primaryJobs: ["Use features"],
				secondaryJobs: [],
			},
			currentExperience: {
				workflow: [],
				strengths: [],
				weaknesses: [],
				frictionPoints: [],
				existingPatterns: [],
				unresolvedQuestions: [],
			},
			constraints: {
				technical: [],
				product: [],
				brand: [],
				accessibility: [],
				performance: [],
				platform: [],
			},
			boundaries: {
				preserve: [],
				allowedToChange: [],
				outOfScope: [],
			},
			success: {
				desiredOutcomes: [],
				measurableSignals: [],
				qualitativeSignals: [],
				failureConditions: [],
			},
		}
	}
}
