export interface DietCodeRecommendedModel {
	id: string
	name: string
	description: string
	tags: string[]
}

export interface DietCodeRecommendedModelsData {
	recommended: DietCodeRecommendedModel[]
	free: DietCodeRecommendedModel[]
}

/**
 * Hardcoded fallback shown when upstream recommended models are not enabled or unavailable.
 */
export const DIETCODE_RECOMMENDED_MODELS_FALLBACK: DietCodeRecommendedModelsData = {
	recommended: [
		{
			id: "anthropic/claude-opus-4.7",
			name: "Anthropic Claude Opus 4.7",
			description: "Our most capable generally available model for complex reasoning and agentic coding",
			tags: ["NEW", "BEST"],
		},
		{
			id: "google/gemini-3.1-pro-preview",
			name: "Google Gemini 3.1 Pro Preview",
			description: "Latest Gemini release with 1m ctx window and strong coding performance",
			tags: ["NEW"],
		},
		{
			id: "anthropic/claude-sonnet-4.6",
			name: "Anthropic Claude Sonnet 4.6",
			description: "The best combination of speed and intelligence",
			tags: ["NEW"],
		},
		{
			id: "anthropic/claude-opus-4.6",
			name: "Anthropic Claude Opus 4.6",
			description: "Most intelligent model for agents and coding",
			tags: ["BEST"],
		},
		{
			id: "openai/gpt-5.3-codex",
			name: "OpenAI GPT-5.3 Codex",
			description: "OpenAI's latest with strong coding abilities",
			tags: ["NEW"],
		},
	],
	free: [
		{
			id: "kwaipilot/kat-coder-pro",
			name: "KwaiKAT Kat Coder Pro",
			description: "KwaiKAT's most advanced agentic coding model in the KAT-Coder series",
			tags: ["FREE"],
		},
		{
			id: "arcee-ai/trinity-large-preview:free",
			name: "Arcee AI Trinity Large Preview",
			description: "Arcee AI's advanced large preview model in the Trinity series",
			tags: ["FREE"],
		},
	],
}

export const CLINE_RECOMMENDED_MODELS_FALLBACK = DIETCODE_RECOMMENDED_MODELS_FALLBACK
