// [LAYER: CORE]
// @classification CAPABILITY
import type { BufferedDbPool } from '../../../infrastructure/db/BufferedDbPool.js';
import type { ReasoningService } from '../ReasoningService.js';
import type { KnowledgeBaseItem, Pedigree } from '../types.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class ReasoningCapability {
  constructor(
    private readonly reasoningService: ReasoningService,
    private readonly db: BufferedDbPool,
    private readonly userId: string,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('reasoning', this.isStarted(), ['ReasoningService']);
  }

  async detectContradictions(startIds: string | string[], depth?: number) {
    this.assertOperational('reasoning.detectContradictions');
    return this.reasoningService.detectContradictions(startIds, depth);
  }

  async getReasoningPedigree(nodeId: string, maxDepth?: number): Promise<Pedigree> {
    this.assertOperational('reasoning.getReasoningPedigree');
    return this.reasoningService.getReasoningPedigree(nodeId, maxDepth);
  }

  async getNarrativePedigree(nodeId: string) {
    this.assertOperational('reasoning.getNarrativePedigree');
    return this.reasoningService.getNarrativePedigree(nodeId);
  }

  async verifySovereignty(nodeId: string) {
    this.assertOperational('reasoning.verifySovereignty');
    return this.reasoningService.verifySovereignty(nodeId);
  }

  async autoDiscoverRelationships(nodeId: string, limit?: number) {
    this.assertOperational('reasoning.autoDiscoverRelationships');
    return this.reasoningService.autoDiscoverRelationships(nodeId, limit);
  }

  async getLogicalSoundness(nodeIds: string[]) {
    this.assertOperational('reasoning.getLogicalSoundness');
    return this.reasoningService.getLogicalSoundness(nodeIds);
  }

  async selfHealGraph() {
    this.assertOperational('reasoning.selfHealGraph');
    return this.reasoningService.selfHealGraph(async () => {
      const results = await this.db.selectWhere('agent_knowledge' as any, [
        { column: 'userId', value: this.userId },
      ]);
      return results.map((r: any) => ({
        ...r,
        itemId: r.id,
        metadata: r.metadata ? JSON.parse(r.metadata) : {},
      })) as KnowledgeBaseItem[];
    });
  }

  async performSkepticalAudit(nodeIds: string[]) {
    this.assertOperational('reasoning.performSkepticalAudit');
    return this.reasoningService.performSkepticalAudit(nodeIds);
  }
}
