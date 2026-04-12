import type { ServiceContext, MemoryMessage } from './types.js';
import { TokenService } from './TokenService.js';

export interface CompactMetadata {
  preservedSegment?: {
    headUuid: string;
    anchorUuid: string;
    tailUuid: string;
  };
  preCompactTokenCount?: number;
}

/**
 * CompactService provides history truncation and context-window scaling.
 * Absorbed and hardened from src/services/compact/compact.ts.
 * Implements "Snipping" - summarizing old messages while preserving recent context.
 */
export class CompactService {
  // Production constants for context window thresholds.
  private readonly COMPACT_THRESHOLD_PERCENT = 0.8; // Compact at 80% capacity
  private readonly CONTEXT_WINDOW_LIMIT = 200000;   // 200k tokens default
  private readonly TARGET_POST_COMPACT_RATIO = 0.4; // Target 40% usage after compaction

  constructor(private ctx: ServiceContext) {}

  /**
   * Performs a history compaction around an adaptive pivot.
   * Summarizes the "head" and keeps the "tail" matching the target budget.
   */
  async compactHistory(messages: MemoryMessage[]): Promise<{
    summary: string;
    boundaryMetadata: CompactMetadata;
    keptMessages: MemoryMessage[];
  } | null> {
    const currentTokens = TokenService.countTokensWithEstimation(messages);
    
    // Check if we actually need to compact based on token budget.
    if (currentTokens < this.CONTEXT_WINDOW_LIMIT * this.COMPACT_THRESHOLD_PERCENT) {
      return null;
    }

    console.log(`[Compact] ✂️  Context budget exceeded (${currentTokens} tokens). Snipping conversation history...`);

    // Adaptive Pivot: calculate how many messages to keep for the target ratio.
    const targetTokens = this.CONTEXT_WINDOW_LIMIT * this.TARGET_POST_COMPACT_RATIO;
    let keptTokens = 0;
    let pivotIndex = messages.length - 1;

    // Walk backwards to find the pivot that keeps us within the post-compact budget.
    while (pivotIndex >= 0 && keptTokens < targetTokens) {
      keptTokens += TokenService.roughTokenCountEstimation(messages[pivotIndex].content);
      pivotIndex--;
    }

    // Ensure we don't split an API round (user -> assistant -> tool_result series).
    pivotIndex = this.findSafePivot(messages, pivotIndex);

    const toSummarize = messages.slice(0, pivotIndex);
    const keptMessages = messages.slice(pivotIndex);

    const summaryResult = await this.ctx.aiService?.completeOneOff(
      `Precisely summarize the technical context of the following conversation history: \n\n${toSummarize.map(m => `[${m.role}] ${m.content}`).join('\n')}`,
      {
        model: 'sonnet' as any,
        maxTokens: 1000,
        system: 'You are a Sovereign Swarm Compactor. Summarize technical state accurately, focusing on current facts and structural impacts.'
      }
    );

    const summary = summaryResult?.text || 'History summarized for context scaling.';

    const boundaryMetadata: CompactMetadata = {
      preservedSegment: {
        headUuid: (toSummarize[0] as any)?.uuid || messages[0]?.timestamp.toString(),
        anchorUuid: (toSummarize[pivotIndex - 1] as any)?.uuid || 'anchor',
        tailUuid: (keptMessages[keptMessages.length - 1] as any)?.uuid || 'tail',
      },
      preCompactTokenCount: currentTokens,
    };

    console.log(`[Compact] ✅  History snipped. Kept ${keptMessages.length} messages (~${keptTokens} tokens).`);

    return { summary, boundaryMetadata, keptMessages };
  }

  /**
   * Prevents splitting interleaved assistant/user messages from the same round.
   */
  private findSafePivot(messages: MemoryMessage[], pivot: number): number {
    // Basic heuristic: Ensure the first kept message is 'user' so the assistant always has context.
    let index = pivot;
    while (index > 0 && messages[index].role !== 'user') {
      index--;
    }
    return index > 0 ? index : pivot;
  }

  /**
   * Strips images and media blocks from messages before compaction to save tokens.
   */
  stripMedia(content: string): string {
    return content.replace(/!\[.*?\]\(.*?\)/g, '[image]').replace(/<img.*?>/g, '[image]');
  }

  /**
   * Returns a standard system notification that history has been truncated.
   */
  formatCompactNotification(summary: string): string {
    return `[earlier conversation history truncated for context scaling]\n\nSummary of prior state:\n${summary}`;
  }
}
