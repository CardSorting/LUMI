// [LAYER: CORE]
// @classification CAPABILITY
import type { BroccoliDbHealth } from '../types.js';
import { CapabilityBase } from '../CapabilityBase.js';
import type { IntentTracer } from '../IntentTracer.js';
import {
  type SnapshotCreateInput,
  type SnapshotCreateResult,
  type StorageStoreInput,
  type StorageStoreResult,
} from '../capability-types.js';

export type SnapshotStorePort = (input: StorageStoreInput) => Promise<StorageStoreResult>;

export class SnapshotCapability extends CapabilityBase {
  readonly name = 'snapshots' as const;
  readonly dependencies = ['StorageService'] as const;

  constructor(
    private readonly storeContent: SnapshotStorePort,
    private readonly healthFn: (options?: { deep?: boolean }) => Promise<BroccoliDbHealth>,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean,
    intentTracer: IntentTracer
  ) {
    super(assertStarted, isStarted, intentTracer);
  }

  async create(input: SnapshotCreateInput = {}): Promise<SnapshotCreateResult> {
    return this.execute(
      'create',
      async () => {
      const payload = {
        metadata: input.metadata ?? {},
        createdAt: new Date().toISOString(),
        health: await this.healthFn(),
      };
      const stored = await this.storeContent({
        content: JSON.stringify(payload),
        namespace: 'snapshot',
      });
      return { hash: stored.hash };
      },
      {
        input,
        inputSummary: { hasMetadata: Boolean(input.metadata) },
        expectedEffects: ['StorageService.storeContent'],
        durability: 'durable',
        summarizeResult: (result) => ({ hash: result.hash }),
      }
    );
  }
}
