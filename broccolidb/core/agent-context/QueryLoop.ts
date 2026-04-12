import type { ServiceContext, MemoryMessage } from './types.js';
import { TokenService } from './TokenService.js';
import { CompactService } from './CompactService.js';
import { SovereignPolicy } from './SovereignPolicy.js';

export interface QueryState {
  messages: MemoryMessage[];
  turnCount: number;
  tokensUsed: number;
  status: 'active' | 'completed' | 'failed' | 'compacting';
}

/**
 * QueryLoop orchestrates the autonomous execution of an agentic turn.
 * Ported and hardened from src/query.ts.
 */
export class QueryLoop {
  private state: QueryState;
  private compactor: CompactService;

  constructor(private ctx: ServiceContext, initialMessages: MemoryMessage[]) {
    this.state = {
      messages: initialMessages,
      turnCount: 0,
      tokensUsed: TokenService.countTokensWithEstimation(initialMessages),
      status: 'active',
    };
    this.compactor = new CompactService(ctx);
  }

  /**
   * Runs the autonomous query loop until completion or max turns reached.
   */
  async* run(maxTurns: number = 20): AsyncGenerator<string, QueryState> {
    while (this.state.turnCount < maxTurns && this.state.status === 'active') {
      this.state.turnCount++;
      
      // 1. Adaptive Compaction Check (Phase 2 core)
      const compaction = await this.compactor.compactHistory(this.state.messages);
      if (compaction) {
        this.ctx.mailbox.postStatus(this.ctx.userId, 'compacting');
        const { summary, keptMessages } = compaction;
        
        // Truncate history and prepend summary
        this.state.messages = [
          { role: 'system', content: this.compactor.formatCompactNotification(summary), timestamp: Date.now() },
          ...keptMessages
        ];
        this.state.tokensUsed = TokenService.countTokensWithEstimation(this.state.messages);
        yield `[QueryLoop] ✂️  Context compacted at turn ${this.state.turnCount}.`;
      }

      // 2. AI Completion
      yield `[QueryLoop] 🧠 Calling AI (Turn ${this.state.turnCount})...`;
      
      const response = await this.ctx.aiService?.completeOneOff(
        this.state.messages[this.state.messages.length - 1].content,
        {
          model: 'sonnet' as any,
          maxTokens: 4000,
          system: SovereignPolicy.SPIDER_THEORY.CORE_DIRECTIVE // Synthesis over lazy delegation
        }
      );

      if (!response) {
        this.state.status = 'failed';
        throw new Error('[QueryLoop] 💥 AI Service returned null response.');
      }

      const assistantMessage: MemoryMessage = {
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
      };
      
      this.state.messages.push(assistantMessage);
      this.state.tokensUsed += TokenService.roughTokenCountEstimation(response.text);

      yield `[Assistant] ${response.text.slice(0, 100)}...`;

      // 3. Tool Execution Handling (Simplified Port)
      // In a real port, we'd use a StreamingToolExecutor to parse XML/JSON tool calls.
      // For Broccolidb's Sovereign Swarm, we treat completion as the turn end unless workers are spawned.
      
      if (response.text.includes('<spawnWorker>') || response.text.includes('spawnWorker(')) {
          yield `[QueryLoop] 🐝 Worker spawn detected in output. Proceeding to task coordination.`;
          // Task coordination logic would live here, calling CoordinatorService.
      } else {
          this.state.status = 'completed';
      }
    }

    if (this.state.turnCount >= maxTurns) {
      this.state.status = 'failed';
      yield `[QueryLoop] ⚠️  Maximum turn limit (${maxTurns}) reached.`;
    }

    return this.state;
  }

  public getState(): QueryState {
    return this.state;
  }
}
