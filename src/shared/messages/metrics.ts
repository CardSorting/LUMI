import { Mode } from "../storage/types"

export interface DietCodeMessageModelInfo {
	modelId: string
	providerId: string
	mode: Mode
}

interface DietCodeTokensInfo {
	prompt: number // Total input tokens (includes cached + non-cached)
	completion: number // Total output tokens
	cached: number // Subset of prompt_tokens that were cache hits
}

export interface DietCodeMessageMetricsInfo {
	tokens?: DietCodeTokensInfo
	cost?: number // Monetary cost for this turn
}
