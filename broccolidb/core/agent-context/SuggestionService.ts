import * as crypto from 'node:crypto';
import type { BlastRadius } from './StructuralDiscoveryService.js';
import type {
  IAgentContext,
  KnowledgeBaseItem,
  PromptSuggestion,
  ServiceContext,
  SuggestionType,
} from './types.js';

interface CachedSuggestions {
  suggestions: PromptSuggestion[];
  timestamp: number;
  contentHash: string;
}

export class SuggestionService {
  private lastSuggestions: PromptSuggestion[] = [];
  private isGenerating = false;
  private lastFetchTime = 0;
  private readonly DEBOUNCE_INTERVAL = 10000; // 10 seconds
  private suggestionCache = new Map<string, CachedSuggestions>();

  constructor(private ctx: ServiceContext) {}

  private calculateContentHash(content: string, filePath: string): string {
    return crypto.createHash('md5').update(`${filePath}:${content}`).digest('hex');
  }

  async getSuggestions(
    params: {
      mode: string;
      activeFilePath?: string;
      fileContent?: string;
      diagnostics?: string;
      gitStatus?: string;
      messages?: unknown[];
    },
    agentContext: IAgentContext
  ): Promise<PromptSuggestion[]> {
    if (this.isGenerating) {
      return this.lastSuggestions;
    }

    const now = Date.now();
    if (now - this.lastFetchTime < this.DEBOUNCE_INTERVAL) {
      return this.lastSuggestions;
    }

    this.isGenerating = true;
    const {
      mode,
      activeFilePath,
      fileContent,
      diagnostics,
      gitStatus,
      messages: _messages = [],
    } = params;

    try {
      if (!this.ctx.aiService?.isAvailable()) {
        return this.getFallbackSuggestions();
      }

      let contentHash = '';
      if (activeFilePath && fileContent) {
        contentHash = this.calculateContentHash(fileContent, activeFilePath);
        const cached = this.suggestionCache.get(activeFilePath);
        if (cached && cached.contentHash === contentHash && now - cached.timestamp < 300000) {
          this.isGenerating = false;
          return cached.suggestions;
        }
      }

      // Gather BroccoliDB context
      let structuralImpact: { summary: string; blastRadius: BlastRadius } | null = null;
      let semanticContext: string[] = [];

      if (activeFilePath) {
        structuralImpact = agentContext.getStructuralImpact(activeFilePath);
        const searchResults = await agentContext.searchKnowledge(
          `context for ${activeFilePath}: ${fileContent?.substring(0, 100)}`,
          undefined,
          2
        );
        semanticContext = searchResults.map((res: KnowledgeBaseItem) => res.content);
      }

      const systemPrompt = `You are a strict, hyper-aware AI Oracle embedded in the user's IDE.
Your sole purpose is to output a JSON array of 3 highly actionable, contextually accurate prompt suggestions.

Current Context:
<mode>${mode}</mode>
<active_file>${activeFilePath || 'None'}</active_file>
<structural_impact>
${structuralImpact?.summary || 'No architectural data available.'}
</structural_impact>
<semantic_context>
${semanticContext.length > 0 ? semanticContext.join('\n---\n') : 'No similar code snippets found.'}
</semantic_context>
<file_snippet>
${fileContent?.substring(0, 2000) || 'No content available.'}
</file_snippet>
<diagnostics>
${diagnostics || 'No problems detected.'}
</diagnostics>
<git_status>
${gitStatus || 'No pending changes.'}
</git_status>

Oracle Modes:
1. fix: High-precision resolution of the most critical issue in <diagnostics>.
2. design: Architectural improvement or refactor grounded in <structural_impact>.
3. learn: Discovery suggestion focused on explaining complex logic in <file_snippet>.
4. feature: Strategic next step for development identifying a new concept or feature.

Output format: JSON array of EXACTLY 3 objects with "text" and "type" (one of fix, design, learn, feature).`;

      const fullText = await this.ctx.aiService.generateText(systemPrompt);

      // Robust JSON extraction
      const jsonStartIndex = fullText.indexOf('[');
      const jsonEndIndex = fullText.lastIndexOf(']');
      if (jsonStartIndex === -1 || jsonEndIndex === -1) throw new Error('No JSON array found');
      const rawSuggestions = JSON.parse(fullText.substring(jsonStartIndex, jsonEndIndex + 1));

      const finalSuggestions: PromptSuggestion[] = [];
      for (const s of rawSuggestions.slice(0, 3)) {
        let impact = 0.1;
        if (structuralImpact) {
          const score = structuralImpact.blastRadius.centralityScore;
          impact = score > 0.2 ? 0.8 : score > 0 ? 0.5 : 0.1;
        }
        finalSuggestions.push({
          text: s.text,
          type: s.type as SuggestionType,
          impact,
        });
      }

      if (activeFilePath && contentHash) {
        this.suggestionCache.set(activeFilePath, {
          suggestions: finalSuggestions,
          timestamp: Date.now(),
          contentHash,
        });
      }

      this.lastSuggestions = finalSuggestions;
      this.lastFetchTime = Date.now();
      return finalSuggestions;
    } catch {
      return this.getFallbackSuggestions();
    } finally {
      this.isGenerating = false;
    }
  }

  private getFallbackSuggestions(): PromptSuggestion[] {
    return [
      { text: 'Help me understand the current project structure', type: 'learn' },
      { text: 'Identify potential architectural improvements', type: 'design' },
      { text: 'What should be the next feature to implement?', type: 'feature' },
    ];
  }
}
