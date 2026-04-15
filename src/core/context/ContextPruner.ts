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
	 * PRODUCTION HARDENING: "Architectural Anchors" — guarantees that [LAYER] tags,
	 * exports, and interface definitions are never folded out.
	 */
	private pruneTextBlock(block: DietCodeTextContentBlock): DietCodeTextContentBlock {
		const lines = block.text.split("\n")

		if (lines.length <= this.config.maxLines) {
			return block
		}

		// 1. Identify Architectural Anchors (High-Fidelity Context)
		// v9 HARDENING: Skeleton Pruning — ensuring API surface is always visible.
		const anchors: { line: string; index: number }[] = []
		const anchorPatterns = [
			/\[LAYER:\s*[^\]]+\]/i,
			/export\s+(?:interface|class|type|function|const|enum)/,
			/import\s+.*from/,
			/public\s+.*\(.*\)/, // Method signatures
			/private\s+.*\(.*\)/, // Internal contracts
			/protected\s+.*\(.*\)/,
			/constructor\s*\(.*\)/,
			/interface\s+\w+\s*{/, // Interface start
			/type\s+\w+\s*=/,
		]

		for (let i = 0; i < lines.length; i++) {
			if (anchorPatterns.some((p) => p.test(lines[i]))) {
				anchors.push({ line: lines[i], index: i })
			}
		}

		const headSize = Math.floor(this.config.maxLines * this.config.headRatio)
		const tailSize = Math.floor(this.config.maxLines * this.config.tailRatio)

		// 2. Build Intelligent Head/Tail while protecting anchors
		const preservedHeadIndices = new Set<number>()
		const preservedTailIndices = new Set<number>()

		// Fill standard head/tail
		for (let i = 0; i < headSize; i++) preservedHeadIndices.add(i)
		for (let i = lines.length - tailSize; i < lines.length; i++) preservedTailIndices.add(i)

		// v9 HARDENING: ALL anchors are now protected from pruning to maintain "Skeleton" visibility
		anchors.forEach((a) => {
			if (a.index < lines.length / 2) {
				preservedHeadIndices.add(a.index)
			} else {
				preservedTailIndices.add(a.index)
			}
		})

		const head = Array.from(preservedHeadIndices)
			.sort((a, b) => a - b)
			.map((i) => lines[i])
			.join("\n")
		const tail = Array.from(preservedTailIndices)
			.sort((a, b) => a - b)
			.map((i) => lines[i])
			.join("\n")

		const foldedCount = lines.length - preservedHeadIndices.size - preservedTailIndices.size

		const prunedText = `${head}\n\n... [JOY-ZONING: ${foldedCount} lines folded for cognitive focus — Architectural Anchors Preserved] ...\n\n${tail}`

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
