// [LAYER: CORE]
// @classification CAPABILITY
import type { BroccoliDbHealth } from '../types.js';
import type { StorageCapability } from './StorageCapability.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class SnapshotCapability {
  constructor(
    private readonly storage: StorageCapability,
    private readonly healthFn: (options?: { deep?: boolean }) => Promise<BroccoliDbHealth>,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('snapshots', this.isStarted(), ['StorageCapability']);
  }

  async create(metadata: Record<string, unknown> = {}): Promise<string> {
    this.assertOperational('snapshots.create');
    const payload = {
      metadata,
      createdAt: new Date().toISOString(),
      health: await this.healthFn(),
    };
    return this.storage.store(JSON.stringify(payload));
  }
}
