// [LAYER: CORE]
// @classification CAPABILITY
import type { StorageService } from '../../../infrastructure/storage/StorageService.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class StorageCapability {
  constructor(
    private readonly storage: StorageService,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('storage', this.isStarted(), ['StorageService']);
  }

  async store(content: string): Promise<string> {
    this.assertOperational('storage.store');
    return this.storage.storeContent(content);
  }

  async hydrate(hash: string): Promise<string | null> {
    this.assertOperational('storage.hydrate');
    return this.storage.hydrateContent(hash);
  }
}
