// [LAYER: CORE]
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { LRUCache } from './lru-cache.js';

export interface EnvironmentMetadata {
  osName: string;
  osVersion: string;
  osArch: string;
  hostName: string;
  nodeVersion: string;
  timestamp: string;
}

/**
 * EnvironmentTracker manages system metadata and pricing estimates.
 */
export const EnvironmentTracker = {
  // Production Parameterized Constants
  CONFIG: {
    DEFAULT_PRICING: {
      'tier-high': { input: 0.01, output: 0.03 },
      'tier-medium': { input: 0.003, output: 0.015 },
      'tier-low': { input: 0.0005, output: 0.0015 },
      default: { input: 0.002, output: 0.008 },
    },
    CACHE_SIZE: 100,
  },

  PRICING: {
    'tier-high': { input: 0.01, output: 0.03 },
    'tier-medium': { input: 0.003, output: 0.015 },
    'tier-low': { input: 0.0005, output: 0.0015 },
    default: { input: 0.002, output: 0.008 },
  } as Record<string, { input: number; output: number }>,

  trackerCache: new LRUCache<
    string,
    { totalCommits: number; totalTokens: number; totalCost: number }
  >(100),

  capture(): EnvironmentMetadata {
    return {
      osName: os.platform(),
      osVersion: os.release(),
      osArch: os.arch(),
      hostName: os.hostname(),
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Configure model pricing rates.
   */
  setPricing(modelId: string, rates: { input: number; output: number }) {
    this.PRICING[modelId] = rates;
  },

  /**
   * Estimates cost for a given usage.
   */
  estimateCost(usage: {
    promptTokens: number;
    completionTokens: number;
    modelId?: string;
    pricingTier?: string;
  }): number {
    const tier = usage.pricingTier || usage.modelId || 'default';
    const rates = this.PRICING[tier] ?? this.PRICING.default;
    return (
      (usage.promptTokens / 1000) * rates.input + (usage.completionTokens / 1000) * rates.output
    );
  },

  /**
   * Persists usage data to the repository's telemetry collection and updates O(1) aggregates.
   */
  async recordUsage(
    db: BufferedDbPool,
    basePath: string,
    agentId: string,
    usage: { promptTokens: number; completionTokens: number; modelId?: string },
    taskId?: string | null
  ) {
    const cost = this.estimateCost(usage);
    const tokens = usage.promptTokens + usage.completionTokens;

    // 1. Detailed Audit Record
    await db.push({
      type: 'insert',
      table: 'telemetry',
      values: {
        id: crypto.randomUUID(),
        repoPath: basePath,
        agentId,
        taskId: taskId || null,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: tokens,
        modelId: usage.modelId || 'default',
        cost,
        timestamp: Date.now(),
        environment: JSON.stringify(this.capture()),
      },
      layer: 'infrastructure',
    });

    const inc = (v: number) => BufferedDbPool.increment(v);

    // 2. Global Aggregates
    await db.push({
      type: 'upsert',
      table: 'telemetry_aggregates',
      where: [
        { column: 'repoPath', value: basePath },
        { column: 'id', value: 'global' },
      ],
      values: {
        repoPath: basePath,
        id: 'global',
        totalCommits: inc(1),
        totalTokens: inc(tokens),
        totalCost: inc(cost),
      },
      layer: 'infrastructure',
    });

    // 3. Agent Aggregates
    await db.push({
      type: 'upsert',
      table: 'telemetry_aggregates',
      where: [
        { column: 'repoPath', value: basePath },
        { column: 'id', value: `agent_${agentId}` },
      ],
      values: {
        repoPath: basePath,
        id: `agent_${agentId}`,
        totalCommits: inc(1),
        totalTokens: inc(tokens),
        totalCost: inc(cost),
      },
      layer: 'infrastructure',
    });

    // 4. Task Aggregates
    if (taskId) {
      await db.push({
        type: 'upsert',
        table: 'telemetry_aggregates',
        where: [
          { column: 'repoPath', value: basePath },
          { column: 'id', value: `task_${taskId}` },
        ],
        values: {
          repoPath: basePath,
          id: `task_${taskId}`,
          totalCommits: inc(1),
          totalTokens: inc(tokens),
          totalCost: inc(cost),
        },
        layer: 'infrastructure',
      });
    }

    // Invalidate caches
    this.trackerCache.delete('global');
    this.trackerCache.delete(`agent_${agentId}`);
    if (taskId) this.trackerCache.delete(`task_${taskId}`);
  },

  getReport(stats: {
    totalCommits: number;
    totalTokens: number;
    totalCost: number;
  }): string {
    const efficiency =
      stats.totalCommits > 0 ? (stats.totalTokens / stats.totalCommits).toFixed(0) : '0';

    return `
=== AgentGit Usage Report ===
Total Commits:  ${stats.totalCommits}
Total Tokens:   ${stats.totalTokens.toLocaleString()}
Estimated Cost: $${stats.totalCost.toFixed(4)}
-----------------------------
Avg Tokens/Commit: ${efficiency}
=============================
    `.trim();
  },

  /**
   * Retrieves aggregate telemetry stats.
   * Optimized to read from pre-computed aggregate documents (O(1)).
   */
  async getStats(
    db: BufferedDbPool,
    basePath: string,
    agentId?: string,
    taskId?: string
  ): Promise<{ totalCommits: number; totalTokens: number; totalCost: number }> {
    let docId = 'global';

    if (taskId) docId = `task_${taskId}`;
    else if (agentId) docId = `agent_${agentId}`;

    const cached = this.trackerCache.get(docId);
    if (cached) return cached;

    const row = await db.selectOne('telemetry_aggregates', [
      { column: 'repoPath', value: basePath },
      { column: 'id', value: docId },
    ]);

    if (!row) {
      return { totalCommits: 0, totalTokens: 0, totalCost: 0 };
    }

    const statsObj = {
      totalCommits: Number(row.totalCommits || 0),
      totalTokens: Number(row.totalTokens || 0),
      totalCost: Number(row.totalCost || 0),
    };
    this.trackerCache.set(docId, statsObj);
    return statsObj;
  },
};


