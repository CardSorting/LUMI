// [LAYER: CORE]
// @classification CAPABILITY
import type { BufferedDbPool } from '../../../infrastructure/db/BufferedDbPool.js';
import type { ReasoningService } from '../ReasoningService.js';
import type { KnowledgeBaseItem } from '../types.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  requireNonEmptyString,
  type ReasoningAutoDiscoverInput,
  type ReasoningAutoDiscoverResult,
  type ReasoningContradictionsInput,
  type ReasoningContradictionsResult,
  type ReasoningLogicalSoundnessInput,
  type ReasoningLogicalSoundnessResult,
  type ReasoningNarrativePedigreeResult,
  type ReasoningNodeInput,
  type ReasoningPedigreeInput,
  type ReasoningPedigreeResult,
  type ReasoningSelfHealResult,
  type ReasoningSkepticalAuditInput,
  type ReasoningSkepticalAuditResult,
  type ReasoningSovereigntyResult,
} from '../capability-types.js';

type AgentKnowledgeRow = {
  id: string;
  metadata?: string | null;
};

export class ReasoningCapability extends CapabilityBase {
  readonly name = 'reasoning';
  readonly dependencies = ['ReasoningService', 'BufferedDbPool'] as const;

  constructor(
    private readonly reasoningService: ReasoningService,
    private readonly db: BufferedDbPool,
    private readonly userId: string,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  async detectContradictions(input: ReasoningContradictionsInput): Promise<ReasoningContradictionsResult> {
    return this.execute('detectContradictions', async () => ({
      reports: await this.reasoningService.detectContradictions(input.startIds, input.depth),
    }));
  }

  async getReasoningPedigree(input: ReasoningPedigreeInput): Promise<ReasoningPedigreeResult> {
    return this.execute('getReasoningPedigree', async () => ({
      pedigree: await this.reasoningService.getReasoningPedigree(
        requireNonEmptyString(input.nodeId, 'nodeId'),
        input.maxDepth
      ),
    }));
  }

  async getNarrativePedigree(input: ReasoningNodeInput): Promise<ReasoningNarrativePedigreeResult> {
    return this.execute('getNarrativePedigree', async () => ({
      narrative: await this.reasoningService.getNarrativePedigree(requireNonEmptyString(input.nodeId, 'nodeId')),
    }));
  }

  async verifySovereignty(input: ReasoningNodeInput): Promise<ReasoningSovereigntyResult> {
    return this.execute('verifySovereignty', async () => {
      const { isValid, metrics } = await this.reasoningService.verifySovereignty(
        requireNonEmptyString(input.nodeId, 'nodeId')
      );
      return {
        isValid,
        metrics: Object.fromEntries(
          Object.entries(metrics ?? {}).map(([key, value]) => [key, value as number | string | boolean | null])
        ),
      };
    });
  }

  async autoDiscoverRelationships(input: ReasoningAutoDiscoverInput): Promise<ReasoningAutoDiscoverResult> {
    return this.execute('autoDiscoverRelationships', async () =>
      this.reasoningService.autoDiscoverRelationships(
        requireNonEmptyString(input.nodeId, 'nodeId'),
        input.limit
      )
    );
  }

  async getLogicalSoundness(input: ReasoningLogicalSoundnessInput): Promise<ReasoningLogicalSoundnessResult> {
    return this.execute('getLogicalSoundness', async () => ({
      soundness: await this.reasoningService.getLogicalSoundness(input.nodeIds),
    }));
  }

  async selfHealGraph(): Promise<ReasoningSelfHealResult> {
    return this.execute('selfHealGraph', async () => {
      await this.reasoningService.selfHealGraph(async () => {
        const results = await this.db.selectWhere('agent_knowledge' as 'knowledge', [
          { column: 'userId', value: this.userId },
        ]);
        return results.map((r) => {
          const row = r as AgentKnowledgeRow;
          return {
            ...(row as unknown as KnowledgeBaseItem),
            itemId: String(row.id),
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
          } as KnowledgeBaseItem;
        });
      });
      return { healed: true };
    });
  }

  async performSkepticalAudit(input: ReasoningSkepticalAuditInput): Promise<ReasoningSkepticalAuditResult> {
    return this.execute('performSkepticalAudit', async () =>
      this.reasoningService.performSkepticalAudit(input.nodeIds)
    );
  }
}
