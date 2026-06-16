// [LAYER: CORE]
// @classification CAPABILITY
import type { BroccoliDbHealth } from '../types.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  type SnapshotCreateInput,
  type SnapshotCreateResult,
  type StorageStoreInput,
  type StorageStoreResult,
} from '../capability-types.js';

export type SnapshotStorePort = (input: StorageStoreInput) => Promise<StorageStoreResult>;

export class SnapshotCapability extends CapabilityBase {
  readonly name = 'snapshots';
  readonly dependencies = ['StorageService'] as const;

  constructor(
    private readonly storeContent: SnapshotStorePort,
    private readonly healthFn: (options?: { deep?: boolean }) => Promise<BroccoliDbHealth>,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  async create(input: SnapshotCreateInput = {}): Promise<SnapshotCreateResult> {
    return this.execute('create', async () => {
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
    });
  }
}
