// [LAYER: CORE]
// @classification CAPABILITY
import type { BufferedDbPool } from '../../../infrastructure/db/BufferedDbPool.js';
import type { LRUCache } from '../../lru-cache.js';
import { RecoveryError } from '../../errors.js';
import type { BroccoliDbRecoveryReport, KnowledgeBaseItem } from '../types.js';
import type { GraphService } from '../GraphService.js';
import type { CleanupService } from '../CleanupService.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export interface RecoveryOptions {
  mode: 'standard';
}

export class RecoveryCapability {
  constructor(
    private readonly db: BufferedDbPool,
    private readonly kbCache: LRUCache<string, KnowledgeBaseItem>,
    private readonly graphService: GraphService,
    private readonly cleanupService: CleanupService,
    private readonly userId: string,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('recovery', this.isStarted(), ['BufferedDbPool', 'CleanupService']);
  }

  async recover(options: RecoveryOptions = { mode: 'standard' }): Promise<BroccoliDbRecoveryReport> {
    this.assertOperational('recovery.recover');
    if (options.mode !== 'standard') {
      throw new RecoveryError(`Unsupported recovery mode: ${options.mode}`);
    }

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
          table as any,
          column,
          value
        );
      } catch (error: any) {
        errors.push(`${table}:${column}:${value}: ${error?.message || error}`);
      }
    }

    if (errors.length > 0) {
      throw new RecoveryError(`BroccoliDB recovery failed: ${errors.join('; ')}`);
    }

    return { recovered: true, warmedTables, errors };
  }

  async retractLastOperation(): Promise<void> {
    this.assertOperational('recovery.retractLastOperation');
    await this.db.rollbackWork(this.userId);
    this.kbCache.clear();
  }

  async reconstituteFromDigest(digest: string): Promise<void> {
    this.assertOperational('recovery.reconstituteFromDigest');
    const data = JSON.parse(digest);
    if (!data.knowledgeIds || !Array.isArray(data.knowledgeIds)) {
      return;
    }

    for (const id of data.knowledgeIds) {
      await this.graphService.getKnowledge(id).catch(() => null);
    }
  }

  async performGarbageCollection() {
    this.assertOperational('recovery.performGarbageCollection');
    return this.cleanupService.performGarbageCollection();
  }

  async performEpistemicSunsetting(confidenceThreshold = 0.2) {
    this.assertOperational('recovery.performEpistemicSunsetting');
    return this.cleanupService.performEpistemicSunsetting(confidenceThreshold);
  }

  async performMemorySynthesis() {
    this.assertOperational('recovery.performMemorySynthesis');
    return this.cleanupService.performMemorySynthesis();
  }
}
