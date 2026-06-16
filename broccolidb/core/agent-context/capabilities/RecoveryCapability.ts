// [LAYER: CORE]
// @classification CAPABILITY
import type { BufferedDbPool } from '../../../infrastructure/db/BufferedDbPool.js';
import type { LRUCache } from '../../lru-cache.js';
import { AgentGitError, RecoveryError } from '../../errors.js';
import type { KnowledgeBaseItem } from '../types.js';
import type { GraphService } from '../GraphService.js';
import type { CleanupService } from '../CleanupService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  requireNonEmptyString,
  requireRecoveryMode,
  type RecoveryEpistemicSunsettingInput,
  type RecoveryEpistemicSunsettingResult,
  type RecoveryGarbageCollectionResult,
  type RecoveryMemorySynthesisResult,
  type RecoveryRecoverInput,
  type RecoveryRecoverResult,
  type RecoveryReconstituteInput,
  type RecoveryReconstituteResult,
  type RecoveryRetractResult,
} from '../capability-types.js';

export class RecoveryCapability extends CapabilityBase {
  readonly name = 'recovery';
  readonly dependencies = ['BufferedDbPool', 'CleanupService', 'GraphService'] as const;

  constructor(
    private readonly db: BufferedDbPool,
    private readonly kbCache: LRUCache<string, KnowledgeBaseItem>,
    private readonly graphService: GraphService,
    private readonly cleanupService: CleanupService,
    private readonly userId: string,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  async recover(input: RecoveryRecoverInput): Promise<RecoveryRecoverResult> {
    return this.execute('recover', async () => {
      requireRecoveryMode(input.mode);
      const warmedTables: Record<string, number> = {};
      const errors: string[] = [];
      const warmups: Array<[string, string, string]> = [
        ['queue_jobs', 'status', 'pending'],
        ['agent_streams', 'status', 'active'],
        ['agent_tasks', 'status', 'pending'],
        ['agent_tasks', 'status', 'running'],
      ];

      for (const [table, column, value] of warmups) {
        try {
          warmedTables[`${table}:${column}:${value}`] = await this.db.warmupTable(
            table as 'queue_jobs',
            column,
            value
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${table}:${column}:${value}: ${message}`);
        }
      }

      if (errors.length > 0) {
        throw new RecoveryError(`BroccoliDB recovery failed: ${errors.join('; ')}`);
      }

      return { recovered: true, warmedTables, errors };
    });
  }

  async retractLastOperation(): Promise<RecoveryRetractResult> {
    return this.execute('retractLastOperation', async () => {
      await this.db.rollbackWork(this.userId);
      this.kbCache.clear();
      return { retracted: true };
    });
  }

  async reconstituteFromDigest(input: RecoveryReconstituteInput): Promise<RecoveryReconstituteResult> {
    return this.execute('reconstituteFromDigest', async () => {
      const digest = requireNonEmptyString(input.digest, 'digest');
      let data: { knowledgeIds?: unknown };
      try {
        data = JSON.parse(digest);
      } catch {
        throw new AgentGitError('digest must be valid JSON', 'INVALID_ARGUMENT');
      }
      if (!Array.isArray(data.knowledgeIds)) {
        return { hydratedCount: 0 };
      }

      let hydratedCount = 0;
      for (const id of data.knowledgeIds) {
        if (typeof id !== 'string') continue;
        const item = await this.graphService.getKnowledge(id).catch(() => null);
        if (item) hydratedCount++;
      }
      return { hydratedCount };
    });
  }

  async performGarbageCollection(): Promise<RecoveryGarbageCollectionResult> {
    return this.execute('performGarbageCollection', () => this.cleanupService.performGarbageCollection());
  }

  async performEpistemicSunsetting(
    input: RecoveryEpistemicSunsettingInput = {}
  ): Promise<RecoveryEpistemicSunsettingResult> {
    return this.execute('performEpistemicSunsetting', async () => {
      const threshold = input.confidenceThreshold ?? 0.2;
      const prunedCount = await this.cleanupService.performEpistemicSunsetting(threshold);
      return { prunedCount };
    });
  }

  async performMemorySynthesis(): Promise<RecoveryMemorySynthesisResult> {
    return this.execute('performMemorySynthesis', async () => {
      await this.cleanupService.performMemorySynthesis();
      return { synthesized: true };
    });
  }
}
