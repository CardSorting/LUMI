import type { ServiceContext } from './types.js';

export interface SideQueryResult {
  id: string;
  response: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
}

/**
 * SideQueryService provides isolated reasoning threads.
 * Absorbed from src/utils/sideQuery.ts.
 * Used for Intent Classification and constitutional pre-audits.
 */
export class SideQueryService {
  constructor(private ctx: ServiceContext) {}

  /**
   * Executes a one-off completion without conversation history.
   */
  async executeIsolatedReasoning(prompt: string, model?: string): Promise<SideQueryResult> {
    const start = Date.now();
    console.log(`[SideQuery] Spawning isolated reasoning thread...`);

    // In this sovereign implementation, we delegate to the AI Service 
    // but with skipHistory=true and a clean context.
    if (!this.ctx.aiService) {
        throw new Error('[SideQuery] AiService not available in ServiceContext.');
    }

    const response = await this.ctx.aiService.completeOneOff(prompt, {
      model: model || 'claude-3-5-sonnet-20241022',
      maxTokens: 1024,
      system: 'You are an internal sovereign classifier. Respond concisely without conversational padding.',
    });

    const duration = Date.now() - start;
    return {
      id: Math.random().toString(36).substring(7),
      response: response.text,
      usage: response.usage,
      durationMs: duration,
    };
  }

  /**
   * Classifies user intent (e.g., 'refactor', 'fix', 'feat') for audit adjustment.
   */
  async classifyIntent(userInput: string): Promise<string> {
    const prompt = `Classify the following user request and return exactly one word representing the intent (e.g., REFACTOR, FIX, FEATURE, DESTRUCTIVE, TEST, DOCS, UNKNOWN): \n\n"${userInput}"`;
    const result = await this.executeIsolatedReasoning(prompt);
    return result.response.trim().toUpperCase();
  }

  /**
   * Performs an epistemic pre-audit of code against a specific constitutional rule.
   * Absorbed from src/utils/constitutional.ts.
   */
  async auditConstitutionalCompliance(
    path: string,
    content: string,
    ruleContent: string
  ): Promise<{ violated: boolean; reason?: string }> {
    console.log(`[SideQuery] Performing constitutional audit for ${path}...`);
    const prompt = `Perform a constitutional audit of the following code snippet at path "${path}" against the provided sovereign rule.\n\nRule:\n${ruleContent}\n\nCode:\n${content}\n\nDoes this code violate the rule? Respond with VIOLATED: <reason> or COMPLIANT.`;
    
    // We use a high-performance model for auditing
    const result = await this.executeIsolatedReasoning(prompt, 'claude-3-5-sonnet-20241022');
    
    const isViolated = result.response.includes('VIOLATED');
    if (isViolated) {
        const reason = result.response.split('VIOLATED:')[1]?.trim() || 'Rule violation detected.';
        return { violated: true, reason };
    }
    
    return { violated: false };
  }
}
