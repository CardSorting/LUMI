import { DietCodeContent, DietCodeTextContentBlock } from "@/shared/messages/content"

/**
 * ContextPruner: Manages cognitive economy by pruning or "folding" large text attachments.
 * Prevents context window saturation and maintains high-density architectural focus.
 */
export interface PrunerConfig {
	maxLines: number
	headRatio: number
	tailRatio: number
	enabled: boolean
}

export class ContextPruner {
	private config: PrunerConfig

	constructor(config: Partial<PrunerConfig> = {}) {
		this.config = {
			maxLines: config.maxLines ?? 200,
			headRatio: config.headRatio ?? 0.6,
			tailRatio: config.tailRatio ?? 0.3,
			enabled: config.enabled ?? true,
		}
	}

	/**
	 * Intelligently prunes a list of content blocks.
	 */
	public prune(content: DietCodeContent[]): DietCodeContent[] {
		if (!this.config.enabled) return content

		return content.map((block) => {
			if (block.type === "text") {
				return this.pruneTextBlock(block)
			}
			return block
		})
	}

	/**
	 * Folds a text block if it exceeds the line limit.
	 */
	private pruneTextBlock(block: DietCodeTextContentBlock): DietCodeTextContentBlock {
		const lines = block.text.split("\n")

		if (lines.length <= this.config.maxLines) {
			return block
		}

		const headSize = Math.floor(this.config.maxLines * this.config.headRatio)
		const tailSize = Math.floor(this.config.maxLines * this.config.tailRatio)

		const head = lines.slice(0, headSize).join("\n")
		const tail = lines.slice(-tailSize).join("\n")
		const foldedCount = lines.length - headSize - tailSize

		const prunedText = `${head}\n\n... [JOY-ZONING: ${foldedCount} lines folded for cognitive focus] ...\n\n${tail}`

		return {
			...block,
			text: prunedText,
			// Metadata for tracking the fold
			// @ts-expect-error
			_folded: {
				originalLineCount: lines.length,
				foldedCount: foldedCount,
			},
		}
	}
}
