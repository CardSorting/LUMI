// [LAYER: CORE]
// @classification CAPABILITY
import type { BroccoliDbHealth } from '../types.js';
import type { StorageCapability } from './StorageCapability.js';

export class SnapshotCapability {
  constructor(
    private readonly storage: StorageCapability,
    private readonly health: (options?: { deep?: boolean }) => Promise<BroccoliDbHealth>,
    private readonly assertOperational: (operation: string) => void
  ) {}

  async snapshot(metadata: Record<string, unknown> = {}): Promise<string> {
    this.assertOperational('snapshot');
    const payload = {
      metadata,
      createdAt: new Date().toISOString(),
      health: await this.health(),
    };
    return this.storage.store(JSON.stringify(payload));
  }
}
