import type { GraphService } from './GraphService.js';
import type { ReasoningService } from './ReasoningService.js';
import type { KnowledgeBaseItem, ServiceContext } from './types.js';

export interface ContextHealth {
  score: number; // 0-100
  gaps: string[];
  findings: {
    staleCount: number;
    contradictionCount: number;
    unverifiedCount: number;
    highEntropyNodes: string[];
  };
}

/**
 * DiagnosisService provides Epistemic Health checks for the current conversation.
 * Absorbed from src/utils/analyzeContext.ts and src/utils/doctorDiagnostic.ts.
 */
export class DiagnosisService {
  constructor(
    private ctx: ServiceContext,
    private graph: GraphService,
    private reasoning: ReasoningService
  ) {}

  /**
   * Performs an epistemic audit of the current graph and context window.
   */
  async diagnoseContext(relevantNodeIds: string[]): Promise<ContextHealth> {
    const gaps: string[] = [];
    let staleCount = 0;
    let contradictionCount = 0;
    let unverifiedCount = 0;
    const highEntropyNodes: string[] = [];

    const nodes = await Promise.all(
      relevantNodeIds.map((id) => this.graph.getKnowledge(id).catch(() => null))
    );
    const validNodes = nodes.filter((n): n is KnowledgeBaseItem => n !== null);

    for (const node of validNodes) {
      // 1. Check Staleness
      const ageMs = Date.now() - (node.createdAt || Date.now());
      if (ageMs > 7 * 86_400_000) {
        staleCount++;
      }

      // 2. Check Sovereignty (Epistemic Verification)
      const sov = await this.reasoning.verifySovereignty(node.itemId);
      if (!sov.isValid) {
        unverifiedCount++;
        if ((sov.metrics?.finalProb as number) < 0.2) {
          highEntropyNodes.push(node.itemId);
        }
      }

      // 3. Check Contradictions
      const conflicts = await this.reasoning.detectContradictions(node.itemId, 1);
      if (conflicts.length > 0) {
        contradictionCount++;
      }
    }

    // Calculate Health Score
    let score = 100;
    score -= staleCount * 5;
    score -= contradictionCount * 15;
    score -= unverifiedCount * 10;
    score = Math.max(0, score);

    if (staleCount > 3) gaps.push('Multiple stale nodes detected in critical path.');
    if (contradictionCount > 0) gaps.push(`${contradictionCount} logical contradictions found.`);
    if (unverifiedCount > 5) gaps.push('High concentration of unverified (low-confidence) nodes.');

    return {
      score,
      gaps,
      findings: {
        staleCount,
        contradictionCount,
        unverifiedCount,
        highEntropyNodes,
      },
    };
  }

  /**
   * Returns a Sovereign Recommendation based on health.
   */
  getRecommendation(health: ContextHealth): string {
    if (health.score < 50) {
        return 'CRITICAL: Epistemic health is low. Strongly recommend re-verifying current workspace state or using Adaptive Thinking (ultrathink).';
    }
    if (health.score < 80) {
        return 'WARNING: Some context gaps detected. Consider auditing high-entropy nodes.';
    }
    return 'HEALTHY: Epistemic state is sound.';
  }
}
