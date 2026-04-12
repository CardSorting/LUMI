import type { GraphService } from './GraphService.js';
import type { ContradictionReport, KnowledgeBaseItem, Pedigree, ServiceContext } from './types.js';

/**
 * ReasoningService provides high-level epistemic evaluation, contradiction detection,
 * and structural sovereignty verification for the BroccoliDB graph.
 */
export class ReasoningService {
  constructor(
    private ctx: ServiceContext,
    private graph: GraphService
  ) {}

  /**
   * Detects logical contradictions within the neighborhood of a set of nodes.
   */
  async detectContradictions(
    startIds: string | string[],
    depth = 3
  ): Promise<ContradictionReport[]> {
    const ids = Array.isArray(startIds) ? startIds : [startIds];
    const reports: ContradictionReport[] = [];
    const visited = new Set<string>();

    for (const startId of ids) {
      const neighborhood = await this.graph.traverseGraph(startId, depth, { direction: 'both' });
      for (const node of neighborhood) {
        if (visited.has(node.itemId)) continue;
        visited.add(node.itemId);

        const contradictions = (node.edges || []).filter((e) => e.type === 'contradicts');
        for (const edge of contradictions) {
          reports.push({
            nodeId: node.itemId,
            conflictingNodeId: edge.targetId,
            confidence: node.confidence ?? 0.5,
            evidencePath: [node.itemId, edge.targetId],
          });
        }
      }
    }
    return reports;
  }

  /**
   * Returns the reasoning lineage (pedigree) for a given node.
   */
  async getReasoningPedigree(nodeId: string, maxDepth = 5): Promise<Pedigree> {
    const node = await this.graph.getKnowledge(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const evidence: string[] = [];
    const lineage: Pedigree['lineage'] = [
      {
        nodeId,
        type: node.type,
        content: node.content,
        timestamp: node.createdAt ?? Date.now(),
        confidence: node.confidence ?? 0.5,
      },
    ];

    const traverse = async (id: string, depth: number) => {
      if (depth >= maxDepth) return;
      const n = await this.graph.getKnowledge(id);

      for (const edge of n.edges || []) {
        if (edge.type === 'supports') {
          evidence.push(edge.targetId);
          const targetNode = await this.graph.getKnowledge(edge.targetId);
          if (targetNode) {
            lineage.push({
              nodeId: targetNode.itemId,
              type: targetNode.type,
              content: targetNode.content,
              timestamp: targetNode.createdAt ?? Date.now(),
              confidence: targetNode.confidence ?? 0.5,
            });
            await traverse(edge.targetId, depth + 1);
          }
        }
      }
    };

    await traverse(nodeId, 0);

    return {
      nodeId,
      effectiveConfidence: node.confidence ?? 0.5,
      supportingEvidenceIds: evidence,
      lineage,
    };
  }

  /**
   * Returns a natural language narrative explaining the reasoning chain.
   */
  async getNarrativePedigree(nodeId: string): Promise<string> {
    if (!this.ctx.aiService?.isAvailable())
      return 'AI Service unavailable for narrative generation.';
    const pedigree = await this.getReasoningPedigree(nodeId);
    const item = await this.graph.getKnowledge(nodeId);

    return this.ctx.aiService.explainReasoningChain(
      item.content,
      pedigree.lineage.map((l) => ({
        content: l.content,
        type: l.type,
      }))
    );
  }

  /**
   * [Pillar 4] Calculates structural metrics for adaptive calibration.
   */
  async getGraphMetrics(): Promise<{
    totalNodes: number;
    rootNodes: number;
    leafNodes: number;
    avgConnectivity: number;
  }> {
    const nodes = await this.graph.traverseGraph('HEAD', 5);
    if (nodes.length === 0)
      return { totalNodes: 0, rootNodes: 0, leafNodes: 0, avgConnectivity: 0 };

    let roots = 0;
    let leaves = 0;
    let totalEdges = 0;

    for (const node of nodes) {
      if ((node.inboundEdges || []).length === 0) roots++;
      if ((node.edges || []).length === 0) leaves++;
      totalEdges += (node.edges || []).length;
    }

    return {
      totalNodes: nodes.length,
      rootNodes: roots,
      leafNodes: leaves,
      avgConnectivity: totalEdges / nodes.length,
    };
  }

  /**
   * [Pillar 1, 2, 3, 4] Verifies the structural and epistemic sovereignty of a node.
   * Incorporates git signals, evidence discounting, and adaptive calibration.
   */
  async verifySovereignty(
    nodeId: string
  ): Promise<{ isValid: boolean; metrics: Record<string, unknown> | null }> {
    const node = await this.graph.getKnowledge(nodeId).catch(() => null);
    if (!node) return { isValid: false, metrics: null };

    const repo = await this.ctx.workspace.getRepo('main');

    const meta = node.metadata as Record<string, unknown> | null;
    const commitId = (meta?.commitId as string) || (meta?.nodeId as string);
    const path = (node as unknown as { path?: string }).path || (meta?.path as string);

    let commitDistance = 1000;
    let churn = 0;
    let prior = 0.5;

    if (repo && commitId) {
      commitDistance = await repo.getCommitDistance(commitId);
      if (path) {
        churn = await repo.getFileChurn(path);
        prior = await repo.getNodePriors(path);
      }
    }

    const baseProb = node.confidence ?? prior;
    const ageDecay = Math.max(0.1, 1.0 - commitDistance / 100);

    // [Pillar 3] Evidence Discounting
    let discountingFactor = 1.0;
    const supports = (node.inboundEdges || []).filter((e) => e.type === 'supports');
    const uniqueCommits = new Set<string>();

    for (const edge of supports) {
      try {
        const evidence = await this.graph.getKnowledge(edge.targetId);
        const evMeta = evidence.metadata as Record<string, unknown> | null;
        const evCommit = (evMeta?.commitId as string) || (evMeta?.nodeId as string);

        if (evCommit && evCommit !== commitId) {
          uniqueCommits.add(evCommit);
        } else {
          discountingFactor *= 0.95;
        }
      } catch {
        // Ignore
      }
    }

    const reinforcement = Math.min(0.15, (uniqueCommits.size - 1) * 0.05);

    // [Pillar 4] Adaptive Calibration
    const graphMetrics = await this.getGraphMetrics();
    const adaptiveThreshold = graphMetrics.avgConnectivity > 1.5 ? 0.35 : 0.45;

    const finalProb = baseProb * ageDecay * discountingFactor + reinforcement;
    const isValid = finalProb > adaptiveThreshold;

    const centrality = await this.graph.getNodeCentrality(nodeId);

    return {
      isValid,
      metrics: {
        finalProb,
        baseProb,
        ageDecay,
        discountingFactor,
        reinforcement,
        adaptiveThreshold,
        totalDegree: centrality.totalDegree,
        commitDistance,
        churn,
        avgConnectivity: graphMetrics.avgConnectivity,
      },
    };
  }

  /**
   * Returns a human-readable staleness caveat for a node.
   * Models are better at reasoning about "14 days old" than abstract probabilities.
   */
  async getSovereignCaveat(nodeId: string): Promise<string> {
    const node = await this.graph.getKnowledge(nodeId).catch(() => null);
    if (!node) return '';

    const mtimeMs = node.createdAt || Date.now();
    const days = Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000));

    if (days <= 1) return '';

    const repo = await this.ctx.workspace.getRepo('main');
    const meta = node.metadata as Record<string, unknown> | null;
    const path = (node as unknown as { path?: string }).path || (meta?.path as string);

    let churnNote = '';
    if (repo && path) {
      const churn = await repo.getFileChurn(path);
      if (churn > 5) {
        churnNote = ` and the underlying file has changed ${churn} times since then.`;
      }
    }

    return (
      `<sovereign-warning>\n` +
      `This memory is ${days} days old${churnNote}\n` +
      `Memories are point-in-time observations, not live state. ` +
      `Verify against current code or data before asserting as fact.\n` +
      `</sovereign-warning>`
    );
  }

  /**
   * Adaptive Thinking Trigger (Ultrathink).
   * Absorbed from src/utils/thinking.ts.
   */
  async getThinkingRecommendation(nodeId: string): Promise<{ type: 'adaptive' | 'none'; reason?: string }> {
    const sov = await this.verifySovereignty(nodeId);
    if (!sov.isValid && (sov.metrics?.finalProb as number) < 0.3) {
      return {
          type: 'adaptive',
          reason: `Low epistemic confidence (${sov.metrics?.finalProb}) detected for node ${nodeId}. High risk of hallucination.`
      };
    }

    const discovery = this.ctx.getStructuralImpact(nodeId);
    if (discovery && discovery.blastRadius > 15) {
        return {
            type: 'adaptive',
            reason: `High structural blast radius (${discovery.blastRadius}) for node ${nodeId}. Architectural change requires slow-thinking (ultrathink) verification.`
        };
    }

    return { type: 'none' };
  }

  /**
   * Vitality Daemon: Background process for autonomous graph self-healing.
   */
  public startVitalityDaemon(listAllFn: () => Promise<KnowledgeBaseItem[]>) {
    console.log('[Reasoning] 🧬 Vitality Daemon started. Monitoring graph hygiene...');
    setInterval(async () => {
      try {
        const result = await this.selfHealGraph(listAllFn);
        if (result.prunedNodes.length > 0) {
          console.log(`[Reasoning] 🧹 Self-Heal: Pruned ${result.prunedNodes.length} stale/invalid nodes.`);
        }
      } catch (err) {
        console.error('[Reasoning] 💥 Vitality Daemon error:', err);
      }
    }, 600000); // Every 10 minutes
  }

  /**
   * Autonomous Epistemic Sunsetting (Self-Healing).
   * Hardened with Git Churn awareness and HITS integration.
   */
  async selfHealGraph(
    listAllFn: () => Promise<KnowledgeBaseItem[]>
  ): Promise<{ prunedNodes: string[]; prunedEdges: number }> {
    const allKnowledge = await listAllFn();
    const nodesToPrune: string[] = [];
    const edgesPruned = 0;

    // 1. Calculate Vitality Scores (HITS + Age Decay)
    const scores = new Map<string, number>();
    const now = Date.now();
    
    for (const node of allKnowledge) {
        const ageInDays = (now - (node.createdAt || now)) / 86400000;
        const decay = Math.pow(0.95, ageInDays); // 5% decay per day
        scores.set(node.itemId, (1.0 / allKnowledge.length) * decay);
    }

    // Iterative Hub/Authority Score Propagation
    for (let i = 0; i < 3; i++) {
      const nextScores = new Map<string, number>();
      for (const node of allKnowledge) {
        let s = (1 - 0.85) / allKnowledge.length;
        const inbound = node.inboundEdges || [];
        for (const edge of inbound) {
          s += 0.85 * (scores.get(edge.targetId) || 0) * ((edge.weight ?? 1.0) / 3.0);
        }
        nextScores.set(node.itemId, s);
      }
      for (const [id, score] of nextScores) {
        scores.set(id, score);
      }
    }

    // 2. Apply Git Churn Penalty & Pruning Decisions
    const repo = await this.ctx.workspace.getRepo('main').catch(() => null);

    for (const node of allKnowledge) {
        let finalScore = scores.get(node.itemId) || 0;
        
        if (repo && node.metadata?.path) {
            const churn = await repo.getFileChurn(node.metadata.path);
            if (churn > 10) {
                finalScore *= 0.5; // Heavy penalty for high-churn evidence
            }
        }

        // 3. Update HubScore/Confidence in Graph
        await this.graph.updateKnowledge(node.itemId, {
          hubScore: finalScore,
          confidence: Math.max(0.01, (node.confidence || 0.5) * 0.9 + finalScore * 0.1)
        });

        // 4. Critical Vitality Pruning
        // Rule: Prune if vitality is critically low OR age is high with zero connectivity.
        if (finalScore < 0.0005 && (now - (node.createdAt || now) > 15 * 86400000)) {
            nodesToPrune.push(node.itemId);
        } else if (finalScore < 0.001 && (node.edges || []).length === 0 && (now - (node.createdAt || now) > 7 * 86400000)) {
            nodesToPrune.push(node.itemId);
        }
    }

    // Execute pruning
    for (const id of nodesToPrune) {
        await this.graph.deleteKnowledge(id);
    }

    return { prunedNodes: nodesToPrune, prunedEdges: edgesPruned };
  }

  /**
   * Automatically discovers and adds relationships for a node based on semantic similarity.
   */
  async autoDiscoverRelationships(
    nodeId: string,
    limit = 5
  ): Promise<{ discovered: number; suggestions: string[] }> {
    const item = await this.graph.getKnowledge(nodeId);
    if (!this.ctx.aiService?.isAvailable()) return { discovered: 0, suggestions: [] };

    // Search for semantically similar nodes
    const candidates = await this.ctx.searchKnowledge(item.content, undefined, limit + 5);
    const existingEdgeTargets = new Set((item.edges || []).map((e) => e.targetId));

    let discoveredCount = 0;
    const suggestions: string[] = [];

    for (const candidate of candidates) {
      if (candidate.itemId === nodeId || existingEdgeTargets.has(candidate.itemId)) continue;
      if (discoveredCount >= limit) break;

      const relationship = await this.ctx.aiService.evaluateLogicRelationship(
        item.content,
        candidate.content
      );
      if (relationship !== 'neutral') {
        await this.graph.updateKnowledge(nodeId, {
          edges: [
            ...(item.edges || []),
            { targetId: candidate.itemId, type: relationship, weight: 0.8 },
          ],
        });
        discoveredCount++;
        suggestions.push(`Automated Link: ${nodeId} -> ${candidate.itemId} (${relationship})`);
      }
    }

    return { discovered: discoveredCount, suggestions };
  }

  /**
   * Calculates a heuristic 'Soundness Score' for a set of nodes.
   */
  async getLogicalSoundness(nodeIds: string[]): Promise<number> {
    if (nodeIds.length === 0) return 1.0;

    let totalConfidence = 0;
    let contradictionCount = 0;
    let supportCount = 0;

    const items = await this.graph.getKnowledgeBatch(nodeIds);
    if (items.length === 0) return 1.0;

    for (const item of items) {
      totalConfidence += item.confidence;
      contradictionCount += (item.edges || []).filter((e) => e.type === 'contradicts').length;
      supportCount += (item.edges || []).filter(
        (e) => e.type === 'supports' || e.type === 'depends_on'
      ).length;
    }

    const avgConfidence = totalConfidence / items.length;
    const conflictPenalty = Math.max(0, 1 - contradictionCount * 0.2);
    const supportBonus = Math.min(0.2, supportCount * 0.05);

    return Math.max(0, Math.min(1, avgConfidence * conflictPenalty + supportBonus));
  }

  /**
   * Synthesizes findings from a swarm of nodes into a coherent "Sovereign Spec".
   * Absorbed from src/coordinator/coordinatorMode.ts.
   */
  async getSwarmSynthesis(nodeIds: string[]): Promise<string> {
    if (!this.ctx.aiService?.isAvailable()) {
      return 'AI Service unavailable for synthesis.';
    }

    const items = await this.graph.getKnowledgeBatch(nodeIds);
    const context = items.map((it) => `[${it.type}] ${it.content}`).join('\n---\n');

    // Synthesis is an autonomous coordination task that extracts structural specs.
    try {
      const result = await this.ctx.aiService.completeOneOff(
        `Synthesize the following research findings into a specific, actionable technical specification for an implementation worker. 
        Focus on facts, structural impacts, and technical requirements. 
        Be extremely precise. 
        Findings:\n\n${context}`,
        {
          model: 'sonnet' as any,
          maxTokens: 4000,
          system: 'You are a Sovereign Swarm Coordinator.',
        }
      );
      return result.text;
    } catch (err) {
      console.error('[Reasoning] Synthesis failed', err);
      return 'Synthesis failed due to AI Service error.';
    }
  }

  /**
   * [Pass 3] Sovereign Verification Audit (Skeptical Layer).
   * Unlike standard synthesis, this specifically searches for negative evidence,
   * edge cases, and potential regressions.
   */
  async performSkepticalAudit(nodeIds: string[]): Promise<{ 
      pass: boolean; 
      risks: string[]; 
      confidence: number;
      narrative: string;
  }> {
    if (!this.ctx.aiService?.isAvailable()) {
      return { pass: true, risks: [], confidence: 1.0, narrative: 'AI Service unavailable for audit.' };
    }

    const items = await this.graph.getKnowledgeBatch(nodeIds);
    const context = items.map((it) => `[${it.type}] ${it.content}`).join('\n---\n');

    try {
      const result = await this.ctx.aiService.completeOneOff(
        `Perform a SKEPTICAL audit of the following implementation details. 
        Your goal is to find edge cases, potential regressions, and structural flaws. 
        Do not rubber-stamp. Be a "Devil's Advocate".
        
        Details:\n\n${context}`,
        {
          model: 'sonnet' as any,
          maxTokens: 4000,
          system: 'You are a Sovereign Swarm Verifier. You are skeptical, precise, and paranoid about code quality.',
        }
      );

      const narrative = result.text;
      const lower = narrative.toLowerCase();
      const riskyKeywords = ['risk', 'flaw', 'regression', 'edge case', 'failure', 'unsafe', 'bug'];
      const risks = riskyKeywords.filter(k => lower.includes(k));
      
      const pass = risks.length < 3;
      const confidence = Math.max(0.1, 1.0 - (risks.length * 0.15));

      return { pass, risks, confidence, narrative };
    } catch (err) {
      console.error('[Reasoning] Skeptical audit failed', err);
      return { pass: false, risks: ['Audit tool failure'], confidence: 0.0, narrative: 'Audit failed due to AI Service error.' };
    }
  }
}
