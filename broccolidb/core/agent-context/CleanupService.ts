// [LAYER: CORE]
// @classification OWNED
import { join } from 'node:path';
import { unlink, readdir, stat } from 'node:fs/promises';
import type { TaskService } from './TaskService.js';
import type { ReasoningService } from './ReasoningService.js';
import type { ServiceContext } from './types.js';
import { LifecycleStateError } from '../errors.js';

/**
 * CleanupService provides memory retention and garbage collection.
 * Absorbed from Settings.transcriptRetentionDays and src/utils/cronTasksLock.ts.
 * Prunes expired facts, unreferenced CAS blobs, and stale task buffers.
 */
export class CleanupService {
  private lifecycleState: 'new' | 'started' | 'stopped' = 'new';
  private cleanupInterval: NodeJS.Timeout | null = null;
  private lastRunAt: number | null = null;
  private lastPrunedShadows = 0;
  private lastError: string | null = null;

  constructor(
    private ctx: ServiceContext,
    private tasks: TaskService,
    private reasoning: ReasoningService
  ) {}

  async start(): Promise<void> {
    if (this.lifecycleState === 'started') return;
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError('CleanupService cannot be restarted after stop().');
    }

    this.lifecycleState = 'started';
    this.cleanupInterval = setInterval(() => {
      this.runBackgroundCleanup().catch((error) => {
        this.lastError = error?.message || String(error);
      });
    }, 30000);
  }

  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.lifecycleState = 'stopped';
  }

  async flush(): Promise<void> {
    this.assertOperational('flush');
  }

  async health(): Promise<Record<string, unknown>> {
    return {
      component: 'CleanupService',
      status: this.lifecycleState === 'started' ? 'healthy' : this.lifecycleState,
      lastRunAt: this.lastRunAt,
      lastPrunedShadows: this.lastPrunedShadows,
      lastError: this.lastError,
    };
  }

  private assertOperational(operation: string): void {
    if (this.lifecycleState === 'new') {
      throw new LifecycleStateError(`CleanupService.${operation}() called before start().`);
    }
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError(`CleanupService.${operation}() called after stop().`);
    }
  }

  private async runBackgroundCleanup(): Promise<void> {
    this.assertOperational('runBackgroundCleanup');
    this.lastRunAt = Date.now();
    this.lastPrunedShadows = await this.ctx.db.pruneExpiredShadows();
    await this.performGarbageCollection();
  }

  /**
   * Performs background memory synthesis.
   * Periodically distills graph nodes and task findings into the Sovereign Scratchpad.
   */
  async performMemorySynthesis(): Promise<void> {
    this.assertOperational('performMemorySynthesis');
    console.log('[Cleanup] Performing Background Memory Synthesis...');
    
    // 1. Get recent high-confidence knowledge (hubScore > 0.1 or confidence > 0.8)
    const all = await this.ctx.db.selectWhere('knowledge', [
        { column: 'userId', value: this.ctx.userId }
    ]);
    
    const highConfidenceNodes = all.filter(n => n.confidence > 0.8 || n.hubScore > 0.1);
    
    if (highConfidenceNodes.length === 0) return;
    
    // 2. Synthesize using ReasoningService
    const executiveSummary = await this.reasoning.getSwarmSynthesis(
        highConfidenceNodes.map(n => n.id)
    );
    
    // 3. Update Sovereign Scratchpad
    const currentScratchpad = await this.tasks.loadScratchpad();
    const newContent = `${currentScratchpad}\n\n## Sovereign Executive Summary (${new Date().toISOString()})\n\n${executiveSummary}`;
    
    await this.tasks.updateScratchpad(newContent);
    console.log('[Cleanup] Memory Synthesis completed and Scratchpad updated.');
  }

  /**
   * Performs active garbage collection for the sovereign memory.
   */
  async performGarbageCollection(): Promise<{ 
      prunedFacts: number; 
      prunedBlobs: number; 
      prunedTaskOutputs: number;
  }> {
    this.assertOperational('performGarbageCollection');
    const prunedFacts = await this._reapExpiredKnowledge();
    const prunedBlobs = await this._reapUnreferencedCASBlobs();
    const prunedTaskOutputs = await this._reapExpiredTaskOutputs();
    
    console.log(`[Cleanup] GC completed. Pruned ${prunedFacts} facts, ${prunedBlobs} CAS blobs, and ${prunedTaskOutputs} task outputs.`);
    return { prunedFacts, prunedBlobs, prunedTaskOutputs };
  }

  /**
   * Prunes nodes that have decayed epistemically (High staleness + Low confidence).
   */
  async performEpistemicSunsetting(confidenceThreshold = 0.2): Promise<number> {
      this.assertOperational('performEpistemicSunsetting');
      console.log(`[Cleanup] Performing Epistemic Sunsetting (threshold: ${confidenceThreshold})...`);
      const allKnowledge = await this.ctx.db.selectWhere('knowledge', [
          { column: 'userId', value: this.ctx.userId }
      ]);
      
      let pruned = 0;
      for (const node of allKnowledge) {
          if (node.confidence < confidenceThreshold) {
              await this.ctx.push({
                  type: 'delete',
                  table: 'knowledge',
                  where: { column: 'id', value: node.id }
              });
              pruned++;
          }
      }
      return pruned;
  }

  private async _reapExpiredKnowledge(): Promise<number> {
    const expired = await this.ctx.db.selectWhere('knowledge', [
        { column: 'expiresAt', value: Date.now(), operator: '<' }
    ]);
    
    if (expired.length === 0) return 0;
    
    await this.ctx.db.push({
        type: 'delete',
        table: 'knowledge',
        where: [
            { column: 'expiresAt', value: Date.now(), operator: '<' },
            { column: 'userId', value: this.ctx.userId }
        ]
    });
    
    return expired.length;
  }

  private async _reapUnreferencedCASBlobs(): Promise<number> {
    const blobsDir = join(this.ctx.workspace.workspacePath, '.broccolidb', 'storage', 'blobs');
    let pruned = 0;

    try {
        const knowledgeRows = await this.ctx.db.selectWhere('knowledge', [
            { column: 'content', value: 'CAS:%', operator: 'LIKE' }
        ]);
        
        const referencedHashes = new Set(knowledgeRows.map(r => (r.content as string).substring(4)));
        
        const shards = await readdir(blobsDir);
        for (const shard of shards) {
            const shardDir = join(blobsDir, shard);
            const stats = await stat(shardDir);
            if (!stats.isDirectory()) continue;

            const files = await readdir(shardDir);
            for (const file of files) {
                if (!referencedHashes.has(file)) {
                    await unlink(join(shardDir, file));
                    pruned++;
                }
            }
        }
    } catch (err) {
        // blobs directory might not exist yet
    }

    return pruned;
  }

  private async _reapExpiredTaskOutputs(maxAgeDays = 7): Promise<number> {
    const taskDir = join(process.cwd(), '.broccolidb', 'tasks');
    let pruned = 0;
    try {
        const files = await readdir(taskDir);
        const now = Date.now();
        const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
        
        for (const file of files) {
            const filePath = join(taskDir, file);
            const stats = await stat(filePath);
            if (now - stats.mtimeMs > maxAge) {
                await unlink(filePath);
                pruned++;
            }
        }
    } catch (err) {
        // tasks dir might not exist
    }
    return pruned;
  }
}
